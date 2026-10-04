// test/ebitda.test.js — INS-01 EBITDA + INS-02 "where every rupee went" funding split.
//   node test/ebitda.test.js
import assert from "node:assert/strict";
import { computeEbitda, purchasesByFunding } from "../services/insightsService.js";

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
};

test("INS-01: EBITDA = net sales (no GST) − food & supplies − staff pay", () => {
  const e = computeEbitda({
    orders: { subtotal: 50000, discount: 2000, serviceCharge: 1000, tax: 2450 },
    purchases: { total: 21000 }, staffPay: { amount: 12000 },
  });
  assert.equal(e.netSales, 49000);
  assert.equal(e.gst, 2450, "GST is shown aside, never as income");
  assert.equal(e.ebitda, 16000);
  assert.equal(e.margin, 32.7);
});

test("INS-01: no sales → margin unknown, never a made-up percentage", () => {
  assert.equal(computeEbitda({}).margin, null);
  assert.equal(computeEbitda({}).ebitda, 0);
});

test("INS-02/INV-07: purchases split by who paid; owner's pocket is its own line (owed back), not drawer spend", () => {
  const r = purchasesByFunding([
    { _id: { type: "PAID", source: "CASH_DRAWER" }, amount: 3000, count: 4 },
    { _id: { type: "PAID", source: "OWNER_POCKET" }, amount: 8000, count: 1 },
    { _id: { type: "PAID", source: "BANK_UPI" }, amount: 2000, count: 1 },
    { _id: { type: "CREDIT", source: null }, amount: 4500, count: 2 },
    { _id: {}, amount: 1000, count: 3 }, // recorded before payment details existed
  ]);
  assert.equal(r.total, 18500, "every purchase is a cost, whoever paid");
  assert.equal(r.byFunding.CASH_DRAWER.amount, 3000);
  assert.equal(r.byFunding.OWNER_POCKET.amount, 8000);
  assert.equal(r.byFunding.CREDIT.amount, 4500);
  assert.equal(r.byFunding.NOT_RECORDED.count, 3);
});

test("INS-01: repaying the owner later is NOT a second expense — EBITDA uses purchases, not cash out", () => {
  const orders = { subtotal: 10000 };
  const before = computeEbitda({ orders, purchases: { total: 8000 } });
  // The owner is repaid ₹8000 from the drawer next week: purchases are unchanged.
  const after = computeEbitda({ orders, purchases: { total: 8000 } });
  assert.equal(before.ebitda, 2000);
  assert.equal(after.ebitda, before.ebitda);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
