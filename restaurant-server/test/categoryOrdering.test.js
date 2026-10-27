import assert from "node:assert/strict";
import { priceItems } from "../utils/pricing.js";
import { categoryResetDay, isAfterCategoryResetBoundary, resetCategoryOrdering } from "../services/categoryOrderingService.js";

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

assert.equal(isAfterCategoryResetBoundary(new Date("2026-10-28T04:00:00+05:30"), "Asia/Kolkata"), true);
assert.equal(isAfterCategoryResetBoundary(new Date("2026-10-28T03:59:59+05:30"), "Asia/Kolkata"), false);
assert.equal(categoryResetDay(new Date("2026-10-28T04:00:00+05:30"), "Asia/Kolkata"), "2026-10-28");
assert.equal(await resetCategoryOrdering({ models: { Category } }), 1);
await assert.rejects(
  () => priceItems([{ menuItemId: "m1", qty: 1 }], MenuItem, null, { Category }),
  /currently unavailable for ordering/i,
);
const reduced = await priceItems([{ menuItemId: "m1", qty: 1 }], MenuItem, null, {
  Category, existingQuantities: new Map([["m1", 2]]),
});
assert.equal(reduced[0].qty, 1);
console.log("category ordering tests passed");
