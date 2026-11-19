// services/deliveryService.js
// ─────────────────────────────────────────────────────────────────────────────
// Home delivery: broadcast → first valid acceptance wins → pickup → OTP drop.
//
// CONTRACT (same spirit as KOTJob / sendToKitchenTx):
//   • Every concurrent write is an atomic conditional update. The winner of a
//     race is decided by MongoDB, never by a client or an in-memory lock.
//   • Accept = ONE transaction: the rider's offer (SENT → WON), the rider's
//     capacity ($inc guarded by activeCount < capacity) and the job
//     (SEARCHING → ASSIGNED). If any of the three fails, all three roll back —
//     a rider can never hold more than their capacity, a job can never have
//     two riders, and a losing rider never "spends" capacity.
//   • Capacity is released in the same transaction that ends a job's active
//     life (delivered / failed / unassigned / cancelled).
//   • The restaurant order lifecycle is untouched except: pickup needs the
//     order READY, and the OTP-verified drop moves it READY → DELIVERED via
//     the order state machine (role "delivery").
//
// Functions return { …result, effects } — `effects` is a list of realtime /
// push notifications for services/deliveryRealtime.js to publish AFTER the
// write committed. Nothing here touches sockets or Firebase directly.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ACTIVE_JOB_STATUSES, TERMINAL_JOB_STATUSES, UNASSIGNABLE_STATUSES, STEP_TIMESTAMP, CUSTOMER_LABEL,
  assertRiderTransition,
} from "../utils/deliveryStateMachine.js";
import {
  deliverySettings, capacityFor, generateOtp, otpMatches, signTrackingToken, parseTrackingToken, trackingOpen,
  sanitizeLocationBatch, straightLineMeters,
} from "../utils/delivery.js";
import { assertValidTransition, effectiveBillStatus } from "../utils/orderStateMachine.js";
import { completeServedSettledOrder } from "./orderService.js";
import { resolveRange } from "./employeeService.js";
import { resolveTimezone } from "../utils/menuSchedule.js";
import { DELIVERY } from "../utils/roles.js";
import { sameAmount, deliveryPaymentSettings, deliveryPaymentOptions } from "../utils/delivery.js";
import { isPhonePeConfigured } from "./paymentService.js";
import { settleBills } from "./billingService.js";
import { buildActor, getRoleFromUser } from "./orderService.js";

// ── small helpers ────────────────────────────────────────────────────────────
const fail = (message, statusCode = 400, code) => Object.assign(new Error(message), { statusCode, ...(code && { code }) });
const AFTER = { returnDocument: "after" };
const withSession = (session) => (session ? { ...AFTER, session } : AFTER);
export const SYSTEM_ACTOR = Object.freeze({ id: null, role: "SYSTEM", name: "System" });
export const riderActor = (user) => ({ id: user._id, role: "DELIVERY", name: user.name || "Delivery partner" });
export const adminActor = (user) => ({ id: user?._id || null, role: "ADMIN", name: user?.name || "Admin" });
/** What an order's statusHistory / deliveredBy records for a rider. */
const orderActorForRider = (user) => ({ id: user._id, role: "DELIVERY", name: user.name || "Delivery partner" });

const id = (v) => String(v?._id ?? v);
/** Order fields a rider's view of their own job needs (never guest PII beyond the drop snapshot). */
const RIDER_ORDER_FIELDS = "status items notes paymentMethod paymentStatus total orderType orderId";
/** Cash on Delivery still to collect: a delivery order on Cash that isn't PAID. */
export const codDue = (order) =>
  order?.orderType === "ONLINE" && order.paymentMethod === "Cash" && order.paymentStatus !== "PAID";
const ORDER_STATUSES_FOR_JOB = ["CONFIRMED", "PREPARING", "READY"]; // D1: broadcast on confirm

const loadSettings = async (models) => {
  const profile = await models.RestaurantProfile.findOne().lean();
  return { profile, settings: deliverySettings(profile) };
};

/** Append-only audit record. Inside a transaction it must succeed; outside one
 *  an audit failure is logged but never undoes a committed delivery change. */
const logEvent = async (models, ev, session) => {
  const doc = { at: new Date(), ...ev };
  if (session) return models.DeliveryEvent.create([doc], { session });
  try { await models.DeliveryEvent.create([doc]); } catch (err) { console.error("delivery event log failed:", err.message); }
};

const runTx = async (db, fn) => {
  const session = await db.startSession();
  try {
    let out;
    await session.withTransaction(async () => { out = await fn(session); });
    return out;
  } finally {
    await session.endSession();
  }
};

const ensureState = (models, partnerId) =>
  models.DeliveryPartnerState.findOneAndUpdate(
    { partner: partnerId }, { $setOnInsert: { partner: partnerId } }, { ...AFTER, upsert: true },
  );

/** Capacity release — inside the caller's transaction. Guarded so it can't go negative. */
const releaseCapacity = (models, partnerId, session) =>
  models.DeliveryPartnerState.updateOne(
    { partner: partnerId, activeCount: { $gt: 0 } }, { $inc: { activeCount: -1, capVersion: 1 } }, { session },
  );

// ── views (what each audience may see) ──────────────────────────────────────
/** An open request as riders see it BEFORE accepting: no customer name/phone, no exact address. */
export const offerView = (job, expiresAt) => ({
  jobId: id(job), orderNo: job.orderNo, expiresAt,
  pickup: { name: job.pickup?.name || "", latitude: job.pickup?.latitude ?? null, longitude: job.pickup?.longitude ?? null },
  drop: { latitude: job.drop?.latitude ?? null, longitude: job.drop?.longitude ?? null },
  distanceMeters: job.distanceMeters ?? null,
  cod: !!job.cod, // "collect cash" — the amount is shown after acceptance
});

/** The assigned rider's full view of their own job. */
export const riderJobView = (job, order) => ({
  jobId: id(job), orderId: id(job.order), orderNo: job.orderNo, status: job.status,
  pickup: job.pickup, drop: job.drop, distanceMeters: job.distanceMeters ?? null,
  orderStatus: order?.status || null,
  canPickUp: order?.status === "READY",
  items: (order?.items || []).map((i) => ({ name: i.size ? `${i.name} (${i.size})` : i.name, qty: i.qty })),
  notes: order?.notes || "",
  otpAttempts: job.otpAttempts || 0,
  // What the rider must collect at the door (₹ re-read from the order, never stored on the job).
  payment: order ? {
    method: order.paymentMethod, paid: order.paymentStatus === "PAID",
    collectCash: codDue(order), amount: codDue(order) ? order.total : 0,
  } : null,
  assignedAt: job.assignedAt, arrivedRestaurantAt: job.arrivedRestaurantAt, pickedUpAt: job.pickedUpAt,
  arrivedCustomerAt: job.arrivedCustomerAt, deliveredAt: job.deliveredAt, failedAt: job.failedAt, failReason: job.failReason,
});

/** Admin board row. */
export const adminJobView = (job) => ({
  jobId: id(job), orderId: id(job.order), orderNo: job.orderNo, status: job.status,
  partner: job.partner ? id(job.partner) : null, partnerName: job.partnerName || "",
  round: job.round, offerExpiresAt: job.offerExpiresAt, escalated: !!job.escalated, escalatedAt: job.escalatedAt,
  drop: job.drop, distanceMeters: job.distanceMeters ?? null, otpAttempts: job.otpAttempts || 0,
  createdAt: job.createdAt, assignedAt: job.assignedAt, pickedUpAt: job.pickedUpAt, deliveredAt: job.deliveredAt,
  failedAt: job.failedAt, failReason: job.failReason, cancelledAt: job.cancelledAt, cancelReason: job.cancelReason,
});

/** Customer-safe status update (tracking room + the order's own room): never an OTP or phone. */
export const trackingStatusView = (job) => ({
  jobId: id(job), orderId: id(job.order), status: job.status, label: CUSTOMER_LABEL[job.status] || job.status,
  partnerName: firstName(job.partnerName), assignedAt: job.assignedAt, pickedUpAt: job.pickedUpAt, deliveredAt: job.deliveredAt,
});
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

// Effects for "this job changed" — rider, admin board and the customer's tracker.
const jobChangedEffects = (job, { order = null, riderEvent = "delivery:job_updated" } = {}) => {
  const fx = [
    { type: "admin", event: "delivery:status_updated", payload: { job: adminJobView(job) } },
    { type: "track", jobId: id(job), orderId: id(job.order), event: "delivery:status_updated", payload: trackingStatusView(job) },
  ];
  if (job.partner) fx.push({ type: "partner", partnerId: id(job.partner), event: riderEvent, payload: { job: riderJobView(job, order) } });
  return fx;
};

// ── Job creation (D1: when the order reaches CONFIRMED) ──────────────────────
/** True when this order should have a delivery job. */
export const needsDeliveryJob = (order) =>
  order?.orderType === "ONLINE" && !!order.deliveryAddress && ORDER_STATUSES_FOR_JOB.includes(order.status);

/**
 * Creates the order's DeliveryJob (unique on order → a second caller gets
 * created:false) and broadcasts round 1. Safe to call any number of times.
 */
export const createJobForOrder = async ({ models, order, now = new Date() }) => {
  if (!needsDeliveryJob(order)) return { job: null, created: false, effects: [] };
  const { profile, settings } = await loadSettings(models);
  const a = order.deliveryAddress;
  let job;
  try {
    [job] = await models.DeliveryJob.create([{
      order: order._id, orderNo: order.orderId || "",
      pickup: { name: profile?.restaurantName || "", address: profile?.address || "", latitude: profile?.latitude ?? null, longitude: profile?.longitude ?? null },
      drop: { address: a.address, landmark: a.landmark || "", latitude: a.latitude, longitude: a.longitude, contactName: a.contactName || "", contactPhone: a.contactPhone },
      distanceMeters: a.distanceMeters ?? straightLineMeters(profile, a),
      cod: codDue(order),
    }]);
  } catch (err) {
    if (err?.code === 11000) return { job: null, created: false, effects: [] };
    throw err;
  }
  await logEvent(models, { job: job._id, order: order._id, type: "JOB_CREATED", actor: SYSTEM_ACTOR });
  const b = await broadcastJob({ models, jobId: job._id, expectRound: 0, settings, now });
  return {
    job: b.job || job, created: true,
    effects: [{ type: "admin", event: "delivery:job_created", payload: { job: adminJobView(b.job || job) } }, ...b.effects],
  };
};

// ── Broadcast one round ─────────────────────────────────────────────────────
/**
 * Claims round `expectRound + 1` atomically (only one caller/instance wins),
 * then offers the job to every eligible rider: role delivery, account Active,
 * not suspended, online, below capacity, and not someone who already
 * rejected this job. One DeliveryOffer per (job, rider, round) — the unique
 * index means a retry never notifies a rider twice for the same round.
 */
export const broadcastJob = async ({ models, jobId, expectRound, settings, now = new Date() }) => {
  const s = settings || (await loadSettings(models)).settings;
  const expiresAt = new Date(now.getTime() + s.offerTtlSeconds * 1000);
  const job = await models.DeliveryJob.findOneAndUpdate(
    { _id: jobId, status: "SEARCHING", round: expectRound },
    { $set: { round: expectRound + 1, offerExpiresAt: expiresAt, escalated: false, escalatedAt: null } },
    AFTER,
  );
  if (!job) return { job: null, offered: 0, effects: [] };

  const [states, rejected] = await Promise.all([
    models.DeliveryPartnerState.find({ online: true, suspended: { $ne: true } }).lean(),
    models.DeliveryOffer.distinct("partner", { job: job._id, status: "REJECTED" }),
  ]);
  const rejectedSet = new Set(rejected.map(String));
  const withRoom = states.filter((st) => (st.activeCount || 0) < capacityFor(st, s) && !rejectedSet.has(String(st.partner)));
  const riders = withRoom.length
    ? await models.User.find({ _id: { $in: withRoom.map((st) => st.partner) }, role: DELIVERY, status: { $ne: "Inactive" } }).select("_id").lean()
    : [];
  const okIds = new Set(riders.map((u) => String(u._id)));

  const effects = [];
  let offered = 0;
  for (const st of withRoom) {
    if (!okIds.has(String(st.partner))) continue;
    const r = await models.DeliveryOffer.updateOne(
      { job: job._id, partner: st.partner, round: job.round },
      { $setOnInsert: { status: "SENT", expiresAt } },
      { upsert: true },
    );
    if (!r.upsertedCount) continue; // already offered this round
    offered++;
    effects.push({ type: "offer", partnerId: String(st.partner), tokens: st.fcmTokens || [], payload: offerView(job, expiresAt) });
  }
  await logEvent(models, { job: job._id, order: job.order, type: "BROADCAST", actor: SYSTEM_ACTOR, data: { round: job.round, offered } });
  effects.push({ type: "admin", event: "delivery:request_broadcast", payload: { job: adminJobView(job), offered } });
  return { job, offered, effects };
};

/** A rider just came online / freed capacity: offer them the open rounds now, not at the next tick. */
const offerOpenJobsTo = async ({ models, partnerId, settings, now = new Date() }) => {
  const state = await models.DeliveryPartnerState.findOne({ partner: partnerId }).lean();
  if (!state?.online || state.suspended) return [];
  let room = capacityFor(state, settings) - (state.activeCount || 0);
  if (room <= 0) return [];
  const jobs = await models.DeliveryJob.find({ status: "SEARCHING", escalated: { $ne: true }, offerExpiresAt: { $gt: now } }).lean();
  const effects = [];
  for (const job of jobs) {
    const rejected = await models.DeliveryOffer.exists({ job: job._id, partner: partnerId, status: "REJECTED" });
    if (rejected) continue;
    const r = await models.DeliveryOffer.updateOne(
      { job: job._id, partner: partnerId, round: job.round },
      { $setOnInsert: { status: "SENT", expiresAt: job.offerExpiresAt } },
      { upsert: true },
    );
    if (r.upsertedCount) effects.push({ type: "offer", partnerId: String(partnerId), tokens: state.fcmTokens || [], payload: offerView(job, job.offerExpiresAt) });
    if (--room <= 0) break;
  }
  return effects;
};

/** After a job leaves SEARCHING, every other open offer for it is LOST. */
const closeOtherOffers = async (models, jobId, winnerId) => {
  const open = await models.DeliveryOffer.find({ job: jobId, status: "SENT" }).select("partner").lean();
  if (!open.length) return [];
  await models.DeliveryOffer.updateMany({ job: jobId, status: "SENT" }, { $set: { status: "LOST" } });
  return open
    .filter((o) => !winnerId || String(o.partner) !== String(winnerId))
    .map((o) => ({ type: "partner", partnerId: String(o.partner), event: "delivery:already_assigned", payload: { jobId: String(jobId) } }));
};

const capacityEffect = (state, settings) => ({
  type: "partner", partnerId: String(state.partner), event: "delivery:capacity_updated",
  payload: { activeCount: state.activeCount, capacity: capacityFor(state, settings) },
});

// ── Rider: accept / reject ──────────────────────────────────────────────────
export const acceptOffer = async ({ models, db, user, jobId, now = new Date() }) => {
  const { settings } = await loadSettings(models);
  const actor = riderActor(user);
  let result;
  try {
    result = await runTx(db, async (session) => {
      const offer = await models.DeliveryOffer.findOneAndUpdate(
        { job: jobId, partner: user._id, status: "SENT", expiresAt: { $gt: now } },
        { $set: { status: "WON", respondedAt: now } }, withSession(session),
      );
      if (!offer) throw fail("This request is no longer available", 409, "OFFER_GONE");

      const state = await models.DeliveryPartnerState.findOneAndUpdate(
        {
          partner: user._id, online: true, suspended: { $ne: true },
          $expr: { $lt: ["$activeCount", { $ifNull: ["$capacity", settings.defaultCapacity] }] },
        },
        { $inc: { activeCount: 1, capVersion: 1 } }, withSession(session),
      );
      if (!state) throw fail("You're at your delivery limit (or offline) — finish a delivery first", 409, "CAPACITY_FULL");

      const job = await models.DeliveryJob.findOneAndUpdate(
        { _id: jobId, status: "SEARCHING", round: offer.round },
        {
          $set: {
            status: "ASSIGNED", partner: user._id, partnerName: user.name || "", assignedAt: now, assignedBy: actor,
            otpCode: generateOtp(), otpAttempts: 0, offerExpiresAt: null, escalated: false, escalatedAt: null,
          },
        }, withSession(session),
      );
      if (!job) throw fail("Another delivery partner already accepted this order", 409, "ALREADY_ASSIGNED");

      await logEvent(models, { job: job._id, order: job.order, partner: user._id, type: "ACCEPTED", actor, data: { round: offer.round } }, session);
      return { job, state };
    });
  } catch (err) {
    // A losing rider whose offer was already closed should hear "taken", not "expired".
    if (err.code === "OFFER_GONE") {
      const j = await models.DeliveryJob.findById(jobId).select("status partner").lean();
      if (j && j.status !== "SEARCHING") throw fail("Another delivery partner already accepted this order", 409, "ALREADY_ASSIGNED");
    }
    throw err;
  }

  const { job, state } = result;
  const order = await models.Order.findById(job.order).select(RIDER_ORDER_FIELDS).lean();
  const effects = [
    ...(await closeOtherOffers(models, job._id, user._id)),
    ...jobChangedEffects(job, { order, riderEvent: "delivery:accepted" }),
    capacityEffect(state, settings),
  ];
  return { job: riderJobView(job, order), effects };
};

export const rejectOffer = async ({ models, user, jobId, now = new Date() }) => {
  const offer = await models.DeliveryOffer.findOneAndUpdate(
    { job: jobId, partner: user._id, status: "SENT" }, { $set: { status: "REJECTED", respondedAt: now } }, AFTER,
  );
  if (!offer) throw fail("This request is no longer open", 409, "OFFER_GONE");
  await logEvent(models, { job: jobId, partner: user._id, type: "REJECTED", actor: riderActor(user), data: { round: offer.round } });
  // Everyone in this round said no → don't wait out the timer; the next tick re-broadcasts.
  const stillOpen = await models.DeliveryOffer.exists({ job: jobId, round: offer.round, status: "SENT" });
  if (!stillOpen) {
    await models.DeliveryJob.updateOne({ _id: jobId, status: "SEARCHING", round: offer.round }, { $set: { offerExpiresAt: now } });
  }
  return { ok: true, effects: [{ type: "admin", event: "delivery:rejected", payload: { jobId: String(jobId), partnerId: String(user._id) } }] };
};

// ── Rider: steps of an accepted delivery ─────────────────────────────────────
const loadOwnJob = async (models, user, jobId, withOtp = false) => {
  const q = models.DeliveryJob.findOne({ _id: jobId, partner: user._id });
  const job = await (withOtp ? q.select("+otpCode") : q);
  if (!job) throw fail("Delivery not found", 404);
  return job;
};

/**
 * AT_RESTAURANT / PICKED_UP / AT_CUSTOMER / FAILED / DELIVERED (OTP).
 * Each write is conditional on the job still being in the status we read,
 * so a double tap or two devices can't apply a step twice.
 */
export const advanceJob = async ({ models, db, user, jobId, to, otp, reason, cashCollected, cashAmount, now = new Date() }) => {
  const job = await loadOwnJob(models, user, jobId, to === "DELIVERED");
  assertRiderTransition(job.status, to);
  const actor = riderActor(user);
  const { settings } = await loadSettings(models);

  if (to === "DELIVERED") return deliverJob({ models, db, user, job, otp, cashCollected, cashAmount, settings, now });

  if (to === "PICKED_UP") {
    const order = await models.Order.findById(job.order).select("status").lean();
    if (!order || order.status === "CANCELLED") throw fail("This order was cancelled — don't pick it up", 409, "ORDER_CANCELLED");
    if (order.status !== "READY") throw fail("The kitchen hasn't marked this order ready yet", 409, "ORDER_NOT_READY");
  }

  let cleanReason = "";
  if (to === "FAILED") {
    cleanReason = String(reason || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (cleanReason.length < 3) throw fail("Say why the delivery couldn't be completed", 400);
  }

  const set = { status: to, [STEP_TIMESTAMP[to]]: now, ...(to === "FAILED" && { failReason: cleanReason }) };
  const write = (session) => models.DeliveryJob.findOneAndUpdate(
    { _id: job._id, partner: user._id, status: job.status }, { $set: set }, withSession(session),
  );

  let updated;
  if (to === "FAILED") {
    updated = await runTx(db, async (session) => {
      const u = await write(session);
      if (!u) throw fail("This delivery changed a moment ago — refresh", 409);
      await releaseCapacity(models, user._id, session);
      await logEvent(models, { job: u._id, order: u.order, partner: user._id, type: "FAILED", actor, data: { reason: cleanReason } }, session);
      return u;
    });
  } else {
    updated = await write();
    if (!updated) throw fail("This delivery changed a moment ago — refresh", 409);
    await logEvent(models, { job: updated._id, order: updated.order, partner: user._id, type: to, actor });
  }

  const order = await models.Order.findById(updated.order).select(RIDER_ORDER_FIELDS).lean();
  const effects = jobChangedEffects(updated, { order });
  if (to === "FAILED") {
    effects.push({ type: "admin", event: "delivery:escalated", payload: { job: adminJobView(updated), reason: "FAILED" } });
    const st = await models.DeliveryPartnerState.findOne({ partner: user._id }).lean();
    if (st) effects.push(capacityEffect(st, settings), ...(await offerOpenJobsTo({ models, partnerId: user._id, settings, now })));
  }
  return { job: riderJobView(updated, order), effects };
};

/**
 * OTP-verified hand-over, ONE transaction: job DELIVERED + capacity back +
 * order READY → DELIVERED + (COD) the CodCollection record. For a COD order
 * the rider must confirm the cash collected = the order total (to the paisa);
 * the collection is the rider's custody of the cash, not a payment — the bill
 * stays unpaid until an admin verifies the hand-in (verifyCodCollection).
 */
const deliverJob = async ({ models, db, user, job, otp, cashCollected, cashAmount, settings, now }) => {
  const actor = riderActor(user);
  const orderBefore = await models.Order.findById(job.order).select("orderId status orderType paymentMethod paymentStatus total").lean();
  if (!orderBefore || orderBefore.status === "CANCELLED") throw fail("This order was cancelled — contact the restaurant", 409, "ORDER_CANCELLED");
  const collect = codDue(orderBefore);
  if ((job.otpAttempts || 0) >= settings.maxOtpAttempts) {
    throw fail("Too many wrong codes — ask the restaurant to reset the delivery code", 423, "OTP_LOCKED");
  }
  if (!otpMatches(job.otpCode, otp)) {
    const bumped = await models.DeliveryJob.findOneAndUpdate(
      { _id: job._id, status: job.status }, { $inc: { otpAttempts: 1 } }, AFTER,
    );
    await logEvent(models, { job: job._id, order: job.order, partner: user._id, type: "OTP_FAILED", actor, data: { attempts: bumped?.otpAttempts ?? null } });
    const left = Math.max(0, settings.maxOtpAttempts - (bumped?.otpAttempts ?? settings.maxOtpAttempts));
    throw Object.assign(fail(left ? `Wrong code — ${left} ${left === 1 ? "try" : "tries"} left` : "Wrong code — ask the restaurant to reset the delivery code", 400, "OTP_WRONG"), { details: { attemptsLeft: left } });
  }

  if (collect && (cashCollected !== true || !sameAmount(cashAmount, orderBefore.total))) {
    throw Object.assign(fail(`Collect ₹${orderBefore.total} in cash and confirm the amount before completing`, 400, "COD_CONFIRM_REQUIRED"), {
      details: { amount: orderBefore.total },
    });
  }

  let previousOrderStatus = null;
  const { updated, order } = await runTx(db, async (session) => {
    const u = await models.DeliveryJob.findOneAndUpdate(
      { _id: job._id, partner: user._id, status: job.status },
      { $set: { status: "DELIVERED", deliveredAt: now } }, withSession(session),
    );
    if (!u) throw fail("This delivery changed a moment ago — refresh", 409);
    await releaseCapacity(models, user._id, session);

    const cur = await models.Order.findById(u.order).select("status orderType paymentMethod paymentStatus total orderId").session(session);
    if (collect) {
      // Re-checked inside the transaction: the bill can't have changed under the rider.
      if (!codDue(cur) || !sameAmount(cashAmount, cur.total)) {
        throw Object.assign(fail(`The bill changed — collect ₹${cur?.total} and confirm again`, 409, "COD_AMOUNT_CHANGED"), { details: { amount: cur?.total } });
      }
      await models.CodCollection.create([{
        order: u.order, orderNo: cur.orderId || u.orderNo, job: u._id, partner: user._id, partnerName: user.name || "",
        amount: cur.total, collectedAt: now,
      }], { session });
      await logEvent(models, { job: u._id, order: u.order, partner: user._id, type: "COD_COLLECTED", actor, data: { amount: cur.total } }, session);
    }
    let ord = null;
    if (cur?.status === "READY") {
      assertValidTransition("READY", "DELIVERED", DELIVERY); // the order state machine stays the authority
      const by = orderActorForRider(user);
      ord = await models.Order.findOneAndUpdate(
        { _id: u.order, status: "READY" },
        {
          $set: { status: "DELIVERED", deliveredBy: by, deliveredAt: now },
          $push: { statusHistory: { status: "DELIVERED", changedBy: by, changedAt: now, note: "Delivered to the customer (OTP verified)" } },
        },
        withSession(session),
      );
      if (ord) previousOrderStatus = "READY";
    }
    await logEvent(models, { job: u._id, order: u.order, partner: user._id, type: "DELIVERED", actor, data: { orderStatusBefore: cur?.status || null } }, session);
    return { updated: u, order: ord };
  });

  const effects = jobChangedEffects(updated, { riderEvent: "delivery:completed" });
  effects.push({ type: "admin", event: "delivery:completed", payload: { job: adminJobView(updated) } });
  if (collect) effects.push({ type: "admin", event: "delivery:cod_collected", payload: { orderId: String(updated.order), orderNo: updated.orderNo, partnerId: String(user._id), amount: orderBefore.total } });
  let finalOrder = order;
  if (order && effectiveBillStatus(order) === "SETTLED") {
    // Served AND settled → COMPLETED, exactly as when a waiter taps "Served".
    const done = await completeServedSettledOrder({ models, orderId: order._id, actor: orderActorForRider(user) });
    if (done.order) finalOrder = done.order;
  }
  if (finalOrder) effects.push({ type: "order_status", order: finalOrder, previousStatus: previousOrderStatus });
  const st = await models.DeliveryPartnerState.findOne({ partner: user._id }).lean();
  if (st) effects.push(capacityEffect(st, settings), ...(await offerOpenJobsTo({ models, partnerId: user._id, settings, now })));
  return { job: riderJobView(updated, finalOrder), effects };
};

// ── Rider: presence, push tokens, GPS ───────────────────────────────────────
export const setOnline = async ({ models, user, online, now = new Date() }) => {
  const { settings } = await loadSettings(models);
  const state = await ensureState(models, user._id);
  if (online) {
    if (state.suspended) throw fail("Your account is suspended — contact the restaurant", 403, "SUSPENDED");
    const st = await models.DeliveryPartnerState.findOneAndUpdate(
      { partner: user._id, suspended: { $ne: true } },
      { $set: { online: true, lastSeenAt: now, ...(!state.online && { onlineSince: now }) } }, AFTER,
    );
    if (!st) throw fail("Your account is suspended — contact the restaurant", 403, "SUSPENDED");
    if (!state.online) await logEvent(models, { partner: user._id, type: "ONLINE", actor: riderActor(user) });
    const effects = [
      { type: "admin", event: "delivery:partner_updated", payload: { partnerId: String(user._id), online: true } },
      ...(await offerOpenJobsTo({ models, partnerId: user._id, settings, now })),
      ...(await reopenEscalatedJobs({ models, settings, now })),
    ];
    return { state: stateView(st, settings), effects };
  }
  const st = await models.DeliveryPartnerState.findOneAndUpdate(
    { partner: user._id, activeCount: { $lte: 0 } }, { $set: { online: false, onlineSince: null } }, AFTER,
  );
  if (!st) throw fail("Finish your active deliveries before going offline", 409, "HAS_ACTIVE_DELIVERIES");
  if (state.online) await logEvent(models, { partner: user._id, type: "OFFLINE", actor: riderActor(user) });
  await models.DeliveryOffer.updateMany({ partner: user._id, status: "SENT" }, { $set: { status: "EXPIRED" } });
  return { state: stateView(st, settings), effects: [{ type: "admin", event: "delivery:partner_updated", payload: { partnerId: String(user._id), online: false } }] };
};

/** A rider came online: escalated jobs (nobody was available) get one fresh round. */
const reopenEscalatedJobs = async ({ models, settings, now }) => {
  const stuck = await models.DeliveryJob.find({ status: "SEARCHING", escalated: true }).select("_id round").lean();
  const effects = [];
  for (const j of stuck) effects.push(...(await broadcastJob({ models, jobId: j._id, expectRound: j.round, settings, now })).effects);
  return effects;
};

export const heartbeat = async ({ models, user, now = new Date() }) => {
  await models.DeliveryPartnerState.updateOne({ partner: user._id }, { $set: { lastSeenAt: now } });
  return { ok: true };
};

export const stateView = (st, settings) => ({
  online: !!st?.online, onlineSince: st?.onlineSince || null, suspended: !!st?.suspended,
  suspendedReason: st?.suspendedReason || "", activeCount: st?.activeCount || 0,
  capacity: capacityFor(st, settings), capacityOverride: st?.capacity ?? null,
  lastLocation: st?.lastLocation || null, lastSeenAt: st?.lastSeenAt || null,
});

const MAX_TOKENS = 5;
export const registerPushToken = async ({ models, user, token }) => {
  if (typeof token !== "string" || token.length < 20 || token.length > 4096) throw fail("Invalid push token");
  await ensureState(models, user._id);
  await models.DeliveryPartnerState.updateOne({ partner: user._id }, { $pull: { fcmTokens: token } });
  await models.DeliveryPartnerState.updateOne({ partner: user._id }, { $push: { fcmTokens: { $each: [token], $slice: -MAX_TOKENS } } });
  return { ok: true };
};
export const removePushToken = async ({ models, user, token }) => {
  await models.DeliveryPartnerState.updateOne({ partner: user._id }, { $pull: { fcmTokens: token } });
  return { ok: true };
};
/** Called by the push sender when FCM says a token is dead. */
export const dropDeadPushTokens = (models, tokens) =>
  tokens.length ? models.DeliveryPartnerState.updateMany({ fcmTokens: { $in: tokens } }, { $pull: { fcmTokens: { $in: tokens } } }) : null;

/**
 * A batch of GPS fixes from the rider's device. Stored as breadcrumbs ONLY
 * while the rider has an active delivery; otherwise it is just a presence
 * ping. `tracking: false` in the reply tells the app to stop its GPS service.
 */
export const recordLocations = async ({ models, user, points, now = new Date() }) => {
  const state = await ensureState(models, user._id);
  const { points: good, rejected } = sanitizeLocationBatch(points, { now, previous: state.lastLocation });
  const active = await models.DeliveryJob.find({ partner: user._id, status: { $in: ACTIVE_JOB_STATUSES } }).select("_id order status").lean();

  await models.DeliveryPartnerState.updateOne({ partner: user._id }, { $set: { lastSeenAt: now } });
  if (!good.length) return { accepted: 0, rejected, tracking: active.length > 0, effects: [] };

  if (active.length) {
    await models.DeliveryLocation.insertMany(
      good.map((p) => ({ ...p, partner: user._id, jobs: active.map((j) => j._id), receivedAt: now })), { ordered: false },
    );
  }
  const newest = good[good.length - 1];
  await models.DeliveryPartnerState.updateOne(
    { partner: user._id, $or: [{ lastLocation: null }, { "lastLocation.at": { $lt: newest.at } }] },
    { $set: { lastLocation: newest } },
  );

  const loc = { latitude: newest.latitude, longitude: newest.longitude, heading: newest.heading, at: newest.at };
  const effects = [];
  if (active.length || state.online) {
    effects.push({ type: "admin", event: "delivery:location_updated", payload: { partnerId: String(user._id), name: user.name || "", location: { ...loc, accuracy: newest.accuracy }, jobIds: active.map((j) => String(j._id)) } });
  }
  // Each customer gets the SAME rider position on their own tracking room —
  // never another customer's job id, address or status.
  for (const j of active) {
    effects.push({ type: "track", jobId: String(j._id), orderId: String(j.order), event: "delivery:location_updated", payload: { jobId: String(j._id), location: loc } });
  }
  return { accepted: good.length, rejected, tracking: active.length > 0, effects };
};

// ── Rider: reads ─────────────────────────────────────────────────────────────
const ordersById = async (models, ids) => {
  const list = ids.length ? await models.Order.find({ _id: { $in: ids } }).select(RIDER_ORDER_FIELDS).lean() : [];
  return new Map(list.map((o) => [String(o._id), o]));
};

export const getRiderSnapshot = async ({ models, user, now = new Date() }) => {
  const { profile, settings } = await loadSettings(models);
  const state = await ensureState(models, user._id);
  const [jobs, offers] = await Promise.all([
    models.DeliveryJob.find({ partner: user._id, status: { $in: ACTIVE_JOB_STATUSES } }).sort({ assignedAt: 1 }).lean(),
    listOpenOffers({ models, user, now }),
  ]);
  const orders = await ordersById(models, jobs.map((j) => j.order));
  return {
    partner: { id: String(user._id), name: user.name || "", phone: user.phone || "" },
    restaurant: { name: profile?.restaurantName || "", phone: profile?.phone || "", latitude: profile?.latitude ?? null, longitude: profile?.longitude ?? null, address: profile?.address || "" },
    state: stateView(state, settings),
    activeJobs: jobs.map((j) => riderJobView(j, orders.get(String(j.order)))),
    offers,
    today: await riderSummary({ models, user, tz: resolveTimezone(profile?.timezone) }),
  };
};

export const listOpenOffers = async ({ models, user, now = new Date() }) => {
  const offers = await models.DeliveryOffer.find({ partner: user._id, status: "SENT", expiresAt: { $gt: now } }).lean();
  if (!offers.length) return [];
  const jobs = await models.DeliveryJob.find({ _id: { $in: offers.map((o) => o.job) }, status: "SEARCHING" }).lean();
  const byId = new Map(jobs.map((j) => [String(j._id), j]));
  return offers.filter((o) => byId.has(String(o.job))).map((o) => offerView(byId.get(String(o.job)), o.expiresAt));
};

export const getRiderJob = async ({ models, user, jobId }) => {
  const job = await loadOwnJob(models, user, jobId);
  const order = await models.Order.findById(job.order).select(RIDER_ORDER_FIELDS).lean();
  return riderJobView(job, order);
};

const minutesBetween = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 60000 : null);
const avg = (xs) => { const v = xs.filter((x) => Number.isFinite(x)); return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null; };

export const riderSummary = async ({ models, user, tz, from, to }) => {
  const { start, end } = resolveRange(from, to, tz);
  const jobs = await models.DeliveryJob.find({ partner: user._id, assignedAt: { $gte: start, $lte: end } }).lean();
  const delivered = jobs.filter((j) => j.status === "DELIVERED");
  return {
    from: start, to: end,
    assigned: jobs.length,
    delivered: delivered.length,
    failed: jobs.filter((j) => j.status === "FAILED").length,
    active: jobs.filter((j) => ACTIVE_JOB_STATUSES.includes(j.status)).length,
    avgDeliveryMinutes: avg(delivered.map((j) => minutesBetween(j.assignedAt, j.deliveredAt))),
    avgRideMinutes: avg(delivered.map((j) => minutesBetween(j.pickedUpAt, j.deliveredAt))),
  };
};

export const riderHistory = async ({ models, user, tz, from, to, limit = 50 }) => {
  const { start, end } = resolveRange(from, to, tz);
  const jobs = await models.DeliveryJob.find({
    partner: user._id, status: { $in: TERMINAL_JOB_STATUSES }, assignedAt: { $gte: start, $lte: end },
  }).sort({ assignedAt: -1 }).limit(Math.min(200, Math.max(1, Number(limit) || 50))).lean();
  return jobs.map((j) => ({
    jobId: String(j._id), orderNo: j.orderNo, status: j.status, dropAddress: j.drop?.address || "",
    distanceMeters: j.distanceMeters ?? null, assignedAt: j.assignedAt, pickedUpAt: j.pickedUpAt,
    deliveredAt: j.deliveredAt, failedAt: j.failedAt, failReason: j.failReason || "",
    minutes: minutesBetween(j.assignedAt, j.deliveredAt || j.failedAt),
  }));
};

// ── Customer: their own delivery + public tracking link ─────────────────────
/** Is this rider position worth showing to the customer? Only while the job is active. */
const riderPositionFor = async (models, job) => {
  if (!ACTIVE_JOB_STATUSES.includes(job.status) || !job.partner) return null;
  const st = await models.DeliveryPartnerState.findOne({ partner: job.partner }).select("lastLocation").lean();
  const l = st?.lastLocation;
  return l ? { latitude: l.latitude, longitude: l.longitude, heading: l.heading ?? null, at: l.at } : null;
};

const publicTrackingView = async ({ models, job, profile }) => {
  const order = await models.Order.findById(job.order).select("orderId status").lean();
  const riderLocation = await riderPositionFor(models, job);
  return {
    jobId: String(job._id),
    orderId: String(job.order), orderNo: job.orderNo || order?.orderId || "",
    status: job.status, label: CUSTOMER_LABEL[job.status] || job.status, orderStatus: order?.status || null,
    restaurant: { name: job.pickup?.name || profile?.restaurantName || "", latitude: job.pickup?.latitude ?? null, longitude: job.pickup?.longitude ?? null, phone: profile?.phone || "" },
    destination: { latitude: job.drop?.latitude ?? null, longitude: job.drop?.longitude ?? null },
    rider: job.partner ? { name: firstName(job.partnerName), location: riderLocation } : null,
    // Straight-line only, and labelled so — real route distance / ETA come
    // from the routes endpoint when a Google key is configured.
    approxDistanceMeters: riderLocation ? straightLineMeters(riderLocation, job.drop) : job.distanceMeters ?? null,
    distanceIsStraightLine: true,
    assignedAt: job.assignedAt, pickedUpAt: job.pickedUpAt, deliveredAt: job.deliveredAt,
  };
};

/** GET /api/delivery/track/:token — no login; the token is the authorisation. */
export const getTrackingByToken = async ({ models, token, now = new Date() }) => {
  const parsed = parseTrackingToken(token);
  if (!parsed) throw fail("This tracking link is not valid", 404, "TRACKING_INVALID");
  const job = await models.DeliveryJob.findById(parsed.jobId).lean();
  const { profile, settings } = await loadSettings(models);
  if (!job || (job.trackingVersion || 0) !== parsed.version || !trackingOpen(job, settings, now)) {
    throw fail("This tracking link has expired", 410, "TRACKING_EXPIRED");
  }
  return publicTrackingView({ models, job, profile });
};

/** Verifies a token for a socket `join-tracking` → the jobId, or null. */
export const verifyTrackingForSocket = async ({ models, token, now = new Date() }) => {
  const parsed = parseTrackingToken(token);
  if (!parsed) return null;
  const job = await models.DeliveryJob.findById(parsed.jobId).select("status trackingVersion trackingRevokedAt deliveredAt failedAt").lean();
  const { settings } = await loadSettings(models);
  if (!job || (job.trackingVersion || 0) !== parsed.version || !trackingOpen(job, settings, now)) return null;
  return String(job._id);
};

/**
 * The logged-in customer's view of their own order's delivery: the tracking
 * view plus what only they may see — the hand-over code and the rider's
 * phone (while the delivery is active) and their own tracking link.
 */
export const getCustomerDelivery = async ({ models, user, orderId }) => {
  const order = await models.Order.findById(orderId).select("user orderType deliveryAddress paymentMethod paymentStatus total").lean();
  if (!order) throw fail("Order not found", 404);
  if (!user || String(order.user) !== String(user._id)) throw fail("Not authorized to view this delivery", 403);
  if (order.orderType !== "ONLINE" || !order.deliveryAddress) throw fail("This is not a delivery order", 404);
  const job = await models.DeliveryJob.findOne({ order: orderId }).select("+otpCode").lean();
  if (!job) return { status: "PENDING", label: "Waiting for the restaurant to accept your order", delivery: null };
  const { profile } = await loadSettings(models);
  const view = await publicTrackingView({ models, job, profile });
  const active = ACTIVE_JOB_STATUSES.includes(job.status);
  let riderPhone = "";
  if (active && job.partner) riderPhone = (await models.User.findById(job.partner).select("phone").lean())?.phone || "";
  return {
    ...view,
    otp: active ? job.otpCode : null,
    rider: view.rider ? { ...view.rider, phone: riderPhone } : null,
    trackingToken: job.trackingRevokedAt ? null : signTrackingToken(job._id, job.trackingVersion || 0),
    payment: { method: order.paymentMethod, paid: order.paymentStatus === "PAID", amountToPay: codDue(order) ? order.total : 0 },
    dropAddress: job.drop,
  };
};

// ── Order hooks (called right after a confirm / cancel) ─────────────────────
/** Keeps the delivery in step with its order. Never throws to the caller. */
export const syncDeliveryForOrder = async ({ models, db, order, now = new Date() }) => {
  try {
    if (!order || order.orderType !== "ONLINE") return { effects: [] };
    if (order.status === "CANCELLED") return await cancelJobForOrder({ models, db, orderId: order._id, reason: order.cancelReason || "Order cancelled", now });
    if (needsDeliveryJob(order)) {
      const created = await createJobForOrder({ models, order, now });
      if (created.created) return created;
      // Job already exists: the kitchen moved the order (e.g. READY) — the
      // assigned rider's card must update ("Ready for pickup").
      const job = await models.DeliveryJob.findOne({ order: order._id, status: { $in: ACTIVE_JOB_STATUSES } }).lean();
      if (job?.partner) {
        const full = await models.Order.findById(order._id).select(RIDER_ORDER_FIELDS).lean();
        return { effects: [{ type: "partner", partnerId: String(job.partner), event: "delivery:job_updated", payload: { job: riderJobView(job, full) } }] };
      }
    }
  } catch (err) {
    console.error("delivery sync failed:", err.message);
  }
  return { effects: [] };
};

const cancelJobForOrder = async ({ models, db, orderId, reason, now }) => {
  const job = await models.DeliveryJob.findOne({ order: orderId, status: { $nin: TERMINAL_JOB_STATUSES } }).select("_id").lean();
  if (!job) return { effects: [] };
  return cancelJob({ models, db, jobId: job._id, reason, actor: SYSTEM_ACTOR, now });
};

/** Any non-terminal job → CANCELLED; capacity back if a rider held it. */
export const cancelJob = async ({ models, db, jobId, reason, actor, now = new Date() }) => {
  const before = await models.DeliveryJob.findById(jobId).lean();
  if (!before) throw fail("Delivery not found", 404);
  if (TERMINAL_JOB_STATUSES.includes(before.status)) throw fail(`This delivery is already ${before.status.toLowerCase()}`, 409);
  const held = ACTIVE_JOB_STATUSES.includes(before.status) && before.partner;
  const job = await runTx(db, async (session) => {
    const u = await models.DeliveryJob.findOneAndUpdate(
      { _id: jobId, status: before.status },
      { $set: { status: "CANCELLED", cancelledAt: now, cancelReason: String(reason || "").slice(0, 200), offerExpiresAt: null } },
      withSession(session),
    );
    if (!u) throw fail("This delivery changed a moment ago — refresh", 409);
    if (held) await releaseCapacity(models, before.partner, session);
    await logEvent(models, { job: u._id, order: u.order, partner: before.partner, type: "CANCELLED", actor, data: { reason: u.cancelReason } }, session);
    return u;
  });
  const effects = [
    ...(await closeOtherOffers(models, job._id, null)),
    { type: "admin", event: "delivery:status_updated", payload: { job: adminJobView(job) } },
    { type: "track", jobId: String(job._id), orderId: String(job.order), event: "delivery:status_updated", payload: trackingStatusView(job) },
  ];
  if (held) effects.push({ type: "partner", partnerId: String(before.partner), event: "delivery:job_removed", payload: { jobId: String(job._id), reason: "CANCELLED" } });
  return { job: adminJobView(job), effects };
};

// ── Admin interventions ─────────────────────────────────────────────────────
/** Manual assignment (escalations, phone-arranged riders). Same atomic capacity rule as accept. */
export const adminAssign = async ({ models, db, admin, jobId, partnerId, now = new Date() }) => {
  const { settings } = await loadSettings(models);
  const rider = await models.User.findOne({ _id: partnerId, role: DELIVERY, status: { $ne: "Inactive" } }).select("_id name").lean();
  if (!rider) throw fail("That delivery partner doesn't exist or is deactivated", 404);
  await ensureState(models, rider._id);
  const actor = adminActor(admin);
  const { job, state } = await runTx(db, async (session) => {
    const st = await models.DeliveryPartnerState.findOneAndUpdate(
      { partner: rider._id, suspended: { $ne: true }, $expr: { $lt: ["$activeCount", { $ifNull: ["$capacity", settings.defaultCapacity] }] } },
      { $inc: { activeCount: 1, capVersion: 1 } }, withSession(session),
    );
    if (!st) throw fail(`${rider.name || "This partner"} is suspended or already at their delivery limit`, 409, "CAPACITY_FULL");
    const j = await models.DeliveryJob.findOneAndUpdate(
      { _id: jobId, status: "SEARCHING" },
      { $set: { status: "ASSIGNED", partner: rider._id, partnerName: rider.name || "", assignedAt: now, assignedBy: actor, otpCode: generateOtp(), otpAttempts: 0, offerExpiresAt: null, escalated: false, escalatedAt: null } },
      withSession(session),
    );
    if (!j) throw fail("This delivery already has a partner (or was cancelled)", 409, "ALREADY_ASSIGNED");
    await logEvent(models, { job: j._id, order: j.order, partner: rider._id, type: "ADMIN_ASSIGNED", actor }, session);
    return { job: j, state: st };
  });
  const order = await models.Order.findById(job.order).select(RIDER_ORDER_FIELDS).lean();
  return {
    job: adminJobView(job),
    effects: [...(await closeOtherOffers(models, job._id, rider._id)), ...jobChangedEffects(job, { order, riderEvent: "delivery:accepted" }), capacityEffect(state, settings)],
  };
};

/** Take a job off a rider before pickup; it goes straight back to broadcasting. */
export const adminUnassign = async ({ models, db, admin, jobId, reason, now = new Date() }) => {
  const before = await models.DeliveryJob.findById(jobId).lean();
  if (!before) throw fail("Delivery not found", 404);
  if (!UNASSIGNABLE_STATUSES.includes(before.status)) throw fail("Only a delivery that hasn't been picked up can be reassigned", 409);
  const { settings } = await loadSettings(models);
  const actor = adminActor(admin);
  const job = await runTx(db, async (session) => {
    const u = await models.DeliveryJob.findOneAndUpdate(
      { _id: jobId, status: before.status, partner: before.partner },
      { $set: { status: "SEARCHING", partner: null, partnerName: "", assignedAt: null, assignedBy: null, arrivedRestaurantAt: null, otpCode: "", otpAttempts: 0, offerExpiresAt: now, escalated: false } },
      withSession(session),
    );
    if (!u) throw fail("This delivery changed a moment ago — refresh", 409);
    await releaseCapacity(models, before.partner, session);
    await logEvent(models, { job: u._id, order: u.order, partner: before.partner, type: "ADMIN_UNASSIGNED", actor, data: { reason: String(reason || "").slice(0, 200) } }, session);
    return u;
  });
  const b = await broadcastJob({ models, jobId: job._id, expectRound: job.round, settings, now });
  const st = await models.DeliveryPartnerState.findOne({ partner: before.partner }).lean();
  return {
    job: adminJobView(b.job || job),
    effects: [
      { type: "partner", partnerId: String(before.partner), event: "delivery:job_removed", payload: { jobId: String(job._id), reason: "UNASSIGNED" } },
      ...(st ? [capacityEffect(st, settings)] : []),
      ...jobChangedEffects(b.job || job),
      ...b.effects,
    ],
  };
};

export const adminRebroadcast = async ({ models, jobId, now = new Date() }) => {
  const job = await models.DeliveryJob.findById(jobId).select("status round").lean();
  if (!job) throw fail("Delivery not found", 404);
  if (job.status !== "SEARCHING") throw fail("Only a delivery that is still looking for a partner can be re-broadcast", 409);
  const r = await broadcastJob({ models, jobId, expectRound: job.round, now });
  if (!r.job) throw fail("This delivery changed a moment ago — refresh", 409);
  return { job: adminJobView(r.job), offered: r.offered, effects: r.effects };
};

export const adminResetOtp = async ({ models, admin, jobId }) => {
  const job = await models.DeliveryJob.findOneAndUpdate(
    { _id: jobId, status: { $in: ACTIVE_JOB_STATUSES } }, { $set: { otpCode: generateOtp(), otpAttempts: 0 } }, AFTER,
  );
  if (!job) throw fail("Only an active delivery's code can be reset", 409);
  await logEvent(models, { job: job._id, order: job.order, partner: job.partner, type: "OTP_RESET", actor: adminActor(admin) });
  return { job: adminJobView(job), effects: jobChangedEffects(job) };
};

/** Invalidates every link handed out so far; the customer's app fetches the new one. */
export const adminRevokeTracking = async ({ models, admin, jobId }) => {
  const job = await models.DeliveryJob.findByIdAndUpdate(jobId, { $inc: { trackingVersion: 1 } }, AFTER);
  if (!job) throw fail("Delivery not found", 404);
  await logEvent(models, { job: job._id, order: job.order, type: "TRACKING_REVOKED", actor: adminActor(admin) });
  return { job: adminJobView(job), effects: [] };
};

export const listJobs = async ({ models, status, escalated, limit = 100 }) => {
  const q = {};
  if (status === "ACTIVE") q.status = { $in: ["SEARCHING", ...ACTIVE_JOB_STATUSES] };
  else if (status) q.status = status;
  if (escalated === "true" || escalated === true) q.escalated = true;
  const jobs = await models.DeliveryJob.find(q).sort({ createdAt: -1 }).limit(Math.min(500, Number(limit) || 100)).lean();
  return jobs.map(adminJobView);
};

export const getJobEvents = async ({ models, jobId }) =>
  models.DeliveryEvent.find({ job: jobId }).sort({ at: 1 }).lean();

export const listPartners = async ({ models, now = new Date() }) => {
  const { settings } = await loadSettings(models);
  const users = await models.User.find({ role: DELIVERY }).select("_id name phone status lastLoginAt").sort({ name: 1 }).lean();
  const [states, active] = await Promise.all([
    models.DeliveryPartnerState.find({ partner: { $in: users.map((u) => u._id) } }).lean(),
    models.DeliveryJob.find({ status: { $in: ACTIVE_JOB_STATUSES } }).select("partner orderNo status").lean(),
  ]);
  const st = new Map(states.map((s) => [String(s.partner), s]));
  return users.map((u) => {
    const s = st.get(String(u._id));
    const mine = active.filter((j) => String(j.partner) === String(u._id));
    const staleMin = s?.lastSeenAt ? Math.round((now - new Date(s.lastSeenAt)) / 60000) : null;
    return {
      id: String(u._id), name: u.name || "", phone: u.phone || "", accountStatus: u.status || "Active",
      ...stateView(s, settings), minutesSinceSeen: staleMin,
      activeJobs: mine.map((j) => ({ jobId: String(j._id), orderNo: j.orderNo, status: j.status })),
    };
  });
};

/** Capacity override and suspension. Suspending also takes the rider offline and withdraws open offers. */
export const updatePartner = async ({ models, admin, partnerId, capacity, suspended, reason, now = new Date() }) => {
  const rider = await models.User.findOne({ _id: partnerId, role: DELIVERY }).select("_id").lean();
  if (!rider) throw fail("Delivery partner not found", 404);
  await ensureState(models, rider._id);
  const set = {};
  if (capacity !== undefined) {
    if (capacity === null || capacity === "") set.capacity = null;
    else {
      const n = Number(capacity);
      if (!Number.isInteger(n) || n < 1 || n > 10) throw fail("Capacity must be a whole number from 1 to 10");
      set.capacity = n;
    }
  }
  if (suspended !== undefined) {
    if (suspended === true) {
      const r = String(reason || "").replace(/\s+/g, " ").trim();
      if (r.length < 3) throw fail("Give a reason for the suspension");
      Object.assign(set, { suspended: true, suspendedReason: r.slice(0, 200), suspendedAt: now, suspendedBy: adminActor(admin), online: false, onlineSince: null });
    } else if (suspended === false) {
      Object.assign(set, { suspended: false, suspendedReason: "", suspendedAt: null, suspendedBy: null });
    } else throw fail("suspended must be true or false");
  }
  if (!Object.keys(set).length) throw fail("Nothing to change");
  const st = await models.DeliveryPartnerState.findOneAndUpdate({ partner: rider._id }, { $set: set }, AFTER);
  const { settings } = await loadSettings(models);
  const effects = [capacityEffect(st, settings), { type: "admin", event: "delivery:partner_updated", payload: { partnerId: String(rider._id) } }];
  if (set.suspended === true) {
    await models.DeliveryOffer.updateMany({ partner: rider._id, status: "SENT" }, { $set: { status: "EXPIRED" } });
    effects.push({ type: "partner", partnerId: String(rider._id), event: "delivery:presence", payload: { online: false, reason: "SUSPENDED" } });
  }
  await logEvent(models, { partner: rider._id, type: "PARTNER_UPDATED", actor: adminActor(admin), data: set.suspendedBy ? { ...set, suspendedBy: undefined } : set });
  return { partner: stateView(st, settings), effects };
};

export const forceOffline = async ({ models, admin, partnerId }) => {
  const st = await models.DeliveryPartnerState.findOneAndUpdate({ partner: partnerId }, { $set: { online: false, onlineSince: null } }, AFTER);
  if (!st) throw fail("Delivery partner not found", 404);
  await models.DeliveryOffer.updateMany({ partner: partnerId, status: "SENT" }, { $set: { status: "EXPIRED" } });
  await logEvent(models, { partner: partnerId, type: "FORCED_OFFLINE", actor: adminActor(admin) });
  return { ok: true, effects: [{ type: "partner", partnerId: String(partnerId), event: "delivery:presence", payload: { online: false, reason: "ADMIN" } }] };
};

export const overview = async ({ models }) => {
  const { profile } = await loadSettings(models);
  const { start, end } = resolveRange(null, null, resolveTimezone(profile?.timezone));
  const [byStatus, escalated, online, todayDone, todayFailed] = await Promise.all([
    models.DeliveryJob.aggregate([{ $match: { status: { $nin: TERMINAL_JOB_STATUSES } } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    models.DeliveryJob.countDocuments({ status: "SEARCHING", escalated: true }),
    models.DeliveryPartnerState.countDocuments({ online: true }),
    models.DeliveryJob.countDocuments({ status: "DELIVERED", deliveredAt: { $gte: start, $lte: end } }),
    models.DeliveryJob.countDocuments({ status: "FAILED", failedAt: { $gte: start, $lte: end } }),
  ]);
  const counts = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));
  return {
    searching: counts.SEARCHING || 0, escalated,
    active: ACTIVE_JOB_STATUSES.reduce((s, k) => s + (counts[k] || 0), 0), byStatus: counts,
    onlinePartners: online, deliveredToday: todayDone, failedToday: todayFailed,
  };
};

export const liveMap = async ({ models }) => {
  const { profile, settings } = await loadSettings(models);
  const active = await models.DeliveryJob.find({ status: { $in: ACTIVE_JOB_STATUSES } }).select("partner orderNo status drop").lean();
  const ids = new Set(active.map((j) => String(j.partner)));
  const states = await models.DeliveryPartnerState.find({ $or: [{ online: true }, { partner: { $in: [...ids] } }] }).lean();
  const users = await models.User.find({ _id: { $in: states.map((s) => s.partner) } }).select("name phone").lean();
  const names = new Map(users.map((u) => [String(u._id), u]));
  return {
    restaurant: { name: profile?.restaurantName || "", latitude: profile?.latitude ?? null, longitude: profile?.longitude ?? null },
    partners: states.map((s) => ({
      id: String(s.partner), name: names.get(String(s.partner))?.name || "", phone: names.get(String(s.partner))?.phone || "",
      ...stateView(s, settings),
      jobs: active.filter((j) => String(j.partner) === String(s.partner)).map((j) => ({
        jobId: String(j._id), orderNo: j.orderNo, status: j.status,
        drop: { latitude: j.drop?.latitude ?? null, longitude: j.drop?.longitude ?? null, address: j.drop?.address || "" },
      })),
    })),
  };
};

/** Delivery reports for [from, to] (restaurant calendar days), grouped by day or month. */
export const reports = async ({ models, from, to, groupBy = "day" }) => {
  const { profile } = await loadSettings(models);
  const tz = resolveTimezone(profile?.timezone);
  const { start, end } = resolveRange(from, to, tz);
  const jobs = await models.DeliveryJob.find({ createdAt: { $gte: start, $lte: end } }).lean();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", ...(groupBy === "month" ? {} : { day: "2-digit" }) });
  const bucket = (d) => fmt.format(new Date(d));

  const sum = (list) => {
    const delivered = list.filter((j) => j.status === "DELIVERED");
    const failed = list.filter((j) => j.status === "FAILED").length;
    const closed = delivered.length + failed;
    return {
      total: list.length, delivered: delivered.length, failed,
      cancelled: list.filter((j) => j.status === "CANCELLED").length,
      escalated: list.filter((j) => j.escalatedAt).length,
      completionRate: closed ? Math.round((delivered.length / closed) * 1000) / 10 : null,
      avgDeliveryMinutes: avg(delivered.map((j) => minutesBetween(j.assignedAt, j.deliveredAt))),
      avgWaitForPartnerMinutes: avg(list.map((j) => minutesBetween(j.createdAt, j.assignedAt))),
    };
  };
  const group = (keyFn) => {
    const m = new Map();
    for (const j of jobs) { const k = keyFn(j); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(j); }
    return m;
  };
  const periods = [...group((j) => bucket(j.createdAt))].sort(([a], [b]) => a.localeCompare(b)).map(([period, list]) => ({ period, ...sum(list) }));
  const byPartner = group((j) => (j.partner ? String(j.partner) : null));
  const users = await models.User.find({ _id: { $in: [...byPartner.keys()] } }).select("name").lean();
  const names = new Map(users.map((u) => [String(u._id), u.name || ""]));
  const cods = await models.CodCollection.find({ collectedAt: { $gte: start, $lte: end } }).select("amount status").lean();
  const codSum = (pred) => Math.round(cods.filter(pred).reduce((t, c) => t + c.amount, 0) * 100) / 100;
  return {
    from: start, to: end, groupBy: groupBy === "month" ? "month" : "day", timezone: tz,
    totals: sum(jobs), periods,
    cod: {
      collections: cods.length,
      collected: codSum(() => true),
      verified: codSum((c) => c.status === "VERIFIED"),
      awaitingVerification: codSum((c) => c.status !== "VERIFIED"),
      disputed: codSum((c) => c.status === "DISPUTED"),
    },
    partners: [...byPartner].map(([pid, list]) => ({ partnerId: pid, name: names.get(pid) || "", ...sum(list) }))
      .sort((a, b) => b.delivered - a.delivered),
  };
};

export const getSettings = async ({ models }) => {
  const { profile, settings } = await loadSettings(models);
  const phonePeConfigured = isPhonePeConfigured();
  return {
    ...settings, deliveryRange: profile?.deliveryRange ?? null,
    restaurantLocationSet: profile?.latitude != null && profile?.longitude != null,
    deliveryServiceOn: profile?.services?.delivery === true,
    payment: deliveryPaymentSettings(profile),
    phonePeConfigured,
    checkout: deliveryPaymentOptions({ profile, phonePeEnabled: phonePeConfigured }), // what customers see right now
  };
};

// ── Cash on Delivery: custody → verification → existing billing settle ──────
export const codView = (c) => ({
  id: String(c._id), orderId: String(c.order), orderNo: c.orderNo, jobId: String(c.job),
  partnerId: String(c.partner), partnerName: c.partnerName, amount: c.amount, collectedAt: c.collectedAt,
  status: c.status, verifiedAt: c.verifiedAt, verifiedBy: c.verifiedBy?.name || "",
  disputedAt: c.disputedAt, disputeReason: c.disputeReason, note: c.note,
});

const HELD = ["COLLECTED", "VERIFYING", "DISPUTED"];
const round2 = (n) => Math.round(n * 100) / 100;

export const listCodCollections = async ({ models, status, partnerId, limit = 200 }) => {
  const q = {};
  if (status) q.status = status;
  if (partnerId) q.partner = partnerId;
  const rows = await models.CodCollection.find(q).sort({ collectedAt: -1 }).limit(Math.min(500, Number(limit) || 200)).lean();
  // Cash each rider still holds (collected or disputed, not yet verified).
  const held = await models.CodCollection.find({ status: { $in: HELD } }).select("partner partnerName amount").lean();
  const byRider = new Map();
  for (const h of held) {
    const k = String(h.partner);
    const cur = byRider.get(k) || { partnerId: k, partnerName: h.partnerName, count: 0, amount: 0 };
    cur.count++; cur.amount = round2(cur.amount + h.amount);
    byRider.set(k, cur);
  }
  return { collections: rows.map(codView), cashWithRiders: [...byRider.values()].sort((a, b) => b.amount - a.amount) };
};

/** The rider's own cash-in-hand (not yet handed in and verified). */
export const riderCash = async ({ models, user }) => {
  const rows = await models.CodCollection.find({ partner: user._id, status: { $in: HELD } }).sort({ collectedAt: -1 }).lean();
  return { total: round2(rows.reduce((s, r) => s + r.amount, 0)), collections: rows.map(codView) };
};

/**
 * Admin/manager confirms the rider handed the cash in. Claimed atomically
 * (COLLECTED|DISPUTED → VERIFYING — two admins can't both run it), then the
 * EXISTING billing settle runs (billingService.settleBills, Cash): it records
 * PAID + paidBy (the verifier, who now holds the cash) and settles the bill,
 * and completes the order if it is DELIVERED. If billing refuses, the claim
 * is released and the reason returned. An already-settled bill (e.g. settled
 * in Invoices) is not settled twice — the custody record is just verified.
 */
export const verifyCodCollection = async ({ models, admin, collectionId, note, now = new Date() }) => {
  const claimed = await models.CodCollection.findOneAndUpdate(
    { _id: collectionId, status: { $in: ["COLLECTED", "DISPUTED"] } }, { $set: { status: "VERIFYING" } }, AFTER,
  );
  if (!claimed) {
    const c = await models.CodCollection.findById(collectionId).select("status").lean();
    if (!c) throw fail("Collection not found", 404);
    throw fail(c.status === "VERIFIED" ? "Already verified" : "Someone else is verifying this right now", 409);
  }
  const prevStatus = claimed.disputedAt ? "DISPUTED" : "COLLECTED";
  try {
    const order = await models.Order.findById(claimed.order).select("orderId total paymentStatus billStatus status").lean();
    if (!order) throw fail("Order not found", 404);
    const alreadyPaid = order.paymentStatus === "PAID";
    if (!alreadyPaid && !sameAmount(claimed.amount, order.total)) {
      throw fail(`The bill is now ₹${order.total} but ₹${claimed.amount} was collected — check with the rider and settle it in Invoices`, 409, "COD_AMOUNT_MISMATCH");
    }
    const settle = await settleBills({
      models, orderIds: [String(claimed.order)], paymentMethod: alreadyPaid ? undefined : "Cash",
      actor: buildActor(admin), role: getRoleFromUser(admin), now,
    });
    if (settle.rejected.length) throw fail(`Billing refused: ${settle.rejected[0].reason}`, 409, "SETTLE_REFUSED");
    const done = await models.CodCollection.findOneAndUpdate(
      { _id: claimed._id, status: "VERIFYING" },
      { $set: { status: "VERIFIED", verifiedAt: now, verifiedBy: adminActor(admin), note: String(note || "").slice(0, 200) } }, AFTER,
    );
    await logEvent(models, {
      job: claimed.job, order: claimed.order, partner: claimed.partner, type: "COD_VERIFIED", actor: adminActor(admin),
      data: { amount: claimed.amount, settledNow: settle.settled.length > 0 },
    });
    return {
      collection: codView(done), settle,
      effects: [
        { type: "admin", event: "delivery:cod_updated", payload: { collection: codView(done) } },
        { type: "partner", partnerId: String(claimed.partner), event: "delivery:cash_updated", payload: { collectionId: String(claimed._id), status: "VERIFIED" } },
      ],
    };
  } catch (err) {
    await models.CodCollection.updateOne({ _id: claimed._id, status: "VERIFYING" }, { $set: { status: prevStatus } });
    throw err;
  }
};

/** The handed-in cash doesn't match (short, missing): flag it; it can still be verified later. */
export const disputeCodCollection = async ({ models, admin, collectionId, reason, now = new Date() }) => {
  const r = String(reason || "").replace(/\s+/g, " ").trim();
  if (r.length < 3) throw fail("Say what is wrong with this collection");
  const c = await models.CodCollection.findOneAndUpdate(
    { _id: collectionId, status: "COLLECTED" },
    { $set: { status: "DISPUTED", disputedAt: now, disputedBy: adminActor(admin), disputeReason: r.slice(0, 200) } }, AFTER,
  );
  if (!c) throw fail("Only a collected, unverified amount can be disputed", 409);
  await logEvent(models, { job: c.job, order: c.order, partner: c.partner, type: "COD_DISPUTED", actor: adminActor(admin), data: { reason: c.disputeReason } });
  return { collection: codView(c), effects: [{ type: "admin", event: "delivery:cod_updated", payload: { collection: codView(c) } }] };
};

// ── Background tick (server.js) ─────────────────────────────────────────────
/**
 * Every few seconds. Each step is an atomic conditional write, so running on
 * several instances at once is safe (the round claim in broadcastJob, the
 * conditional expiries, the capVersion-guarded drift repair).
 *   1. jobs for confirmed delivery orders that don't have one yet (crash-safe D1)
 *   2. cancel jobs whose order was cancelled
 *   3. expire lapsed offers (riders' cards disappear)
 *   4. next round for lapsed SEARCHING jobs, or escalate to the admin
 *   5. idle riders with no heartbeat → offline (never one mid-delivery)
 *   6. repair capacity drift
 */
export const runDeliveryTick = async ({ models, db, now = new Date() }) => {
  const { settings } = await loadSettings(models);
  const effects = [];
  const stats = { created: 0, cancelled: 0, expiredOffers: 0, rebroadcast: 0, escalated: 0, wentOffline: 0, repaired: 0 };

  // 1
  const pending = await models.Order.find({ orderType: "ONLINE", deliveryAddress: { $ne: null }, status: { $in: ORDER_STATUSES_FOR_JOB } })
    .select("_id orderId orderType status deliveryAddress paymentMethod paymentStatus").limit(200).lean();
  if (pending.length) {
    const have = new Set((await models.DeliveryJob.find({ order: { $in: pending.map((o) => o._id) } }).select("order").lean()).map((j) => String(j.order)));
    for (const o of pending.filter((p) => !have.has(String(p._id)))) {
      const r = await createJobForOrder({ models, order: o, now });
      if (r.created) { stats.created++; effects.push(...r.effects); }
    }
  }

  // 2
  const open = await models.DeliveryJob.find({ status: { $nin: TERMINAL_JOB_STATUSES } }).select("_id order").lean();
  if (open.length) {
    const cancelled = await models.Order.find({ _id: { $in: open.map((j) => j.order) }, status: "CANCELLED" }).select("_id cancelReason").lean();
    for (const o of cancelled) {
      try {
        const r = await cancelJobForOrder({ models, db, orderId: o._id, reason: o.cancelReason || "Order cancelled", now });
        if (r.job) { stats.cancelled++; effects.push(...r.effects); }
      } catch (err) { if (err.statusCode !== 409) throw err; }
    }
  }

  // 3
  const lapsed = await models.DeliveryOffer.find({ status: "SENT", expiresAt: { $lte: now } }).select("_id job partner").limit(500).lean();
  for (const off of lapsed) {
    const r = await models.DeliveryOffer.updateOne({ _id: off._id, status: "SENT" }, { $set: { status: "EXPIRED" } });
    if (r.modifiedCount) {
      stats.expiredOffers++;
      effects.push({ type: "partner", partnerId: String(off.partner), event: "delivery:request_expired", payload: { jobId: String(off.job) } });
    }
  }

  // 4
  const due = await models.DeliveryJob.find({
    status: "SEARCHING", escalated: { $ne: true }, $or: [{ offerExpiresAt: { $lte: now } }, { offerExpiresAt: null }],
  }).select("_id round order").limit(100).lean();
  for (const j of due) {
    if (j.round >= settings.maxRounds) {
      const esc = await models.DeliveryJob.findOneAndUpdate(
        { _id: j._id, status: "SEARCHING", round: j.round, escalated: { $ne: true } },
        { $set: { escalated: true, escalatedAt: now, offerExpiresAt: null } }, AFTER,
      );
      if (esc) {
        stats.escalated++;
        await logEvent(models, { job: esc._id, order: esc.order, type: "ESCALATED", actor: SYSTEM_ACTOR, data: { rounds: j.round } });
        effects.push({ type: "admin", event: "delivery:escalated", payload: { job: adminJobView(esc), reason: "NO_PARTNER" } });
      }
    } else {
      const r = await broadcastJob({ models, jobId: j._id, expectRound: j.round, settings, now });
      if (r.job) { stats.rebroadcast++; effects.push(...r.effects); }
    }
  }

  // 5
  const cutoff = new Date(now.getTime() - settings.presenceTimeoutMinutes * 60000);
  const idle = await models.DeliveryPartnerState.find({ online: true, activeCount: { $lte: 0 }, $or: [{ lastSeenAt: null }, { lastSeenAt: { $lt: cutoff } }] }).select("partner").lean();
  for (const s of idle) {
    const r = await models.DeliveryPartnerState.updateOne(
      { _id: s._id, online: true, activeCount: { $lte: 0 }, $or: [{ lastSeenAt: null }, { lastSeenAt: { $lt: cutoff } }] },
      { $set: { online: false, onlineSince: null } },
    );
    if (r.modifiedCount) {
      stats.wentOffline++;
      await models.DeliveryOffer.updateMany({ partner: s.partner, status: "SENT" }, { $set: { status: "EXPIRED" } });
      await logEvent(models, { partner: s.partner, type: "AUTO_OFFLINE", actor: SYSTEM_ACTOR });
      effects.push({ type: "partner", partnerId: String(s.partner), event: "delivery:presence", payload: { online: false, reason: "INACTIVE" } });
      effects.push({ type: "admin", event: "delivery:partner_updated", payload: { partnerId: String(s.partner), online: false } });
    }
  }

  // 6 — read the version, count, write only if nobody changed capacity meanwhile.
  const counts = await models.DeliveryJob.aggregate([
    { $match: { status: { $in: ACTIVE_JOB_STATUSES }, partner: { $ne: null } } },
    { $group: { _id: "$partner", n: { $sum: 1 } } },
  ]);
  const want = new Map(counts.map((c) => [String(c._id), c.n]));
  const statesToCheck = await models.DeliveryPartnerState.find({ $or: [{ activeCount: { $gt: 0 } }, { partner: { $in: counts.map((c) => c._id) } }] }).select("partner activeCount capVersion").lean();
  for (const s of statesToCheck) {
    const n = want.get(String(s.partner)) || 0;
    if (n === s.activeCount) continue;
    const fresh = await models.DeliveryJob.countDocuments({ partner: s.partner, status: { $in: ACTIVE_JOB_STATUSES } });
    const r = await models.DeliveryPartnerState.updateOne(
      { _id: s._id, capVersion: s.capVersion }, { $set: { activeCount: fresh }, $inc: { capVersion: 1 } },
    );
    if (r.modifiedCount) {
      stats.repaired++;
      console.warn(`delivery: capacity drift repaired for ${s.partner}: ${s.activeCount} → ${fresh}`);
    }
  }

  return { stats, effects };
};
