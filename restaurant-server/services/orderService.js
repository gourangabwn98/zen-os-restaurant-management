// services/orderService.js
// ─────────────────────────────────────────────────────────────────────────────
// The single, reliable order system shared by the Customer app, Waiter app,
// and Admin panel. Every controller (customer ordering, waiter POS, admin
// dashboard) calls into these functions instead of writing to the Order
// collection directly, so pricing rules, status transitions, ownership
// checks, and KOT creation can never drift between the three surfaces.
// ─────────────────────────────────────────────────────────────────────────────

import { priceOrder } from "../utils/pricing.js";
import { normalizeOrderType, assertValidTransition } from "../utils/orderStateMachine.js";
import { createKotJobForOrder } from "./kotService.js";
import { findOrOpenTableSession } from "./tableSessionService.js";
import { signGuestOrderToken, verifyGuestOrderToken } from "../utils/guestOrderToken.js";
import { deductStockForOrder, reverseStockForOrder } from "./inventoryService.js";

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
 * Staff-sourced orders (WAITER/ADMIN) are auto-CONFIRMED (the person keying
 * it in at the table/counter IS the confirmation) and their KOT job is
 * created immediately. Customer-sourced orders start PENDING_CONFIRMATION
 * and require an explicit staff confirmation before any KOT job exists.
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

  const { Order, MenuItem, RestaurantProfile, Table, TableSession, KOTJob } = req.models;
  const {
    items, orderType, tableNo, tableToken, notes,
    customerName, customerPhone, paymentMethod, idempotencyKey, priority,
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
  const { dbItems, subtotal, tax, serviceCharge, discount, total } =
    await priceOrder({ items, MenuItem, restaurantProfile: restaurant });

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

    const sessionActor = buildActor(req.user, customerName);
    const session = await findOrOpenTableSession({ TableSession, Table, table: tableDoc, actor: sessionActor });
    tableSessionId = session._id;
  }

  const initialStatus = isStaffOrder ? "CONFIRMED" : "PENDING_CONFIRMATION";
  const actor = buildActor(req.user, customerName);
  const now = new Date();

  const orderPayload = {
    user:          req.user ? req.user._id : null,
    isGuest:       !req.user,
    items:         dbItems,
    subtotal, tax, serviceCharge, discount, total,
    orderType:     normalizedType,
    tableNo:       tableNo ? Number(tableNo) : null,
    tableSession:  tableSessionId,
    tableVerified,
    source,
    createdBy:     actor,
    status:        initialStatus,
    confirmedBy:   isStaffOrder ? actor : null,
    confirmedAt:   isStaffOrder ? now   : null,
    cancelDeadline: new Date(now.getTime() + 3 * 60 * 1000),
    notes:         notes || "",
    waiterName:    source === "WAITER" ? (req.user?.waiterName || req.user?.name || "") : "",
    waiterId:      source === "WAITER" ? req.user?._id : null,
    // Staff-only, and only meaningful for a staff-placed (already-confirmed)
    // order — a customer/guest can never mark their own order urgent.
    priority:      isStaffOrder && priority === "URGENT" ? "URGENT" : "NORMAL",
    guestName:     customerName  || "",
    guestPhone:    customerPhone || "",
    paymentMethod: paymentMethod || "Cash",
    paymentStatus: "PENDING_VERIFICATION",
    idempotencyKey: idempotencyKey || undefined,
    statusHistory: [{ status: initialStatus, changedBy: actor, changedAt: now, note: "Order placed" }],
  };

  let order;
  let kotJob = null;
  let inventoryAlerts = [];

  if (isStaffOrder) {
    // Staff-placed orders are already "confirmed" the moment they're
    // created (Phase 1), so the full CONFIRMED workflow — inventory
    // validation, deduction, ledger, KOT job — runs in the SAME transaction
    // as the order's creation. If stock can't cover it, the whole order
    // creation is rolled back and the waiter/admin gets a clear error
    // instead of an order nobody can fulfil.
    const session = await req.db.startSession();
    try {
      await session.withTransaction(async () => {
        const created = await Order.create([orderPayload], { session });
        order = created[0];

        if (tableSessionId) {
          await TableSession.findByIdAndUpdate(
            tableSessionId, { $addToSet: { orders: order._id } }, { session }
          );
        }

        const stockResult = await deductStockForOrder({ models: req.models, order, actor, session });
        inventoryAlerts = stockResult.alerts || [];

        const kotResult = await createKotJobForOrder({ KOTJob, order, actor, session });
        kotJob = kotResult.job;
      });
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
    } finally {
      session.endSession();
    }
  } else {
    // Customer/guest order — stays PENDING_CONFIRMATION, so NO stock
    // deduction happens here (only on staff confirmation — see
    // confirmOrderTx). No transaction needed for a single insert.
    try {
      order = await Order.create(orderPayload);
    } catch (err) {
      // See the staff-path catch above — the `&& idempotencyKey` guard is what
      // stops a keyless order's duplicate-key error becoming a false success.
      if (err?.code === 11000 && err.keyPattern?.idempotencyKey && idempotencyKey) {
        const raced = await Order.findOne({ idempotencyKey });
        if (raced) return { order: raced, alreadyExisted: true };
      }
      throw err;
    }

    if (tableSessionId) {
      await TableSession.findByIdAndUpdate(tableSessionId, { $addToSet: { orders: order._id } });
    }
  }

  const guestAccessToken = !req.user ? signGuestOrderToken(order._id) : null;

  return { order, alreadyExisted: false, kotJob, guestAccessToken, inventoryAlerts };
};

// ── Confirm order (customer-sourced PENDING_CONFIRMATION → CONFIRMED) ─────
/**
 * Only admin/waiter may call this. Atomic + transactional so two staff
 * members tapping "confirm" on the same order within milliseconds of each
 * other can never both succeed, and the order's single KOT job can never be
 * created twice.
 */
export const confirmOrderTx = async ({ req, orderId }) => {
  const { Order, KOTJob } = req.models;
  const role = getRoleFromUser(req.user);

  const current = await Order.findById(orderId);
  if (!current) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }
  assertValidTransition(current.status, "CONFIRMED", role);

  const actor = buildActor(req.user);
  const session = await req.db.startSession();
  let confirmedOrder, kotResult, inventoryAlerts = [];

  try {
    await session.withTransaction(async () => {
      const updated = await Order.findOneAndUpdate(
        { _id: orderId, status: "PENDING_CONFIRMATION" },
        {
          $set:  { status: "CONFIRMED", confirmedBy: actor, confirmedAt: new Date() },
          $push: { statusHistory: { status: "CONFIRMED", changedBy: actor, changedAt: new Date() } },
        },
        { new: true, session }
      );

      if (!updated) {
        const err = new Error(
          "Order is no longer pending confirmation (already confirmed or cancelled)"
        );
        err.statusCode = 409;
        throw err;
      }

      confirmedOrder = updated;
      const stockResult = await deductStockForOrder({ models: req.models, order: updated, actor, session });
      inventoryAlerts = stockResult.alerts || [];
      kotResult = await createKotJobForOrder({ KOTJob, order: updated, actor, session });
    });
  } finally {
    session.endSession();
  }

  return { order: confirmedOrder, kotJob: kotResult.job, kotCreated: kotResult.created, inventoryAlerts };
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

  if (role === "customer" && order.cancelDeadline && new Date() > order.cancelDeadline) {
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
  if (toStatus === "CONFIRMED") return confirmOrderTx({ req, orderId });
  if (toStatus === "CANCELLED") {
    const order = await cancelOrderTx({ req, orderId, reason: note });
    return { order };
  }

  const { Order } = req.models;
  const role = getRoleFromUser(req.user);
  const current = await Order.findById(orderId);
  if (!current) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }
  assertValidTransition(current.status, toStatus, role);

  const actor = buildActor(req.user);
  const extraFields = {};
  if (toStatus === "PREPARING") { extraFields.preparedBy = actor; extraFields.preparingAt = new Date(); }
  if (toStatus === "READY")     { extraFields.readyBy    = actor; extraFields.readyAt     = new Date(); }
  if (toStatus === "DELIVERED") { extraFields.deliveredBy = actor; extraFields.deliveredAt = new Date(); }
  if (toStatus === "COMPLETED") { extraFields.completedBy = actor; extraFields.completedAt = new Date(); }

  const updated = await Order.findOneAndUpdate(
    { _id: orderId, status: current.status },
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

  return { order: updated };
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
