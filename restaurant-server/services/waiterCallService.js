// services/waiterCallService.js
// ─────────────────────────────────────────────────────────────────────────────
// "Call waiter" from the customer's order page (dine-in).
//
//   attempt 1 — rings the waiter who took (placed) or accepted (confirmed) the
//               order, if they're ON DUTY; otherwise every on-duty waiter.
//               The customer waits CALL_WINDOW_MS[1] (3 min).
//   attempt 2 — if nobody marked the call done in time: rings EVERY on-duty
//               waiter, waits CALL_WINDOW_MS[2] (2 min).
//   after that — the customer is shown the restaurant's phone number.
// Admin accounts are never rung.
//
// At most one live call per order: WaiterCall.active + a partial unique index
// (config/getModels.js), every transition an atomic conditional update — a
// double tap, two tabs or two waiters tapping at once can't ring twice or
// both "win". Expiry is lazy (compared with expiresAt on read / next call);
// nothing needs a background sweep.
// ─────────────────────────────────────────────────────────────────────────────

import { verifyGuestOrderToken } from "../utils/guestOrderToken.js";

export const CALL_WINDOW_MS = { 1: 3 * 60 * 1000, 2: 2 * 60 * 1000 };
// After the 2nd call runs out the customer is pointed at the phone; a fresh
// round of calls is allowed again once this much time has passed.
const PHONE_COOLDOWN_MS = 10 * 60 * 1000;
const CALLABLE_STATUSES = ["PENDING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY", "DELIVERED"];
const LIVE = ["OPEN", "ACKNOWLEDGED"];

const httpError = (msg, statusCode = 400, extra = {}) => Object.assign(new Error(msg), { statusCode, ...extra });

/**
 * Strict ownership check (stricter than orderService.assertCanViewOrder,
 * which lets a token-less guest *view* an order): ringing staff needs a
 * logged-in owner or a valid guest order token. Staff don't call themselves.
 */
export const assertCanCallForOrder = (req, order, role) => {
  if (role === "admin" || role === "waiter" || role === "chef") {
    throw httpError("Staff accounts can't call a waiter", 403);
  }
  if (req.user) {
    const owner = order.user?._id ?? order.user;
    if (!owner || String(owner) !== String(req.user._id)) throw httpError("Not authorized for this order", 403);
    return;
  }
  if (!verifyGuestOrderToken(req.headers["x-guest-order-token"], order._id)) {
    throw httpError("Not authorized for this order", 403);
  }
};

/** OPEN/ACKNOWLEDGED past its expiresAt counts as EXPIRED. */
const effectiveStatus = (call, now) =>
  LIVE.includes(call.status) && new Date(call.expiresAt) <= now ? "EXPIRED" : call.status;

/** What the customer may do next: CALL | WAIT | CALL_AGAIN | PHONE. */
const nextAction = (call, now) => {
  if (!call) return "CALL";
  const st = effectiveStatus(call, now);
  if (LIVE.includes(st)) return "WAIT";
  if (st !== "EXPIRED") return "CALL"; // RESOLVED / CANCELLED → a fresh call is fine
  if (call.attempt === 1) return "CALL_AGAIN";
  return now.getTime() - new Date(call.expiresAt).getTime() < PHONE_COOLDOWN_MS ? "PHONE" : "CALL";
};

/** Customer-safe view of a call. */
const toPublic = (call, now) => call && ({
  _id: call._id,
  attempt: call.attempt,
  status: effectiveStatus(call, now),
  expiresAt: call.expiresAt,
  createdAt: call.createdAt,
  acknowledgedBy: call.acknowledgedBy?.name ? { name: call.acknowledgedBy.name } : null,
  ringing: call.targets?.length || 0,
});

/** Staff view (waiter app). */
export const toStaffCall = (call, now = new Date()) => call && ({
  _id: call._id,
  order: call.order,
  orderNumber: call.orderNumber,
  tableNo: call.tableNo,
  customerName: call.customerName,
  attempt: call.attempt,
  status: effectiveStatus(call, now),
  expiresAt: call.expiresAt,
  createdAt: call.createdAt,
  acknowledgedBy: call.acknowledgedBy?.name ? { id: call.acknowledgedBy.id, name: call.acknowledgedBy.name } : null,
  targets: (call.targets || []).map(String),
});

const onDutyWaiterIds = async ({ AttendanceSession }) =>
  (await AttendanceSession.find({ role: "waiter", status: "OPEN", presenceStatus: "ONLINE" }).select("employee").lean())
    .map((s) => String(s.employee));

/** The waiter who took (placed) or accepted (confirmed) the order, if any. */
export const orderWaiterId = (order) => {
  if (order.waiterId) return String(order.waiterId);
  if (order.confirmedBy?.role === "WAITER" && order.confirmedBy.id) return String(order.confirmedBy.id);
  return null;
};

/** Who attempt N rings, given who is on duty right now. */
export const pickTargets = ({ attempt, orderWaiter, onDuty }) => {
  if (attempt === 1 && orderWaiter && onDuty.includes(orderWaiter)) return [orderWaiter];
  return onDuty;
};

/** Current call state for the customer's order page. */
export const getCallState = async ({ models, order, adminPhone = "", now = new Date() }) => {
  const latest = await models.WaiterCall.findOne({ order: order._id }).sort({ createdAt: -1 }).lean();
  const action = nextAction(latest, now);
  return {
    orderId: String(order._id),
    call: toPublic(latest, now),
    nextAction: action,
    serverNow: now,
    ...(action === "PHONE" || (latest && LIVE.includes(effectiveStatus(latest, now)) && !latest.targets?.length)
      ? { adminPhone } : {}),
  };
};

/**
 * Customer taps "Call waiter" / "Call again". Returns
 * { call, created, targets, state } — `targets` (staff ids) only when a new
 * call was created, for the controller's realtime emit.
 */
export const createCall = async ({ models, order, adminPhone = "", now = new Date() }) => {
  const { WaiterCall, AttendanceSession } = models;
  if (order.orderType !== "DINE_IN" || !order.tableNo) throw httpError("Call waiter is available for dine-in orders at a table");
  if (order.status === "AWAITING_PAYMENT") throw httpError("Please complete the online payment first", 409);
  if (!CALLABLE_STATUSES.includes(order.status)) throw httpError("This order is already closed", 409);

  const latest = await WaiterCall.findOne({ order: order._id }).sort({ createdAt: -1 });
  const action = nextAction(latest, now);
  if (action === "WAIT") {
    return { call: latest, created: false, targets: [], state: await getCallState({ models, order, adminPhone, now }) };
  }
  if (action === "PHONE") {
    throw httpError("Please call the restaurant directly", 409, { code: "CALL_RESTAURANT", adminPhone });
  }

  // Close an expired-but-still-flagged call first (frees the unique slot).
  if (latest?.active) {
    await WaiterCall.updateOne({ _id: latest._id, active: true }, { $set: { status: "EXPIRED", active: false } });
  }

  const attempt = action === "CALL_AGAIN" ? 2 : 1;
  const onDuty = await onDutyWaiterIds({ AttendanceSession });
  const targets = pickTargets({ attempt, orderWaiter: orderWaiterId(order), onDuty });

  let call;
  try {
    call = await WaiterCall.create({
      order: order._id,
      orderNumber: order.orderId || "",
      tableNo: order.tableNo,
      customerName: order.guestName || "",
      attempt,
      targets,
      status: "OPEN",
      active: true,
      expiresAt: new Date(now.getTime() + CALL_WINDOW_MS[attempt]),
    });
  } catch (err) {
    if (err?.code === 11000) { // a parallel tap created it a moment ago
      const raced = await WaiterCall.findOne({ order: order._id, active: true });
      return { call: raced, created: false, targets: [], state: await getCallState({ models, order, adminPhone, now }) };
    }
    throw err;
  }
  return { call, created: true, targets, state: await getCallState({ models, order, adminPhone, now }) };
};

/** Customer withdraws their live call ("never mind"). */
export const cancelCall = async ({ models, order }) => {
  const call = await models.WaiterCall.findOneAndUpdate(
    { order: order._id, active: true },
    { $set: { status: "CANCELLED", active: false } },
    { new: true },
  );
  return call;
};

/** Waiter taps "On my way". Only a live, unexpired, not-yet-taken call. */
export const acknowledgeCall = async ({ models, callId, actor, now = new Date() }) => {
  const call = await models.WaiterCall.findOneAndUpdate(
    { _id: callId, active: true, status: "OPEN", expiresAt: { $gt: now } },
    { $set: { status: "ACKNOWLEDGED", acknowledgedBy: actor, acknowledgedAt: now } },
    { new: true },
  );
  if (call) return call;
  const exists = await models.WaiterCall.findById(callId).lean();
  if (!exists) throw httpError("Call not found", 404);
  throw httpError(exists.acknowledgedBy?.name ? `${exists.acknowledgedBy.name} is already on the way` : "This call has already ended", 409);
};

/** Waiter taps "Done" — they've attended the table. Allowed even a little
 * after the timer ran out (they may arrive late), as long as it's still live. */
export const resolveCall = async ({ models, callId, actor, now = new Date() }) => {
  const call = await models.WaiterCall.findOneAndUpdate(
    { _id: callId, active: true },
    { $set: { status: "RESOLVED", active: false, resolvedBy: actor, resolvedAt: now } },
    { new: true },
  );
  if (call) return call;
  const exists = await models.WaiterCall.exists({ _id: callId });
  throw httpError(exists ? "This call has already ended" : "Call not found", exists ? 409 : 404);
};

/** Live calls ringing this waiter (for the waiter app on load/reconnect). */
export const listCallsForWaiter = async ({ models, userId, now = new Date() }) => {
  const calls = await models.WaiterCall.find({ targets: userId, active: true, expiresAt: { $gt: now } })
    .sort({ createdAt: 1 }).lean();
  return calls.map((c) => toStaffCall(c, now));
};
