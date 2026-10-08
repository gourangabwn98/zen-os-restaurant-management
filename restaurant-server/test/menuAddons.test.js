// test/menuAddons.test.js — KH-12: per-item add-ons, priced server-side.
// No DB — fakes.  node test/menuAddons.test.js
import assert from "node:assert/strict";
import { normalizeAddons, resolveLineAddons, lineAddonKey } from "../utils/menuAddons.js";
import { priceItems, computeTotals } from "../utils/pricing.js";
import { createKotJobForOrder } from "../services/kotService.js";
import { combinedPrintPayload } from "../services/combinedBillService.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};

const CHICKEN = { _id: "a1", name: "1 pc Chicken", price: 40 };
const EGG = { _id: "a2", name: "Egg", price: 15 };
const BIRYANI = { _id: "m1", name: "Biryani", price: 100, isAvailable: true, addons: [CHICKEN, EGG] };
const TEA = { _id: "m2", name: "Tea", price: 20, isAvailable: true };
const MenuItem = { findById: async (id) => [BIRYANI, TEA].find((m) => m._id === id) || null };

await test("Biryani ₹100 + 1 pc chicken → line price ₹140; ×2 → ₹280 (add-on per unit)", async () => {
  const [line] = await priceItems([{ menuItemId: "m1", qty: 2, addonIds: ["a1"] }], MenuItem);
  assert.equal(line.price, 140);
  assert.equal(line.basePrice, 100);
  assert.deepEqual(line.addons, [{ addonId: "a1", name: "1 pc Chicken", price: 40 }]);
  assert.equal(computeTotals([line], { gstRate: 0 }).total, 280);
});

await test("several add-ons on one line add up; a repeated id = more of that add-on", async () => {
  const [line] = await priceItems([{ menuItemId: "m1", qty: 1, addonIds: ["a2", "a1", "a1"] }], MenuItem);
  assert.equal(line.price, 195, "100 + 2 × 40 + 15");
  assert.deepEqual(line.addons, [{ addonId: "a1", name: "1 pc Chicken", price: 40, qty: 2 }, { addonId: "a2", name: "Egg", price: 15 }]);
  const [two] = await priceItems([{ menuItemId: "m1", qty: 3, addonIds: ["a1", "a1"] }], MenuItem);
  assert.equal(computeTotals([two], { gstRate: 0 }).total, 540, "(100 + 80) × 3");
});

await test("add-on qty is capped per add-on", async () => {
  await assert.rejects(priceItems([{ menuItemId: "m1", qty: 1, addonIds: Array(11).fill("a1") }], MenuItem), (e) => e.statusCode === 400);
  const [ok] = await priceItems([{ menuItemId: "m1", qty: 1, addonIds: Array(10).fill("a1") }], MenuItem);
  assert.equal(ok.price, 500);
});

await test("an item without add-ons prices EXACTLY as before (no new fields)", async () => {
  const [line] = await priceItems([{ menuItemId: "m2", qty: 3 }], MenuItem);
  assert.deepEqual(Object.keys(line).sort(), ["menuItem", "name", "nameBn", "notes", "price", "qty"]);
  assert.equal(line.price, 20);
  const [plain] = await priceItems([{ menuItemId: "m1", qty: 1, addonIds: [] }], MenuItem);
  assert.equal(plain.price, 100);
  assert.equal(plain.addons, undefined);
});

await test("an add-on that isn't this item's (or was deleted) is refused — no client prices", async () => {
  await assert.rejects(priceItems([{ menuItemId: "m2", qty: 1, addonIds: ["a1"] }], MenuItem), (e) => e.statusCode === 400);
  await assert.rejects(priceItems([{ menuItemId: "m1", qty: 1, addonIds: ["zz"] }], MenuItem), (e) => e.statusCode === 400);
  await assert.rejects(priceItems([{ menuItemId: "m1", qty: 1, addonIds: "a1" }], MenuItem), (e) => e.statusCode === 400);
  const [line] = await priceItems([{ menuItemId: "m1", qty: 1, addonIds: ["a1"], price: 1, addonPrice: 0 }], MenuItem);
  assert.equal(line.price, 140, "a price sent by the client is ignored");
});

await test("normalizeAddons: admin input validated; JSON string ok; ids of existing add-ons kept", () => {
  assert.equal(normalizeAddons(undefined), undefined);
  assert.deepEqual(normalizeAddons(""), []);
  const out = normalizeAddons(JSON.stringify([{ _id: "a1", name: " 1 pc  Chicken ", price: "45" }, { name: "Raita", price: 20 }, { _id: "forged", name: "X", price: 1 }]), [CHICKEN]);
  assert.deepEqual(out, [{ name: "1 pc Chicken", price: 45, _id: "a1" }, { name: "Raita", price: 20 }, { name: "X", price: 1 }]);
  assert.throws(() => normalizeAddons([{ name: "", price: 10 }]), /name/);
  assert.throws(() => normalizeAddons([{ name: "A", price: -1 }]), /Price/);
  assert.throws(() => normalizeAddons([{ name: "A", price: "x" }]), /Price/);
  assert.throws(() => normalizeAddons([{ name: "Egg", price: 1 }, { name: "egg", price: 2 }]), /twice/);
  assert.throws(() => normalizeAddons(Array.from({ length: 11 }, (_, i) => ({ name: `a${i}`, price: 1 }))), /At most/);
  assert.throws(() => normalizeAddons("{bad"), /list/);
});

await test("lineAddonKey: same add-ons in any order → same line; different → different line", () => {
  assert.equal(lineAddonKey([{ addonId: "a2" }, { addonId: "a1" }]), lineAddonKey(["a1", "a2"]));
  assert.notEqual(lineAddonKey([{ addonId: "a1" }]), lineAddonKey([]));
  assert.equal(lineAddonKey([{ addonId: "a1", qty: 2 }]), lineAddonKey(["a1", "a1"]));
  assert.notEqual(lineAddonKey([{ addonId: "a1", qty: 2 }]), lineAddonKey([{ addonId: "a1" }]));
  assert.equal(lineAddonKey(undefined), "");
});

await test("resolveLineAddons: nothing picked → no extra", () => {
  assert.deepEqual(resolveLineAddons(BIRYANI, undefined), { addons: [], extra: 0 });
});

await test("KOT job lists add-on names under the item; plain items unchanged", async () => {
  const rows = [];
  const KOTJob = { create: async ([d]) => { rows.push(d); return [d]; } };
  await createKotJobForOrder({ KOTJob, actor: {}, order: { _id: "o1", orderId: "ORD1", items: [
    { name: "Biryani", qty: 2, price: 140, addons: [{ addonId: "a1", name: "1 pc Chicken", price: 40 }] },
    { name: "Tea", qty: 1, price: 20 },
    { name: "Biryani", qty: 1, price: 180, addons: [{ addonId: "a1", name: "1 pc Chicken", price: 40, qty: 2 }] },
  ] } });
  assert.deepEqual(rows[0].items[0].addons, ["1 pc Chicken"]);
  assert.deepEqual(rows[0].items[2].addons, ["2 x 1 pc Chicken"]);
  assert.equal("addons" in rows[0].items[1], false);
});

await test("combined bill payload carries each line's add-ons", () => {
  const p = combinedPrintPayload({ tableNo: 5, orders: [{ orderId: "O1", total: 280, items: [{ name: "Biryani", qty: 2, price: 140, addons: [{ name: "1 pc Chicken", price: 40 }] }] }] });
  assert.equal(p.items[0].addons[0].name, "1 pc Chicken");
  assert.equal(p.orders[0].items[0].addons[0].price, 40);
  const q = combinedPrintPayload({ tableNo: 5, orders: [{ orderId: "O1", total: 180, items: [{ name: "Biryani", qty: 1, price: 180, addons: [{ name: "1 pc Chicken", price: 40, qty: 2 }] }] }] });
  assert.deepEqual(q.items[0].addons, [{ name: "2 x 1 pc Chicken", price: 40 }]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
