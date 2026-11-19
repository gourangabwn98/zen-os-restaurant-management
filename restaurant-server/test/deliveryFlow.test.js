// test/deliveryFlow.test.js — end-to-end delivery flows through the REAL
// services/deliveryService.js on an in-memory fake (test/fakeMongo.js:
// atomic conditional updates, unique indexes, serialized rolling-back
// transactions). Plain Node.  Run: node test/deliveryFlow.test.js
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const { FakeModel, fakeDb, oid } = await import("./fakeMongo.js");
const svc = await import("../services/deliveryService.js");
const { parseTrackingToken } = await import("../utils/delivery.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};

// ── world ────────────────────────────────────────────────────────────────────
const REST = { latitude: 22.5726, longitude: 88.3639 };
const setup = ({ delivery = {} } = {}) => {
  const models = {
    User: new FakeModel("User", { defaults: () => ({ status: "Active" }) }),
    RestaurantProfile: new FakeModel("RestaurantProfile"),
    Order: new FakeModel("Order"),
    DeliveryPartnerState: new FakeModel("DeliveryPartnerState", {
      unique: [["partner"]],
      defaults: () => ({ online: false, onlineSince: null, lastSeenAt: null, activeCount: 0, capVersion: 0, capacity: null, suspended: false, suspendedReason: "", lastLocation: null, fcmTokens: [] }),
    }),
    DeliveryJob: new FakeModel("DeliveryJob", {
      unique: [["order"]], hidden: ["otpCode"],
      defaults: () => ({
        status: "SEARCHING", partner: null, partnerName: "", round: 0, offerExpiresAt: null, escalated: false, escalatedAt: null,
        otpCode: "", otpAttempts: 0, trackingVersion: 0, trackingRevokedAt: null, assignedAt: null, arrivedRestaurantAt: null,
        pickedUpAt: null, arrivedCustomerAt: null, deliveredAt: null, failedAt: null, failReason: "", cancelledAt: null, cancelReason: "",
      }),
    }),
    DeliveryOffer: new FakeModel("DeliveryOffer", { unique: [["job", "partner", "round"]], defaults: () => ({ respondedAt: null }) }),
    DeliveryLocation: new FakeModel("DeliveryLocation"),
    DeliveryEvent: new FakeModel("DeliveryEvent"),
    CodCollection: new FakeModel("CodCollection", { unique: [["order"]], defaults: () => ({ status: "COLLECTED", verifiedAt: null, verifiedBy: null, disputedAt: null, disputeReason: "", note: "" }) }),
    TableSession: null,
  };
  models.RestaurantProfile.docs.push({ _id: oid(), restaurantName: "Zen Cafe", phone: "03340000000", ...REST, deliveryRange: 6000, timezone: "Asia/Kolkata", delivery });
  return { models, db: fakeDb() };
};

const rider = async (models, name, { online = true, capacity = null, tokens = [] } = {}) => {
  const u = await models.User.create({ name, phone: `98${Math.floor(Math.random() * 1e8)}`, role: "delivery" });
  if (online || capacity) {
    await models.DeliveryPartnerState.create({ partner: u._id, online, capacity, lastSeenAt: new Date(), fcmTokens: tokens });
  }
  return u;
};

let orderSeq = 1000;
const deliveryOrder = async (models, { status = "CONFIRMED", lat = 22.5530, lng = 88.3520, user = oid(), cod = false, total = 240 } = {}) =>
  models.Order.create({
    orderId: `ORD${++orderSeq}`, user, orderType: "ONLINE", status, items: [{ name: "Momo", qty: 2 }], notes: "",
    paymentMethod: cod ? "Cash" : "Online", paymentStatus: cod ? "PENDING_VERIFICATION" : "PAID", total,
    billStatus: "OPEN", statusHistory: [],
    deliveryAddress: { address: `${orderSeq} Park St`, landmark: "near gate", latitude: lat, longitude: lng, contactName: `Cust${orderSeq}`, contactPhone: `90000${orderSeq}` },
  });

const fx = (effects, type, event) => effects.filter((e) => e.type === type && (!event || e.event === event));
const jobOf = async (models, order) => models.DeliveryJob.findOne({ order: order._id }).select("+otpCode");
const stateOf = (models, u) => models.DeliveryPartnerState.findOne({ partner: u._id });
const setOrder = (models, order, status) => models.Order.updateOne({ _id: order._id }, { $set: { status } });

// ── tests ────────────────────────────────────────────────────────────────────
console.log("── broadcast + atomic acceptance ──");

await test("confirmed delivery order → one job, offered to every eligible online rider (FCM tokens attached)", async () => {
  const { models } = setup();
  const a = await rider(models, "Ravi Kumar", { tokens: ["tok-a".padEnd(30, "x")] });
  const b = await rider(models, "Sunil Das");
  const off = await rider(models, "Offline Om", { online: false, capacity: 3 });
  await models.DeliveryPartnerState.updateOne({ partner: off._id }, { $set: { online: false } });
  const order = await deliveryOrder(models);

  const r = await svc.createJobForOrder({ models, order });
  assert.equal(r.created, true);
  const offers = fx(r.effects, "offer");
  assert.deepEqual(offers.map((o) => o.partnerId).sort(), [String(a._id), String(b._id)].sort());
  assert.equal(offers.find((o) => o.partnerId === String(a._id)).tokens.length, 1);
  // Offer payload: no customer name / phone / street address before acceptance.
  const p = JSON.stringify(offers[0].payload);
  assert.ok(!p.includes("Cust") && !p.includes("90000") && !p.includes("Park St"), p);

  const again = await svc.createJobForOrder({ models, order });
  assert.equal(again.created, false, "unique on order → second call is a no-op");
  assert.equal(models.DeliveryJob.docs.length, 1);
});

await test("non-delivery / not-yet-confirmed orders never get a job", async () => {
  const { models } = setup();
  await rider(models, "R");
  const pending = await deliveryOrder(models, { status: "PENDING_CONFIRMATION" });
  assert.equal((await svc.createJobForOrder({ models, order: pending })).created, false);
  const takeaway = await models.Order.create({ orderType: "TAKEAWAY", status: "CONFIRMED", deliveryAddress: null });
  assert.equal((await svc.createJobForOrder({ models, order: takeaway })).created, false);
});

await test("TWO riders accept at the same instant → exactly one wins; loser keeps capacity, gets ALREADY_ASSIGNED", async () => {
  const { models, db } = setup();
  const a = await rider(models, "Ravi");
  const b = await rider(models, "Sunil");
  const c = await rider(models, "Third");
  const order = await deliveryOrder(models);
  await svc.createJobForOrder({ models, order });
  const job = await jobOf(models, order);

  const results = await Promise.allSettled([
    svc.acceptOffer({ models, db, user: a, jobId: job._id }),
    svc.acceptOffer({ models, db, user: b, jobId: job._id }),
  ]);
  const ok = results.filter((r) => r.status === "fulfilled");
  const bad = results.filter((r) => r.status === "rejected");
  assert.equal(ok.length, 1, "exactly one acceptance succeeds");
  assert.equal(bad[0].reason.code, "ALREADY_ASSIGNED");
  assert.equal(bad[0].reason.statusCode, 409);

  const winner = ok[0] === results[0] ? a : b;
  const loser = winner === a ? b : a;
  const after = await jobOf(models, order);
  assert.equal(after.status, "ASSIGNED");
  assert.equal(String(after.partner), String(winner._id));
  assert.match(after.otpCode, /^\d{4}$/);
  assert.equal((await stateOf(models, winner)).activeCount, 1);
  assert.equal((await stateOf(models, loser)).activeCount, 0, "loser's capacity increment rolled back");
  // Third rider's still-open card is closed with already_assigned.
  const closed = fx(ok[0].value.effects, "partner", "delivery:already_assigned").map((e) => e.partnerId);
  assert.ok(closed.includes(String(c._id)));
  assert.ok(!closed.includes(String(winner._id)));
  assert.equal((await models.DeliveryOffer.find({ job: job._id, status: "SENT" })).length, 0);
  assert.equal(models.DeliveryEvent.docs.filter((e) => e.type === "ACCEPTED").length, 1);
});

await test("many riders racing (8) → still exactly one assignment, total capacity in use = 1", async () => {
  const { models, db } = setup();
  const riders = [];
  for (let i = 0; i < 8; i++) riders.push(await rider(models, `R${i}`));
  const order = await deliveryOrder(models);
  await svc.createJobForOrder({ models, order });
  const job = await jobOf(models, order);
  const rs = await Promise.allSettled(riders.map((u) => svc.acceptOffer({ models, db, user: u, jobId: job._id })));
  assert.equal(rs.filter((r) => r.status === "fulfilled").length, 1);
  const inUse = models.DeliveryPartnerState.docs.reduce((s, d) => s + d.activeCount, 0);
  assert.equal(inUse, 1);
});

await test("a rider who was never offered the job cannot grab it", async () => {
  const { models, db } = setup();
  await rider(models, "Offered");
  const order = await deliveryOrder(models);
  await svc.createJobForOrder({ models, order });
  const late = await rider(models, "Late joiner"); // online after the broadcast, never offered
  const job = await jobOf(models, order);
  await assert.rejects(() => svc.acceptOffer({ models, db, user: late, jobId: job._id }), (e) => e.code === "OFFER_GONE");
});

console.log("── capacity / multiple active orders ──");

await test("rider holds several orders up to capacity; the next accept is refused and the job stays open", async () => {
  const { models, db } = setup({ delivery: { defaultCapacity: 2 } });
  const a = await rider(models, "Ravi");
  const orders = [await deliveryOrder(models), await deliveryOrder(models), await deliveryOrder(models)];
  for (const o of orders) await svc.createJobForOrder({ models, order: o });
  const jobs = await Promise.all(orders.map((o) => jobOf(models, o)));

  await svc.acceptOffer({ models, db, user: a, jobId: jobs[0]._id });
  await svc.acceptOffer({ models, db, user: a, jobId: jobs[1]._id });
  await assert.rejects(() => svc.acceptOffer({ models, db, user: a, jobId: jobs[2]._id }), (e) => e.code === "CAPACITY_FULL");
  assert.equal((await stateOf(models, a)).activeCount, 2);
  assert.equal((await jobOf(models, orders[2])).status, "SEARCHING");
  assert.equal((await models.DeliveryOffer.findOne({ job: jobs[2]._id, partner: a._id })).status, "SENT", "offer rolled back to SENT");
});

await test("per-rider capacity override is honoured, and a full rider is skipped by the next broadcast", async () => {
  const { models, db } = setup({ delivery: { defaultCapacity: 3 } });
  const a = await rider(models, "Solo", { capacity: 1 });
  const b = await rider(models, "Other");
  const o1 = await deliveryOrder(models);
  await svc.createJobForOrder({ models, order: o1 });
  await svc.acceptOffer({ models, db, user: a, jobId: (await jobOf(models, o1))._id });
  const o2 = await deliveryOrder(models);
  const r = await svc.createJobForOrder({ models, order: o2 });
  assert.deepEqual(fx(r.effects, "offer").map((e) => e.partnerId), [String(b._id)]);
});

await test("suspended or deactivated riders are never offered work", async () => {
  const { models } = setup();
  const s = await rider(models, "Suspended");
  await models.DeliveryPartnerState.updateOne({ partner: s._id }, { $set: { suspended: true } });
  const d = await rider(models, "Deactivated");
  await models.User.updateOne({ _id: d._id }, { $set: { status: "Inactive" } });
  const ok = await rider(models, "Fine");
  const r = await svc.createJobForOrder({ models, order: await deliveryOrder(models) });
  assert.deepEqual(fx(r.effects, "offer").map((e) => e.partnerId), [String(ok._id)]);
});

console.log("── multi-order lifecycle: pickup, OTP, independence ──");

const twoJobsOnOneRider = async () => {
  const w = setup();
  const a = await rider(w.models, "Ravi");
  const oA = await deliveryOrder(w.models, { lat: 22.5530, lng: 88.3520 });
  const oB = await deliveryOrder(w.models, { lat: 22.5900, lng: 88.4000 });
  await svc.createJobForOrder({ models: w.models, order: oA });
  await svc.createJobForOrder({ models: w.models, order: oB });
  const jA = await jobOf(w.models, oA), jB = await jobOf(w.models, oB);
  await svc.acceptOffer({ ...w, user: a, jobId: jA._id });
  await svc.acceptOffer({ ...w, user: a, jobId: jB._id });
  // Re-read after acceptance — that is when the hand-over code is generated.
  return { ...w, a, oA, oB, jA: await jobOf(w.models, oA), jB: await jobOf(w.models, oB) };
};

await test("pickup is blocked until the kitchen marks the order READY", async () => {
  const { models, db, a, oA, jA } = await twoJobsOnOneRider();
  await svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "AT_RESTAURANT" });
  await assert.rejects(() => svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "PICKED_UP" }), (e) => e.code === "ORDER_NOT_READY");
  await setOrder(models, oA, "READY");
  const r = await svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "PICKED_UP" });
  assert.equal(r.job.status, "PICKED_UP");
});

await test("wrong OTP counts attempts and locks; correct OTP delivers ONLY that order and frees one slot", async () => {
  const { models, db, a, oA, oB, jA, jB } = await twoJobsOnOneRider();
  await setOrder(models, oA, "READY");
  await setOrder(models, oB, "READY");
  await svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "PICKED_UP" });
  await svc.advanceJob({ models, db, user: a, jobId: jB._id, to: "PICKED_UP" });

  const wrong = jA.otpCode === "0000" ? "1111" : "0000";
  await assert.rejects(() => svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "DELIVERED", otp: wrong }),
    (e) => e.code === "OTP_WRONG" && e.details.attemptsLeft === 4);
  // B's code must not open A.
  const bCode = (await jobOf(models, oB)).otpCode;
  if (bCode !== jA.otpCode) {
    await assert.rejects(() => svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "DELIVERED", otp: bCode }), (e) => e.code === "OTP_WRONG");
  }

  const r = await svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "DELIVERED", otp: jA.otpCode });
  assert.equal(r.job.status, "DELIVERED");
  const ordA = await models.Order.findById(oA._id);
  assert.equal(ordA.status, "DELIVERED", "order READY → DELIVERED via the state machine");
  assert.equal(ordA.deliveredBy.role, "DELIVERY");
  assert.equal(ordA.statusHistory.at(-1).status, "DELIVERED");
  assert.equal((await models.Order.findById(oB._id)).status, "READY", "order B untouched");
  assert.equal((await jobOf(models, oB)).status, "PICKED_UP", "job B untouched");
  assert.equal((await stateOf(models, a)).activeCount, 1);
  assert.ok(fx(r.effects, "order_status").length === 1);

  const snap = await svc.getRiderSnapshot({ models, user: a });
  assert.deepEqual(snap.activeJobs.map((j) => j.jobId), [String(jB._id)], "completed order left the active list");
});

await test("OTP lock after the maximum wrong attempts, admin reset unlocks", async () => {
  const { models, db, a, oA, jA } = await twoJobsOnOneRider();
  await setOrder(models, oA, "READY");
  await svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "PICKED_UP" });
  const wrong = jA.otpCode === "9999" ? "8888" : "9999";
  for (let i = 0; i < 5; i++) await assert.rejects(() => svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "DELIVERED", otp: wrong }));
  await assert.rejects(() => svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "DELIVERED", otp: jA.otpCode }), (e) => e.code === "OTP_LOCKED");
  await svc.adminResetOtp({ models, admin: { _id: oid(), name: "Boss" }, jobId: jA._id });
  const fresh = await jobOf(models, oA);
  assert.notEqual(fresh.otpCode, "");
  const r = await svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "DELIVERED", otp: fresh.otpCode });
  assert.equal(r.job.status, "DELIVERED");
});

await test("a rider can't act on someone else's delivery", async () => {
  const { models, db, jA } = await twoJobsOnOneRider();
  const other = await rider(models, "Other");
  await assert.rejects(() => svc.advanceJob({ models, db, user: other, jobId: jA._id, to: "AT_RESTAURANT" }), (e) => e.statusCode === 404);
});

await test("failed delivery needs a reason, releases capacity and escalates to the admin", async () => {
  const { models, db, a, oA, jA } = await twoJobsOnOneRider();
  await setOrder(models, oA, "READY");
  await svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "PICKED_UP" });
  await assert.rejects(() => svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "FAILED", reason: "" }));
  const r = await svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "FAILED", reason: "Customer not reachable" });
  assert.equal(r.job.status, "FAILED");
  assert.equal((await stateOf(models, a)).activeCount, 1);
  assert.equal(fx(r.effects, "admin", "delivery:escalated").length, 1);
});

console.log("── GPS + customer tracking privacy ──");

await test("each customer gets the rider's position on THEIR OWN room only; nothing stored once deliveries end", async () => {
  const { models, db, a, oA, oB, jA, jB } = await twoJobsOnOneRider();
  const now = new Date();
  const r = await svc.recordLocations({ models, user: a, points: [{ latitude: 22.56, longitude: 88.36, accuracy: 8, at: now.toISOString() }], now });
  assert.equal(r.tracking, true);
  const track = fx(r.effects, "track");
  assert.deepEqual(track.map((t) => t.jobId).sort(), [String(jA._id), String(jB._id)].sort());
  for (const t of track) {
    assert.deepEqual(Object.keys(t.payload).sort(), ["jobId", "location"]);
    assert.equal(t.payload.jobId, t.jobId, "a room only ever carries its own job id");
  }
  assert.equal(models.DeliveryLocation.docs.length, 1);

  // Finish both → app is told to stop GPS; further points are not stored.
  for (const [o, j] of [[oA, jA], [oB, jB]]) {
    await setOrder(models, o, "READY");
    await svc.advanceJob({ models, db, user: a, jobId: j._id, to: "PICKED_UP" });
    await svc.advanceJob({ models, db, user: a, jobId: j._id, to: "DELIVERED", otp: (await jobOf(models, o)).otpCode });
  }
  const later = new Date(now.getTime() + 60000);
  const r2 = await svc.recordLocations({ models, user: a, points: [{ latitude: 22.561, longitude: 88.361, at: later.toISOString() }], now: later });
  assert.equal(r2.tracking, false, "GPS stops after all deliveries are completed");
  assert.equal(models.DeliveryLocation.docs.length, 1, "no breadcrumbs without an active delivery");
});

await test("tracking link: only that order's destination, no OTP/phone; owner endpoint adds OTP; others refused", async () => {
  const { models, db, a, oA, oB, jA } = await twoJobsOnOneRider();
  await svc.recordLocations({ models, user: a, points: [{ latitude: 22.56, longitude: 88.36, at: new Date().toISOString() }] });
  const owner = { _id: oA.user };
  const mine = await svc.getCustomerDelivery({ models, user: owner, orderId: oA._id });
  assert.match(mine.otp, /^\d{4}$/);
  assert.ok(mine.rider.phone, "owner sees the rider's phone while active");
  assert.ok(parseTrackingToken(mine.trackingToken));

  const view = await svc.getTrackingByToken({ models, token: mine.trackingToken });
  const s = JSON.stringify(view);
  assert.equal(view.destination.latitude, oA.deliveryAddress.latitude);
  assert.ok(!s.includes(String(oB.deliveryAddress.latitude)), "never the other customer's pin");
  assert.ok(!s.includes(mine.otp) || mine.otp === "", "no OTP in the public view");
  assert.ok(!s.includes(oA.deliveryAddress.contactPhone), "no phone in the public view");
  assert.ok(view.rider.location, "rider position shown while active");
  assert.equal(view.distanceIsStraightLine, true, "approximate distance is labelled as such");

  await assert.rejects(() => svc.getCustomerDelivery({ models, user: { _id: oid() }, orderId: oA._id }), (e) => e.statusCode === 403);
  await assert.rejects(() => svc.getCustomerDelivery({ models, user: { _id: oB.user }, orderId: oA._id }), (e) => e.statusCode === 403);

  await svc.adminRevokeTracking({ models, admin: { _id: oid() }, jobId: jA._id });
  await assert.rejects(() => svc.getTrackingByToken({ models, token: mine.trackingToken }), (e) => e.statusCode === 410);
  const renewed = await svc.getCustomerDelivery({ models, user: owner, orderId: oA._id });
  assert.ok(await svc.getTrackingByToken({ models, token: renewed.trackingToken }));
  void db;
});

console.log("── tick: expiry, re-broadcast, escalation, cancellation, presence, drift ──");

await test("offers expire → riders told; next round re-broadcast; after maxRounds → escalated", async () => {
  const { models, db } = setup({ delivery: { maxRounds: 2, offerTtlSeconds: 30 } });
  const a = await rider(models, "Ravi");
  const order = await deliveryOrder(models);
  const t0 = new Date();
  await svc.createJobForOrder({ models, order, now: t0 });
  const t1 = new Date(t0.getTime() + 31000);
  // Keep the rider "seen" so presence timeout doesn't interfere.
  await models.DeliveryPartnerState.updateOne({ partner: a._id }, { $set: { lastSeenAt: t1 } });
  const r1 = await svc.runDeliveryTick({ models, db, now: t1 });
  assert.equal(r1.stats.expiredOffers, 1);
  assert.equal(fx(r1.effects, "partner", "delivery:request_expired").length, 1);
  assert.equal(r1.stats.rebroadcast, 1);
  assert.equal((await jobOf(models, order)).round, 2);
  const t2 = new Date(t1.getTime() + 31000);
  await models.DeliveryPartnerState.updateOne({ partner: a._id }, { $set: { lastSeenAt: t2 } });
  const r2 = await svc.runDeliveryTick({ models, db, now: t2 });
  assert.equal(r2.stats.escalated, 1);
  const j = await jobOf(models, order);
  assert.equal(j.escalated, true);
  assert.equal(j.status, "SEARCHING");
  assert.equal(fx(r2.effects, "admin", "delivery:escalated").length, 1);
});

await test("no rider online → rounds still run, then escalate; a rider coming online reopens it", async () => {
  const { models, db } = setup({ delivery: { maxRounds: 1, offerTtlSeconds: 15 } });
  const order = await deliveryOrder(models);
  const t0 = new Date();
  const c = await svc.createJobForOrder({ models, order, now: t0 });
  assert.equal(fx(c.effects, "offer").length, 0);
  await svc.runDeliveryTick({ models, db, now: new Date(t0.getTime() + 16000) });
  assert.equal((await jobOf(models, order)).escalated, true);
  const a = await rider(models, "Late", { online: false, capacity: 3 });
  const on = await svc.setOnline({ models, user: a, online: true });
  const jid = String((await jobOf(models, order))._id);
  assert.ok(fx(on.effects, "offer").some((e) => e.payload.jobId === jid));
  assert.equal((await jobOf(models, order)).escalated, false);
});

await test("rejecting by everyone → re-broadcast without waiting; rejecter isn't asked again", async () => {
  const { models, db } = setup();
  const a = await rider(models, "Ravi");
  const b = await rider(models, "Sunil");
  const order = await deliveryOrder(models);
  await svc.createJobForOrder({ models, order });
  const job = await jobOf(models, order);
  await svc.rejectOffer({ models, user: a, jobId: job._id });
  await svc.rejectOffer({ models, user: b, jobId: job._id });
  const r = await svc.runDeliveryTick({ models, db });
  assert.equal(r.stats.rebroadcast, 1);
  assert.equal(fx(r.effects, "offer").length, 0, "both rejected this job — neither is pinged again");
});

await test("cancelled order → job cancelled, rider's slot freed and rider told", async () => {
  const { models, db } = setup();
  const a = await rider(models, "Ravi");
  const order = await deliveryOrder(models);
  await svc.createJobForOrder({ models, order });
  await svc.acceptOffer({ models, db, user: a, jobId: (await jobOf(models, order))._id });
  await setOrder(models, order, "CANCELLED");
  const r = await svc.runDeliveryTick({ models, db });
  assert.equal(r.stats.cancelled, 1);
  assert.equal((await jobOf(models, order)).status, "CANCELLED");
  assert.equal((await stateOf(models, a)).activeCount, 0);
  assert.equal(fx(r.effects, "partner", "delivery:job_removed").length, 1);
});

await test("tick creates the job for a confirmed delivery order that missed the immediate hook", async () => {
  const { models, db } = setup();
  await rider(models, "Ravi");
  await deliveryOrder(models);
  const r = await svc.runDeliveryTick({ models, db });
  assert.equal(r.stats.created, 1);
  const r2 = await svc.runDeliveryTick({ models, db });
  assert.equal(r2.stats.created, 0, "idempotent");
});

await test("idle online rider times out to offline; a rider mid-delivery is never dropped", async () => {
  const { models, db } = setup({ delivery: { presenceTimeoutMinutes: 10 } });
  const idle = await rider(models, "Idle");
  const busy = await rider(models, "Busy");
  const order = await deliveryOrder(models);
  await svc.createJobForOrder({ models, order });
  await svc.acceptOffer({ models, db, user: busy, jobId: (await jobOf(models, order))._id });
  const old = new Date(Date.now() - 30 * 60000);
  await models.DeliveryPartnerState.updateMany({}, { $set: { lastSeenAt: old } });
  const r = await svc.runDeliveryTick({ models, db });
  assert.equal(r.stats.wentOffline, 1);
  assert.equal((await stateOf(models, idle)).online, false);
  assert.equal((await stateOf(models, busy)).online, true);
});

await test("going offline with active deliveries is refused; suspended rider can't go online", async () => {
  const { models, db } = setup();
  const a = await rider(models, "Ravi");
  const order = await deliveryOrder(models);
  await svc.createJobForOrder({ models, order });
  await svc.acceptOffer({ models, db, user: a, jobId: (await jobOf(models, order))._id });
  await assert.rejects(() => svc.setOnline({ models, user: a, online: false }), (e) => e.code === "HAS_ACTIVE_DELIVERIES");
  const s = await rider(models, "Sus", { online: false, capacity: 2 });
  await svc.updatePartner({ models, admin: { _id: oid() }, partnerId: s._id, suspended: true, reason: "Late twice" });
  await assert.rejects(() => svc.setOnline({ models, user: s, online: true }), (e) => e.code === "SUSPENDED");
});

await test("capacity drift is repaired from the real job count", async () => {
  const { models, db } = setup();
  const a = await rider(models, "Ravi");
  await models.DeliveryPartnerState.updateOne({ partner: a._id }, { $set: { activeCount: 3 } });
  const r = await svc.runDeliveryTick({ models, db });
  assert.equal(r.stats.repaired, 1);
  assert.equal((await stateOf(models, a)).activeCount, 0);
});

console.log("── admin interventions ──");

await test("admin assigns an escalated job; unassign before pickup re-broadcasts and frees the slot", async () => {
  const { models, db } = setup();
  const order = await deliveryOrder(models);
  await svc.createJobForOrder({ models, order });
  const a = await rider(models, "Ravi", { online: false, capacity: 3 });
  const job = await jobOf(models, order);
  const boss = { _id: oid(), name: "Boss" };
  await svc.adminAssign({ models, db, admin: boss, jobId: job._id, partnerId: a._id });
  assert.equal((await jobOf(models, order)).status, "ASSIGNED");
  await assert.rejects(() => svc.adminAssign({ models, db, admin: boss, jobId: job._id, partnerId: a._id }), (e) => e.code === "ALREADY_ASSIGNED");
  assert.equal((await stateOf(models, a)).activeCount, 1, "failed second assign rolled back");

  const u = await svc.adminUnassign({ models, db, admin: boss, jobId: job._id, reason: "bike broke" });
  assert.equal((await jobOf(models, order)).status, "SEARCHING");
  assert.equal((await stateOf(models, a)).activeCount, 0);
  assert.equal(fx(u.effects, "partner", "delivery:job_removed").length, 1);
  assert.equal((await jobOf(models, order)).otpCode, "", "old code invalidated");
});

await test("reports: counts, completion rate and per-partner rows", async () => {
  const { models, db, a, oA, oB, jA, jB } = await twoJobsOnOneRider();
  await setOrder(models, oA, "READY");
  await svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "PICKED_UP" });
  await svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "DELIVERED", otp: jA.otpCode });
  await setOrder(models, oB, "READY");
  await svc.advanceJob({ models, db, user: a, jobId: jB._id, to: "PICKED_UP" });
  await svc.advanceJob({ models, db, user: a, jobId: jB._id, to: "FAILED", reason: "Wrong address" });
  const rep = await svc.reports({ models });
  assert.equal(rep.totals.total, 2);
  assert.equal(rep.totals.delivered, 1);
  assert.equal(rep.totals.failed, 1);
  assert.equal(rep.totals.completionRate, 50);
  assert.equal(rep.partners[0].name, "Ravi");
  const ov = await svc.overview({ models });
  assert.equal(ov.deliveredToday, 1);
  assert.equal(ov.failedToday, 1);
});

console.log("── Cash on Delivery: hand-over → custody → admin verification → billing ──");

const ADMIN = { _id: oid(), name: "Boss", role: "admin", isAdmin: true };
const MANAGER = { _id: oid(), name: "Mina", role: "manager" };

const codDelivered = async ({ total = 240 } = {}) => {
  const w = setup();
  const a = await rider(w.models, "Ravi");
  const order = await deliveryOrder(w.models, { cod: true, total });
  await svc.createJobForOrder({ models: w.models, order });
  let job = await jobOf(w.models, order);
  await svc.acceptOffer({ ...w, user: a, jobId: job._id });
  job = await jobOf(w.models, order);
  await setOrder(w.models, order, "READY");
  await svc.advanceJob({ ...w, user: a, jobId: job._id, to: "PICKED_UP" });
  return { ...w, a, order, job };
};

await test("COD offer is flagged; the rider's job shows the exact cash to collect", async () => {
  const { models, db } = setup();
  const a = await rider(models, "Ravi");
  const order = await deliveryOrder(models, { cod: true, total: 312.5 });
  const r = await svc.createJobForOrder({ models, order });
  assert.equal(fx(r.effects, "offer")[0].payload.cod, true);
  const acc = await svc.acceptOffer({ models, db, user: a, jobId: (await jobOf(models, order))._id });
  assert.deepEqual(acc.job.payment, { method: "Cash", paid: false, collectCash: true, amount: 312.5 });
});

await test("COD hand-over needs OTP AND the exact cash confirmation; then ONE collection, order DELIVERED but still unpaid", async () => {
  const { models, db, a, order, job } = await codDelivered({ total: 240 });
  await assert.rejects(() => svc.advanceJob({ models, db, user: a, jobId: job._id, to: "DELIVERED", otp: job.otpCode }), (e) => e.code === "COD_CONFIRM_REQUIRED" && e.details.amount === 240);
  await assert.rejects(() => svc.advanceJob({ models, db, user: a, jobId: job._id, to: "DELIVERED", otp: job.otpCode, cashCollected: true, cashAmount: 200 }), (e) => e.code === "COD_CONFIRM_REQUIRED");
  const wrong = job.otpCode === "0000" ? "1111" : "0000";
  await assert.rejects(() => svc.advanceJob({ models, db, user: a, jobId: job._id, to: "DELIVERED", otp: wrong, cashCollected: true, cashAmount: 240 }), (e) => e.code === "OTP_WRONG");
  assert.equal(models.CodCollection.docs.length, 0, "nothing recorded on a failed attempt");

  const r = await svc.advanceJob({ models, db, user: a, jobId: job._id, to: "DELIVERED", otp: job.otpCode, cashCollected: true, cashAmount: 240 });
  assert.equal(r.job.status, "DELIVERED");
  assert.equal(models.CodCollection.docs.length, 1);
  const c = models.CodCollection.docs[0];
  assert.equal(c.amount, 240);
  assert.equal(String(c.partner), String(a._id));
  assert.equal(String(c.order), String(order._id));
  assert.ok(c.collectedAt instanceof Date);
  const o = await models.Order.findById(order._id);
  assert.equal(o.status, "DELIVERED");
  assert.equal(o.paymentStatus, "PENDING_VERIFICATION", "the rider never marks PAID");
  assert.notEqual(o.billStatus, "SETTLED");
  assert.ok(models.DeliveryEvent.docs.some((e) => e.type === "COD_COLLECTED"));
  assert.equal((await svc.riderCash({ models, user: a })).total, 240);
  // A replay of the same hand-over can't create a second record.
  await assert.rejects(() => svc.advanceJob({ models, db, user: a, jobId: job._id, to: "DELIVERED", otp: job.otpCode, cashCollected: true, cashAmount: 240 }));
  assert.equal(models.CodCollection.docs.length, 1);
});

await test("a collection is unique per order even if written twice directly (unique index)", async () => {
  const { models, db, a, job } = await codDelivered();
  await svc.advanceJob({ models, db, user: a, jobId: job._id, to: "DELIVERED", otp: job.otpCode, cashCollected: true, cashAmount: 240 });
  const c = models.CodCollection.docs[0];
  await assert.rejects(() => models.CodCollection.create([{ order: c.order, job: c.job, partner: c.partner, amount: 1, collectedAt: new Date() }]), (e) => e.code === 11000);
});

await test("admin verifies the hand-in → existing billing settle: PAID + SETTLED + COMPLETED; second verify refused", async () => {
  const { models, db, a, order, job } = await codDelivered();
  await svc.advanceJob({ models, db, user: a, jobId: job._id, to: "DELIVERED", otp: job.otpCode, cashCollected: true, cashAmount: 240 });
  const cid = models.CodCollection.docs[0]._id;
  const v = await svc.verifyCodCollection({ models, admin: ADMIN, collectionId: cid });
  assert.equal(v.collection.status, "VERIFIED");
  assert.deepEqual(v.settle.settled, [order.orderId]);
  const o = await models.Order.findById(order._id);
  assert.equal(o.paymentStatus, "PAID");
  assert.equal(o.paymentMethod, "Cash");
  assert.equal(o.billStatus, "SETTLED");
  assert.equal(o.status, "COMPLETED", "DELIVERED + SETTLED → COMPLETED via the existing path");
  assert.equal(String(o.paidBy.id), String(ADMIN._id), "credited to the verifier who received the cash");
  await assert.rejects(() => svc.verifyCodCollection({ models, admin: ADMIN, collectionId: cid }), (e) => e.statusCode === 409);
  assert.equal((await svc.riderCash({ models, user: a })).total, 0);
});

await test("two admins verifying at once → settled exactly once", async () => {
  const { models, db, a, order, job } = await codDelivered();
  await svc.advanceJob({ models, db, user: a, jobId: job._id, to: "DELIVERED", otp: job.otpCode, cashCollected: true, cashAmount: 240 });
  const cid = models.CodCollection.docs[0]._id;
  const rs = await Promise.allSettled([
    svc.verifyCodCollection({ models, admin: ADMIN, collectionId: cid }),
    svc.verifyCodCollection({ models, admin: MANAGER, collectionId: cid }),
  ]);
  assert.equal(rs.filter((r) => r.status === "fulfilled").length, 1);
  const o = await models.Order.findById(order._id);
  assert.equal(o.statusHistory.filter((h) => /Bill settled · Cash/.test(h.note || "")).length, 1, "paid + settled once");
  assert.equal(o.statusHistory.filter((h) => h.status === "COMPLETED").length, 1, "completed once");
});

await test("bill changed after collection → verification refused, claim released for retry", async () => {
  const { models, db, a, order, job } = await codDelivered();
  await svc.advanceJob({ models, db, user: a, jobId: job._id, to: "DELIVERED", otp: job.otpCode, cashCollected: true, cashAmount: 240 });
  await models.Order.updateOne({ _id: order._id }, { $set: { total: 300 } });
  const cid = models.CodCollection.docs[0]._id;
  await assert.rejects(() => svc.verifyCodCollection({ models, admin: ADMIN, collectionId: cid }), (e) => e.code === "COD_AMOUNT_MISMATCH");
  assert.equal(models.CodCollection.docs[0].status, "COLLECTED");
  assert.equal((await models.Order.findById(order._id)).paymentStatus, "PENDING_VERIFICATION");
});

await test("a role billing doesn't allow to record PAID can't verify; the claim is released", async () => {
  const { models, db, a, job } = await codDelivered();
  await svc.advanceJob({ models, db, user: a, jobId: job._id, to: "DELIVERED", otp: job.otpCode, cashCollected: true, cashAmount: 240 });
  const cid = models.CodCollection.docs[0]._id;
  await assert.rejects(() => svc.verifyCodCollection({ models, admin: { _id: a._id, name: "Ravi", role: "delivery" }, collectionId: cid }), (e) => e.statusCode === 403);
  assert.equal(models.CodCollection.docs[0].status, "COLLECTED");
});

await test("dispute (short cash) → listed as held by the rider; can still be verified later", async () => {
  const { models, db, a, job } = await codDelivered();
  await svc.advanceJob({ models, db, user: a, jobId: job._id, to: "DELIVERED", otp: job.otpCode, cashCollected: true, cashAmount: 240 });
  const cid = models.CodCollection.docs[0]._id;
  await assert.rejects(() => svc.disputeCodCollection({ models, admin: ADMIN, collectionId: cid, reason: "" }));
  await svc.disputeCodCollection({ models, admin: ADMIN, collectionId: cid, reason: "Handed in ₹200 only" });
  const list = await svc.listCodCollections({ models });
  assert.equal(list.cashWithRiders[0].amount, 240);
  assert.equal(list.collections[0].status, "DISPUTED");
  const v = await svc.verifyCodCollection({ models, admin: ADMIN, collectionId: cid, note: "Rest paid next day" });
  assert.equal(v.collection.status, "VERIFIED");
});

await test("a PREPAID delivery needs no cash step and creates no collection", async () => {
  const { models, db, a, oA, jA } = await twoJobsOnOneRider();
  await setOrder(models, oA, "READY");
  await svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "PICKED_UP" });
  await svc.advanceJob({ models, db, user: a, jobId: jA._id, to: "DELIVERED", otp: jA.otpCode });
  assert.equal(models.CodCollection.docs.length, 0);
});

await test("reports include COD totals", async () => {
  const { models, db, a, job } = await codDelivered({ total: 150 });
  await svc.advanceJob({ models, db, user: a, jobId: job._id, to: "DELIVERED", otp: job.otpCode, cashCollected: true, cashAmount: 150 });
  const rep = await svc.reports({ models });
  assert.deepEqual(rep.cod, { collections: 1, collected: 150, verified: 0, awaitingVerification: 150, disputed: 0 });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
