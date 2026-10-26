import assert from "node:assert/strict";
import { isServed, paymentActionsVisible } from "../src/utils/orderLifecycle.js";

for (const status of ["PENDING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY"]) {
  assert.equal(isServed({ status }), false, `${status} is not Served`);
  assert.equal(paymentActionsVisible({ status }), false, `${status} hides payment actions`);
}
for (const status of ["DELIVERED", "COMPLETED"]) {
  assert.equal(isServed({ status }), true, `${status} is post-Served`);
  assert.equal(paymentActionsVisible({ status }), true, `${status} shows bill/payment state`);
}
console.log("orderLifecycle.test.js: Served gating assertions passed");
