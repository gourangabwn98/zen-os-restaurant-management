// test/coupons.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Customer coupons (services/couponService.js + utils/pricing.js): discount
// maths, admin input validation, and — the core rule — that only coupons
// whose start/end window contains "now" are listed or accepted. No DB: an
// in-memory fake Coupon model. Run with:
//   node test/coupons.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import { computeCouponDiscount, computeTotals } from "../utils/pricing.js";
import {
  normalizeCouponInput, listLiveCoupons, resolveCouponForOrder, getLiveCoupon, isCouponLive,
} from "../services/couponService.js";

let passed = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
};

// ── Tiny in-memory Coupon model (only what the service uses) ────────────────
const val = (v) => (v instanceof Date ? v.getTime() : v);
const matches = (doc, filter) => Object.entries(filter).every(([k, cond]) => {
  const v = doc[k];
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    return Object.entries(cond).every(([op, x]) => {
      if (op === "$lte") return v != null && val(v) <= val(x);
      if (op === "$gte") return v != null && val(v) >= val(x);
      throw new Error(`fake: unsupported ${op}`);
    });
  }
  return val(v) === val(cond);
});
const query = (rows) => ({
  sort(spec) { rows = [...rows].sort((a, b) => { for (const [k, d] of Object.entries(spec)) { const x = val(a[k]) - val(b[k]); if (x) return x * d; } return 0; }); return this; },
  lean() { return Promise.resolve(rows); },
});
const fakeModels = (coupons) => ({
  Coupon: {
    find: (f) => query(coupons.filter((c) => matches(c, f))),
    findOne: (f) => ({ lean: () => Promise.resolve(coupons.find((c) => matches(c, f)) || null) }),
  },
});

const day = (d, h = 0) => new Date(2026, 9, d, h); // October 2026, local time
const PUJA = {
  code: "PUJA20", title: "Puja offer", description: "20% off", discountType: "PERCENT", discountValue: 20,
  maxDiscount: 100, minOrderAmount: 300, startsAt: day(10), endsAt: day(15, 23), isActive: true,
};
const SPECIAL = {
  code: "SPECIAL50", title: "Special offer", description: "₹50 off", discountType: "FLAT", discountValue: 50,
  maxDiscount: null, minOrderAmount: 0, startsAt: day(20), endsAt: day(30, 23), isActive: true,
};

const valid = {
  code: "diwali10", title: "Diwali", discountType: "percent", discountValue: 10,
  startsAt: day(1).toISOString(), endsAt: day(5).toISOString(),
};

console.log("── discount maths ──────────────────────────────");

await test("percent coupon: 20% of subtotal, capped at maxDiscount", () => {
  assert.equal(computeCouponDiscount(PUJA, 400), 80);
  assert.equal(computeCouponDiscount(PUJA, 1000), 100); // 200 capped to 100
});

await test("below the minimum order the coupon takes nothing off", () => {
  assert.equal(computeCouponDiscount(PUJA, 299), 0);
});

await test("flat coupon never exceeds the subtotal", () => {
  assert.equal(computeCouponDiscount(SPECIAL, 500), 50);
  assert.equal(computeCouponDiscount(SPECIAL, 30), 30);
});

await test("computeTotals: GST is charged on the discounted amount", () => {
  const totals = computeTotals([{ price: 200, qty: 2 }], { gstRate: 5, serviceCharge: 0 }, PUJA);
  assert.equal(totals.subtotal, 400);
  assert.equal(totals.discount, 80);
  assert.equal(totals.tax, Math.round(320 * 0.05)); // 16
  assert.equal(totals.total, 400 - 80 + 16);
});

await test("computeTotals without a coupon is unchanged (discount 0)", () => {
  const totals = computeTotals([{ price: 100, qty: 1 }], { gstRate: 5 });
  assert.equal(totals.discount, 0);
  assert.equal(totals.total, 105);
});

console.log("── date window ─────────────────────────────────");

await test("on 25 Oct only the Special offer is listed — not the Puja offer", async () => {
  const { coupons } = await listLiveCoupons({ models: fakeModels([PUJA, SPECIAL]), now: day(25, 12) });
  assert.deepEqual(coupons.map((c) => c.code), ["SPECIAL50"]);
});

await test("on 12 Oct only the Puja offer is listed", async () => {
  const { coupons } = await listLiveCoupons({ models: fakeModels([PUJA, SPECIAL]), now: day(12, 12) });
  assert.deepEqual(coupons.map((c) => c.code), ["PUJA20"]);
});

await test("a paused (inactive) coupon is not listed even inside its window", async () => {
  const { coupons } = await listLiveCoupons({ models: fakeModels([{ ...SPECIAL, isActive: false }]), now: day(25) });
  assert.equal(coupons.length, 0);
  assert.equal(isCouponLive({ ...SPECIAL, isActive: false }, day(25)), false);
});

await test("listed coupons carry no admin-only fields", async () => {
  const { coupons } = await listLiveCoupons({ models: fakeModels([{ ...SPECIAL, createdBy: { name: "Admin" } }]), now: day(25) });
  assert.equal(coupons[0].createdBy, undefined);
});

console.log("── applying at order time ──────────────────────");

await test("an expired coupon code is refused when placing the order", async () => {
  await assert.rejects(
    resolveCouponForOrder({ models: fakeModels([PUJA, SPECIAL]), code: "puja20", subtotal: 500, now: day(25) }),
    (e) => e.statusCode === 400 && /expired/.test(e.message),
  );
});

await test("a coupon before its start date is refused", async () => {
  await assert.rejects(
    getLiveCoupon({ models: fakeModels([SPECIAL]), code: "SPECIAL50", now: day(18) }),
    (e) => e.statusCode === 400 && /isn't active yet/.test(e.message),
  );
});

await test("an unknown code is refused", async () => {
  await assert.rejects(
    resolveCouponForOrder({ models: fakeModels([SPECIAL]), code: "NOPE", subtotal: 500, now: day(25) }),
    (e) => e.statusCode === 400,
  );
});

await test("a live coupon resolves to a snapshot (code is case-insensitive)", async () => {
  const snap = await resolveCouponForOrder({ models: fakeModels([SPECIAL]), code: " special50 ", subtotal: 500, now: day(25) });
  assert.deepEqual(snap, {
    code: "SPECIAL50", title: "Special offer", discountType: "FLAT", discountValue: 50, maxDiscount: null, minOrderAmount: 0,
  });
});

await test("an order below the minimum is refused with how much more to add", async () => {
  await assert.rejects(
    resolveCouponForOrder({ models: fakeModels([PUJA]), code: "PUJA20", subtotal: 250, now: day(12) }),
    (e) => e.statusCode === 400 && /₹50 more/.test(e.message),
  );
});

await test("no code sent → no coupon", async () => {
  assert.equal(await resolveCouponForOrder({ models: fakeModels([SPECIAL]), code: "", subtotal: 500, now: day(25) }), null);
});

console.log("── audience (registered / guest) ───────────────");

const MEMBERS = { ...SPECIAL, code: "MEMBERS30", audience: "REGISTERED" };
const WALKIN  = { ...SPECIAL, code: "WALKIN10", audience: "GUEST" };

await test("a guest sees ALL + GUEST coupons, and how many a login would unlock", async () => {
  const res = await listLiveCoupons({ models: fakeModels([SPECIAL, MEMBERS, WALKIN]), isRegistered: false, now: day(25) });
  assert.deepEqual(res.coupons.map((c) => c.code).sort(), ["SPECIAL50", "WALKIN10"]);
  assert.equal(res.lockedCount, 1);
});

await test("a registered customer sees ALL + REGISTERED coupons, not guest-only ones", async () => {
  const res = await listLiveCoupons({ models: fakeModels([SPECIAL, MEMBERS, WALKIN]), isRegistered: true, now: day(25) });
  assert.deepEqual(res.coupons.map((c) => c.code).sort(), ["MEMBERS30", "SPECIAL50"]);
  assert.equal(res.lockedCount, 0);
});

await test("a guest can't place an order with a registered-only coupon", async () => {
  await assert.rejects(
    resolveCouponForOrder({ models: fakeModels([MEMBERS]), code: "MEMBERS30", subtotal: 500, isRegistered: false, now: day(25) }),
    (e) => e.statusCode === 400 && /Log in/.test(e.message),
  );
});

await test("a registered customer can't use a guest-only coupon", async () => {
  await assert.rejects(
    resolveCouponForOrder({ models: fakeModels([WALKIN]), code: "WALKIN10", subtotal: 500, isRegistered: true, now: day(25) }),
    (e) => e.statusCode === 400 && /guest/.test(e.message),
  );
});

await test("a registered customer can use a registered-only coupon", async () => {
  const snap = await resolveCouponForOrder({ models: fakeModels([MEMBERS]), code: "MEMBERS30", subtotal: 500, isRegistered: true, now: day(25) });
  assert.equal(snap.code, "MEMBERS30");
});

await test("coupons without an audience (created before this field) are for everyone", async () => {
  const { audience, ...old } = { ...SPECIAL, audience: undefined };
  const res = await listLiveCoupons({ models: fakeModels([old]), isRegistered: true, now: day(25) });
  assert.equal(res.coupons.length, 1);
  assert.equal(res.coupons[0].audience, "ALL");
});

await test("audience is validated and defaults to ALL", () => {
  assert.equal(normalizeCouponInput(valid).audience, "ALL");
  assert.equal(normalizeCouponInput({ ...valid, audience: "registered" }).audience, "REGISTERED");
  assert.throws(() => normalizeCouponInput({ ...valid, audience: "VIP" }), /Audience/);
});

console.log("── admin input ─────────────────────────────────");


await test("normalizes code/type and defaults isActive/minOrder", () => {
  const c = normalizeCouponInput(valid);
  assert.equal(c.code, "DIWALI10");
  assert.equal(c.discountType, "PERCENT");
  assert.equal(c.isActive, true);
  assert.equal(c.minOrderAmount, 0);
});

await test("rejects end date before start date", () => {
  assert.throws(() => normalizeCouponInput({ ...valid, endsAt: day(1).toISOString(), startsAt: day(5).toISOString() }), /after the start/);
});

await test("rejects a percent above 100", () => {
  assert.throws(() => normalizeCouponInput({ ...valid, discountValue: 150 }), /Discount %/);
});

await test("a flat coupon ignores maxDiscount", () => {
  assert.equal(normalizeCouponInput({ ...valid, discountType: "FLAT", discountValue: 50, maxDiscount: 20 }).maxDiscount, null);
});

await test("update keeps unsent fields from the existing coupon", () => {
  const existing = { ...PUJA };
  const c = normalizeCouponInput({ isActive: false }, existing);
  assert.equal(c.code, "PUJA20");
  assert.equal(c.discountValue, 20);
  assert.equal(c.isActive, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
