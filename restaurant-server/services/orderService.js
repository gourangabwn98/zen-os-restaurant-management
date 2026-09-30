// services/orderService.js
// ─────────────────────────────────────────────────────────────────────────────
// The single, reliable order system shared by the Customer app, Waiter app,
// and Admin panel. Every controller (customer ordering, waiter POS, admin
// dashboard) calls into these functions instead of writing to the Order
// collection directly, so pricing rules, status transitions, ownership
// checks, and KOT creation can never drift between the three surfaces.
// ─────────────────────────────────────────────────────────────────────────────

import { priceOrder, priceItems, computeTotals } from "../utils/pricing.js";
import { resolveCouponForOrder } from "./couponService.js";
import { getScheduleContext } from "./menuScheduleService.js";
import { normalizeOrderType, assertValidTransition, requiresPaidForTransition } from "../utils/orderStateMachine.js";
import { createKotJobForOrder } from "./kotService.js";
import { findOrOpenTableSession, closeTableSession } from "./tableSessionService.js";
import { findNextMatch } from "./waitlistService.js";
import { signGuestOrderToken, verifyGuestOrderToken } from "../utils/guestOrderToken.js";
import {
  deductStockForOrder, reverseStockForOrder, calculateRecipeConsumption, validateInventoryForConsumption,
} from "./inventoryService.js";
import { isPhonePeConfigured } from "./paymentService.js";
import { resolveCustomerPaymentMethod, isPayFirst, PAYMENT_METHODS, PAY_FIRST_WINDOW_MS } from "../utils/paymentMode.js";

// ── Identity helpers ──────────────────────────────────────────────────────

/** Lowercase role: "admin" | "waiter" | "customer" — never trust req.body for this. */
export const getRoleFromUser = (user) => {
  if (!user) return "customer";
  if (user.isAdmin) return "admin";
  return user.role || "customer";
};

/** Uppercase order "source" enum value derived from the authenticated identity.
 * Deliberately only CUSTOMER/WAITER/ADMIN — chefs never *create* an order,
 * so "source" (who placed it) is a narrower concept than "actor" (who
 * performed a given action) below. */
export const getSourceFromUser = (user) => {
  const role = getRoleFromUser(user);
  if (role === "admin") return "ADMIN";
  if (role === "waiter") return "WAITER";
  return "CUSTOMER";
};

/** Uppercase actor role for audit fields (createdBy/confirmedBy/preparedBy/
 * readyBy/...). Broader than getSourceFromUser — chef is a legitimate actor
 * on an order (e.g. preparedBy) even though a chef can never be the order's
 * *source*. Getting this wrong would mis-attribute a chef's action as
 * "CUSTOMER" (getSourceFromUser's fallback), which is both misleading and
 * wrong for reporting/statistics. */
const getActorRole = (user) => {
  const role = getRoleFromUser(user);
  if (role === "admin") return "ADMIN";
  if (role === "waiter") return "WAITER";
  if (role === "chef") return "CHEF";
  return "CUSTOMER";
};

const buildActor = (user, fallbackName) => ({
  id:   user?._id || null,
  role: user ? getActorRole(user) : "GUEST",
  name: user?.name || user?.waiterName || fallbackName || (user ? "Staff" : "Guest"),
});

// ── Place order ────────────────────────────────────────────────────────────
/**
 * Central "place an order" entry point for customer (guest or logged in),
 * waiter, and admin. Source and initial status are always derived from the
 * authenticated identity server-side — a client can never claim to be staff.
 *
 * Staff (waiter/admin) orders start CONFIRMED ("Placed"); customer orders
 * start PENDING_CONFIRMATION ("Awaiting confirmation") until staff accept
 * them (confirmOrderTx). A Placed order is editable until autoPrepareAt
 * (default 3 min), then sendToKitchenTx moves it to PREPARING with the stock
 * deduction + KOT in one transaction. Pay-first orders start
 * AWAITING_PAYMENT (utils/paymentMode.js).
 *
 * A waiter must be ON_DUTY to reach this at all — enforced by the
 * requireWaiterOnDuty route middleware (routes/orderRoutes.js), not here,
 * so it applies uniformly across every route this function is reachable
 * from without this function needing to know which route called it.
 */
export const placeOrderTx = async ({ req, body }) => {
  // Chefs are kitchen-only — placing an order (as themselves or as an
  // accidental "customer" via getSourceFromUser's fallback) is outside
  // their role entirely, and not something the Kitchen app's UI ever
  // triggers, so this should only ever fire on a direct/malicious API call.
  if (getRoleFromUser(req.user) === "chef") {
    const err = new Error("Chef accounts cannot place orders");
    err.statusCode = 403;
    throw err;
  }

  const { Order, MenuItem, RestaurantProfile, Table, TableSession } = req.models;
  const {
    items, orderType, tableNo, tableToken, notes,
    customerName, customerPhone, paymentMethod, idempotencyKey, priority, couponCode,
  } = body;

  // ── Idempotency: replay-safe "place order" ────────────────────────────────
  if (idempotencyKey) {
    const existing = await Order.findOne({ idempotencyKey });
    if (existing) return { order: existing, alreadyExisted: true };
  }

  const source       = getSourceFromUser(req.user);
  const isStaffOrder = source === "ADMIN" || source === "WAITER";
  const normalizedType = normalizeOrderType(orderType);

  if (normalizedType === "DINE_IN" && !tableNo) {
    const err = new Error("Table number is required for dine-in orders");
    err.statusCode = 400;
    throw err;
  }

  const restaurant = await RestaurantProfile.findOne();

  // ── Payment method (utils/paymentMode.js) ─────────────────────────────────
  // Customers are held to the restaurant's payment mode; a pay-first order
  // (Online + PhonePe) starts AWAITING_PAYMENT and stays invisible to staff
  // until a verified payment promotes it (promotePaidOrder). Staff-keyed
  // orders are taken in person and only need a valid method.
  const phonePeEnabled = isPhonePeConfigured();
  let method;
  if (isStaffOrder) {
    method = paymentMethod ?? "Cash";
    if (!PAYMENT_METHODS.includes(method)) {
      const err = new Error(`paymentMethod must be one of: ${PAYMENT_METHODS.join(", ")}`);
      err.statusCode = 400;
      throw err;
    }
  } else {
    method = resolveCustomerPaymentMethod({ requested: paymentMethod, mode: restaurant?.paymentMode, phonePeEnabled });
  }
  const payFirst = !isStaffOrder && isPayFirst(method, phonePeEnabled);

  const scheduleCtx = await getScheduleContext({ models: req.models, profile: restaurant });
  const dbItems = await priceItems(items, MenuItem, scheduleCtx);
  // Coupons are a customer checkout feature: validated against the
  // server-priced item subtotal and the server clock (couponService); the
  // client only sends the code. Staff orders don't take one.
  const coupon = isStaffOrder ? null : await resolveCouponForOrder({
    models: req.models, code: couponCode, subtotal: dbItems.reduce((s, i) => s + i.price * i.qty, 0),
  });
  const { subtotal, tax, serviceCharge, discount, total } = computeTotals(dbItems, restaurant, coupon);

  // ── Table / QR verification (soft — see schema comment) + session ─────────
  let tableSessionId = null;
  let tableVerified  = false;

  if (normalizedType === "DINE_IN" && tableNo) {
    const tableDoc = await Table.findOne({ tableNo: Number(tableNo) });
    if (!tableDoc || tableDoc.status !== "Active") {
      const err = new Error(`Table ${tableNo} is not available`);
      err.statusCode = 400;
      throw err;
    }

    if (isStaffOrder) {
      tableVerified = true; // trusted staff placing the order in person
    } else if (tableToken) {
      tableVerified = !!tableDoc.qrToken && tableToken === tableDoc.qrToken;
      if (!tableVerified) {
        const err = new Error("Invalid table QR code — please rescan the QR at your table.");
        err.statusCode = 400;
        throw err;
      }
    }
    // else: guest didn't send a token (today's customer app doesn't yet) —
    // order still proceeds, just tableVerified stays false for audit/reporting.

    // A pay-first order must not occupy the table until it's paid — it joins
    // the table session in promotePaidOrder instead.
    if (!payFirst) {
      const sessionActor = buildActor(req.user, customerName);
      const session = await findOrOpenTableSession({ TableSession, Table, table: tableDoc, actor: sessionActor });
      tableSessionId = session._id;
    }
  }

  // Staff (waiter/admin) orders start CONFIRMED ("Placed") — the person
  // keying it in IS the acceptance. Customer orders start
  // PENDING_CONFIRMATION ("Awaiting confirmation") until a waiter/admin
  // accepts them (confirmOrderTx). A Placed order stays editable until
  // autoPrepareAt (RestaurantProfile.editWindowMinutes, default 3), then
  // sendToKitchenTx moves it to PREPARING and prints the KOT.
  const initialStatus = payFirst ? "AWAITING_PAYMENT" : isStaffOrder ? "CONFIRMED" : "PENDING_CONFIRMATION";
  const actor = buildActor(req.user, customerName);
  const now = new Date();
  const autoPrepareAt = initialStatus === "CONFIRMED" ? new Date(now.getTime() + editWindowMs(restaurant)) : null;

  // Fail now — not minutes later at the kitchen — if stock clearly can't
  // cover it. (Deduction itself still happens exactly once, at
  // sendToKitchenTx, guarded atomically.)
  await assertStockForItems({ models: req.models, items: dbItems });

  const orderPayload = {
    user:          req.user ? req.user._id : null,
    isGuest:       !req.user,
    items:         dbItems,
    subtotal, tax, serviceCharge, discount, total,
    coupon,
    orderType:     normalizedType,
    tableNo:       tableNo ? Number(tableNo) : null,
    tableSession:  tableSessionId,
    tableVerified,
    source,
    createdBy:     actor,
    status:        initialStatus,
    confirmedBy:   initialStatus === "CONFIRMED" ? actor : null,
    confirmedAt:   initialStatus === "CONFIRMED" ? now : null,
    // A customer may cancel while it's awaiting confirmation (the state
    // machine stops them once staff accept it) — no time limit.
    cancelDeadline: null,
    autoPrepareAt,
    notes:         notes || "",
    waiterName:    source === "WAITER" ? (req.user?.waiterName || req.user?.name || "") : "",
    waiterId:      source === "WAITER" ? req.user?._id : null,
    // Staff-only — a customer/guest can never mark their own order urgent.
    priority:      isStaffOrder && priority === "URGENT" ? "URGENT" : "NORMAL",
    guestName:     customerName  || "",
    guestPhone:    customerPhone || "",
    paymentMethod: method,
    paymentStatus: "PENDING_VERIFICATION",
    paymentDeadline: payFirst ? new Date(now.getTime() + PAY_FIRST_WINDOW_MS) : null,
    idempotencyKey: idempotencyKey || undefined,
    statusHistory: [{ status: initialStatus, changedBy: actor, changedAt: now, note: payFirst ? "Order placed — waiting for online payment" : "Order placed" }],
  };

  // Single insert — no stock or KOT is written until the order goes to
  // PREPARING, so no transaction is needed here.
  let order;
  try {
    order = await Order.create(orderPayload);
  } catch (err) {
    // Only treat a duplicate-key error as an idempotent replay when we
    // actually HAVE a key to look the original up by. Without the
    // `&& idempotencyKey` guard, a keyless order that hit any 11000 would
    // `findOne({ idempotencyKey: undefined })` → `findOne({})` → return an
    // arbitrary existing order as a false success.
    if (err?.code === 11000 && err.keyPattern?.idempotencyKey && idempotencyKey) {
      const raced = await Order.findOne({ idempotencyKey });
      if (raced) return { order: raced, alreadyExisted: true };
    }
    throw err;
  }

  if (tableSessionId) {
    await TableSession.findByIdAndUpdate(tableSessionId, { $addToSet: { orders: order._id } });
  }

  const guestAccessToken = !req.user ? signGuestOrderToken(order._id) : null;

  // Edit window of 0 minutes → a staff order goes straight to PREPARING.
  let kotJob = null, kotCreated = false, inventoryAlerts = [];
  if (autoPrepareAt && autoPrepareAt.getTime() <= now.getTime()) {
    const sent = await sendToKitchenTx({
      models: req.models, db: req.db, orderId: order._id, actor, role: getRoleFromUser(req.user),
    });
    ({ order, kotJob, kotCreated, inventoryAlerts } = sent);
  }

  return { order, alreadyExisted: false, kotJob, kotCreated, guestAccessToken, inventoryAlerts };
};

// ── Edit window helpers ────────────────────────────────────────────────────
const SYSTEM_ACTOR = { id: null, role: null, name: "System" };
const MAX_EDIT_WINDOW_MIN = 15;

/** RestaurantProfile.editWindowMinutes → ms (default 3 min, clamped 0–15). */
export const editWindowMs = (profile) => {
  const raw = profile?.editWindowMinutes == null ? NaN : Number(profile.editWindowMinutes);
  const min = Number.isFinite(raw) ? Math.min(MAX_EDIT_WINDOW_MIN, Math.max(0, raw)) : 3;
  return min * 60 * 1000;
};

/** Throws 409 (listing what's short) if stock can't cover these order lines. */
const assertStockForItems = async ({ models, items }) => {
  const { Recipe, InventoryItem } = models;
  const consumption = await calculateRecipeConsumption({ Recipe, order: { items } });
  await validateInventoryForConsumption({ InventoryItem, consumption });
};

// ── Send to kitchen (CONFIRMED "Placed" → PREPARING) ───────────────────────
/**
 * The single place an order reaches the kitchen: the edit-window timer
 * (role "system"), "Start preparing" (admin/waiter/chef), or a 0-minute
 * window. ONE transaction: the status write (conditional on CONFIRMED, so it
 * can only ever happen once), the stock deduction and the KOT job — the KOT
 * prints exactly when the order becomes PREPARING, and stock never moves
 * without a ticket.
 */
export const sendToKitchenTx = async ({ models, db, orderId, actor, role }) => {
  const { Order, KOTJob } = models;
  const current = await Order.findById(orderId);
  if (!current) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }
  assertValidTransition(current.status, "PREPARING", role);

  const session = await db.startSession();
  let sentOrder, kotResult, inventoryAlerts = [];
  try {
    await session.withTransaction(async () => {
      const now = new Date();
      const updated = await Order.findOneAndUpdate(
        { _id: orderId, status: "CONFIRMED" },
        {
          $set: { status: "PREPARING", preparedBy: actor, preparingAt: now, autoPrepareAt: null, sendError: "" },
          $push: { statusHistory: { status: "PREPARING", changedBy: actor, changedAt: now } },
        },
        { new: true, session },
      );
      if (!updated) {
        const err = new Error("This order is no longer Placed (already preparing or cancelled)");
        err.statusCode = 409;
        throw err;
      }
      sentOrder = updated;
      const stockResult = await deductStockForOrder({ models, order: updated, actor, session });
      inventoryAlerts = stockResult.alerts || [];
      kotResult = await createKotJobForOrder({ KOTJob, order: updated, actor, session });
    });
  } finally {
    session.endSession();
  }

  return { order: sentOrder, kotJob: kotResult.job, kotCreated: kotResult.created, inventoryAlerts };
};

// ── Accept a customer order (PENDING_CONFIRMATION → CONFIRMED "Placed") ────
/**
 * Admin/waiter accepts it. Atomic, so two staff tapping at once can't both
 * win. Starts the edit window; no stock or KOT yet (that's at PREPARING).
 * With a 0-minute window it goes on to PREPARING straight away.
 * Returns { order, kotJob?, kotCreated?, inventoryAlerts? }.
 */
export const confirmOrderTx = async ({ req, orderId }) => {
  const { Order, RestaurantProfile } = req.models;
  const role = getRoleFromUser(req.user);
  const current = await Order.findById(orderId);
  if (!current) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }
  assertValidTransition(current.status, "CONFIRMED", role);

  const actor = buildActor(req.user);
  const now = new Date();
  const autoPrepareAt = new Date(now.getTime() + editWindowMs(await RestaurantProfile.findOne()));
  const updated = await Order.findOneAndUpdate(
    { _id: orderId, status: "PENDING_CONFIRMATION" },
    {
      $set: { status: "CONFIRMED", confirmedBy: actor, confirmedAt: now, autoPrepareAt, sendError: "" },
      $push: { statusHistory: { status: "CONFIRMED", changedBy: actor, changedAt: now, note: "Order accepted" } },
    },
    { new: true },
  );
  if (!updated) {
    const err = new Error("Order is no longer awaiting confirmation (already accepted or cancelled)");
    err.statusCode = 409;
    throw err;
  }
  if (autoPrepareAt.getTime() <= now.getTime()) {
    return sendToKitchenTx({ models: req.models, db: req.db, orderId, actor, role });
  }
  return { order: updated, kotJob: null, kotCreated: false, inventoryAlerts: [] };
};

/**
 * Background tick (server.js): moves every Placed order whose edit window
 * has run out to PREPARING (KOT prints). If that fails (e.g. an ingredient ran out meanwhile)
 * the order is parked with `sendError` for staff to sort out — it is not
 * retried every tick. Safe on several instances: sendToKitchenTx's write is
 * conditional on PENDING_CONFIRMATION, so only one caller ever wins.
 */
export const autoSendDueOrders = async ({ models, db, now = new Date(), onSent, onFailed, limit = 50 }) => {
  const { Order } = models;
  const due = await Order.find({
    status: "CONFIRMED", autoPrepareAt: { $ne: null, $lte: now }, sendError: { $in: ["", null] },
  }).select("_id").limit(limit).lean();

  const results = { sent: 0, failed: 0 };
  for (const { _id } of due) {
    try {
      const r = await sendToKitchenTx({ models, db, orderId: _id, actor: SYSTEM_ACTOR, role: "system" });
      results.sent++;
      onSent?.(r);
    } catch (err) {
      if (err.statusCode === 409 && /no longer Placed/.test(err.message)) continue; // lost a race — fine
      const parked = await Order.findOneAndUpdate(
        { _id, status: "CONFIRMED" },
        { $set: { sendError: String(err.message || "Could not start preparing").slice(0, 300), autoPrepareAt: null } },
        { new: true },
      );
      results.failed++;
      if (parked) onFailed?.(parked);
    }
  }
  return results;
};

// ── Edit an order while it is still editable ───────────────────────────────
/**
 * Replaces the order's items (add / remove / change qty / notes) while it is
 * still PENDING_CONFIRMATION. Admin and waiter may always edit; the customer
 * (owner, or guest with their order token) may too — except once it has been
 * paid online, since the paid amount would no longer match.
 *
 * Prices are re-derived server-side from the menu (utils/pricing.js), never
 * taken from the client. `revision` must be the order's current revision —
 * a stale one (someone else edited first) is refused with 409, as is an edit
 * racing the send to the kitchen (the write is conditional on the status).
 */
export const modifyOrderItemsTx = async ({ req, orderId, items, revision }) => {
  const { Order, MenuItem, RestaurantProfile } = req.models;
  const order = await Order.findById(orderId);
  if (!order) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }

  const role = getRoleFromUser(req.user);
  const isStaff = role === "admin" || role === "waiter";
  if (role === "chef") {
    const err = new Error("Chef accounts cannot edit orders");
    err.statusCode = 403;
    throw err;
  }
  if (!isStaff) {
    // Strict ownership (stricter than viewing): owner, or a valid guest token.
    const owner = order.user?._id ?? order.user;
    const ok = req.user
      ? owner && String(owner) === String(req.user._id)
      : verifyGuestOrderToken(req.headers["x-guest-order-token"], order._id);
    if (!ok) {
      const err = new Error("Not authorized to edit this order");
      err.statusCode = 403;
      throw err;
    }
    if (order.paymentStatus === "PAID") {
      const err = new Error("This order is already paid — please ask a waiter to change it");
      err.statusCode = 409;
      throw err;
    }
  }

  // Only a Placed order that hasn't reached the kitchen (no KOT / stock yet —
  // an admin could move a later order back to CONFIRMED) can be changed.
  if (order.status !== "CONFIRMED" || order.stockDeducted) {
    const err = new Error(
      order.status === "PENDING_CONFIRMATION" ? "This order can be changed once the restaurant accepts it"
      : order.status === "AWAITING_PAYMENT" ? "Pay for the order first, or cancel it and order again"
      : "This order is already being prepared and can't be changed");
    err.statusCode = 409;
    throw err;
  }
  if (!Number.isInteger(revision)) {
    const err = new Error("revision is required");
    err.statusCode = 400;
    throw err;
  }
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error("An order needs at least one item — cancel it instead of removing everything");
    err.statusCode = 400;
    throw err;
  }
  if (items.length > 50) {
    const err = new Error("Too many lines in one order");
    err.statusCode = 400;
    throw err;
  }
  for (const it of items) {
    if (!it?.menuItemId || !Number.isInteger(Number(it.qty)) || Number(it.qty) < 1 || Number(it.qty) > 99) {
      const err = new Error("Each item needs a menu item and a quantity from 1 to 99");
      err.statusCode = 400;
      throw err;
    }
  }

  const restaurant = await RestaurantProfile.findOne();
  const scheduleCtx = await getScheduleContext({ models: req.models, profile: restaurant });
  const { dbItems, subtotal, tax, serviceCharge, discount, total } =
    await priceOrder({ items, MenuItem, restaurantProfile: restaurant, scheduleCtx, coupon: order.coupon });
  await assertStockForItems({ models: req.models, items: dbItems });

  const actor = buildActor(req.user, order.guestName);
  let note = order.paymentStatus === "PAID" && total !== order.total
    ? `Order changed by ${actor.name} after payment — paid ₹${order.total}, new total ₹${total}`
    : `Order changed by ${actor.name}`;
  // The coupon's own terms are re-applied (the order keeps its snapshot); it
  // stops discounting if the change took the order below its minimum.
  if (order.coupon && order.discount > 0 && discount === 0) {
    note += ` — coupon ${order.coupon.code} no longer applies (below ₹${order.coupon.minOrderAmount} minimum)`;
  }

  const updated = await Order.findOneAndUpdate(
    { _id: orderId, status: "CONFIRMED", stockDeducted: { $ne: true }, revision },
    {
      $set: { items: dbItems, subtotal, tax, serviceCharge, discount, total },
      $inc: { revision: 1 },
      $push: { statusHistory: { status: "CONFIRMED", changedBy: actor, changedAt: new Date(), note } },
    },
    { new: true },
  );
  if (!updated) {
    const fresh = await Order.findById(orderId).select("status revision");
    const err = new Error(fresh?.status !== "CONFIRMED"
      ? "This order has just started preparing and can't be changed"
      : "Someone else changed this order a moment ago — please review it and try again");
    err.statusCode = 409;
    throw err;
  }
  return { order: updated };
};

// ── Cancel order ────────────────────────────────────────────────────────────
/**
 * Handles all three callers:
 *  - logged-in customer cancelling their own order (pre-confirmation only)
 *  - guest cancelling via their per-order guest token
 *  - staff (waiter/admin) cancelling per the role rules in orderStateMachine
 */
export const cancelOrderTx = async ({ req, orderId, reason }) => {
  const { Order } = req.models;
  const order = await Order.findById(orderId);
  if (!order) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }

  let role, actor;

  if (req.user) {
    role = getRoleFromUser(req.user);
    const isStaff = role === "admin" || role === "waiter";
    if (!isStaff && String(order.user) !== String(req.user._id)) {
      const err = new Error("You can only cancel your own order");
      err.statusCode = 403;
      throw err;
    }
    actor = buildActor(req.user);
  } else {
    const token = req.headers["x-guest-order-token"];
    if (!verifyGuestOrderToken(token, order._id)) {
      const err = new Error("Not authorized to cancel this order");
      err.statusCode = 403;
      throw err;
    }
    role = "customer";
    actor = { id: null, role: "GUEST", name: order.guestName || "Guest" };
  }

  assertValidTransition(order.status, "CANCELLED", role);

  // An unpaid pay-first order has reached nobody yet — the customer may drop
  // it at any time; the 3-minute window applies once staff can see it.
  if (role === "customer" && order.status !== "AWAITING_PAYMENT" && order.cancelDeadline && new Date() > order.cancelDeadline) {
    const err = new Error("Cancellation window has passed");
    err.statusCode = 400;
    throw err;
  }

  const session = await req.db.startSession();
  let cancelledOrder;
  try {
    await session.withTransaction(async () => {
      order.status        = "CANCELLED";
      order.cancelledBy   = actor;
      order.cancelledAt   = new Date();
      order.cancelReason  = reason || "";
      order.statusHistory.push({
        status: "CANCELLED", changedBy: actor, changedAt: new Date(), note: order.cancelReason,
      });
      await order.save({ session });

      // If this order had already had stock deducted (i.e. it was CONFIRMED
      // or later), credit it back — reverseStockForOrder no-ops safely if it
      // was never deducted in the first place.
      await reverseStockForOrder({ models: req.models, order, actor, session });

      cancelledOrder = order;
    });
  } finally {
    session.endSession();
  }

  return cancelledOrder;
};

// ── Generic status transition (admin dropdown / future kitchen display) ───
/**
 * Any transition that ISN'T into CONFIRMED or CANCELLED (those have their
 * own dedicated, transactional functions above with extra guarantees).
 * Still fully validated + atomic via a conditional findOneAndUpdate.
 */
export const transitionOrderStatusTx = async ({ req, orderId, toStatus, note }) => {
  const { Order, TableSession, Table, WaitlistEntry } = req.models;

  const current = await Order.findById(orderId);
  if (!current) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }

  // The real, first-time confirmation — the only path that creates the KOT
  // job and deducts stock — is routed through confirmOrderTx exactly as
  // before. An admin correcting a LATER order back to CONFIRMED (e.g.
  // PREPARING → CONFIRMED) is a plain status fix: that side-effecting work
  // already ran once and must not run again, so it falls through to the
  // generic flip below instead of re-entering confirmOrderTx.
  if (toStatus === "CONFIRMED" && current.status === "PENDING_CONFIRMATION") {
    return confirmOrderTx({ req, orderId });
  }
  // Starting preparation is where the KOT prints and stock is deducted —
  // always through sendToKitchenTx, whoever triggers it (chef "Start
  // preparing", waiter, admin — even an admin jumping straight from
  // "Awaiting confirmation", which accepts it first).
  if (toStatus === "PREPARING" && ["CONFIRMED", "PENDING_CONFIRMATION"].includes(current.status)) {
    const role = getRoleFromUser(req.user);
    if (current.status === "PENDING_CONFIRMATION") {
      assertValidTransition("PENDING_CONFIRMATION", "PREPARING", role); // admin override only
      await confirmOrderTx({ req, orderId });
      const again = await Order.findById(orderId).select("status");
      if (again?.status === "PREPARING") return { order: await Order.findById(orderId) }; // 0-min window already sent it
    }
    return sendToKitchenTx({ models: req.models, db: req.db, orderId, actor: buildActor(req.user), role });
  }
  if (toStatus === "CANCELLED") {
    const order = await cancelOrderTx({ req, orderId, reason: note });
    return { order };
  }

  const role = getRoleFromUser(req.user);
  assertValidTransition(current.status, toStatus, role);

  const needsPaid = requiresPaidForTransition(current.status, toStatus, role);
  if (needsPaid && current.paymentStatus !== "PAID") {
    const err = new Error("Mark the payment as Paid before completing this order");
    err.statusCode = 400;
    throw err;
  }

  const actor = buildActor(req.user);
  const extraFields = {};
  if (toStatus === "PREPARING") { extraFields.preparedBy = actor; extraFields.preparingAt = new Date(); }
  if (toStatus === "READY")     { extraFields.readyBy    = actor; extraFields.readyAt     = new Date(); }
  if (toStatus === "DELIVERED") { extraFields.deliveredBy = actor; extraFields.deliveredAt = new Date(); }
  if (toStatus === "COMPLETED") { extraFields.completedBy = actor; extraFields.completedAt = new Date(); }

  const updated = await Order.findOneAndUpdate(
    { _id: orderId, status: current.status, ...(needsPaid && { paymentStatus: "PAID" }) },
    {
      $set:  { status: toStatus, ...extraFields },
      $push: { statusHistory: { status: toStatus, changedBy: actor, changedAt: new Date(), note: note || "" } },
    },
    { new: true }
  );

  if (!updated) {
    const err = new Error("Order status changed concurrently — please retry");
    err.statusCode = 409;
    throw err;
  }

  // ── Auto-clear the table (Phase 2) ──────────────────────────────────────
  // A waiter/admin no longer has to remember to "clear the table" by hand —
  // the moment the LAST active order on a table's session reaches COMPLETED,
  // the session closes itself here, the same way the manual "clear table"
  // button always worked (see tableSessionService.closeTableSession — it
  // still refuses to close while any other order on the session is
  // non-terminal, so a table with several running orders only frees up once
  // every one of them is done). We surface the closed session (and a
  // waitlist suggestion, if any) so the caller can emit the same realtime
  // events the manual clear used to.
  let closedTableSession = null;
  let freedTable = null;
  let suggestedEntry = null;
  if (toStatus === "COMPLETED" && updated.tableSession) {
    try {
      closedTableSession = await closeTableSession({
        TableSession, Order, Table, sessionId: updated.tableSession, actor,
      });
      freedTable = await Table.findById(closedTableSession.table);
      if (freedTable) {
        suggestedEntry = await findNextMatch({ WaitlistEntry }, freedTable.seats);
      }
    } catch (err) {
      // The order's own status flip above already committed — a hiccup
      // freeing the table (another order on the session still active, a
      // concurrent close, a dangling session reference) must never surface
      // as a failure to complete THIS order. Expected 400s (still-active /
      // already-closed) are silent; anything else is logged for visibility.
      if (err.statusCode !== 400) console.error("Auto-clear table on order completion failed:", err);
    }
  }

  return { order: updated, closedTableSession, freedTable, suggestedEntry };
};

// ── Ownership check for read access ───────────────────────────────────────
export const assertCanViewOrder = (req, order) => {
  const role = getRoleFromUser(req.user);
  const isStaff = role === "admin" || role === "waiter";
  if (isStaff) return;

  if (req.user) {
    // order.user may be a raw ObjectId or a populated sub-document
    // (e.g. getOrderById populates "user name phone email") — handle both.
    const orderOwnerId = order.user?._id ?? order.user;
    if (!orderOwnerId || String(orderOwnerId) !== String(req.user._id)) {
      const err = new Error("Not authorized to view this order");
      err.statusCode = 403;
      throw err;
    }
    return;
  }

  // Guest: soft-check — only enforced if a token was actually supplied, so
  // the current (unmodified this phase) customer app, which sends no token,
  // keeps working exactly as before.
  const token = req.headers["x-guest-order-token"];
  if (token && !verifyGuestOrderToken(token, order._id)) {
    const err = new Error("Not authorized to view this order");
    err.statusCode = 403;
    throw err;
  }
};

export { buildActor };

// ── Pay-first orders (utils/paymentMode.js) ────────────────────────────────

/**
 * A pay-first order's payment was verified (paymentStatus PAID, set only by
 * paymentService.applyPhonePeResult on a checksum-verified success): move it
 * AWAITING_PAYMENT → PENDING_CONFIRMATION so staff see it, and only now let
 * it join the table's session. Atomic on status, so the PhonePe callback, the
 * customer's status poll and the expiry tick racing each other promote it
 * exactly once. Returns { order, promoted } — callers emit order:new only
 * when promoted is true.
 */
export const promotePaidOrder = async ({ models, orderId, now = new Date() }) => {
  const { Order, Table, TableSession } = models;
  const current = await Order.findOne({ _id: orderId, status: "AWAITING_PAYMENT", paymentStatus: "PAID" });
  if (!current) return { order: await Order.findById(orderId), promoted: false };
  assertValidTransition("AWAITING_PAYMENT", "PENDING_CONFIRMATION", "system");

  let tableSessionId = null;
  if (current.orderType === "DINE_IN" && current.tableNo) {
    const tableDoc = await Table.findOne({ tableNo: Number(current.tableNo) });
    if (tableDoc && tableDoc.status === "Active") {
      const session = await findOrOpenTableSession({
        TableSession, Table, table: tableDoc, actor: buildActor(null, current.guestName),
      });
      tableSessionId = session._id;
    }
  }

  const updated = await Order.findOneAndUpdate(
    { _id: orderId, status: "AWAITING_PAYMENT" },
    {
      $set: {
        status: "PENDING_CONFIRMATION",
        tableSession: tableSessionId,
        paymentDeadline: null,
        // Now it waits for a waiter/admin to accept it, like any customer order.
        cancelDeadline: null,
      },
      $push: { statusHistory: { status: "PENDING_CONFIRMATION", changedBy: SYSTEM_ACTOR, changedAt: now, note: "Paid online" } },
    },
    { new: true },
  );
  if (!updated) return { order: await Order.findById(orderId), promoted: false };
  if (tableSessionId) {
    await TableSession.findByIdAndUpdate(tableSessionId, { $addToSet: { orders: updated._id } });
  }
  return { order: updated, promoted: true };
};

/**
 * Cancels pay-first orders still unpaid after their paymentDeadline. No stock
 * was deducted and no table session joined, so this is a plain atomic status
 * flip. `beforeCancel(order)` (optional) lets the caller do a last live
 * gateway check first; if the order turns out PAID it is left alone (the
 * caller promotes it) instead of being cancelled. `skip(order)` (optional)
 * defers an order to a later tick (e.g. a payment attempt still in flight).
 * Returns the cancelled orders (for realtime emits).
 */
export const expireUnpaidOrders = async ({ models, now = new Date(), beforeCancel = null, skip = null, limit = 50 }) => {
  const { Order } = models;
  const due = await Order.find({ status: "AWAITING_PAYMENT", paymentDeadline: { $lte: now } }).limit(limit);
  const cancelled = [];
  for (const order of due) {
    if (skip?.(order)) continue;
    if (beforeCancel) {
      try { await beforeCancel(order); } catch (err) { console.error(`pay-first recheck ${order._id} failed:`, err.message); }
    }
    assertValidTransition("AWAITING_PAYMENT", "CANCELLED", "system");
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: "AWAITING_PAYMENT", paymentStatus: { $ne: "PAID" } },
      {
        $set: {
          status: "CANCELLED", cancelledBy: SYSTEM_ACTOR, cancelledAt: now,
          cancelReason: "Not paid in time", paymentDeadline: null,
        },
        $push: { statusHistory: { status: "CANCELLED", changedBy: SYSTEM_ACTOR, changedAt: now, note: "Not paid in time" } },
      },
      { new: true },
    );
    if (updated) cancelled.push(updated);
  }
  return cancelled;
};
