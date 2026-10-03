// test/menuBoard.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Admin → Menu items "big-menu" tools: availability states (Sold out today),
// diner tags, bulk edit, the import reader + commit, Menu times (window copied
// onto categories), and category reorder / merge. No DB — fake models. Run:
//   node test/menuBoard.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import {
  availabilityUpdate, setAvailability, normalizeTags, applyPercent, bulkEditItems, normalizeImportRow, commitImport,
} from "../services/menuItemService.js";
import { createMenuTime, updateMenuTime, deleteMenuTime } from "../services/menuTimeService.js";
import { reorderCategories, mergeCategory } from "../services/categoryService.js";
import { parseMenuText, parseMenuCsv, parseMenuLine, guessFoodType } from "../utils/menuImportParser.js";

let passed = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.message}`); }
};
const oid = (n) => n.toString(16).padStart(24, "0");
const lean = (v) => ({ lean: async () => v, select: () => lean(v), sort: () => lean(v) });
const rejectsWith = (fn, code) => assert.rejects(fn, (e) => e.statusCode === code);

const run = async () => {
  console.log("── availability ───────────────────────────────");

  await test("On / Off clear soldOutUntil; Sold out today lasts until 03:00 restaurant time", () => {
    assert.deepEqual(availabilityUpdate("on"), { isAvailable: true, soldOutUntil: null });
    assert.deepEqual(availabilityUpdate("off"), { isAvailable: false, soldOutUntil: null });
    const so = availabilityUpdate("soldout", { now: new Date("2026-01-02T14:30:00Z"), timezone: "Asia/Kolkata" });
    assert.equal(so.isAvailable, false);
    assert.equal(so.soldOutUntil.toISOString(), "2026-01-02T21:30:00.000Z");
    assert.throws(() => availabilityUpdate("maybe"), (e) => e.statusCode === 400);
  });

  await test("setAvailability uses the profile's business-day end and checks ids first", async () => {
    const writes = [];
    const models = {
      RestaurantProfile: { findOne: () => lean({ timezone: "Asia/Kolkata", businessDayEndsAt: "04:00" }) },
      MenuItem: {
        countDocuments: async (q) => q._id.$in.filter((id) => id !== oid(9)).length,
        updateMany: async (q, u) => { writes.push(u); return {}; },
      },
    };
    const r = await setAvailability({ models, ids: [oid(1), oid(1)], state: "soldout", now: new Date("2026-01-02T14:30:00Z") });
    assert.equal(r.updated, 1);
    assert.equal(writes[0].$set.soldOutUntil.toISOString(), "2026-01-02T22:30:00.000Z");
    await rejectsWith(() => setAvailability({ models, ids: [oid(1), oid(9)], state: "off" }), 404);
    await rejectsWith(() => setAvailability({ models, ids: ["x"], state: "off" }), 400);
    assert.equal(writes.length, 1);
  });

  console.log("── diner tags + bulk edit ─────────────────────");

  await test("normalizeTags: arrays, JSON strings, comma text; dedupe case-insensitively", () => {
    assert.deepEqual(normalizeTags(["Fish", " fish ", "Spicy  hot"]), ["Fish", "Spicy hot"]);
    assert.deepEqual(normalizeTags('["Bestseller"]'), ["Bestseller"]);
    assert.deepEqual(normalizeTags("Fish, Prawn,"), ["Fish", "Prawn"]);
    assert.deepEqual(normalizeTags(undefined), []);
    assert.throws(() => normalizeTags([{ $gt: "" }]), (e) => e.statusCode === 400);
    assert.throws(() => normalizeTags(["x".repeat(25)]), (e) => e.statusCode === 400);
    assert.throws(() => normalizeTags(Array.from({ length: 11 }, (_, i) => `t${i}`)), (e) => e.statusCode === 400);
  });

  await test("applyPercent rounds to whole rupees and never goes below zero", () => {
    assert.equal(applyPercent(160, 10), 176);
    assert.equal(applyPercent(155, -5), 147);
    assert.equal(applyPercent(100, -90), 10);
  });

  const bulkWorld = () => {
    const state = {
      items: [
        { _id: oid(1), price: 160, tags: ["Fish"], category: "Lunch" },
        { _id: oid(2), price: 250, tags: [], category: "Lunch" },
      ],
      writes: null,
    };
    const models = {
      Category: { findOne: (q) => lean(new RegExp(q.name.$regex, q.name.$options).test("Extras") ? { name: "Extras" } : null) },
      MenuItem: {
        find: (q) => lean(state.items.filter((i) => q._id.$in.includes(i._id))),
        bulkWrite: async (ops) => { state.writes = ops; },
      },
    };
    return { state, models };
  };

  await test("bulk edit: price %, move category, add/remove tags — computed server-side", async () => {
    const { state, models } = bulkWorld();
    const r = await bulkEditItems({
      models, ids: [oid(1), oid(2)], category: "extras", addTags: ["Bestseller", "fish"], removeTags: ["FISH"], pricePercent: 10,
    });
    assert.equal(r.updated, 2);
    const set1 = state.writes[0].updateOne.update.$set;
    assert.deepEqual(set1, { category: "Extras", price: 176, tags: ["Bestseller"] });
    assert.equal(state.writes[1].updateOne.update.$set.price, 275);
  });

  await test("bulk edit rejects unknown category, bad percent, no change, missing items — writes nothing", async () => {
    const { state, models } = bulkWorld();
    await rejectsWith(() => bulkEditItems({ models, ids: [oid(1)], category: "Nope" }), 404);
    await rejectsWith(() => bulkEditItems({ models, ids: [oid(1)], pricePercent: 900 }), 400);
    await rejectsWith(() => bulkEditItems({ models, ids: [oid(1)], pricePercent: "abc" }), 400);
    await rejectsWith(() => bulkEditItems({ models, ids: [oid(1)] }), 400);
    await rejectsWith(() => bulkEditItems({ models, ids: [oid(1), oid(3)], pricePercent: 5 }), 404);
    assert.equal(state.writes, null);
  });

  console.log("── import reader ──────────────────────────────");

  const printed = [
    "LUNCH",
    "Veg Thali … 160/-",
    "Katla Fish Curry - 130",
    "Masala Bhetki (Time 30min) … 260/-",
    "Chingri Malai Curry (B/Less)(3pcs) … 250/-",
    "Burgers 120",
    "Masala Dosa Rs 80",
    "EXTRA -",
    "Begun Bhaja (4 pcs) 80",
    "Chicken Tikka 180/280",
  ].join("\n");

  await test("printed menu: sections become categories, notes lifted out of brackets", () => {
    const { rows, sections } = parseMenuText(printed);
    assert.deepEqual(sections, ["Lunch", "Extra"]);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    assert.equal(by["Veg Thali"].price, 160);
    assert.equal(by["Veg Thali"].category, "Lunch");
    assert.equal(by["Masala Bhetki"].description, "Time 30min");
    assert.equal(by["Chingri Malai Curry"].description, "B/Less · 3pcs");
    assert.equal(by["Burgers"].price, 120, "'rs' inside a word is not a currency");
    assert.equal(by["Masala Dosa"].price, 80);
    assert.equal(by["Begun Bhaja"].category, "Extra");
    assert.equal(by["Chicken Tikka"].price, 280);
    assert.match(by["Chicken Tikka"].description, /Half ₹180/);
    assert.ok(by["Chicken Tikka"].check.length > 0, "two prices are flagged");
  });

  await test("food type and Fish / Prawn tags are guessed from the name", () => {
    assert.deepEqual(guessFoodType("Katla Fish Curry"), { tag: "Non Veg", tags: ["Fish"] });
    assert.deepEqual(guessFoodType("Dab Chingri"), { tag: "Non Veg", tags: ["Prawn"] });
    assert.deepEqual(guessFoodType("Aloo Posto"), { tag: "Veg", tags: [] });
    assert.equal(guessFoodType("Egg Roll").tag, "Non Veg");
    assert.equal(guessFoodType("Eggless Cake").tag, "Veg");
  });

  await test("lines without a price are not dishes", () => {
    assert.equal(parseMenuLine("Our special recipes"), null);
    assert.equal(parseMenuLine("160"), null);
  });

  await test("CSV: headings matched by name, quotes, Half/Full, own tags", () => {
    const csv = 'Item Name,Rate,Section,Type,Remarks,Half,Tags\n"Ilish, Fry",320,Lunch,Non-veg,big,,Fish\nPaneer Tikka,280,Starters,Veg,,160,\n,,,\n';
    const { rows } = parseMenuCsv(csv);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      { n: rows[0].name, p: rows[0].price, c: rows[0].category, t: rows[0].tag, d: rows[0].description, g: rows[0].tags },
      { n: "Ilish, Fry", p: 320, c: "Lunch", t: "Non Veg", d: "big", g: ["Fish"] },
    );
    assert.equal(rows[1].description, "Half ₹160");
    assert.throws(() => parseMenuCsv("foo,bar\n1,2"), (e) => e.statusCode === 422);
  });

  console.log("── import commit ──────────────────────────────");

  await test("rows are validated; bad ones name their row", () => {
    assert.deepEqual(normalizeImportRow({ name: " Veg  Thali ", price: "160", category: "Lunch", tag: "Bogus" }, 0),
      { name: "Veg Thali", price: 160, category: "Lunch", tag: "Veg", description: "", tags: [] });
    assert.throws(() => normalizeImportRow({ name: "", price: 1, category: "x" }, 2), /Row 3/);
    assert.throws(() => normalizeImportRow({ name: "A", price: -1, category: "x" }, 0), (e) => e.statusCode === 400);
    assert.throws(() => normalizeImportRow({ name: "A", price: 1, category: "" }, 0), (e) => e.statusCode === 400);
  });

  await test("commit creates missing categories once, reuses existing ones, skips duplicates", async () => {
    const created = { cats: [], items: [] };
    const models = {
      Category: {
        find: () => lean([{ name: "Lunch" }]),
        insertMany: async (docs) => { created.cats.push(...docs); },
      },
      MenuItem: {
        find: () => lean([{ name: "Veg Thali", category: "Lunch" }]),
        insertMany: async (docs) => { created.items.push(...docs); },
      },
    };
    const r = await commitImport({
      models,
      rows: [
        { name: "veg thali", price: 160, category: "lunch" },     // exists → skipped
        { name: "Posto Bora", price: 110, category: "LUNCH" },    // existing category, any case
        { name: "Moong Dal", price: 80, category: "Extras" },     // new category
        { name: "Papad", price: 40, category: "extras" },
        { name: "Papad", price: 40, category: "Extras" },         // duplicate within the import
      ],
    });
    assert.deepEqual(r, { created: 3, skipped: 2, categoriesCreated: ["Extras"] });
    assert.deepEqual(created.cats, [{ name: "Extras" }]);
    assert.deepEqual(created.items.map((i) => `${i.category}/${i.name}`), ["Lunch/Posto Bora", "Extras/Moong Dal", "Extras/Papad"]);
    await rejectsWith(() => commitImport({ models, rows: [] }), 400);
  });

  console.log("── menu times ─────────────────────────────────");

  const mtWorld = () => {
    const calls = [];
    const state = { mts: [{ _id: oid(50), name: "Lunch", schedule: { enabled: true, startTime: "11:30", endTime: "16:30", days: [], startDate: "", endDate: "" } }] };
    const models = {
      MenuTime: {
        findOne: (q) => lean(state.mts.find((m) => new RegExp(q.name.$regex, q.name.$options).test(m.name) && (!q._id || m._id !== q._id.$ne)) || null),
        findById: (id) => lean(state.mts.find((m) => m._id === String(id)) || null),
        countDocuments: async () => state.mts.length,
        create: async ([doc]) => { const d = { _id: oid(60), ...doc }; state.mts.push(d); return [d]; },
        findByIdAndUpdate: (id, u) => lean({ ...state.mts.find((m) => m._id === id), ...u.$set }),
        deleteOne: async () => ({ deletedCount: 1 }),
      },
      Category: {
        countDocuments: async (q) => q._id.$in.length,
        updateMany: async (q, u) => { calls.push({ q, u }); return { modifiedCount: 3 }; },
      },
    };
    return { calls, state, models };
  };

  await test("create: validates the window and copies it onto the chosen categories", async () => {
    const { calls, models } = mtWorld();
    const mt = await createMenuTime({ models, input: { name: "Weekend fish special", schedule: { startTime: "12:00", endTime: "22:00", days: [5, 6, 0] }, color: "cyan", categoryIds: [oid(1)] } });
    assert.equal(mt.color, "cyan");
    assert.deepEqual(mt.schedule.days, [0, 5, 6]);
    const assign = calls.find((c) => c.q._id?.$in);
    assert.deepEqual(assign.u.$set, { menuTime: mt._id, schedule: mt.schedule });
  });

  await test("create rejects a duplicate name and a bad window", async () => {
    const { models } = mtWorld();
    await rejectsWith(() => createMenuTime({ models, input: { name: "lunch", schedule: { startTime: "08:00", endTime: "09:00" } } }), 409);
    await rejectsWith(() => createMenuTime({ models, input: { name: "X", schedule: { startTime: "08:00", endTime: "08:00" } } }), 400);
    await rejectsWith(() => createMenuTime({ models, input: { name: " ", schedule: { startTime: "08:00", endTime: "09:00" } } }), 400);
  });

  await test("editing the window re-copies it onto every category in the menu time", async () => {
    const { calls, models } = mtWorld();
    await updateMenuTime({ models, id: oid(50), input: { schedule: { startTime: "12:00", endTime: "16:00" } } });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].q, { menuTime: oid(50) });
    assert.equal(calls[0].u.$set.schedule.startTime, "12:00");
  });

  await test("setting categoryIds frees the ones left out (back to All day)", async () => {
    const { calls, models } = mtWorld();
    await updateMenuTime({ models, id: oid(50), input: { categoryIds: [oid(2)] } });
    const freed = calls.find((c) => c.q._id?.$nin);
    assert.deepEqual(freed.q, { menuTime: oid(50), _id: { $nin: [oid(2)] } });
    assert.equal(freed.u.$set.menuTime, null);
    assert.equal(freed.u.$set.schedule.enabled, false);
  });

  await test("delete frees its categories", async () => {
    const { calls, models } = mtWorld();
    const r = await deleteMenuTime({ models, id: oid(50) });
    assert.equal(r.deleted, "Lunch");
    assert.equal(calls[0].u.$set.menuTime, null);
    await rejectsWith(() => deleteMenuTime({ models, id: oid(99) }), 404);
  });

  console.log("── category order + merge ─────────────────────");

  await test("reorder needs every category exactly once", async () => {
    let ops = null;
    const models = { Category: { find: () => lean([{ _id: "a" }, { _id: "b" }, { _id: "c" }]), bulkWrite: async (o) => { ops = o; } } };
    await reorderCategories({ models, ids: ["c", "a", "b"] });
    assert.deepEqual(ops.map((o) => [o.updateOne.filter._id, o.updateOne.update.$set.sortOrder]), [["c", 0], ["a", 1], ["b", 2]]);
    await rejectsWith(() => reorderCategories({ models, ids: ["c", "a"] }), 409);
    await rejectsWith(() => reorderCategories({ models, ids: ["c", "a", "a"] }), 400);
  });

  await test("merge moves the items and deletes the source in one transaction", async () => {
    const seen = [];
    const session = { withTransaction: async (fn) => fn(), endSession: async () => {} };
    const db = { startSession: async () => session };
    const docs = { x: { _id: "x", name: "Extra" }, y: { _id: "y", name: "Extras" } };
    const models = {
      Category: {
        findById: (id) => lean(docs[id] || null),
        deleteOne: async (q, o) => { seen.push(["del", q, o.session === session]); return { deletedCount: 1 }; },
      },
      MenuItem: { updateMany: async (q, u, o) => { seen.push(["move", q, u, o.session === session]); return { modifiedCount: 2 }; } },
    };
    const r = await mergeCategory({ models, db, id: "x", intoId: "y" });
    assert.deepEqual(r, { from: "Extra", into: "Extras", itemsMoved: 2 });
    assert.deepEqual(seen[0], ["move", { category: "Extra" }, { $set: { category: "Extras" } }, true]);
    assert.deepEqual(seen[1], ["del", { _id: "x", name: "Extra" }, true]);
    await rejectsWith(() => mergeCategory({ models, db, id: "x", intoId: "x" }), 400);
    await rejectsWith(() => mergeCategory({ models, db, id: "x", intoId: "z" }), 404);
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("SOME TESTS FAILED");
    process.exit(1);
  }
  console.log("ALL TESTS PASSED");
};

run();
