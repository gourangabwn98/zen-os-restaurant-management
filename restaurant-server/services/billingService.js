// services/billingService.js
// ─────────────────────────────────────────────────────────────────────────────
// BIL-01 / BIL-02 — the billing workflow, the only writer of an order's bill
// lifecycle (`billStatus` OPEN → SETTLED, utils/orderStateMachine.js).
//
// Three independent concepts on an order:
//   status         operational — Placed → Cooking (PREPARING) → Ready to
//                  Deliver (READY) → Eating (DELIVERED) → Completed
//   paymentStatus  money received (PAID), set by staff or a verified gateway
//   billStatus     the bill itself — settled here, in Invoices / the waiter's
//                  bill screen, never from the Dashboard
//
// Settling records the payment too when it isn't recorded yet (that's what a
// counter "Collect & settle" is), but it never changes the operational
// status by itself: an order that is already served is completed right after
// (orderService.completeServedSettledOrder); one still cooking stays cooking
// and completes the moment the waiter taps "Served".
//
// Every write is one atomic conditional update per order (retries, double
// clicks and two cashiers at once are safe) — the result lists what happened
// to every requested id, like services/combinedBillService.js.
// ─────────────────────────────────────────────────────────────────────────────
import mongoose from "mongoose";
import {
  ORDER_STATUSES, PAYMENT_STATUSES, BILL_STATUSES, canSetPaymentStatus, effectiveBillStatus,
} from "../utils/orderStateMachine.js";
import { completeServedSettledOrder } from "./orderService.js";

const pick = (list, v) => { if (!list.includes(v)) throw new Error(`billingService: unknown enum ${v}`); return v; };
const PAID = pick(PAYMENT_STATUSES, "PAID");
const SETTLED = pick(BILL_STATUSES, "SETTLED");
const OPEN = pick(BILL_STATUSES, "OPEN");
const CANCELLED = pick(ORDER_STATUSES, "CANCELLED");
const COMPLETED = pick(ORDER_STATUSES, "COMPLETED");
// A bill can be settled once the restaurant has accepted the order — not
// while it is still awaiting payment/acceptance (it may yet be rejected).
export const SETTLEABLE = ["CONFIRMED", "PREPARING", "READY", "DELIVERED"].map((s) => pick(ORDER_STATUSES, s));
export const PAY_METHODS = ["Cash", "Online"];
export const MAX_SETTLE = 50;

const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

/** Pure: request body → unique, valid order ids (or throws 400). */
export const parseOrderIds = (raw) => {
  if (!Array.isArray(raw) || !raw.length) throw httpError("Select at least one order to settle");
  const ids = [...new Set(raw.map(String))];
  if (ids.length > MAX_SETTLE) throw httpError(`At most ${MAX_SETTLE} orders at once`);
  const bad = ids.find((id) => !mongoose.isValidObjectId(id));
  if (bad) throw httpError(`Invalid order id: ${bad}`);
  return ids;
};

/** Pure: why this order's bill can't be settled now, or null. */
export const settleBlocker = (order) => {
  if (!order) return "Order not found";
  if (order.status === CANCELLED) return "Cancelled";
  if (effectiveBillStatus(order) === SETTLED) return null; // reported as already settled
  if (!SETTLEABLE.includes(order.status)) return order.status === COMPLETED ? null : "Not accepted yet";
  return null;
};

/**
 * Settle the bills of these orders.
 * @param paymentMethod "Cash" | "Online" — required for any order not yet PAID
 *                      (that order's payment is recorded with this method).
 * @param role          the caller's role — must be allowed to record PAID.
 * @returns {{ settled, alreadySettled, rejected, changed, completions }}
 *   changed      orders whose bill was settled now (for payment emits)
 *   completions  results of completeServedSettledOrder that completed one
 */
export const settleBills = async ({ models, orderIds, paymentMethod, actor, role, now = new Date() }) => {
  const { Order } = models;
  const ids = parseOrderIds(orderIds);
  if (paymentMethod !== undefined && paymentMethod !== null && !PAY_METHODS.includes(paymentMethod)) {
    throw httpError(`paymentMethod must be one of: ${PAY_METHODS.join(", ")}`);
  }
  if (!canSetPaymentStatus(PAID, role)) throw httpError("You are not allowed to settle bills", 403);

  const found = await Order.find({ _id: { $in: ids } }).lean();
  const byId = new Map(found.map((o) => [String(o._id), o]));
  const settled = [], alreadySettled = [], rejected = [], changed = [], completions = [];

  for (const id of ids) {
    const o = byId.get(id);
    const why = settleBlocker(o);
    if (why) { rejected.push({ id, orderId: o?.orderId || "", reason: why }); continue; }
    if (effectiveBillStatus(o) === SETTLED) { alreadySettled.push(o.orderId); continue; }

    const needsPayment = o.paymentStatus !== PAID;
    if (needsPayment && !paymentMethod) {
      rejected.push({ id, orderId: o.orderId, reason: "Not paid yet — choose Cash or Online to collect and settle" });
      continue;
    }

    const note = needsPayment ? `Bill settled · ${paymentMethod}` : "Bill settled";
    const updated = await Order.findOneAndUpdate(
      // Re-checked at write time: same operational status, still open, and
      // the payment state we decided on (a payment racing this stays honest).
      {
        _id: o._id, status: o.status, billStatus: { $ne: SETTLED },
        paymentStatus: needsPayment ? { $ne: PAID } : PAID,
      },
      {
        $set: {
          billStatus: SETTLED, billSettledAt: now, billSettledBy: actor,
          ...(needsPayment && { paymentStatus: PAID, paymentMethod }),
        },
        $push: { statusHistory: { status: o.status, changedBy: actor, changedAt: now, note } },
      },
      { returnDocument: "after" },
    );
    if (!updated) {
      const fresh = await Order.findById(o._id).select("status billStatus orderId").lean();
      if (fresh && effectiveBillStatus(fresh) === SETTLED) alreadySettled.push(o.orderId);
      else rejected.push({ id, orderId: o.orderId, reason: fresh?.status === CANCELLED ? "Cancelled" : "Changed by someone else — refresh" });
      continue;
    }
    settled.push(o.orderId);
    changed.push(updated);

    // Served already → Completed now (no-op while it is still cooking).
    const done = await completeServedSettledOrder({ models, orderId: o._id, actor, now });
    if (done.order) completions.push({ ...done, previousStatus: updated.status });
  }

  return { settled, alreadySettled, rejected, changed, completions };
};

/**
 * Admin: reopen a settled bill (a mistaken settlement). Only the bill goes
 * back to OPEN — the operational status is untouched (BIL-02), so a
 * completed order stays completed; the payment can then be corrected.
 */
export const reopenBill = async ({ models, orderId, actor, now = new Date() }) => {
  const { Order } = models;
  if (!mongoose.isValidObjectId(String(orderId))) throw httpError("Order not found", 404);
  const current = await Order.findById(orderId).lean();
  if (!current) throw httpError("Order not found", 404);
  if (effectiveBillStatus(current) !== SETTLED) throw httpError("This bill is not settled", 409);
  const updated = await Order.findOneAndUpdate(
    // Legacy COMPLETED orders have no billStatus field yet — match those too.
    { _id: orderId, $or: [{ billStatus: SETTLED }, { billStatus: { $exists: false }, status: COMPLETED }] },
    {
      $set: { billStatus: OPEN, billSettledAt: null, billSettledBy: null },
      $push: { statusHistory: { status: current.status, changedBy: actor, changedAt: now, note: "Bill reopened" } },
    },
    { returnDocument: "after" },
  );
  if (!updated) throw httpError("This bill changed a moment ago — refresh and try again", 409);
  return updated;
};
