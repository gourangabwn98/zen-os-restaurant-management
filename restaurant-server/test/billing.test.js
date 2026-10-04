// test/billing.test.js
// ─────────────────────────────────────────────────────────────────────────────
// BIL-02 / BIL-01 / DSH-03 / DSH-04 — operational status and billing status
// are separate:
//   • serving food (→ DELIVERED / "Eating") never settles the bill
//   • settling a bill never moves a cooking order along
//   • COMPLETED = served AND settled, whichever happens last
//   • nobody completes by hand; settlement is idempotent
// No DB — fakes that honour the atomic filters. Run:
//   node test/billing.test.js
// ─────────────────────────────────────────────────────────────────────────────
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const { settleBills, reopenBill, settleBlocker } = await import("../services/billingService.js");
const { transitionOrderStatusTx } = await import("../services/orderService.js");
const { effectiveBillStatus } = await import("../utils/orderStateMachine.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.stack || err.message}`); }
};

const oid = (n) => String(n).padStart(24, "0");

// Minimal Mongo filter semantics used by the services under test.
const matchOne = (v, cond) => {
  if (cond && typeof cond === "object" && !Array.isArray(cond)) {
    return Object.entries(cond).every(([op, x]) => {
      if (op === "$ne") return String(v) !== String(x);
      if (op === "$in") return x.map(String).includes(String(v));
      if (op === "$nin") return !x.map(String).includes(String(v));
      if (op === "$exists") return x ? v !== undefined : v === undefined;
      throw new Error(`fake: ${op}`);
    });
  }
  return String(v) === String(cond);
};
const matches = (doc, filter) => Object.entries(filter).every(([k, c]) => {
  if (k === "$or") return c.some((f) => matches(doc, f));
  return matchOne(doc[k], c);
});

const makeWorld = (orders, { sessions = [] } = {}) => {
  const state = { orders: orders.map((o) => ({ statusHistory: [], ...o })), sessions: sessions.map((s) => ({ ...s })) };
  const apply = (o, u) => {
    Object.assign(o, u.$set || {});
    const push = u.$push?.statusHistory;
    if (push) o.statusHistory = [...o.statusHistory, push];
  };
  const Order = {
    find: (f) => ({
      lean: async () => state.orders.filter((o) => matches(o, f._id ? { _id: f._id } : f)).map((o) => ({ ...o })),
    }),
    findById: (id) => {
      const row = state.orders.find((o) => String(o._id) === String(id));
      const p = Promise.resolve(row ? { ...row } : null);
      return Object.assign(p, { select: () => ({ lean: async () => (row ? { ...row } : null) }), lean: async () => (row ? { ...row } : null) });
    },
    findOneAndUpdate: async (f, u) => {
      const row = state.orders.find((o) => matches(o, f));
      if (!row) return null;
      apply(row, u);
      return { ...row };
    },
    countDocuments: async (f) => state.orders.filter((o) => matches(o, f)).length,
  };
  const TableSession = {
    findById: async (id) => {
      const s = state.sessions.find((x) => String(x._id) === String(id));
      return s ? Object.assign(s, { save: async () => s }) : null;
    },
  };
  const Table = { findById: async () => ({ tableNo: 4, seats: 4 }), updateOne: async () => ({}) };
  const WaitlistEntry = { findOne: () => ({ sort: () => ({ lean: async () => null }) }), find: () => ({ sort: () => ({ lean: async () => [] }) }) };
  return { state, models: { Order, TableSession, Table, WaitlistEntry } };
};

const waiter = { _id: "w1", role: "waiter", name: "Rana" };
const ACTOR = { id: "w1", role: "WAITER", name: "Rana" };
const get = (state, id) => state.orders.find((o) => o._id === id);

await test("pure: effective bill status — legacy COMPLETED reads SETTLED, everything else OPEN", () => {
  assert.equal(effectiveBillStatus({ status: "COMPLETED" }), "SETTLED");
  assert.equal(effectiveBillStatus({ status: "DELIVERED" }), "OPEN");
  assert.equal(effectiveBillStatus({ status: "COMPLETED", billStatus: "OPEN" }), "OPEN"); // reopened
  assert.equal(settleBlocker({ status: "PENDING_CONFIRMATION" }), "Not accepted yet");
  assert.equal(settleBlocker({ status: "CANCELLED" }), "Cancelled");
  assert.equal(settleBlocker({ status: "PREPARING" }), null);
});

await test("serving food does NOT settle the bill (DELIVERED, bill still OPEN, payment untouched)", async () => {
  const { state, models } = makeWorld([{ _id: oid(1), orderId: "ORD1", status: "READY", paymentStatus: "PENDING_VERIFICATION", billStatus: "OPEN" }]);
  const { order } = await transitionOrderStatusTx({ req: { models, user: waiter }, orderId: oid(1), toStatus: "DELIVERED" });
  assert.equal(order.status, "DELIVERED");
  assert.equal(get(state, oid(1)).billStatus, "OPEN");
  assert.equal(get(state, oid(1)).paymentStatus, "PENDING_VERIFICATION");
});

await test("settling a served bill collects the payment and completes it (Eating → Completed) + frees the table", async () => {
  const { state, models } = makeWorld(
    [{ _id: oid(2), orderId: "ORD2", status: "DELIVERED", paymentStatus: "PENDING_VERIFICATION", billStatus: "OPEN", tableSession: "s1" }],
    { sessions: [{ _id: "s1", status: "OPEN", orders: [oid(2)], table: "t4", tableNo: 4 }] },
  );
  const r = await settleBills({ models, orderIds: [oid(2)], paymentMethod: "Cash", actor: ACTOR, role: "waiter" });
  const o = get(state, oid(2));
  assert.deepEqual(r.settled, ["ORD2"]);
  assert.equal(o.paymentStatus, "PAID");
  assert.equal(o.paymentMethod, "Cash");
  assert.equal(o.billStatus, "SETTLED");
  assert.equal(o.status, "COMPLETED");
  assert.equal(r.completions.length, 1);
  assert.equal(r.completions[0].closedTableSession.status, "CLOSED");
});

await test("settling while still cooking does NOT move the order; Served then completes it", async () => {
  const { state, models } = makeWorld([{ _id: oid(3), orderId: "ORD3", status: "PREPARING", paymentStatus: "PAID", paymentMethod: "Online", billStatus: "OPEN" }]);
  const r = await settleBills({ models, orderIds: [oid(3)], actor: ACTOR, role: "waiter" });
  assert.deepEqual(r.settled, ["ORD3"]);
  assert.equal(r.completions.length, 0);
  assert.equal(get(state, oid(3)).status, "PREPARING", "billing never mutates operational status");
  assert.equal(get(state, oid(3)).paymentMethod, "Online", "an already-recorded payment is not re-labelled");

  const req = { models, user: waiter };
  await transitionOrderStatusTx({ req, orderId: oid(3), toStatus: "READY" });
  assert.equal(get(state, oid(3)).status, "READY", "Ready to Deliver is not Eating");
  const served = await transitionOrderStatusTx({ req, orderId: oid(3), toStatus: "DELIVERED" });
  assert.equal(served.order.status, "COMPLETED", "served + settled → Completed");
});

await test("an unpaid bill needs a payment method to settle", async () => {
  const { state, models } = makeWorld([{ _id: oid(4), orderId: "ORD4", status: "DELIVERED", paymentStatus: "PENDING_VERIFICATION", billStatus: "OPEN" }]);
  const r = await settleBills({ models, orderIds: [oid(4)], actor: ACTOR, role: "waiter" });
  assert.equal(r.settled.length, 0);
  assert.match(r.rejected[0].reason, /choose Cash or Online/);
  assert.equal(get(state, oid(4)).billStatus, "OPEN");
  assert.equal(get(state, oid(4)).status, "DELIVERED");
});

await test("settling twice is a no-op (one history entry, reported as already settled)", async () => {
  const { state, models } = makeWorld([{ _id: oid(5), orderId: "ORD5", status: "DELIVERED", paymentStatus: "PAID", billStatus: "OPEN" }]);
  await settleBills({ models, orderIds: [oid(5)], actor: ACTOR, role: "waiter" });
  const again = await settleBills({ models, orderIds: [oid(5)], actor: ACTOR, role: "waiter" });
  assert.deepEqual(again.alreadySettled, ["ORD5"]);
  assert.equal(get(state, oid(5)).statusHistory.filter((h) => /Bill settled/.test(h.note)).length, 2, "settle note + completion note, once each");
});

await test("legacy COMPLETED order (no billStatus) counts as settled; cancelled / not accepted are refused", async () => {
  const { models } = makeWorld([
    { _id: oid(6), orderId: "ORD6", status: "COMPLETED", paymentStatus: "PAID" },
    { _id: oid(7), orderId: "ORD7", status: "CANCELLED", paymentStatus: "PENDING_VERIFICATION", billStatus: "OPEN" },
    { _id: oid(8), orderId: "ORD8", status: "PENDING_CONFIRMATION", paymentStatus: "PENDING_VERIFICATION", billStatus: "OPEN" },
  ]);
  const r = await settleBills({ models, orderIds: [oid(6), oid(7), oid(8)], paymentMethod: "Cash", actor: ACTOR, role: "admin" });
  assert.deepEqual(r.alreadySettled, ["ORD6"]);
  assert.deepEqual(r.rejected.map((x) => x.reason).sort(), ["Cancelled", "Not accepted yet"]);
});

await test("a chef can't settle bills (403); bad ids are 400", async () => {
  const { models } = makeWorld([]);
  await assert.rejects(settleBills({ models, orderIds: [oid(1)], paymentMethod: "Cash", actor: ACTOR, role: "chef" }), (e) => e.statusCode === 403);
  await assert.rejects(settleBills({ models, orderIds: ["nope"], actor: ACTOR, role: "admin" }), (e) => e.statusCode === 400);
  await assert.rejects(settleBills({ models, orderIds: [oid(1)], paymentMethod: "Cheque", actor: ACTOR, role: "admin" }), (e) => e.statusCode === 400);
});

await test("reopening a settled bill only reopens the bill — operational status stays", async () => {
  const { state, models } = makeWorld([{ _id: oid(9), orderId: "ORD9", status: "COMPLETED", paymentStatus: "PAID" }]); // legacy
  const o = await reopenBill({ models, orderId: oid(9), actor: ACTOR });
  assert.equal(o.billStatus, "OPEN");
  assert.equal(get(state, oid(9)).status, "COMPLETED");
  await assert.rejects(reopenBill({ models, orderId: oid(9), actor: ACTOR }), (e) => e.statusCode === 409);
});

await test("combined bill 'settle selected' goes through settleBills (table-checked selection, never a hand completion)", async () => {
  const { completeSelected } = await import("../services/combinedBillService.js");
  const rows = [
    { _id: oid(10), orderId: "ORD10", orderType: "DINE_IN", tableNo: 4, status: "DELIVERED", paymentStatus: "PAID", billStatus: "OPEN", createdAt: new Date(1) },
    { _id: oid(11), orderId: "ORD11", orderType: "DINE_IN", tableNo: 5, status: "DELIVERED", paymentStatus: "PAID", billStatus: "OPEN", createdAt: new Date(2) },
  ];
  const { state, models } = makeWorld(rows);
  models.Order.find = (f) => ({
    populate: () => ({ lean: async () => state.orders.filter((o) => matches(o, f)).map((o) => ({ ...o })) }),
    lean: async () => state.orders.filter((o) => matches(o, f)).map((o) => ({ ...o })),
  });
  const r = await completeSelected({
    req: { models }, body: { tableNo: 4, orderIds: [oid(10), oid(11)] }, settle: settleBills, actor: ACTOR, role: "admin",
  });
  assert.deepEqual(r.settled, ["ORD10"]);
  assert.deepEqual(r.completed, ["ORD10"]);
  assert.equal(r.rejected[0].reason, "Not an order of this table");
  assert.equal(get(state, oid(11)).status, "DELIVERED");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
