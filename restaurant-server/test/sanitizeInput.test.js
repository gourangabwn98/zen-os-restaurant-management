// test/sanitizeInput.test.js — run: node test/sanitizeInput.test.js
import assert from "node:assert/strict";
import { stripOperators, sanitizeInput } from "../middleware/sanitizeInput.js";

// Operator injection into a login filter is removed.
const body = { phone: { $ne: null } };
assert.equal(stripOperators(body), 1);
assert.deepEqual(body, { phone: {} });

// Nested objects and arrays are cleaned; ordinary data is untouched.
const order = {
  items: [{ menuItem: "abc", qty: 2, extra: { $gt: "" } }],
  note: "₹50 off $5",           // "$" inside a value is fine
  "payment.state": "x",         // dotted keys are left alone
  $where: "sleep(1000)",
};
assert.equal(stripOperators(order), 2);
assert.deepEqual(order, { items: [{ menuItem: "abc", qty: 2, extra: {} }], note: "₹50 off $5", "payment.state": "x" });

// Middleware: works on req.body, tolerates missing / non-object bodies.
for (const b of [undefined, null, "text", 5]) {
  let called = false;
  sanitizeInput({ body: b }, {}, () => { called = true; });
  assert.ok(called);
}
const req = { body: { otp: { $regex: ".*" }, phone: "9876543210" } };
sanitizeInput(req, {}, () => {});
assert.deepEqual(req.body, { otp: {}, phone: "9876543210" });

console.log("sanitizeInput: all tests passed");
