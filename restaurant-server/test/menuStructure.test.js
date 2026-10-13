// test/menuStructure.test.js — sections → subcategories (GET /api/menu/structure),
// the new item fields' validation and the ?subcategory= filter parsing.
// No DB — fakes.  node test/menuStructure.test.js
import assert from "node:assert/strict";
import {
  buildMenuStructure, readMenuItemFields, parseSubcategoryFilter, escapeRegex,
} from "../services/menuStructureService.js";
import { MENU_SECTIONS, sortBySection } from "../utils/menuSections.js";
import { getMenuStructure } from "../controllers/menuController.js";
import { ensureMenuSections } from "../services/categoryService.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};

const ITEMS = [
  { category: "Breakfast", subcategory: "Eggs", itemId: "BF-005", name: "Boiled Egg" },
  { category: "Breakfast", subcategory: "Bengali Morning", itemId: "BF-001", name: "Aloo Paratha" },
  { category: "Breakfast", subcategory: "Eggs", itemId: "BF-006", name: "Egg Bhujia" },
  { category: "Counter", subcategory: "Cigarettes", itemId: "CT-001", name: "Cigarette 1" },
  { category: "Breakfast", subcategory: "", itemId: "BF-099", name: "Loose item" },
  { category: "Old Snacks", subcategory: "", name: "Legacy Samosa" },
];

await test("structure: every configured section, in config order; subcategories with counts in menu order", () => {
  const { sections } = buildMenuStructure(ITEMS);
  assert.deepEqual(sections.slice(0, MENU_SECTIONS.length).map((s) => s.name), MENU_SECTIONS);
  const bf = sections.find((s) => s.name === "Breakfast");
  assert.equal(bf.count, 4);
  assert.deepEqual(bf.subcategories, [{ name: "Bengali Morning", count: 1 }, { name: "Eggs", count: 2 }], "BF-001 before BF-005; no-subcategory items only in All");
  assert.deepEqual(sections.find((s) => s.name === "Starters"), { name: "Starters", count: 0, subcategories: [] });
});

await test("structure: an unknown (old) category that still has items is listed after the configured ones", () => {
  const { sections } = buildMenuStructure(ITEMS);
  assert.equal(sections.at(-1).name, "Old Snacks");
  assert.equal(sections.length, MENU_SECTIONS.length + 1);
  assert.equal(buildMenuStructure([]).sections.length, MENU_SECTIONS.length);
});

await test("GET /menu/structure: customers see only available items outside scheduled-out sections", async () => {
  let seenFilter;
  const models = {
    RestaurantProfile: { findOne: () => ({ select: () => ({ lean: async () => ({ timezone: "Asia/Kolkata" }) }) }) },
    Category: { find: () => ({ select: () => ({ lean: async () => [{ name: "Counter", schedule: { enabled: true, startTime: "00:00", endTime: "00:01", days: [], startDate: "", endDate: "" } }] }) }) },
    MenuItem: {
      updateMany: async () => ({ modifiedCount: 0 }),
      find: (f) => { seenFilter = f; return { select: () => ({ lean: async () => ITEMS.filter((i) => !f.category?.$nin?.includes(i.category)) }) }; },
    },
  };
  let body, status = 200;
  const res = { json: (b) => { body = b; return res; }, status: (s) => { status = s; return res; } };
  await getMenuStructure({ models, query: {}, user: null }, res);
  assert.equal(status, 200);
  assert.equal(seenFilter.isAvailable, true);
  // Counter is scheduled to 00:00–00:01 — hidden unless the test runs in that minute.
  if (seenFilter.category) assert.deepEqual(seenFilter.category, { $nin: ["Counter"] });
  assert.ok(Array.isArray(body.sections) && body.sections[0].name === "Breakfast");

  await getMenuStructure({ models, query: { includeUnavailable: "true" }, user: { role: "admin", isAdmin: true } }, res);
  assert.deepEqual(seenFilter, {}, "admin manage view counts every item");
  await getMenuStructure({ models, query: { includeUnavailable: "true" }, user: null }, res);
  assert.equal(seenFilter.isAvailable, true, "a customer can't ask for hidden items");
});

await test("item fields: subcategory / size / foodType validated; only sent fields returned", () => {
  assert.deepEqual(readMenuItemFields({}), {});
  assert.deepEqual(readMenuItemFields({ subcategory: "  Small   River Fish ", size: " 2 pcs ", foodType: "Egg" }),
    { subcategory: "Small River Fish", size: "2 pcs", foodType: "Egg" });
  assert.deepEqual(readMenuItemFields({ subcategory: "", foodType: "" }), { subcategory: "", foodType: "" }, "\"\" clears");
  assert.throws(() => readMenuItemFields({ foodType: "Vegan" }), (e) => e.statusCode === 400);
  assert.throws(() => readMenuItemFields({ foodType: "Non Veg" }), (e) => e.statusCode === 400, "foodType uses Non-veg, tag uses Non Veg");
  assert.throws(() => readMenuItemFields({ subcategory: "x".repeat(41) }), (e) => e.statusCode === 400);
  assert.throws(() => readMenuItemFields({ size: "x".repeat(31) }), (e) => e.statusCode === 400);
});

await test("?subcategory=: one name or a comma list (multi-select chips), trimmed and deduped", () => {
  assert.deepEqual(parseSubcategoryFilter(undefined), []);
  assert.deepEqual(parseSubcategoryFilter(""), []);
  assert.deepEqual(parseSubcategoryFilter("Eggs"), ["Eggs"]);
  assert.deepEqual(parseSubcategoryFilter(" Eggs, Toast ,Eggs,"), ["Eggs", "Toast"]);
  assert.deepEqual(parseSubcategoryFilter(["Paneer", "Veg"]), ["Paneer", "Veg"]);
});

await test("search text is matched literally (no regex injection / 500 on \"(\")", () => {
  assert.equal(escapeRegex("Chicken (3 pcs)"), "Chicken \\(3 pcs\\)");
  assert.ok(new RegExp(escapeRegex("a.*(")).test("xa.*(y"));
});

await test("sortBySection: configured order first, others keep their order after", () => {
  assert.deepEqual(sortBySection(["Zed", "Counter", "Khoai Signature", "Breakfast"]), ["Breakfast", "Counter", "Zed", "Khoai Signature"]);
});

await test("sections: every configured section gets a Category record; a case-only match is renamed (keeps its schedule); old ones stay", async () => {
  const cats = [
    { _id: "c1", name: "BreakFast", schedule: { enabled: true, startTime: "08:00", endTime: "11:00" } },
    { _id: "c2", name: "Rice", kind: "MANUAL" },
    { _id: "c3", name: "Lunch", kind: "MANUAL" },
    { _id: "s1", name: "Khoai Signature", kind: "SMART" },
  ];
  const items = [{ category: "BreakFast" }, { category: "Breakfast" }];
  const models = {
    Category: {
      find: () => ({ select: () => ({ lean: async () => cats.map((c) => ({ ...c })) }) }),
      updateOne: async ({ _id, name }, { $set }) => { const c = cats.find((x) => x._id === _id && x.name === name); if (c) Object.assign(c, $set); },
      create: async (doc) => {
        if (cats.some((c) => c.name === doc.name)) throw Object.assign(new Error("dup"), { code: 11000 });
        cats.push({ _id: `n${cats.length}`, ...doc });
      },
    },
    MenuItem: { updateMany: async (f, u) => { for (const i of items) if (i.category === f.category) Object.assign(i, u.$set); } },
  };
  const r = await ensureMenuSections({ models, force: true });
  assert.deepEqual(r.renamed, [["BreakFast", "Breakfast"]]);
  assert.equal(r.created.length, MENU_SECTIONS.length - 2, "Breakfast renamed, Rice already there");
  assert.equal(cats.find((c) => c._id === "c1").schedule.startTime, "08:00", "the renamed record keeps its time window");
  assert.ok(items.every((i) => i.category === "Breakfast"));
  assert.ok(cats.some((c) => c.name === "Lunch"), "old categories are never deleted here");
  for (const n of MENU_SECTIONS) assert.equal(cats.filter((c) => c.name === n).length, 1, n);
  assert.deepEqual(await ensureMenuSections({ models, force: true }), { created: [], renamed: [] }, "second run changes nothing");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
