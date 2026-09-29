// test/paymentBeforeComplete.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Nobody (waiter or admin) can complete an order until it is PAID, and
// nobody sets FAILED by hand (utils/orderStateMachine.js). No DB — fake
// models. Run with:
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

const fakeReq = ({ role, order }) => {
  const calls = { filter: null };
  const Order = {
    findById: async () => ({ ...order }),
    findOneAndUpdate: async (filter, update) => {
      calls.filter = filter;
      // Honour the atomic filter the way Mongo would.
      for (const [k, v] of Object.entries(filter)) if (k !== "_id" && order[k] !== v) return null;
      return { ...order, ...update.$set, tableSession: null };
    },
  };
  const user = role === "admin" ? { _id: "u1", isAdmin: true, name: "A" } : { _id: "u1", role, name: "W" };
  return { req: { models: { Order }, user }, calls };
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

await test("waiter completing an unpaid delivered order is rejected (400)", async () => {
  const { req } = fakeReq({ role: "waiter", order: { _id: "o1", status: "DELIVERED", paymentStatus: "PENDING_VERIFICATION" } });
  await assert.rejects(
    transitionOrderStatusTx({ req, orderId: "o1", toStatus: "COMPLETED" }),
    (e) => e.statusCode === 400 && /Paid/.test(e.message),
  );
});

await test("waiter completing a paid order succeeds, with PAID in the atomic filter", async () => {
  const { req, calls } = fakeReq({ role: "waiter", order: { _id: "o1", status: "DELIVERED", paymentStatus: "PAID" } });
  const { order } = await transitionOrderStatusTx({ req, orderId: "o1", toStatus: "COMPLETED" });
  assert.equal(order.status, "COMPLETED");
  assert.equal(calls.filter.paymentStatus, "PAID");
});

await test("admin completing an unpaid order is rejected too (even jumping from READY)", async () => {
  for (const from of ["DELIVERED", "READY"]) {
    const { req } = fakeReq({ role: "admin", order: { _id: "o1", status: from, paymentStatus: "PENDING_VERIFICATION" } });
    await assert.rejects(
      transitionOrderStatusTx({ req, orderId: "o1", toStatus: "COMPLETED" }),
      (e) => e.statusCode === 400 && /Paid/.test(e.message), from,
    );
  }
});

await test("admin completing a paid order succeeds, with PAID in the atomic filter", async () => {
  const { req, calls } = fakeReq({ role: "admin", order: { _id: "o1", status: "DELIVERED", paymentStatus: "PAID" } });
  const { order } = await transitionOrderStatusTx({ req, orderId: "o1", toStatus: "COMPLETED" });
  assert.equal(order.status, "COMPLETED");
  assert.equal(calls.filter.paymentStatus, "PAID");
});

await test("waiter READY→DELIVERED needs no payment", async () => {
  const { req } = fakeReq({ role: "waiter", order: { _id: "o1", status: "READY", paymentStatus: "PENDING_VERIFICATION" } });
  const { order } = await transitionOrderStatusTx({ req, orderId: "o1", toStatus: "DELIVERED" });
  assert.equal(order.status, "DELIVERED");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
