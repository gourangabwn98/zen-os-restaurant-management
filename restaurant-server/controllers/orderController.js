// controllers/orderController.js
// ─────────────────────────────────────────────────────────────────────────────
// Thin HTTP layer. All real logic (pricing, RBAC, state machine, idempotency,
// KOT creation) lives in services/orderService.js so it's identical no matter
// whether the caller is the Customer app, Waiter app, or Admin panel.
// ─────────────────────────────────────────────────────────────────────────────

import {
  placeOrderTx, confirmOrderTx, cancelOrderTx, assertCanViewOrder,
} from "../services/orderService.js";
import {
  emitNewOrderPendingConfirmation, emitOrderConfirmed,
  emitOrderCancelled, emitKotCreated, emitInventoryAlert,
} from "../sockets/socket.js";

const emitAlerts = (tenantKey, alerts) => {
  for (const a of alerts || []) emitInventoryAlert(tenantKey, a);
};

// ── POST /api/orders ──────────────────────────────────────────────────────
// Shared by: guest customer (QR ordering), logged-in customer, waiter (POS),
// admin (rush-order modal). Source + initial status are derived server-side
// from the authenticated identity — never trust the client for either.
export const placeOrder = async (req, res) => {
  try {
    const { order, alreadyExisted, kotJob, guestAccessToken, inventoryAlerts } = await placeOrderTx({
      req, body: req.body,
    });

    if (!alreadyExisted) {
      if (order.status === "PENDING_CONFIRMATION") {
        emitNewOrderPendingConfirmation(req.tenantKey, order);
      } else {
        // staff-placed → already confirmed
        emitOrderConfirmed(req.tenantKey, order);
      }
      emitAlerts(req.tenantKey, inventoryAlerts);
    }

    res.status(alreadyExisted ? 200 : 201).json({
      ...order.toObject(),
      ...(guestAccessToken ? { guestAccessToken } : {}),
      ...(kotJob ? { kotJobId: kotJob._id } : {}),
    });
  } catch (err) {
    console.error("placeOrder error:", err.message);
    res.status(err.statusCode || 400).json({ message: err.message });
  }
};

// ── PATCH /api/orders/:id/confirm  (also mounted as /approve for back-compat)
// Admin/waiter only (enforced by route middleware). Moves
// PENDING_CONFIRMATION → CONFIRMED and creates the order's (single,
// idempotent) KOT job in one transaction.
export const confirmOrder = async (req, res) => {
  try {
    const { order, kotJob, kotCreated, inventoryAlerts } = await confirmOrderTx({ req, orderId: req.params.id });

    emitOrderConfirmed(req.tenantKey, order);
    if (kotCreated) emitKotCreated(req.tenantKey, kotJob);
    emitAlerts(req.tenantKey, inventoryAlerts);

    res.json({
      message: "Order confirmed",
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
