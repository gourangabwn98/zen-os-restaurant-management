// test/paymentBeforeComplete.test.js
// ─────────────────────────────────────────────────────────────────────────────
// An order is completed by hand ONLY by an admin, ONLY once it is PAID, and
// only from cooking / ready / served — completing settles the bill and clears
// the table. Waiters never complete by hand (they settle the bill), and nobody
// sets FAILED by hand (utils/orderStateMachine.js). No DB — fake models. Run with:
//   node test/paymentBeforeComplete.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import { requiresPaidForTransition, canSetPaymentStatus } from "../utils/orderStateMachine.js";
import { transitionOrderStatusTx } from "../services/orderService.js";

let passed = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
};

const fakeReq = ({ role, order, payAtWrite, session }) => {
  const calls = { filter: null, update: null };
  const thenable = (v) => { const p = Promise.resolve(v); p.select = () => p; p.lean = () => p; return p; };
  const Order = {
    findById: () => thenable({ ...order }),
    findOneAndUpdate: async (filter, update) => {
      calls.filter = filter; calls.update = update;
      // Honour the atomic filter the way Mongo would (payAtWrite = the
      // payment status at write time, e.g. undone a moment ago).
      const atWrite = { ...order, ...(payAtWrite && { paymentStatus: payAtWrite }) };
      for (const [k, v] of Object.entries(filter)) if (k !== "_id" && atWrite[k] !== v) return null;
      return { ...order, ...update.$set, tableSession: session ? session._id : null };
    },
    countDocuments: async () => 0, // no other active order on the table
  };
  const models = { Order };
  if (session) {
    models.TableSession = { findById: async () => session };
    models.Table = { updateOne: async (q, u) => { calls.tableFreed = u.$set.occupancyStatus; }, findById: async () => ({ tableNo: 4, seats: 4 }) };
  }
  const user = role === "admin" ? { _id: "u1", isAdmin: true, name: "A" } : { _id: "u1", role, name: "W" };
  return { req: { models, user }, calls };
};

await test("rule table: waiter AND admin need PAID to complete — from any status", () => {
  for (const role of ["waiter", "admin"]) {
    assert.equal(requiresPaidForTransition("DELIVERED", "COMPLETED", role), true, role);
    assert.equal(requiresPaidForTransition("READY", "COMPLETED", role), true, `${role} override jump`);
  }
  assert.equal(requiresPaidForTransition("READY", "DELIVERED", "waiter"), false);
  assert.equal(requiresPaidForTransition("READY", "DELIVERED", "admin"), false);
});

await test("rule table: nobody marks FAILED by hand; waiter sets PAID only; admin PAID or undo", () => {
  assert.equal(canSetPaymentStatus("PAID", "waiter"), true);
  assert.equal(canSetPaymentStatus("PENDING_VERIFICATION", "waiter"), false);
  assert.equal(canSetPaymentStatus("PAID", "admin"), true);
  assert.equal(canSetPaymentStatus("PENDING_VERIFICATION", "admin"), true);
  for (const role of ["admin", "waiter"]) assert.equal(canSetPaymentStatus("FAILED", role), false, role);
  assert.equal(canSetPaymentStatus("BOGUS", "admin"), false);
});

await test("waiter can't complete by hand — paid or unpaid (400), nothing written", async () => {
  for (const paymentStatus of ["PENDING_VERIFICATION", "PAID"]) {
    const { req, calls } = fakeReq({ role: "waiter", order: { _id: "o1", status: "DELIVERED", paymentStatus } });
    await assert.rejects(
      transitionOrderStatusTx({ req, orderId: "o1", toStatus: "COMPLETED" }),
      (e) => e.statusCode === 400 && /Only an admin/.test(e.message), paymentStatus,
    );
    assert.equal(calls.filter, null, "nothing was written");
  }
});

await test("admin can't complete an UNPAID order — from cooking, ready or served (400 PAYMENT_REQUIRED)", async () => {
  for (const from of ["PREPARING", "READY", "DELIVERED"]) {
    const { req, calls } = fakeReq({ role: "admin", order: { _id: "o1", status: from, paymentStatus: "PENDING_VERIFICATION" } });
    await assert.rejects(
      transitionOrderStatusTx({ req, orderId: "o1", toStatus: "COMPLETED" }),
      (e) => e.statusCode === 400 && e.code === "PAYMENT_REQUIRED" && /Mark this order Paid first/.test(e.message), from,
    );
    assert.equal(calls.filter, null, `nothing written (${from})`);
  }
});

await test("admin completes a PAID order — bill settled, served recorded, PAID in the atomic filter", async () => {
  for (const from of ["PREPARING", "READY", "DELIVERED"]) {
    const { req, calls } = fakeReq({ role: "admin", order: { _id: "o1", status: from, paymentStatus: "PAID", billStatus: "OPEN" } });
    const { order } = await transitionOrderStatusTx({ req, orderId: "o1", toStatus: "COMPLETED" });
    assert.equal(order.status, "COMPLETED", from);
    assert.equal(order.billStatus, "SETTLED", from);
    assert.ok(order.completedAt && order.deliveredAt, from);
    assert.equal(calls.filter.paymentStatus, "PAID");
    assert.equal(calls.filter.status, from);
  }
});

await test("an already-settled bill isn't re-settled; served time isn't overwritten", async () => {
  const deliveredAt = new Date("2026-10-01T10:00:00Z");
  const { req, calls } = fakeReq({ role: "admin", order: { _id: "o1", status: "DELIVERED", paymentStatus: "PAID", billStatus: "SETTLED", deliveredAt } });
  await transitionOrderStatusTx({ req, orderId: "o1", toStatus: "COMPLETED" });
  assert.equal(calls.update.$set.billSettledAt, undefined);
  assert.equal(calls.update.$set.deliveredAt, undefined);
});

await test("admin can't complete an order the kitchen hasn't taken yet (Placed / awaiting) — even paid", async () => {
  for (const from of ["CONFIRMED", "PENDING_CONFIRMATION", "AWAITING_PAYMENT"]) {
    const { req, calls } = fakeReq({ role: "admin", order: { _id: "o1", status: from, paymentStatus: "PAID" } });
    await assert.rejects(
      transitionOrderStatusTx({ req, orderId: "o1", toStatus: "COMPLETED" }),
      (e) => e.statusCode === 400 && /send it to the kitchen first/.test(e.message), from,
    );
    assert.equal(calls.filter, null, from);
  }
});

await test("payment undone a moment before the write → refused (400 PAYMENT_REQUIRED), not completed", async () => {
  const { req } = fakeReq({ role: "admin", order: { _id: "o1", status: "DELIVERED", paymentStatus: "PAID" }, payAtWrite: "PENDING_VERIFICATION" });
  // The re-read after the failed write sees the undone payment.
  req.models.Order.findById = (() => { let n = 0; return () => {
    const v = n++ === 0 ? { _id: "o1", status: "DELIVERED", paymentStatus: "PAID" } : { _id: "o1", status: "DELIVERED", paymentStatus: "PENDING_VERIFICATION" };
    const p = Promise.resolve(v); p.select = () => p; p.lean = () => p; return p;
  }; })();
  await assert.rejects(
    transitionOrderStatusTx({ req, orderId: "o1", toStatus: "COMPLETED" }),
    (e) => e.statusCode === 400 && e.code === "PAYMENT_REQUIRED",
  );
});

await test("completing the table's last active order clears the table", async () => {
  const session = { _id: "s1", table: "t1", status: "OPEN", orders: ["o1"], save: async () => {} };
  const { req, calls } = fakeReq({ role: "admin", order: { _id: "o1", status: "DELIVERED", paymentStatus: "PAID" }, session });
  const r = await transitionOrderStatusTx({ req, orderId: "o1", toStatus: "COMPLETED" });
  assert.equal(r.order.status, "COMPLETED");
  assert.equal(session.status, "CLOSED");
  assert.equal(r.closedTableSession, session);
  assert.equal(calls.tableFreed, "AVAILABLE");
  assert.equal(r.freedTable.tableNo, 4);
});

await test("waiter READY→DELIVERED needs no payment", async () => {
  const { req } = fakeReq({ role: "waiter", order: { _id: "o1", status: "READY", paymentStatus: "PENDING_VERIFICATION" } });
  const { order } = await transitionOrderStatusTx({ req, orderId: "o1", toStatus: "DELIVERED" });
  assert.equal(order.status, "DELIVERED");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
