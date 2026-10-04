// test/serviceToggles.test.js
// SET-01 — Dine-in / Takeaway / Delivery switches are enforced server-side.
//   node test/serviceToggles.test.js
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.PHONEPE_MERCHANT_ID;

const { isServiceEnabled, assertServiceEnabled, effectiveServices } = await import("../utils/serviceToggles.js");
const { placeOrderTx } = await import("../services/orderService.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
};

await test("defaults match the schema (dine-in + takeaway on, delivery off)", () => {
  assert.deepEqual(effectiveServices(null), { dineIn: true, takeAway: true, delivery: false });
  assert.deepEqual(effectiveServices({ services: { takeAway: false } }), { dineIn: true, takeAway: false, delivery: false });
});

await test("each order type follows its own switch", () => {
  const p = { services: { dineIn: false, takeAway: true, delivery: true } };
  assert.equal(isServiceEnabled(p, "DINE_IN"), false);
  assert.equal(isServiceEnabled(p, "TAKEAWAY"), true);
  assert.equal(isServiceEnabled(p, "ONLINE"), true);
  assert.throws(() => assertServiceEnabled(p, "DINE_IN"), (e) => e.statusCode === 400 && e.code === "SERVICE_DISABLED" && /Dine-in/.test(e.message));
});

const world = (services) => ({
  models: {
    Order: { findOne: async () => null },
    RestaurantProfile: { findOne: async () => ({ services, gstRate: 0 }) },
  },
});

await test("a customer can't place a takeaway order when Takeaway is off (nothing is priced or saved)", async () => {
  const { models } = world({ dineIn: true, takeAway: false, delivery: false });
  await assert.rejects(
    placeOrderTx({ req: { models, user: null, headers: {} }, body: { orderType: "TAKEAWAY", items: [{ menuItemId: "m1", qty: 1 }] } }),
    (e) => e.statusCode === 400 && e.code === "SERVICE_DISABLED",
  );
});

await test("legacy 'Delivery' order type maps to ONLINE and is refused while Delivery is off", async () => {
  const { models } = world({ dineIn: true, takeAway: true, delivery: false });
  await assert.rejects(
    placeOrderTx({ req: { models, user: null, headers: {} }, body: { orderType: "Delivery", items: [{ menuItemId: "m1", qty: 1 }] } }),
    (e) => e.code === "SERVICE_DISABLED",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
