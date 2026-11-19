// test/deliveryReplSet.test.js — the delivery invariants against a REAL
// MongoDB replica set (real transactions, real write conflicts, real unique
// indexes), started in-process by mongodb-memory-server on 127.0.0.1 and
// thrown away afterwards. It never reads MONGO_URI and refuses any URI that
// isn't local — the production database can't be reached from here.
// Run: node test/deliveryReplSet.test.js   (first run downloads a mongod binary)
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

process.env.JWT_SECRET = "replset-test-secret";
delete process.env.MONGO_URI; // nothing below may fall back to the real database
for (const k of ["PHONEPE_MERCHANT_ID", "PHONEPE_SALT_KEY", "FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"]) delete process.env[k];

const { getModels } = await import("../config/getModels.js");
const svc = await import("../services/deliveryService.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
const uri = replSet.getUri("zen_delivery_test");
if (!/^mongodb:\/\/127\.0\.0\.1:\d+/.test(uri)) { await replSet.stop(); throw new Error(`Refusing non-local test database: ${uri}`); }
const conn = await mongoose.createConnection(uri).asPromise();
const models = getModels(conn);
const db = conn;
await Promise.all(Object.values(models).map((m) => m.init())); // build unique indexes before racing

const reset = async (delivery = {}) => {
  // Raw driver: some models (DeliveryEvent, DutyHistory) are read-only by design; indexes are kept.
  for (const c of await conn.db.collections()) await c.deleteMany({});
  await models.RestaurantProfile.create({
    restaurantName: "Zen Cafe", latitude: 22.5726, longitude: 88.3639, deliveryRange: 6000, timezone: "Asia/Kolkata", delivery,
  });
};
let n = 0;
const rider = async (name, { capacity = null } = {}) => {
  const u = await models.User.create({ name, phone: `9000000${String(++n).padStart(3, "0")}`, role: "delivery", status: "Active" });
  await models.DeliveryPartnerState.create({ partner: u._id, online: true, lastSeenAt: new Date(), capacity });
  return u;
};
const order = async ({ cod = false, total = 240 } = {}) => models.Order.create({
  orderId: `T${++n}`, user: new mongoose.Types.ObjectId(), orderType: "ONLINE", status: "CONFIRMED",
  items: [{ menuItem: new mongoose.Types.ObjectId(), name: "Momo", price: total / 2, qty: 2 }],
  subtotal: total, tax: 0, total, source: "CUSTOMER", paymentMethod: cod ? "Cash" : "Online",
  paymentStatus: cod ? "PENDING_VERIFICATION" : "PAID", billStatus: "OPEN",
  deliveryAddress: { address: "12 Park St", latitude: 22.553, longitude: 88.352, contactName: "Asha", contactPhone: "9876543210" },
});
const jobOf = (o) => models.DeliveryJob.findOne({ order: o._id }).select("+otpCode");

try {
  await test("10 riders accept the same order concurrently → exactly one winner, capacity in use = 1", async () => {
    await reset();
    const riders = [];
    for (let i = 0; i < 10; i++) riders.push(await rider(`R${i}`));
    const o = await order();
    await svc.createJobForOrder({ models, order: o });
    const job = await jobOf(o);
    const rs = await Promise.allSettled(riders.map((u) => svc.acceptOffer({ models, db, user: u, jobId: job._id })));
    const wins = rs.filter((r) => r.status === "fulfilled");
    assert.equal(wins.length, 1, rs.filter((r) => r.status === "rejected").map((r) => r.reason.message).join(" | "));
    for (const r of rs.filter((x) => x.status === "rejected")) assert.ok(["ALREADY_ASSIGNED", "OFFER_GONE"].includes(r.reason.code), r.reason.message);
    const states = await models.DeliveryPartnerState.find().lean();
    assert.equal(states.reduce((s, x) => s + x.activeCount, 0), 1);
    assert.equal((await models.DeliveryJob.findById(job._id)).status, "ASSIGNED");
  });

  await test("one rider racing for 5 orders with capacity 2 → exactly 2 assigned, never over capacity", async () => {
    await reset({ defaultCapacity: 2 });
    const u = await rider("Solo");
    const os = [];
    for (let i = 0; i < 5; i++) { const o = await order(); await svc.createJobForOrder({ models, order: o }); os.push(o); }
    const jobs = await Promise.all(os.map(jobOf));
    const rs = await Promise.allSettled(jobs.map((j) => svc.acceptOffer({ models, db, user: u, jobId: j._id })));
    assert.equal(rs.filter((r) => r.status === "fulfilled").length, 2);
    assert.equal((await models.DeliveryPartnerState.findOne({ partner: u._id })).activeCount, 2);
    assert.equal(await models.DeliveryJob.countDocuments({ status: "ASSIGNED" }), 2);
    assert.equal(await models.DeliveryJob.countDocuments({ status: "SEARCHING" }), 3);
  });

  await test("unique indexes: one job per order, one offer per (job, rider, round), one COD record per order", async () => {
    await reset();
    await rider("A");
    const o = await order();
    const both = await Promise.all([svc.createJobForOrder({ models, order: o }), svc.createJobForOrder({ models, order: o })]);
    assert.equal(both.filter((r) => r.created).length, 1);
    assert.equal(await models.DeliveryJob.countDocuments(), 1);
    const job = await jobOf(o);
    const offer = await models.DeliveryOffer.findOne({ job: job._id }).lean();
    await assert.rejects(() => models.DeliveryOffer.create({ job: job._id, partner: offer.partner, round: offer.round, expiresAt: new Date() }), (e) => e.code === 11000);
  });

  await test("COD end to end on real transactions: hand-over → one collection → verify → PAID, SETTLED, COMPLETED", async () => {
    await reset();
    const u = await rider("Ravi");
    const o = await order({ cod: true, total: 312.5 });
    await svc.createJobForOrder({ models, order: o });
    let job = await jobOf(o);
    await svc.acceptOffer({ models, db, user: u, jobId: job._id });
    job = await jobOf(o);
    await models.Order.updateOne({ _id: o._id }, { $set: { status: "READY" } });
    await svc.advanceJob({ models, db, user: u, jobId: job._id, to: "PICKED_UP" });
    // Two hand-over submits at once (double tap): one delivery, one collection.
    const rs = await Promise.allSettled([1, 2].map(() => svc.advanceJob({ models, db, user: u, jobId: job._id, to: "DELIVERED", otp: job.otpCode, cashCollected: true, cashAmount: 312.5 })));
    assert.equal(rs.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(await models.CodCollection.countDocuments(), 1);
    assert.equal((await models.DeliveryPartnerState.findOne({ partner: u._id })).activeCount, 0, "capacity released exactly once");
    let ord = await models.Order.findById(o._id).lean();
    assert.equal(ord.status, "DELIVERED");
    assert.equal(ord.paymentStatus, "PENDING_VERIFICATION");

    const admin = await models.User.create({ name: "Boss", phone: "9111111111", role: "admin", isAdmin: true });
    const c = await models.CodCollection.findOne().lean();
    const vs = await Promise.allSettled([1, 2].map(() => svc.verifyCodCollection({ models, admin, collectionId: c._id })));
    assert.equal(vs.filter((r) => r.status === "fulfilled").length, 1);
    ord = await models.Order.findById(o._id).lean();
    assert.equal(ord.paymentStatus, "PAID");
    assert.equal(ord.billStatus, "SETTLED");
    assert.equal(ord.status, "COMPLETED");
    assert.equal((await models.CodCollection.findById(c._id)).status, "VERIFIED");
  });

  await test("a failed transaction leaves nothing behind (capacity, offer, job all rolled back)", async () => {
    await reset({ defaultCapacity: 1 });
    const u = await rider("Ravi");
    const o1 = await order(), o2 = await order();
    await svc.createJobForOrder({ models, order: o1 });
    await svc.createJobForOrder({ models, order: o2 });
    await svc.acceptOffer({ models, db, user: u, jobId: (await jobOf(o1))._id });
    const j2 = await jobOf(o2);
    await assert.rejects(() => svc.acceptOffer({ models, db, user: u, jobId: j2._id }), (e) => e.code === "CAPACITY_FULL");
    assert.equal((await models.DeliveryOffer.findOne({ job: j2._id, partner: u._id })).status, "SENT");
    assert.equal((await jobOf(o2)).status, "SEARCHING");
    assert.equal((await models.DeliveryPartnerState.findOne({ partner: u._id })).activeCount, 1);
  });

  await test("audit log is append-only in the real database", async () => {
    await assert.rejects(() => models.DeliveryEvent.updateMany({}, { $set: { type: "X" } }), /read-only/);
    await assert.rejects(() => models.DeliveryEvent.deleteMany({}), /read-only/);
  });

  await test("tick on a real DB: expiry → re-broadcast → escalation, cancelled order releases the rider", async () => {
    await reset({ maxRounds: 1, offerTtlSeconds: 15 });
    const u = await rider("Ravi");
    const o = await order();
    const t0 = new Date();
    await svc.createJobForOrder({ models, order: o, now: t0 });
    await models.DeliveryPartnerState.updateOne({ partner: u._id }, { $set: { lastSeenAt: new Date(t0.getTime() + 16000) } });
    const r = await svc.runDeliveryTick({ models, db, now: new Date(t0.getTime() + 16000) });
    assert.equal(r.stats.escalated, 1);
    await svc.adminAssign({ models, db, admin: { _id: new mongoose.Types.ObjectId(), name: "Boss" }, jobId: (await jobOf(o))._id, partnerId: u._id });
    await models.Order.updateOne({ _id: o._id }, { $set: { status: "CANCELLED" } });
    const r2 = await svc.runDeliveryTick({ models, db });
    assert.equal(r2.stats.cancelled, 1);
    assert.equal((await models.DeliveryPartnerState.findOne({ partner: u._id })).activeCount, 0);
  });
} finally {
  await conn.close();
  await replSet.stop();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
