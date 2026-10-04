// test/menuCategories.test.js — MNU-01/03–07 admin helpers (menu/menuKit.js, pure).
//   node test/menuCategories.test.js
import assert from "node:assert/strict";
import { memberNames, findCleanup, CATEGORY_ICON_KEYS, ITEM_FLAGS } from "../src/pages/admin/menu/menuKit.js";
import { CATEGORY_ICONS, ITEM_FLAGS as SERVER_FLAGS } from "../../restaurant-server/utils/menuCategories.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };

const cats = [
  { _id: "1", name: "Biryani" },
  { _id: "2", name: "Rice" },
  { _id: "3", name: "Chef's Picks", kind: "SMART", smartFlag: "isChefsPick" },
  { _id: "4", name: "Most Ordered", kind: "SMART", smartFlag: null },
];

test("icon keys match the server's list", () => {
  assert.deepEqual(CATEGORY_ICON_KEYS, CATEGORY_ICONS);
});
test("item flags match the server's", () => {
  assert.deepEqual(ITEM_FLAGS.map((f) => f.flag).sort(), [...SERVER_FLAGS].sort());
});
test("an item is in its primary, extra, flagged and server-computed categories", () => {
  const item = { category: "Biryani", categories: ["Rice"], isChefsPick: true, categoryList: ["Biryani", "Most Ordered"] };
  assert.deepEqual([...memberNames(item, cats)].sort(), ["Biryani", "Chef's Picks", "Most Ordered", "Rice"]);
});
test("a flag switched off locally wins over a stale categoryList", () => {
  const item = { category: "Biryani", isChefsPick: false, categoryList: ["Biryani", "Chef's Picks"] };
  assert.deepEqual([...memberNames(item, cats)], ["Biryani"]);
});
test("built-in categories are never offered for cleanup, even when empty", () => {
  const out = findCleanup(cats, () => 0);
  assert.deepEqual(out.map((x) => x.cat.name).sort(), ["Biryani", "Rice"]);
});

console.log(`\n${passed} passed`);
