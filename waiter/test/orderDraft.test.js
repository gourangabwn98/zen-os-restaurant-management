// Pure draft state tests: no API, database, socket, or printer imports.
import assert from "node:assert/strict";
import { editLinesOf, stepLineQty, stepLineAddon, stepAddonIds, replaceLineAddons,
  orderItemsPayload, mergeOrderAdditions, draftSubtotal } from "../src/utils/orderDraft.js";

const original = ["less spicy", "no salt"].map((notes) => ({
  menuItem: { _id: "rice" }, name: "Rice", size: "large", qty: 2, price: 125, notes,
  addons: [{ addonId: "egg", name: "Boiled Egg", price: 25 }],
}));
let lines = editLinesOf(original);
const key = lines[0].key;
assert.notEqual(key, lines[1].key);
assert.equal(lines[0].size, "large");
for (const quantity of [2, 3, 2, 1, 0]) {
  lines = stepLineAddon(lines, key, "egg", quantity > lines[0].addonIds.length ? 1 : -1);
  assert.equal(lines[0].addonIds.length, quantity);
  assert.equal(lines[0].addons[0]?.qty || 0, quantity);
  assert.equal(lines[0].price, 100 + quantity * 25);
  assert.equal(draftSubtotal(lines), (100 + quantity * 25) * 2 + 250);
  assert.deepEqual(orderItemsPayload(lines)[0].addonIds, Array(quantity).fill("egg"));
  assert.deepEqual(orderItemsPayload(lines)[1], { menuItemId: "rice", qty: 2, notes: "no salt", addonIds: ["egg"] });
}
assert.deepEqual(stepLineAddon(lines, key, "egg", -1), lines, "zero cannot become negative");
assert.equal(lines[0].qty, 2, "removing an extra keeps its parent");
assert.equal(original[0].price, 125, "never mutate loaded order");
lines = stepLineQty(lines, key, -1);
lines = stepLineQty(lines, key, -1);
assert.equal(lines[0].qty, 1, "parent uses existing minimum one");
assert.equal(lines[1].qty, 2);
lines = stepLineQty(lines, key, 1);
assert.equal(lines[0].qty, 2);
const menu = { price: 100, addons: [{ _id: "egg", name: "Boiled Egg", price: 25 }, { _id: "sauce", name: "Sauce", price: 5 }] };
lines = replaceLineAddons(lines, key, ["egg", "egg", "sauce"], menu);
assert.equal(lines[0].price, 155);
assert.equal(lines[0].key, key, "modifier changes keep identity");
assert.equal(lines[0].notes, "less spicy");
assert.equal(lines[1].price, 125);
assert.equal(draftSubtotal(lines, 30), 590);
let ids = [];
for (let i = 0; i < 15; i++) ids = stepAddonIds(ids, "egg", 1);
assert.equal(ids.length, 10, "functional updates enforce cap during rapid clicks");
const sameNotes = editLinesOf([original[0], original[0]]);
assert.equal(stepLineQty(sameNotes, sameNotes[0].key, 1)[1].qty, 2, "even identical existing rows remain independent");
const merged = mergeOrderAdditions(original, [{ menuItemId: "rice", qty: 1, addonIds: ["egg"] }]);
assert.equal(merged.length, 3, "unnoted additions cannot absorb noted rows");
assert.deepEqual(merged.slice(0, 2), orderItemsPayload(original));
assert.equal(mergeOrderAdditions(merged, [{ menuItemId: "rice", qty: 1, addonIds: ["egg"] }])[2].qty, 2);
assert.equal(mergeOrderAdditions([original[0], original[0]], []).length, 2, "merging does not discard duplicate originals");
console.log("orderDraft.test.js: quantity, zero removal, isolation, payload, pricing, merge and cap assertions passed");
