import assert from "node:assert/strict";
import { priceItems } from "../utils/pricing.js";
import { categoryResetDay, isAfterCategoryResetBoundary, resetCategoryOrdering } from "../services/categoryOrderingService.js";
import { setCategoryOrdering } from "../services/categoryService.js";

const query = (value) => ({ select: () => ({ lean: async () => value }) });
const menu = [
  { _id: "m1", name: "Tea", nameBn: "", price: 20, category: "Drinks", isAvailable: true },
];
const MenuItem = { findById: async (id) => menu.find((m) => m._id === id) || null };
const Category = {
  find: () => query([{ name: "Drinks", orderingEnabled: false }]),
  updateMany: async (filter, update) => {
    assert.deepEqual(filter, { orderingEnabled: false });
    assert.deepEqual(update, { $set: { orderingEnabled: true } });
    return { modifiedCount: 1 };
  },
};
MenuItem.updateMany = async (filter, update) => {
    assert.deepEqual(filter, {});
    assert.deepEqual(update, { $set: { isAvailable: true, soldOutUntil: null } });
    return { modifiedCount: 1 };
};

const sessionDb = { startSession: async () => ({
  withTransaction: async (fn) => fn(), endSession: async () => {},
}) };
let savedCategory = { _id: "c1", name: "Drinks", orderingEnabled: true };
const ToggleCategory = {
  findOneAndUpdate: async (_filter, update) => {
    savedCategory = { ...savedCategory, ...update.$set };
    return savedCategory;
  },
};
let bulkUpdate;
const ToggleMenuItem = { updateMany: async (filter, update) => { bulkUpdate = { filter, update }; return { modifiedCount: 2 }; } };

assert.equal(isAfterCategoryResetBoundary(new Date("2026-10-28T04:00:00+05:30"), "Asia/Kolkata"), true);
assert.equal(isAfterCategoryResetBoundary(new Date("2026-10-28T03:59:59+05:30"), "Asia/Kolkata"), false);
assert.equal(categoryResetDay(new Date("2026-10-28T04:00:00+05:30"), "Asia/Kolkata"), "2026-10-28");
assert.equal(await resetCategoryOrdering({ models: { Category, MenuItem } }), 1);
const toggled = await setCategoryOrdering({ models: { Category: ToggleCategory, MenuItem: ToggleMenuItem }, db: sessionDb, id: "c1", enabled: false });
assert.equal(toggled.category.orderingEnabled, false);
assert.deepEqual(bulkUpdate, { filter: { category: "Drinks" }, update: { $set: { isAvailable: false, soldOutUntil: null } } });
const individuallyEnabled = await priceItems([{ menuItemId: "m1", qty: 1 }], MenuItem);
assert.equal(individuallyEnabled[0].qty, 1);
console.log("category ordering tests passed");
