// Offline regression: raw/legacy menu records must have the same selectable
// add-on identity as hydrated pricing records. No database connection.
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { getModels } from "../config/getModels.js";
import { resolveLineAddons, menuAddonRecords, normalizeAddons } from "../utils/menuAddons.js";
import { priceItems, computeTotals } from "../utils/pricing.js";
import { addonIdsOf, stepAddonIds, stepLineAddon, replaceLineAddons, cartLineKey, unitPrice } from "../../admin/src/pages/admin/shared/addons.js";
import { diffOrderLines, createKotJobForOrder } from "../services/kotService.js";
import { combinedPrintPayload } from "../services/combinedBillService.js";

const { MenuItem } = getModels(mongoose.createConnection());
const raw = {
  _id: new mongoose.Types.ObjectId(), name: "Boiled Egg", price: 50,
  category: "Breakfast", tag: "Non Veg", isAvailable: true,
  addons: [{ name: "Extra Egg", price: 25, type: "Extra egg" }],
};
const hydrate = () => MenuItem.hydrate({ ...raw, addons: raw.addons.map((a) => ({ ...a })) });
const first = hydrate();
const second = hydrate();
assert.equal(String(first.addons[0]._id), String(second.addons[0]._id), "legacy add-on IDs must survive a fresh read");
assert.equal(resolveLineAddons(second, [String(first.addons[0]._id)]).extra, 25);
console.log("PASS: legacy add-on identity survives separate reads");

const menu = { ...raw, addons: menuAddonRecords(raw) };
const id = String(menu.addons[0]._id);
assert.equal(id, String(first.addons[0]._id), "lean menu and pricing identities agree");
assert.equal(raw.addons[0]._id, undefined, "read compatibility never mutates the raw record");
assert.equal(menuAddonRecords({ ...menu, price: 60, addons: [{ ...menu.addons[0], price: 30 }] })[0]._id, id);
assert.notEqual(menuAddonRecords({ ...raw, _id: new mongoose.Types.ObjectId() })[0]._id, id, "IDs are scoped to the menu item");
assert.throws(() => resolveLineAddons(second, [String(raw._id)]), /removed or disabled/, "a menu item ID is not an add-on ID");
assert.throws(() => resolveLineAddons({ ...menu, addons: [{ ...menu.addons[0], isAvailable: false }] }, [id]), /disabled/);
assert.throws(() => resolveLineAddons({ ...menu, addons: [] }, [id]), /removed/);
assert.equal(normalizeAddons([{ ...menu.addons[0], price: 30 }], menu.addons)[0]._id, id);
assert.equal(normalizeAddons([{ ...menu.addons[0], isAvailable: false }], menu.addons)[0].isAvailable, false);
assert.throws(() => normalizeAddons([{ ...menu.addons[0] }, { ...menu.addons[0], name: "Different name" }], menu.addons), /ID is listed twice/);

let ids = [];
for (const qty of [1, 2, 3]) {
  ids = stepAddonIds(ids, id, 1);
  assert.equal(ids.length, qty);
  const line = (await priceItems([{ menuItemId: String(raw._id), qty: 2, addonIds: ids }], { findById: async () => hydrate() }))[0];
  assert.equal(line.addons.length, 1, "repeated picks never create duplicate snapshots");
  assert.equal(line.price, 50 + 25 * qty);
  assert.equal(unitPrice(menu, ids), line.price);
  assert.equal(computeTotals([line], { gstRate: 0 }).total, (50 + 25 * qty) * 2);
}
for (const qty of [2, 1, 0]) { ids = stepAddonIds(ids, id, -1); assert.equal(ids.length, qty); }
assert.deepEqual(stepAddonIds(ids, id, -1), [], "cannot become negative");
assert.equal(stepAddonIds(Array(10).fill(id), id, 1).length, 10, "rapid updates obey the cap");

const [priced] = await priceItems([{ menuItemId: String(raw._id), qty: 1, addonIds: [id, id, id] }], { findById: async () => hydrate() });
const { Order } = getModels(mongoose.createConnection());
const saved = new Order({ items: [priced] }).toObject();
const reloaded = Order.hydrate(saved).toObject().items[0];
assert.deepEqual(addonIdsOf(reloaded), [id, id, id], "schema serialization/reload retains qty and identity");
let lines = [{ ...reloaded, menuItemId: String(raw._id), key: cartLineKey(raw._id, addonIdsOf(reloaded)), addonIds: addonIdsOf(reloaded) }];
const before = lines[0];
lines = stepLineAddon(lines, before.key, id, -1);
assert.equal(lines[0].price, 100);
assert.equal(lines[0].addons[0].qty, 2);
assert.equal(diffOrderLines([before], lines).added.length, 1, "kitchen gets a changed variant");
const bill = combinedPrintPayload({ orders: [{ orderId: "TEST", items: lines, total: 100 }] });
assert.equal(bill.items[0].addons[0].name, "2 x Extra Egg");
const jobs = [];
await createKotJobForOrder({ KOTJob: { create: async ([job]) => { jobs.push(job); return [job]; } }, actor: {}, order: { _id: "test", items: lines } });
assert.deepEqual(jobs[0].items[0].addons, ["2 x Extra Egg"]);
for (let n = 2; n > 0; n--) lines = stepLineAddon(lines, lines[0].key, id, -1);
assert.equal(lines[0].price, 50);
assert.deepEqual(lines[0].addons, []);
assert.deepEqual(lines[0].addonIds, []);
lines = replaceLineAddons(lines, lines[0].key, [id], menu);
assert.equal(lines[0].price, 75, "removed extra can be selected again");
const plain = { item: menu, key: cartLineKey(raw._id, []), qty: 2, addonIds: [] };
const extra = { item: menu, key: cartLineKey(raw._id, [id]), qty: 1, addonIds: [id] };
const merged = stepLineAddon([plain, extra], extra.key, id, -1);
assert.equal(merged.length, 1); assert.equal(merged[0].qty, 3);
assert.equal(plain.qty, 2, "updates don't mutate previous state");
const withNotes = [
  { ...plain, notes: "No salt", key: cartLineKey(raw._id, [], "No salt") },
  { ...extra, notes: "Spicy", key: cartLineKey(raw._id, [id], "Spicy") },
];
const keptNotes = stepLineAddon(withNotes, withNotes[1].key, id, -1);
assert.equal(keptNotes.length, 2, "different kitchen notes must not be merged");
assert.notEqual(keptNotes[0].key, keptNotes[1].key, "editable variants retain unique React keys");
console.log("PASS: quantities, removal, caps, totals, schema reload, edits, KOT/bill payloads, duplicate merging and availability validation");
