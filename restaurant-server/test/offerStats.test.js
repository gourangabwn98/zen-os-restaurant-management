// test/offerStats.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Admin → Offers read-only figures (services/offerStatsService.js): the cost
// check reuses utils/pricing.js computeCouponDiscount, "vs normal" needs real
// earlier days, rush hour, slipping-away customers, timezone instants.
//   node test/offerStats.test.js
// ─────────────────────────────────────────────────────────────────────────────
import assert from "node:assert/strict";
import {
  checkTerms, ordersVsNormal, rushFromHours, slippingAway, zonedInstant, hourIn,
} from "../services/offerStatsService.js";

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.message}`); }
};
const DAY = 864e5;

test("cost check: minimum filters bills, % discount honours the ₹ cap", () => {
  const r = checkTerms({ discountType: "PERCENT", discountValue: 20, maxDiscount: 50, minOrderAmount: 300 }, [100, 300, 500], 40);
  assert.equal(r.bills, 3);
  assert.equal(r.qualifying, 2);
  assert.equal(r.sharePct, 66.7);
  assert.equal(r.avgDiscount, 50);           // min(60, 50) and min(100, 50)
  assert.equal(r.avgQualifyingBill, 400);
  assert.equal(r.keepPerUse, 110);           // 400 × 40% − 50
});

test("cost check: flat discount never exceeds the bill; unknown margin → no keep figure", () => {
  const r = checkTerms({ discountType: "FLAT", discountValue: 75, minOrderAmount: 0 }, [50, 200], null);
  assert.equal(r.avgDiscount, 62.5);         // 50 (capped at the bill) and 75
  assert.equal(r.keepPerUse, null);
});

test("cost check: no recent bills → nothing invented", () => {
  const r = checkTerms({ discountType: "FLAT", discountValue: 75 }, [], 40);
  assert.equal(r.sharePct, null); assert.equal(r.avgBill, null); assert.equal(r.keepPerUse, null);
});

test("vs normal: compares the window with the earlier per-day rate", () => {
  const now = new Date("2026-10-10T00:00:00Z");
  const start = new Date("2026-10-01T00:00:00Z"), end = new Date("2026-10-03T00:00:00Z");
  const times = [];
  for (let d = 1; d <= 14; d++) times.push(start.getTime() - d * DAY + 1000); // 1 a day before
  times.push(start.getTime() + 1000, start.getTime() + 2000, start.getTime() + DAY, start.getTime() + DAY + 5);
  const r = ordersVsNormal({ startsAt: start, endsAt: end, times, firstOrderAt: new Date(start.getTime() - 14 * DAY), now });
  assert.equal(r.during, 4); assert.equal(r.expected, 2); assert.equal(r.extra, 2);
});

test("vs normal: under 7 earlier days of orders → no comparison, not a fake 0", () => {
  const now = new Date("2026-10-10T00:00:00Z"), start = new Date("2026-10-05T00:00:00Z");
  const r = ordersVsNormal({ startsAt: start, endsAt: now, times: [], firstOrderAt: new Date("2026-10-01T00:00:00Z"), now });
  assert.equal(r.expected, null); assert.equal(r.extra, null);
});

test("vs normal: a coupon that hasn't started has no result", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  assert.equal(ordersVsNormal({ startsAt: new Date("2026-10-05T00:00:00Z"), endsAt: new Date("2026-10-06T00:00:00Z"), times: [], firstOrderAt: now, now }), null);
});

test("rush hour: busiest hour, send 2 hours before; too few bills → null", () => {
  const h = new Array(24).fill(0); h[13] = 6; h[20] = 3;
  assert.deepEqual(rushFromHours(h), { hour: 13, sendHour: 11, bills: 6, share: 66.7 });
  const few = new Array(24).fill(0); few[1] = 2; few[0] = 1;
  assert.equal(rushFromHours(few), null);
  const early = new Array(24).fill(0); early[1] = 9;
  assert.equal(rushFromHours(early).sendHour, 23);
});

test("slipping away: 2+ bills and none in 21 days; walk-ins never counted", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  const r = slippingAway([
    { _id: "u:1", bills: 3, last: new Date("2026-10-01T00:00:00Z") },
    { _id: "p:900", bills: 2, last: new Date("2026-09-01T00:00:00Z") },
    { _id: "u:2", bills: 1, last: new Date("2026-09-01T00:00:00Z") },
    { _id: "u:3", bills: 5, last: new Date("2026-10-25T00:00:00Z") },
    { _id: null, bills: 40, last: new Date("2026-09-01T00:00:00Z") },
  ], now);
  assert.equal(r.count, 2); assert.deepEqual(r.userIds, ["1"]);
});

test("zonedInstant: 9 AM in Kolkata is 03:30 UTC", () => {
  const d = zonedInstant(2026, 10, 3, 9, "Asia/Kolkata");
  assert.equal(d.toISOString(), "2026-10-03T03:30:00.000Z");
  assert.equal(hourIn(d, "Asia/Kolkata"), 9);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
