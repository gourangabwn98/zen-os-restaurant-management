// test/categoryService.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Menu categories (services/categoryService.js): case-insensitive unique
// names, rename moves the category's items in the same transaction, delete is
// refused while items still use the category. No DB — fake models. Run with:
//   node test/categoryService.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import {
  normalizeCategoryName, listCategoriesWithCounts, createCategory, updateCategory, deleteCategory,
} from "../services/categoryService.js";
import { _resetSmartCache } from "../services/smartCategoryService.js";

let passed = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
};

const lean = (v) => ({ lean: async () => v, select: () => ({ lean: async () => v }), sort: () => lean(v) });

/** Fake Category/MenuItem + a db whose transactions record the session used. */
const fakeWorld = ({ cats = [], items = [], failItemUpdate = false } = {}) => {
  const state = { cats: cats.map((c) => ({ ...c })), items: items.map((i) => ({ ...i })), txCommitted: 0, txWrites: [] };
  const nameMatch = (c, f) => {
    if (f.name?.$regex) return new RegExp(f.name.$regex, f.name.$options).test(c.name);
    return f.name === undefined || c.name === f.name;
  };
  const idMatch = (c, f) => (f._id === undefined ? true : f._id?.$ne !== undefined ? c._id !== f._id.$ne : c._id === f._id);
  const keyMatch = (c, f) => (f.smartKey === undefined ? true : c.smartKey === f.smartKey);
  // MNU-01: { category: X } | { categories: X } | { $or: [...] } | { flag: true }
  const itemMatch = (i, f) => Object.entries(f).every(([k, v]) =>
    k === "$or" ? v.some((g) => itemMatch(i, g))
    : k === "categories" ? (i.categories || []).includes(v)
    : i[k] === v);
  const Category = {
    findById: (id) => {
      const found = state.cats.find((x) => x._id === id);
      const c = found ? { ...found } : null; // a separate document, like Mongoose
      const p = Promise.resolve(c);
      p.select = () => lean(c && { ...c });
      return p;
    },
    findOne: (f = {}) => lean(state.cats.find((c) => nameMatch(c, f) && idMatch(c, f) && keyMatch(c, f)) || null),
    updateOne: async ({ _id }, u) => { Object.assign(state.cats.find((c) => c._id === _id), u.$set); },
    find: () => ({ sort: () => ({ lean: async () => [...state.cats].sort((a, b) => a.name.localeCompare(b.name)) }) }),
    create: async (doc) => { const row = { _id: `c${state.cats.length + 1}`, ...doc }; state.cats.push(row); return row; },
    findByIdAndUpdate: async (id, u) => { const c = state.cats.find((x) => x._id === id); Object.assign(c, u.$set); return { ...c }; },
    findOneAndUpdate: async (f, u, opts) => {
      if (opts?.session) state.txWrites.push("category");
      const c = state.cats.find((x) => x._id === f._id && x.name === f.name);
      if (!c) return null;
      opts?.session?.stage(() => Object.assign(c, u.$set));
      return { ...c, ...u.$set };
    },
    deleteOne: async ({ _id }) => { state.cats = state.cats.filter((c) => c._id !== _id); },
  };
  const MenuItem = {
    aggregate: async (pipeline) => {
      const m = new Map();
      const extras = pipeline[0]?.$unwind === "$categories";
      for (const i of state.items) for (const c of extras ? (i.categories || []) : [i.category]) m.set(c, (m.get(c) || 0) + 1);
      return [...m].map(([_id, n]) => ({ _id, n }));
    },
    countDocuments: async (f) => state.items.filter((i) => itemMatch(i, f)).length,
    updateMany: async (f, u, opts) => {
      if (opts?.session) state.txWrites.push("items");
      if (failItemUpdate) throw new Error("write conflict");
      const hit = state.items.filter((i) => itemMatch(i, f));
      const apply = (i) => {
        for (const [k, v] of Object.entries(u.$set || {})) {
          if (k === "categories.$[c]") i.categories = i.categories.map((c) => (c === opts.arrayFilters[0].c ? v : c));
          else i[k] = v;
        }
        if (u.$addToSet) i.categories = [...new Set([...(i.categories || []), u.$addToSet.categories])];
        if (u.$pull) i.categories = (i.categories || []).filter((c) => c !== u.$pull.categories);
      };
      if (opts?.session) opts.session.stage(() => hit.forEach(apply)); else hit.forEach(apply);
      return { modifiedCount: hit.length };
    },
  };
  // Smart-category data sets read revenue orders / food ratings — none here.
  const Order = { aggregate: async () => [], find: () => ({ select: () => ({ lean: async () => [] }) }) };
  // Writes made with a session are staged and only applied if the
  // transaction callback resolves — mimicking commit/rollback.
  const db = {
    startSession: async () => {
      let staged = [];
      return {
        stage: (fn) => staged.push(fn),
        withTransaction: async (fn) => { staged = []; await fn(); staged.forEach((f) => f()); state.txCommitted++; },
        endSession: async () => {},
      };
    },
  };
  _resetSmartCache();
  return { state, models: { Category, MenuItem, Order }, db };
};

await test("name: trimmed, inner spaces collapsed; empty/too long rejected", () => {
  assert.equal(normalizeCategoryName("  Main   Course "), "Main Course");
  assert.throws(() => normalizeCategoryName("   "), (e) => e.statusCode === 400);
  assert.throws(() => normalizeCategoryName("x".repeat(41)), (e) => e.statusCode === 400);
});

await test("list: every category with its item count (primary + extra listings, MNU-01)", async () => {
  const { models } = fakeWorld({
    cats: [{ _id: "c1", name: "Pizza" }, { _id: "c2", name: "Drinks" }],
    items: [{ category: "Pizza" }, { category: "Pizza", categories: ["Drinks"] }],
  });
  const rows = await listCategoriesWithCounts({ models });
  const count = (n) => rows.find((r) => r.name === n)?.itemCount;
  assert.equal(count("Pizza"), 2);
  assert.equal(count("Drinks"), 1, "the extra listing counts, the item is still one document");
});

await test("list: built-in smart categories exist once; counts come from flags / real data (MNU-03/04/05/07)", async () => {
  const { models, state } = fakeWorld({
    cats: [{ _id: "c1", name: "Chai" }],
    items: [{ category: "Chai", isChefsPick: true }, { category: "Chai", isFastAvailable: true }],
  });
  const rows = await listCategoriesWithCounts({ models });
  await listCategoriesWithCounts({ models }); // idempotent
  assert.equal(state.cats.filter((c) => c.kind === "SMART").length, 6);
  const count = (n) => rows.find((r) => r.name === n)?.itemCount;
  assert.equal(count("Chef's Picks"), 1);
  assert.equal(count("Fast Available"), 1);
  assert.equal(count("Most Ordered"), 0, "no sales yet → empty, never invented");
});

await test("smart: a hand-made \"Chef's Picks\" is adopted, not duplicated — its items get the flag", async () => {
  const { models, state } = fakeWorld({
    cats: [{ _id: "c1", name: "chef's picks" }, { _id: "c2", name: "Chai" }],
    items: [{ name: "Tea", category: "Chai", categories: ["chef's picks"] }],
  });
  await listCategoriesWithCounts({ models });
  const adopted = state.cats.filter((c) => /chef's picks/i.test(c.name));
  assert.equal(adopted.length, 1);
  assert.equal(adopted[0].smartKey, "CHEFS_PICKS");
  assert.equal(state.items[0].isChefsPick, true);
});

await test("smart: built-in categories can't be renamed or deleted", async () => {
  const { models, db } = fakeWorld({ cats: [{ _id: "s1", name: "Fast Available", kind: "SMART", smartKey: "FAST_AVAILABLE" }] });
  await assert.rejects(updateCategory({ models, db, id: "s1", name: "Quick" }), (e) => e.statusCode === 400 && /built-in/.test(e.message));
  await assert.rejects(deleteCategory({ models, id: "s1" }), (e) => e.statusCode === 400);
  await updateCategory({ models, db, id: "s1", nameBn: "দ্রুত", icon: "bolt" }); // Bengali name / icon are fine
});

await test("create: duplicate name is refused case-insensitively (409)", async () => {
  const { models, state } = fakeWorld({ cats: [{ _id: "c1", name: "Pizza" }] });
  await assert.rejects(createCategory({ models, name: " pizza " }), (e) => e.statusCode === 409);
  const made = await createCategory({ models, name: "Burgers", image: "https://x/y.png" });
  assert.equal(made.name, "Burgers");
  assert.equal(state.cats.length, 2);
});

await test("create: a name with regex characters is matched literally", async () => {
  const { models } = fakeWorld({ cats: [{ _id: "c1", name: "Pizza" }] });
  const made = await createCategory({ models, name: "Pizz." }); // must not match "Pizza"
  assert.equal(made.name, "Pizz.");
});

await test("rename: category and all its items move together in one transaction", async () => {
  const { models, db, state } = fakeWorld({
    cats: [{ _id: "c1", name: "Starters" }],
    items: [{ category: "Starters" }, { category: "Starters" }, { category: "Mains" }],
  });
  const r = await updateCategory({ models, db, id: "c1", name: "Appetizers" });
  assert.equal(r.renamedFrom, "Starters");
  assert.equal(r.itemsMoved, 2);
  assert.equal(state.cats[0].name, "Appetizers");
  assert.deepEqual(state.items.map((i) => i.category), ["Appetizers", "Appetizers", "Mains"]);
  assert.equal(state.txCommitted, 1);
  assert.deepEqual(state.txWrites, ["category", "items", "items"], "every write used the transaction session");
});

await test("rename: items listing it as an EXTRA category follow too (MNU-01)", async () => {
  const { models, db, state } = fakeWorld({
    cats: [{ _id: "c1", name: "Specials" }],
    items: [{ name: "Tea", category: "Chai", categories: ["Specials"] }],
  });
  await updateCategory({ models, db, id: "c1", name: "House Specials" });
  assert.deepEqual(state.items[0].categories, ["House Specials"]);
  assert.equal(state.items[0].category, "Chai");
});

await test("rename: if moving the items fails, the category keeps its old name", async () => {
  const { models, db, state } = fakeWorld({
    cats: [{ _id: "c1", name: "Starters" }], items: [{ category: "Starters" }], failItemUpdate: true,
  });
  await assert.rejects(updateCategory({ models, db, id: "c1", name: "Appetizers" }));
  assert.equal(state.cats[0].name, "Starters");
  assert.equal(state.items[0].category, "Starters");
});

await test("rename: to another category's name (any case) is refused (409)", async () => {
  const { models, db } = fakeWorld({ cats: [{ _id: "c1", name: "Starters" }, { _id: "c2", name: "Mains" }] });
  await assert.rejects(updateCategory({ models, db, id: "c1", name: "MAINS" }), (e) => e.statusCode === 409);
});

await test("rename: changing only the case of its own name is allowed", async () => {
  const { models, db, state } = fakeWorld({ cats: [{ _id: "c1", name: "starters" }], items: [{ category: "starters" }] });
  await updateCategory({ models, db, id: "c1", name: "Starters" });
  assert.equal(state.cats[0].name, "Starters");
  assert.equal(state.items[0].category, "Starters");
});

await test("image-only update: no transaction, items untouched; \"\" removes the image", async () => {
  const { models, db, state } = fakeWorld({ cats: [{ _id: "c1", name: "Pizza", image: "old" }], items: [{ category: "Pizza" }] });
  await updateCategory({ models, db, id: "c1", image: "https://new/img.png" });
  assert.equal(state.cats[0].image, "https://new/img.png");
  await updateCategory({ models, db, id: "c1", image: "" });
  assert.equal(state.cats[0].image, "");
  assert.equal(state.txCommitted, 0);
});

await test("update: unknown id → 404", async () => {
  const { models, db } = fakeWorld();
  await assert.rejects(updateCategory({ models, db, id: "nope", name: "X" }), (e) => e.statusCode === 404);
});

await test("delete: refused while an item lists it only as an extra category (MNU-01)", async () => {
  const { models } = fakeWorld({ cats: [{ _id: "c1", name: "Specials" }], items: [{ category: "Chai", categories: ["Specials"] }] });
  await assert.rejects(deleteCategory({ models, id: "c1" }), (e) => e.statusCode === 409);
});

await test("delete: refused (409) while items use it; allowed once empty", async () => {
  const { models, state } = fakeWorld({ cats: [{ _id: "c1", name: "Pizza" }], items: [{ category: "Pizza" }] });
  await assert.rejects(deleteCategory({ models, id: "c1" }), (e) => e.statusCode === 409 && /1 item/.test(e.message));
  state.items = [];
  const gone = await deleteCategory({ models, id: "c1" });
  assert.equal(gone.name, "Pizza");
  assert.equal(state.cats.length, 0);
  await assert.rejects(deleteCategory({ models, id: "c1" }), (e) => e.statusCode === 404);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
