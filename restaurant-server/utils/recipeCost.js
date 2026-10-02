// utils/recipeCost.js
// ─────────────────────────────────────────────────────────────────────────────
// The one recipe "making cost" calculation, used when a recipe is saved
// (snapshot on the Recipe), when it is listed (live cost at today's prices)
// and when an order goes to the kitchen (snapshot on Order.items[].makingCost,
// so a later price change never rewrites a past sale's cost).
//
// A STOCK ingredient costs  InventoryItem.costPrice (₹ per stock unit)
//                           × quantity converted into the stock unit:
//   Milk ₹60/l, 100 ml → 0.1 l × 60 = ₹6.
// A CUSTOM ingredient (not stocked) costs exactly the price the admin
// entered for that quantity.
// A stock item with no cost price is reported as `costMissing`, never as ₹0,
// and marks the recipe total `incomplete`.
// ─────────────────────────────────────────────────────────────────────────────

import { conversionFactor } from "./units.js";

export const INGREDIENT_SOURCES = ["STOCK", "CUSTOM"];

const round4 = (n) => Math.round((n + Number.EPSILON) * 1e4) / 1e4;
export const roundMoney = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Legacy ingredients predate `sourceType` — they were always stock items. */
export const ingredientSource = (ing) => (ing?.sourceType === "CUSTOM" ? "CUSTOM" : "STOCK");

/**
 * @param ing        { sourceType, inventoryItem, name, quantity, unit, cost }
 * @param stockItem  the referenced InventoryItem (STOCK only), or undefined
 * @returns { unitCost, cost, costMissing, error }  — ₹ per `ing.unit` and ₹ for `ing.quantity`
 */
export const computeIngredientCost = (ing, stockItem) => {
  const qty = Number(ing.quantity);
  if (ingredientSource(ing) === "CUSTOM") {
    const cost = Number(ing.cost);
    if (!Number.isFinite(cost) || cost < 0) return { unitCost: null, cost: null, costMissing: true, error: "Price is missing" };
    return { unitCost: qty > 0 ? round4(cost / qty) : null, cost: round4(cost), costMissing: false, error: null };
  }

  if (!stockItem) return { unitCost: null, cost: null, costMissing: true, error: "Stock item not found" };
  let factor;
  try { factor = conversionFactor(ing.unit, stockItem.unit); }
  catch (err) { return { unitCost: null, cost: null, costMissing: true, error: err.message }; }

  const price = Number(stockItem.costPrice);
  if (!(price > 0)) return { unitCost: null, cost: null, costMissing: true, error: `No cost price set for "${stockItem.name}"` };

  const unitCost = price * factor;
  return { unitCost: round4(unitCost), cost: round4(unitCost * qty), costMissing: false, error: null };
};

/**
 * @param ingredients  recipe.ingredients
 * @param itemsById    Map<inventoryItemId, InventoryItem> covering the STOCK ingredients
 * @returns { lines: [{ ...ingredient cost fields }], totalCost, incomplete }
 */
export const computeRecipeCost = (ingredients = [], itemsById = new Map()) => {
  let total = 0;
  let incomplete = false;
  const lines = ingredients.map((ing) => {
    const ref = ing.inventoryItem?._id || ing.inventoryItem;
    const stockItem = ingredientSource(ing) === "STOCK" ? itemsById.get(String(ref)) : undefined;
    const c = computeIngredientCost(ing, stockItem);
    if (c.costMissing) incomplete = true;
    else total += c.cost;
    return c;
  });
  return { lines, totalCost: roundMoney(total), incomplete };
};

/** Ids of every STOCK ingredient across these recipes (for one batched lookup). */
export const stockIngredientIds = (recipes) => [...new Set(
  recipes.flatMap((r) => (r.ingredients || [])
    .filter((i) => ingredientSource(i) === "STOCK" && i.inventoryItem)
    .map((i) => String(i.inventoryItem?._id || i.inventoryItem))),
)];
