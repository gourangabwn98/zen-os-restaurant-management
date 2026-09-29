// services/payFirstService.js
// ─────────────────────────────────────────────────────────────────────────────
// Glue for pay-first orders (status AWAITING_PAYMENT — utils/paymentMode.js):
// turns a verified PhonePe result into "the order now reaches staff", and
// expires orders nobody paid for. Payment verification itself stays in
// paymentService (checksum-verified results only, atomic apply); the status
// change stays in orderService (promotePaidOrder / expireUnpaidOrders).
// ─────────────────────────────────────────────────────────────────────────────

import { isPhonePeConfigured, fetchPhonePeStatus, applyPhonePeResult } from "./paymentService.js";
import { promotePaidOrder, expireUnpaidOrders } from "./orderService.js";

// A gateway attempt still PENDING at the deadline (customer is on PhonePe's
// page right now) gets this much longer before the order is cancelled.
const IN_FLIGHT_GRACE_MS = 10 * 60 * 1000;

/** After a payment result was applied to `order`: promote it if it's a paid
 * pay-first order. Returns { order, promoted }. */
export const afterPaymentApplied = async ({ models, order }) => {
  if (order?.status === "AWAITING_PAYMENT" && order.paymentStatus === "PAID") {
    return promotePaidOrder({ models, orderId: order._id });
  }
  if (order?.status === "CANCELLED" && order.paymentStatus === "PAID") {
    // Paid after it was already cancelled (e.g. paid on PhonePe long after
    // the deadline) — money was taken for an order that won't be made.
    console.warn(`⚠️ Order ${order.orderId || order._id} was paid online after being cancelled — refund needed`);
  }
  return { order, promoted: false };
};

/**
 * Background tick (server.js): promotes paid-but-not-yet-promoted orders
 * (e.g. the server stopped between applying the payment and promoting), and
 * cancels unpaid ones past their deadline — after one last live PhonePe
 * check, so a payment that just went through is never cancelled.
 * Callbacks let server.js do the realtime emits.
 */
export const runPayFirstTick = async ({ models, now = new Date(), onPromoted, onPaymentChanged, onExpired }) => {
  const { Order } = models;
  const results = { promoted: 0, expired: 0 };

  const stuck = await Order.find({ status: "AWAITING_PAYMENT", paymentStatus: "PAID" }).select("_id").limit(50).lean();
  for (const { _id } of stuck) {
    const r = await promotePaidOrder({ models, orderId: _id, now });
    if (r.promoted) { results.promoted++; onPromoted?.(r.order); }
  }

  const beforeCancel = async (order) => {
    const mtid = order.payment?.merchantTransactionId;
    if (!mtid || !isPhonePeConfigured() || order.payment?.state === "SUCCESS") return;
    const result = await fetchPhonePeStatus({ order });
    const { order: updated, changed } = await applyPhonePeResult({
      models, orderId: order._id, merchantTransactionId: mtid, result,
    });
    if (changed) onPaymentChanged?.(updated);
    const r = await afterPaymentApplied({ models, order: updated });
    if (r.promoted) { results.promoted++; onPromoted?.(r.order); }
  };

  const expired = await expireUnpaidOrders({
    models, now, beforeCancel,
    // Leave orders with an attempt still in flight alone for a little longer.
    skip: (order) => order.payment?.state === "PENDING"
      && order.paymentDeadline && now.getTime() < new Date(order.paymentDeadline).getTime() + IN_FLIGHT_GRACE_MS,
  });
  for (const o of expired) { results.expired++; onExpired?.(o); }
  return results;
};
