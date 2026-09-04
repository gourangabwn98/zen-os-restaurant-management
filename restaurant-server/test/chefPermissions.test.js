import assert from "node:assert/strict";
import { validateTransition } from "../utils/orderStateMachine.js";

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.message}`); }
};

console.log("── chef order-transition permissions ───────────────────────");

test("chef CAN move CONFIRMED -> PREPARING (start preparing)", () => {
  assert.equal(validateTransition("CONFIRMED", "PREPARING", "chef").ok, true);
});

test("chef CAN move PREPARING -> READY", () => {
  assert.equal(validateTransition("PREPARING", "READY", "chef").ok, true);
});

test("chef CANNOT confirm a pending order (that's a waiter/admin action)", () => {
  const r = validateTransition("PENDING_CONFIRMATION", "CONFIRMED", "chef");
  assert.equal(r.ok, false);
  assert.equal(r.code, 403);
});

test("chef CANNOT mark an order DELIVERED", () => {
  const r = validateTransition("READY", "DELIVERED", "chef");
  assert.equal(r.ok, false);
});

test("chef CANNOT mark an order COMPLETED", () => {
  const r = validateTransition("DELIVERED", "COMPLETED", "chef");
  assert.equal(r.ok, false);
});

test("chef CANNOT cancel an order at any stage", () => {
  assert.equal(validateTransition("PENDING_CONFIRMATION", "CANCELLED", "chef").ok, false);
  assert.equal(validateTransition("CONFIRMED", "CANCELLED", "chef").ok, false);
  assert.equal(validateTransition("PREPARING", "CANCELLED", "chef").ok, false);
});

test("waiter and admin retain their existing PREPARING/READY permissions (chef addition didn't regress them)", () => {
  assert.equal(validateTransition("CONFIRMED", "PREPARING", "waiter").ok, true);
  assert.equal(validateTransition("CONFIRMED", "PREPARING", "admin").ok, true);
  assert.equal(validateTransition("PREPARING", "READY", "waiter").ok, true);
});

console.log("──────────────────────────────────────────────");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
console.log("ALL TESTS PASSED");
