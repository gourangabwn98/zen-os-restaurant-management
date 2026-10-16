// test/importMenu.test.js — scripts/importMenu.js planning: $oid/$date
// conversion, match by _id then itemId, old items switched off (never
// deleted by default), and a second run changing nothing.
// No DB — an in-memory collection.  node test/importMenu.test.js
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { fromExtendedJson, planMenuImport, planToOps, normalizeRow } from "../scripts/importMenu.js";

const { ObjectId } = mongoose.Types;
let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};

const OLD_EGG = "6ab76c8e95b91a41c6dc0001";
const FILE = [
  { _id: { $oid: OLD_EGG }, itemId: "BF-005", name: "Boiled Egg", size: "2 pcs", price: 50, category: "Breakfast", subcategory: "Eggs",
    tag: "Non Veg", foodType: "Egg", isAvailable: true, addons: [{ name: "Extra Egg", price: 25, type: "Extra egg" }], tags: [],
    schedule: { enabled: true, startTime: "08:00", endTime: "11:00" }, createdAt: { $date: "2026-09-26T06:56:14.322Z" } },
  { itemId: "CT-001", name: "Cigarette Variant 1", price: 20, category: "Counter", subcategory: "Cigarettes", tag: "Others", foodType: "Veg", addons: [], tags: [] },
  { itemId: "MC-037", name: "Chicken Kosha (3 pcs)", size: "3 pcs", price: 180, category: "Main Course", subcategory: "Chicken", tag: "Non Veg", foodType: "Non-veg",
    addons: [{ name: "Extra piece", price: 70, type: "Extra piece" }], tags: ["Not sharable"], isChefsPick: true },
];

/** A tiny collection that applies the planned bulk ops like MongoDB would. */
const memoryCollection = (docs) => {
  const rows = docs.map((d) => ({ ...d }));
  return {
    rows,
    apply(ops) {
      for (const op of ops) {
        if (op.insertOne) rows.push({ _id: op.insertOne.document._id || new ObjectId(), ...op.insertOne.document,
          addons: op.insertOne.document.addons.map((a) => ({ _id: a._id || new ObjectId(), ...a })) });
        else if (op.updateOne) {
          const d = rows.find((r) => String(r._id) === String(op.updateOne.filter._id));
          const { $set = {}, $unset = {} } = op.updateOne.update;
          Object.assign(d, $set);
          if ($set.addons) d.addons = $set.addons.map((a) => ({ _id: a._id || new ObjectId(), ...a }));
          for (const k of Object.keys($unset)) delete d[k];
        } else if (op.deleteOne) rows.splice(rows.findIndex((r) => String(r._id) === String(op.deleteOne.filter._id)), 1);
      }
    },
  };
};

const existingDb = () => [
  // Same _id as the file's BF-005, old shape: no itemId, old category, extra list.
  { _id: new ObjectId(OLD_EGG), name: "Boiled Egg", price: 45, category: "Eggs & Toast", categories: ["Breakfast"], tag: "Non Veg", isAvailable: true,
    addons: [{ _id: new ObjectId(), name: "Extra Egg", price: 20 }] },
  { _id: new ObjectId(), name: "Paneer Masala", price: 200, category: "Main Course", tag: "Veg", isAvailable: true }, // the 2nd one
  { _id: new ObjectId(), name: "Omlet", price: 40, category: "Breakfast", tag: "Non Veg", isAvailable: true },
  { _id: new ObjectId(), name: "Old Off", price: 1, category: "Gone", tag: "Veg", isAvailable: false },
];

await test("$oid / $date are converted; other values pass through", () => {
  const [row] = fromExtendedJson([FILE[0]]);
  assert.ok(row._id instanceof ObjectId && String(row._id) === OLD_EGG);
  assert.ok(row.createdAt instanceof Date && row.createdAt.toISOString() === "2026-09-26T06:56:14.322Z");
  assert.equal(row.name, "Boiled Egg");
  assert.deepEqual(fromExtendedJson({ d: { $date: { $numberLong: "0" } } }).d, new Date(0));
});

await test("plan: match by _id, create rows without one, old items switched off — not deleted", () => {
  const rows = fromExtendedJson(FILE);
  const plan = planMenuImport({ rows, existing: existingDb() });
  assert.equal(plan.create.length, 2);
  assert.ok(plan.create.every((d) => d._id === undefined), "Mongo generates their _id");
  assert.equal(plan.update.length, 1);
  assert.equal(String(plan.update[0]._id), OLD_EGG);
  assert.equal(plan.update[0].set.category, "Breakfast");
  assert.equal(plan.update[0].set.schedule, undefined, "item schedules are not imported");
  assert.deepEqual(plan.deactivate.map((d) => d.name).sort(), ["Omlet", "Paneer Masala"], "already-off items aren't counted");
  assert.equal(plan.categoryChanges.get("Eggs & Toast"), "Breakfast");
  const ops = planToOps(plan);
  assert.ok(!ops.some((o) => o.deleteOne), "nothing deleted by default");
  assert.deepEqual(ops.find((o) => o.updateOne?.filter._id === plan.deactivate[0]._id).updateOne.update, { $set: { isAvailable: false, soldOutUntil: null } });
});

await test("plan: an existing add-on keeps its _id when its name matches (carts that picked it still work)", () => {
  const db = existingDb();
  const plan = planMenuImport({ rows: fromExtendedJson(FILE), existing: db });
  assert.equal(String(plan.update[0].set.addons[0]._id), String(db[0].addons[0]._id));
  assert.equal(plan.update[0].set.addons[0].price, 25);
});

await test("import is idempotent: the second run creates / updates / deactivates nothing", () => {
  const col = memoryCollection(existingDb());
  const first = planMenuImport({ rows: fromExtendedJson(FILE), existing: col.rows });
  col.apply(planToOps(first));
  assert.equal(col.rows.length, 6);
  assert.ok(col.rows.every((r) => r.categories === undefined), "the removed extra-categories field is unset");
  const second = planMenuImport({ rows: fromExtendedJson(FILE), existing: col.rows });
  assert.deepEqual([second.create.length, second.update.length, second.deactivate.length, second.unchanged], [0, 0, 0, 3]);
  assert.equal(planToOps(second).length, 0);
  // Rows without _id were matched by itemId the second time, not created again.
  assert.equal(col.rows.filter((r) => r.itemId === "CT-001").length, 1);
});

await test("--remove-old deletes old items (incl. already-off ones); still idempotent", () => {
  const col = memoryCollection(existingDb());
  const plan = planMenuImport({ rows: fromExtendedJson(FILE), existing: col.rows, removeOld: true });
  assert.equal(plan.deactivate.length, 3);
  col.apply(planToOps(plan, { removeOld: true }));
  assert.equal(col.rows.length, 3);
  const again = planMenuImport({ rows: fromExtendedJson(FILE), existing: col.rows, removeOld: true });
  assert.equal(planToOps(again, { removeOld: true }).length, 0);
});

await test("a 'Sold out today' item stays sold out until the business day ends", () => {
  const db = existingDb();
  db[0].isAvailable = false;
  db[0].soldOutUntil = new Date(Date.now() + 3600e3);
  const plan = planMenuImport({ rows: fromExtendedJson(FILE), existing: db });
  assert.equal(plan.update[0].set.isAvailable, false);
  assert.deepEqual(plan.soldOutKept, ["BF-005"]);
});

await test("bad files are refused before anything is planned", () => {
  assert.throws(() => planMenuImport({ rows: [], existing: [] }), /no items/);
  assert.throws(() => planMenuImport({ rows: fromExtendedJson([FILE[1], FILE[1]]), existing: [] }), /twice/);
  assert.throws(() => normalizeRow({ name: "X", price: 1, category: "Snacks" }, 0), /not a section/);
  assert.throws(() => normalizeRow({ name: "X", price: -1, category: "Counter" }, 0), /price/);
  assert.throws(() => normalizeRow({ name: "X", price: 1, category: "Counter", addons: Array.from({ length: 11 }, (_, i) => ({ name: `Extra ${i}`, price: 1 })) }, 0), /At most 10/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
