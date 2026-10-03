// test/insightsOverview.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Insights overview helpers (services/insightsService.js): the new-vs-returning
// customer split and the shared revenue rule it is built on.
//   node test/insightsOverview.test.js
// ─────────────────────────────────────────────────────────────────────────────
import assert from "node:assert/strict";
import { summariseCustomers, revenueOrderMatch } from "../services/insightsService.js";

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.message}`); }
};

test("walk-in bills (no user, no phone) are counted but never as customers", () => {
  const s = summariseCustomers([{ _id: null, bills: 3, spent: 300 }]);
  assert.deepEqual(s, { bills: 3, walkInBills: 3, identified: 0, newCount: 0, returning: 0, repeatInPeriod: 0, identifiedSpend: 0 });
});

test("a customer seen before the period is returning; first-timers are new", () => {
  const s = summariseCustomers(
    [{ _id: "u:1", bills: 1, spent: 199.5 }, { _id: "p:9000000001", bills: 2, spent: 357 }, { _id: null, bills: 1, spent: 63 }],
    new Set(["u:1"]),
  );
  assert.equal(s.returning, 1); assert.equal(s.newCount, 1); assert.equal(s.identified, 2);
  assert.equal(s.repeatInPeriod, 1, "two bills inside the period");
  assert.equal(s.bills, 4); assert.equal(s.walkInBills, 1); assert.equal(s.identifiedSpend, 556.5);
});

test("overview uses the same revenue rule as the sales breakdown (PAID, not CANCELLED)", () => {
  const m = revenueOrderMatch({ from: new Date(0), to: new Date(1) });
  assert.deepEqual(m.status, { $ne: "CANCELLED" });
  assert.equal(m.paymentStatus, "PAID");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
