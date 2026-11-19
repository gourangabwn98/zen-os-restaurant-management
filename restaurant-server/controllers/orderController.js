// controllers/orderController.js
// ─────────────────────────────────────────────────────────────────────────────
// Thin HTTP layer. All real logic (pricing, RBAC, state machine, idempotency,
// KOT creation) lives in services/orderService.js so it's identical no matter
// whether the caller is the Customer app, Waiter app, or Admin panel.
// ─────────────────────────────────────────────────────────────────────────────

import {
  placeOrderTx, confirmOrderTx, cancelOrderTx, assertCanViewOrder, modifyOrderItemsTx,
  priceOrderDraft, getSourceFromUser,
} from "../services/orderService.js";
import { kickDeliveryForOrder } from "../services/deliveryRealtime.js";
import {
  emitNewOrderPendingConfirmation, emitOrderCancelled, emitOrderConfirmed,
  emitSentToKitchen, emitOrderModified, emitKitchenOrderModified,
} from "../sockets/socket.js";
import { normalizeDiningArea, DINING_AREA_AC_ROOM } from "../utils/diningArea.js";
import { acRateFor, parseGuests } from "../services/acServiceCharge.js";


// ── POST /api/orders ──────────────────────────────────────────────────────
// Shared by: guest customer (QR ordering), logged-in customer, waiter (POS),
// admin (rush-order modal). Source + initial status are derived server-side
// from the authenticated identity — never trust the client for either.
export const placeOrder = async (req, res) => {
  try {
    const { order, alreadyExisted, kotJob, kotCreated, guestAccessToken, inventoryAlerts } = await placeOrderTx({
      req, body: req.body,
    });

    // Hard invariant: we never tell a client "order placed" without a real,
    // persisted order document in hand. If this ever trips, something in
    // placeOrderTx resolved without creating/finding an order — treat it as a
    // failure, never a success.
    if (!order || !order._id) {
      console.error("placeOrder: placeOrderTx resolved without an order document");
      return res.status(500).json({ message: "Order could not be created. Please try again." });
    }

    if (!alreadyExisted) {
      if (order.status === "PENDING_CONFIRMATION") {
        // Customer order — waits for a waiter/admin to accept it.
        emitNewOrderPendingConfirmation(req.tenantKey, order);
      } else if (order.status === "CONFIRMED") {
        // Staff order — Placed, editable until its timer.
        emitOrderConfirmed(req.tenantKey, order);
      } else if (order.status === "PREPARING") {
        // 0-minute edit window → straight to preparing (KOT printed).
        emitSentToKitchen(req.tenantKey, { order, kotJob, kotCreated, inventoryAlerts });
      }
      // AWAITING_PAYMENT (pay-first): nothing to staff yet — the order is
      // announced as new only once a verified payment promotes it
      // (controllers/paymentController.js → emitPayFirstPromoted).
    }

    res.status(alreadyExisted ? 200 : 201).json({
      ...order.toObject(),
      ...(guestAccessToken ? { guestAccessToken } : {}),
      ...(kotJob ? { kotJobId: kotJob._id } : {}),
    });
  } catch (err) {
    // Full error server-side (stack + duplicate-key details) for debugging;
    // only a safe message goes to the client.
    console.error("placeOrder error:", err);
    const status = err.statusCode || (err.code === 11000 ? 409 : 400);
    const clientMessage =
      err.code === 11000
        ? "Could not place the order due to a conflict. Please try again."
        : err.message || "Could not place the order.";
    res.status(status).json({ message: clientMessage, ...(typeof err.code === "string" && { code: err.code }), ...(err.details && { details: err.details }) });
  }
};

// ── POST /api/orders/quote — the cart's live bill (saves nothing) ───────────
// Same pricing path as placing the order (orderService.priceOrderDraft), so
// "Total payable" in the cart is the amount the order will be stored with.
// A coupon problem (expired, not started, login needed, below minimum) comes
// back as couponError next to the un-discounted bill — never a failed quote.
export const quoteOrder = async (req, res) => {
  try {
    const { items, couponCode, orderType, tableNo, tableToken } = req.body || {};
    const guests = parseGuests(req.body?.guests);
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ message: "Add at least one item" });
    const source = getSourceFromUser(req.user);
    const isStaffOrder = source === "ADMIN" || source === "WAITER";
    const restaurant = await req.models.RestaurantProfile.findOne();
    let acServiceCharge = 0;
    let acServiceRate = null;
    // Customer QR quote: use the same table metadata and AC rate as placeOrderTx.
    // Staff quotes retain their existing behavior and do not enter this path.
    if (!isStaffOrder && orderType === "DINE_IN" && tableNo && tableToken) {
      const table = await req.models.Table.findOne({ tableNo: Number(tableNo) }).select("tableNo status qrToken diningArea").lean();
      const validQr = table?.status === "Active" && table.qrToken === tableToken;
      const isAcRoom = validQr && normalizeDiningArea(table.diningArea || "", orderType) === DINING_AREA_AC_ROOM;
      if (isAcRoom) {
        acServiceRate = acRateFor(null, restaurant);
        const open = req.models.TableSession && await req.models.TableSession.findOne({ tableNo: table.tableNo, status: "OPEN" }).select("_id").lean();
        const counted = open && await req.models.Order.findOne({ tableSession: open._id, status: { $ne: "CANCELLED" }, guests: { $gt: 0 } }).select("_id").lean();
        if (!counted && guests != null) acServiceCharge = Math.round(guests * acServiceRate * 100) / 100;
      }
    }
    const shape = (p) => ({
      items: p.dbItems.map((i) => ({ menuItemId: i.menuItem, name: i.name, price: i.price, qty: i.qty, lineTotal: i.price * i.qty })),
      subtotal: p.subtotal, discount: p.discount, tax: p.tax, serviceCharge: p.serviceCharge, total: p.total,
      coupon: p.coupon, gstRate: restaurant?.gstRate || 0, acServiceCharge, acServiceRate,
    });
    const base = await priceOrderDraft({ req, items, isStaffOrder, restaurant, acServiceCharge });
    if (!couponCode || isStaffOrder) return res.json({ ...shape(base), couponError: null });
    try {
      const withCoupon = await priceOrderDraft({ req, items, couponCode, isStaffOrder, restaurant, acServiceCharge });
      return res.json({ ...shape(withCoupon), couponError: null });
    } catch (err) {
      if (!err.statusCode || err.statusCode >= 500) throw err;
      return res.json({ ...shape(base), couponError: { message: err.message, ...(typeof err.code === "string" && { code: err.code }) } });
    }
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── PATCH /api/orders/:id/confirm  (also mounted as /approve for back-compat)
// Admin/waiter accepts a customer order: PENDING_CONFIRMATION → CONFIRMED
// ("Placed"), starting its edit window. No KOT yet — that prints when it
// moves to PREPARING (or right away with a 0-minute window).
export const confirmOrder = async (req, res) => {
  try {
    const { order, kotJob, kotCreated, inventoryAlerts } = await confirmOrderTx({ req, orderId: req.params.id });

    emitOrderConfirmed(req.tenantKey, order);
    if (order.status === "PREPARING") emitSentToKitchen(req.tenantKey, { order, kotJob, kotCreated, inventoryAlerts });
    kickDeliveryForOrder(req, order); // home delivery: broadcast to riders now (D1)

    res.json({
      message: "Order accepted",
      order,
      kotJob,
      kotAlreadyExisted: !kotCreated,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// legacy name — same route, same behaviour
export const approveOrder = confirmOrder;

// ── PATCH /api/orders/:id/reject ─────────────────────────────────────────
// Staff declining a PENDING_CONFIRMATION (or later) order. Thin wrapper
// around the same cancel logic used everywhere else.
export const rejectOrder = async (req, res) => {
  try {
    const order = await cancelOrderTx({
      req, orderId: req.params.id, reason: req.body?.reason || "Rejected by staff",
    });
    emitOrderCancelled(req.tenantKey, order, order.cancelReason);
    kickDeliveryForOrder(req, order);
    res.json({ message: "Order rejected", order });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── DELETE /api/orders/:id (cancel) ──────────────────────────────────────
// Logged-in customer (own order), guest (via x-guest-order-token), or staff.
export const cancelOrder = async (req, res) => {
  try {
    const order = await cancelOrderTx({
      req, orderId: req.params.id, reason: req.body?.reason || "",
    });
    emitOrderCancelled(req.tenantKey, order, order.cancelReason);
    kickDeliveryForOrder(req, order);
    res.json({ message: "Order cancelled", order });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── GET /api/orders/my ────────────────────────────────────────────────────
export const getMyOrders = async (req, res) => {
  try {
    const { Order } = req.models;
    const filter = req.user ? { user: req.user._id } : { isGuest: true };
    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(20);
    res.json(orders);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── GET /api/orders/:id ───────────────────────────────────────────────────
export const getOrderById = async (req, res) => {
  try {
    const { Order } = req.models;
    const order = await Order.findById(req.params.id).populate("user", "name phone email");
    if (!order) return res.status(404).json({ message: "Order not found" });

    assertCanViewOrder(req, order);
    res.json(order);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── PATCH /api/orders/:id/items  { items: [{ menuItemId, qty, notes }], revision }
// Edit a Placed order before it starts preparing — admin, waiter, or the
// customer (JWT owner / guest token). Rules live in modifyOrderItemsTx.
export const modifyOrderItems = async (req, res) => {
  try {
    const { order, kotChange, inventoryAlerts } = await modifyOrderItemsTx({
      req, orderId: req.params.id, items: req.body?.items, revision: req.body?.revision,
    });
    // kotChange is set only when the kitchen already had it (admin/manager edit).
    if (kotChange) emitKitchenOrderModified(req.tenantKey, { order, kotChange, inventoryAlerts });
    else emitOrderModified(req.tenantKey, order);
    res.json(order);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};
