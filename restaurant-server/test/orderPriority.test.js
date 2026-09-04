// test/orderPriority.test.js
import assert from "node:assert/strict";
import { getSourceFromUser } from "../services/orderService.js";

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.message}`); }
};

// Mirrors the exact expression used in placeOrderTx (services/orderService.js):
//   priority: isStaffOrder && priority === "URGENT" ? "URGENT" : "NORMAL"
const resolvePriority = (user, requestedPriority) => {
  const source = getSourceFromUser(user);
  const isStaffOrder = source === "ADMIN" || source === "WAITER";
  return isStaffOrder && requestedPriority === "URGENT" ? "URGENT" : "NORMAL";
};

console.log("── staff-only order priority (URGENT flag) ──────────────");

test("a waiter can mark an order URGENT", () => {
  assert.equal(resolvePriority({ role: "waiter" }, "URGENT"), "URGENT");
});

test("an admin can mark an order URGENT", () => {
  assert.equal(resolvePriority({ isAdmin: true }, "URGENT"), "URGENT");
});

test("a logged-in customer requesting URGENT is silently downgraded to NORMAL", () => {
  assert.equal(resolvePriority({ role: "customer" }, "URGENT"), "NORMAL");
});

test("a guest (no account at all) requesting URGENT is silently downgraded to NORMAL", () => {
  assert.equal(resolvePriority(null, "URGENT"), "NORMAL");
});

test("staff placing an order with no priority specified defaults to NORMAL", () => {
  assert.equal(resolvePriority({ role: "waiter" }, undefined), "NORMAL");
});

test("an unrecognized/garbage priority value from staff is rejected, not passed through", () => {
  assert.equal(resolvePriority({ role: "waiter" }, "SUPER_URGENT_PLEASE"), "NORMAL");
});

console.log("──────────────────────────────────────────────");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
console.log("ALL TESTS PASSED");
