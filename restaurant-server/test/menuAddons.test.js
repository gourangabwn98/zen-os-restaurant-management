// test/menuAddons.test.js — KH-12: per-item add-ons, priced server-side.
// No DB — fakes.  node test/menuAddons.test.js
import assert from "node:assert/strict";
import { normalizeAddons, resolveLineAddons, lineAddonKey, nameWithSize, ADDONS_MAX } from "../utils/menuAddons.js";
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

await test("normalizeAddons: admin input validated; JSON string ok; id of an existing add-on kept", () => {
  assert.equal(normalizeAddons(undefined), undefined);
  assert.deepEqual(normalizeAddons(""), []);
  assert.deepEqual(normalizeAddons(JSON.stringify([{ _id: "a1", name: " 1 pc  Chicken ", price: "45" }]), [CHICKEN]), [{ name: "1 pc Chicken", price: 45, _id: "a1" }]);
  assert.deepEqual(normalizeAddons([{ _id: "forged", name: "X", price: 1 }], [CHICKEN]), [{ name: "X", price: 1 }], "an unknown id is dropped");
  assert.throws(() => normalizeAddons([{ name: "", price: 10 }]), /name/);
  assert.throws(() => normalizeAddons([{ name: "A", price: -1 }]), /Price/);
  assert.throws(() => normalizeAddons([{ name: "A", price: "x" }]), /Price/);
  assert.throws(() => normalizeAddons("{bad"), /list/);
});

await test("add-on validation: at most ONE add-on per item; price >= 0; free (₹0) is allowed", () => {
  assert.equal(ADDONS_MAX, 1);
  assert.throws(() => normalizeAddons([{ name: "Egg", price: 25 }, { name: "Butter", price: 10 }]), (e) => e.statusCode === 400 && /At most 1/.test(e.message));
  assert.deepEqual(normalizeAddons([{ name: "Onion", price: 0 }]), [{ name: "Onion", price: 0 }]);
  assert.throws(() => normalizeAddons([{ name: "Egg", price: -0.5 }]), (e) => e.statusCode === 400);
});

await test("add-on validation: type is optional, but only Extra egg / Extra piece / Butter", () => {
  assert.deepEqual(normalizeAddons([{ name: "Extra Egg", price: 25, type: "Extra egg" }]), [{ name: "Extra Egg", price: 25, type: "Extra egg" }]);
  assert.deepEqual(normalizeAddons([{ name: "Add Butter", price: 10, type: "" }]), [{ name: "Add Butter", price: 10 }]);
  assert.throws(() => normalizeAddons([{ name: "Cheese", price: 30, type: "Cheese" }]), (e) => e.statusCode === 400 && /type/.test(e.message));
});

await test("schema: the MenuItem model refuses a second add-on even if a caller skips normalizeAddons", async () => {
  const { default: mongoose } = await import("mongoose");
  const { getModels } = await import("../config/getModels.js");
  const { MenuItem } = getModels(mongoose.createConnection());
  const doc = new MenuItem({ name: "Egg Curry", price: 90, category: "Main Course", tag: "Non Veg",
    addons: [{ name: "Extra Egg", price: 25, type: "Extra egg" }, { name: "Butter", price: 10, type: "Butter" }] });
  const check = (d) => d.validate().then(() => undefined, (e) => e);
  const err = await check(doc);
  assert.ok(err?.errors?.addons, "two add-ons fail validation");
  const one = new MenuItem({ name: "Egg Curry", price: 90, category: "Main Course", tag: "Non Veg", foodType: "Egg", subcategory: "Egg", size: "2 pcs",
    addons: [{ name: "Extra Egg", price: 25, type: "Extra egg" }] });
  assert.equal(await check(one), undefined);
  const bad = new MenuItem({ name: "X", price: 1, category: "Counter", tag: "Others", foodType: "Vegan", addons: [{ name: "a", price: 1, type: "Nope" }] });
  const e2 = await check(bad);
  assert.ok(e2.errors.foodType && e2.errors["addons.0.type"]);
});

await test("line total = (item price + add-on price) × qty, computed by the server; type snapshotted", async () => {
  const KOSHA = { _id: "m3", name: "Chicken Kosha (3 pcs)", size: "3 pcs", price: 180, isAvailable: true,
    addons: [{ _id: "x1", name: "Extra piece", price: 70, type: "Extra piece" }] };
  const M = { findById: async (id) => (id === "m3" ? KOSHA : null) };
  const [line] = await priceItems([{ menuItemId: "m3", qty: 3, addonIds: ["x1"], price: 1, lineTotal: 1 }], M);
  assert.equal(line.price, 250);
  assert.equal(line.price * line.qty, 750);
  assert.deepEqual(line.addons, [{ addonId: "x1", name: "Extra piece", price: 70, type: "Extra piece" }]);
  assert.equal(line.size, "3 pcs", "portion snapshotted for tickets");
  const [plain] = await priceItems([{ menuItemId: "m3", qty: 2 }], M);
  assert.equal(plain.price * plain.qty, 360, "the add-on is optional");
  assert.equal(computeTotals([line, plain], { gstRate: 5 }).subtotal, 1110);
});

await test("nameWithSize: adds the portion unless the name already says it", () => {
  assert.equal(nameWithSize("Chicken Kosha (3 pcs)", "3 pcs"), "Chicken Kosha (3 pcs)");
  assert.equal(nameWithSize("Boiled Egg", "2 pcs"), "Boiled Egg (2 pcs)");
  assert.equal(nameWithSize("Tea", ""), "Tea");
  assert.equal(nameWithSize("Afgani Chicken (Full)", "full"), "Afgani Chicken (Full)");
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
    { name: "Boiled Egg", size: "2 pcs", qty: 1, price: 75, addons: [{ addonId: "e1", name: "Extra Egg", price: 25, type: "Extra egg" }] },
  ] } });
  assert.deepEqual(rows[0].items[0].addons, ["1 pc Chicken"]);
  assert.equal(rows[0].items[3].name, "Boiled Egg (2 pcs)", "size printed with the name");
  assert.deepEqual(rows[0].items[3].addons, ["Extra Egg"], "the KOT is the kitchen copy — add-on names, no prices");
  assert.deepEqual(rows[0].items[2].addons, ["2 x 1 pc Chicken"]);
  assert.equal("addons" in rows[0].items[1], false);
});

await test("kitchen feed (GET /kitchen/orders): name with size + add-on names, never a price", async () => {
  const { getKitchenOrders } = await import("../controllers/kitchenController.js");
  const order = { _id: "o1", orderId: "ORD1", status: "PREPARING", total: 250, paymentStatus: "PAID", items: [
    { name: "Boiled Egg", size: "2 pcs", qty: 1, price: 75, basePrice: 50, addons: [{ addonId: "e1", name: "Extra Egg", price: 25 }] },
    { name: "Tea", qty: 2, price: 20 },
  ] };
  const Order = { find: () => ({ sort: () => ({ select: async () => [order] }) }) };
  let body;
  await getKitchenOrders({ models: { Order } }, { json: (b) => { body = b; }, status: () => ({ json: () => {} }) });
  const [ticket] = body.orders;
  assert.deepEqual(ticket.items[0], { name: "Boiled Egg (2 pcs)", qty: 1, notes: "", addons: ["Extra Egg"] });
  assert.deepEqual(ticket.items[1], { name: "Tea", qty: 2, notes: "" });
  assert.ok(!JSON.stringify(ticket).includes("price") && ticket.total === undefined);
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
