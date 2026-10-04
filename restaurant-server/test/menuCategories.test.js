// test/menuCategories.test.js
// ─────────────────────────────────────────────────────────────────────────────
// MNU-01 one item / many categories, MNU-03/04/05 flags, MNU-06 icons,
// MNU-07 data-driven smart categories (utils/menuCategories.js — pure).
//   node test/menuCategories.test.js
// ─────────────────────────────────────────────────────────────────────────────
import assert from "node:assert/strict";
import {
  itemCategoryList, cleanExtraCategories, categoryIcon, topIds, highestRatedIds, parseFlag,
  SMART_CATEGORIES, SMART_DATA_RULES,
} from "../utils/menuCategories.js";

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
};

const smartCats = SMART_CATEGORIES.map((c) => ({ name: c.name, smartKey: c.key }));
const tea = { _id: "t1", name: "Tea", price: 15, category: "Chai", categories: ["Breakfast"], isFastAvailable: true, isChefsPick: true, isTodaysSpecial: true };

test("MNU-01: one Tea document is listed under Chai + its extra + every flag category — once each", () => {
  const list = itemCategoryList({ ...tea, categories: ["Breakfast", "Chai", "Breakfast"] }, { smartCats });
  assert.deepEqual(list, ["Chai", "Breakfast", "Today's Special", "Chef's Picks", "Fast Available"]);
});

test("MNU-03/04/05: flags off → not in the flag categories", () => {
  const list = itemCategoryList({ ...tea, isFastAvailable: false, isChefsPick: false, isTodaysSpecial: false }, { smartCats });
  assert.deepEqual(list, ["Chai", "Breakfast"]);
});

test("MNU-07: data categories only from the computed sets", () => {
  const dataSets = new Map([["MOST_ORDERED", new Set(["t1"])], ["HIGHEST_RATED", new Set()], ["SALES_CHOICE", new Set(["x"])]]);
  const list = itemCategoryList({ _id: "t1", category: "Chai" }, { smartCats, dataSets });
  assert.deepEqual(list, ["Chai", "Most Ordered"]);
});

test("a scheduled-out extra category is not listed (the item still shows elsewhere)", () => {
  const list = itemCategoryList({ _id: "t1", category: "Chai", categories: ["Breakfast"] }, { smartCats, hidden: new Set(["Breakfast"]) });
  assert.deepEqual(list, ["Chai"]);
});

test("extra categories: existing manual names only, primary dropped, deduped; JSON string accepted", () => {
  const manualNames = new Set(["Chai", "Breakfast", "Snacks"]);
  assert.deepEqual(cleanExtraCategories('["Breakfast","Chai"," Breakfast ","Snacks"]', { primary: "Chai", manualNames }), ["Breakfast", "Snacks"]);
  assert.deepEqual(cleanExtraCategories("", { primary: "Chai", manualNames }), []);
  assert.throws(() => cleanExtraCategories(["Chef's Picks"], { primary: "Chai", manualNames }), (e) => e.statusCode === 400);
});

test("flags parse from multipart strings; absent stays undefined (not changed)", () => {
  assert.equal(parseFlag("true"), true);
  assert.equal(parseFlag("false"), false);
  assert.equal(parseFlag(undefined), undefined);
  assert.equal(parseFlag(""), undefined);
});

test("MNU-07: Most Ordered / Sales top-N ignore zero rows and rank by value", () => {
  const ids = topIds([{ _id: "a", value: 3 }, { _id: "b", value: 9 }, { _id: "c", value: 0 }], 2);
  assert.deepEqual([...ids], ["b", "a"]);
  assert.equal(topIds([]).size, 0, "no sales → empty, never invented");
});

test("MNU-07: Highest Rated needs enough real ratings and a high average", () => {
  const ids = highestRatedIds([
    { _id: "few", n: SMART_DATA_RULES.minRatings - 1, avg: 5 },
    { _id: "good", n: 5, avg: 4.6 },
    { _id: "low", n: 9, avg: 3.2 },
    { _id: "best", n: 4, avg: 4.9 },
  ]);
  assert.deepEqual([...ids], ["best", "good"]);
});

test("MNU-06: icon = own pick → smart default → guessed from the name → plate; never an emoji", () => {
  assert.equal(categoryIcon({ name: "Anything", icon: "fish" }), "fish");
  assert.equal(categoryIcon({ name: "Chef's Picks", smartKey: "CHEFS_PICKS" }), "chef");
  assert.equal(categoryIcon({ name: "Masala Chai" }), "tea");
  assert.equal(categoryIcon({ name: "Fish Curry" }), "fish");
  assert.equal(categoryIcon({ name: "Zzz" }), "plate");
  assert.equal(categoryIcon({ name: "x", icon: "🍔" }), "plate");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
