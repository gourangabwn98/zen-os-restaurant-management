// services/inventoryService.js
// ─────────────────────────────────────────────────────────────────────────────
// All inventory business logic lives here — controllers are thin HTTP
// wrappers, and services/orderService.js calls into deductStockForOrder /
// reverseStockForOrder so the order lifecycle and inventory stay in lockstep.
// ─────────────────────────────────────────────────────────────────────────────

import { classifyStockLevel } from "../utils/inventoryConstants.js";

const money = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ── Recipe consumption calculation ─────────────────────────────────────────
/**
 * Aggregates every ingredient required to fulfil an order's items, summed
 * across all order lines that share an ingredient. Menu items with no
 * active recipe are silently skipped (no recipe = not inventory-tracked).
 * @returns {Array<{ inventoryItem, name, unit, qty }>}
 */
export const calculateRecipeConsumption = async ({ Recipe, order }) => {
  const menuItemIds = [...new Set(order.items.map((i) => String(i.menuItem)))];
  const recipes = await Recipe.find({ menuItem: { $in: menuItemIds }, status: "Active" });
  const recipeByMenuItem = new Map(recipes.map((r) => [String(r.menuItem), r]));

  const required = new Map(); // inventoryItemId -> { inventoryItem, unit, qty }

  for (const line of order.items) {
    const recipe = recipeByMenuItem.get(String(line.menuItem));
    if (!recipe) continue; // no recipe → not inventory-tracked

    for (const ing of recipe.ingredients) {
      const key = String(ing.inventoryItem);
      const needed = ing.quantity * line.qty;
      if (required.has(key)) {
        required.get(key).qty += needed;
      } else {
        required.set(key, { inventoryItem: ing.inventoryItem, unit: ing.unit, qty: needed });
      }
    }
  }

  return [...required.values()];
};

// ── Validate availability (step 1 of the confirm workflow) ─────────────────
/**
 * Throws (statusCode 409) listing every ingredient that's short, without
 * mutating anything. Call BEFORE deduction so an order can never be
 * confirmed into a state inventory can't actually fulfil.
 */
export const validateInventoryForConsumption = async ({ InventoryItem, consumption, session }) => {
  if (!consumption.length) return;

  const ids = consumption.map((c) => c.inventoryItem);
  const items = await InventoryItem.find({ _id: { $in: ids } }).session(session || null);
  const byId = new Map(items.map((i) => [String(i._id), i]));

  const shortages = [];
  for (const need of consumption) {
    const item = byId.get(String(need.inventoryItem));
    if (!item) {
      shortages.push(`Ingredient no longer exists (id ${need.inventoryItem})`);
      continue;
    }
    if (item.status !== "Active") {
      shortages.push(`"${item.name}" is inactive and cannot be used`);
      continue;
    }
    if (item.currentStock < need.qty) {
      shortages.push(
        `"${item.name}": need ${need.qty}${need.unit}, only ${item.currentStock}${item.unit} in stock`
      );
    }
  }

  if (shortages.length) {
    const err = new Error(`Insufficient stock — ${shortages.join("; ")}`);
    err.statusCode = 409;
    err.shortages = shortages;
    throw err;
  }
};

// ── Deduct stock for a confirmed order (steps 2–4 of the confirm workflow) ─
/**
 * MUST be called from inside the same Mongo transaction/session as the
 * order's PENDING_CONFIRMATION → CONFIRMED write (or, for staff orders that
 * are created already-CONFIRMED, from inside that same creation transaction).
 *
 * Idempotency: `Order.stockDeducted` flips false→true via an atomic
 * conditional update — a second call for the same order is a safe no-op.
 * Negative stock is additionally guarded at the DB level via a conditional
 * $inc (`currentStock: { $gte: qty } → $inc: -qty`), so even a validation
 * pass immediately followed by a concurrent order can't push stock negative.
 */
export const deductStockForOrder = async ({ models, order, actor, session }) => {
  const { Order, Recipe, InventoryItem, StockLedger, InventoryBatch } = models;

  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, stockDeducted: false },
    { $set: { stockDeducted: true } },
    { session }
  );
  if (!claimed) {
    // Already deducted (or raced) — nothing further to do.
    return { deducted: false, deductions: [], alerts: [] };
  }

  const consumption = await calculateRecipeConsumption({ Recipe, order });
  if (!consumption.length) return { deducted: true, deductions: [], alerts: [] };

  await validateInventoryForConsumption({ InventoryItem, consumption, session });

  const deductions = [];
  const alerts = [];
  for (const need of consumption) {
    const updated = await InventoryItem.findOneAndUpdate(
      { _id: need.inventoryItem, currentStock: { $gte: need.qty } },
      { $inc: { currentStock: -need.qty } },
      { new: true, session }
    );
    if (!updated) {
      // Lost a race against another order between validation and deduction.
      const err = new Error(`Stock for ingredient ${need.inventoryItem} changed concurrently — please retry`);
      err.statusCode = 409;
      throw err;
    }

    await StockLedger.create(
      [{
        inventoryItem: updated._id,
        type: "SALE_DEDUCTION",
        quantity: -need.qty,
        balanceAfter: updated.currentStock,
        relatedOrder: order._id,
        reason: `Order ${order.orderId}`,
        createdBy: actor,
      }],
      { session }
    );

    if (updated.isBatchTracked) {
      await consumeFromBatchesFIFO({ InventoryBatch, inventoryItemId: updated._id, qty: need.qty, session });
    }

    deductions.push({ inventoryItem: updated._id, name: updated.name, qty: need.qty, unit: need.unit });

    // Order-triggered deduction is the most common way stock quietly drops
    // below a threshold — this is what makes "trigger low-stock alert if
    // required" actually fire at KOT time, not just when a human happens to
    // open the Inventory tab later. (Manual adjustment/wastage already had
    // this via inventoryController.js's maybeAlert — this closes the gap
    // for the order-confirmation path specifically.)
    const level = classifyStockLevel(updated.currentStock, updated.reorderLevel, updated.criticalLevel);
    if (level !== "OK") {
      alerts.push({ item: updated.toObject(), level });
    }
  }

  await Order.findByIdAndUpdate(order._id, { $set: { stockDeductions: deductions } }, { session });

  return { deducted: true, deductions, alerts };
};

// ── Reverse stock for a cancelled order ────────────────────────────────────
/**
 * Replays `order.stockDeductions` (captured at deduction time) in reverse.
 * Idempotent the same way as deduction: `stockReversed` flips false→true
 * exactly once via an atomic conditional update.
 */
export const reverseStockForOrder = async ({ models, order, actor, session }) => {
  const { Order, InventoryItem, StockLedger } = models;

  if (!order.stockDeducted) return { reversed: false }; // never deducted → nothing to undo

  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, stockDeducted: true, stockReversed: false },
    { $set: { stockReversed: true } },
    { session, new: true }
  );
  if (!claimed) return { reversed: false };

  for (const d of claimed.stockDeductions) {
    const updated = await InventoryItem.findByIdAndUpdate(
      d.inventoryItem,
      { $inc: { currentStock: d.qty } },
      { new: true, session }
    );
    if (!updated) continue; // item was deleted since — nothing to credit back to

    await StockLedger.create(
      [{
        inventoryItem: updated._id,
        type: "REVERSAL",
        quantity: d.qty,
        balanceAfter: updated.currentStock,
        relatedOrder: order._id,
        reason: `Order ${order.orderId} cancelled`,
        createdBy: actor,
      }],
      { session }
    );
  }

  return { reversed: true };
};

// ── FIFO batch consumption (best-effort, expiry-accuracy only) ────────────
const consumeFromBatchesFIFO = async ({ InventoryBatch, inventoryItemId, qty, session }) => {
  let remaining = qty;
  const batches = await InventoryBatch.find({ inventoryItem: inventoryItemId, quantity: { $gt: 0 } })
    .sort({ expiryDate: 1, receivedAt: 1 })
    .session(session || null);

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    batch.quantity -= take;
    remaining -= take;
    await batch.save({ session });
  }
  // If remaining > 0 here, batch records under-account vs currentStock
  // (e.g. stock was added without a batch, or batches are out of sync) —
  // that's fine: currentStock stays authoritative, batches are best-effort.
};

// ── Purchases ────────────────────────────────────────────────────────────
export const recordPurchase = async ({ models, body, actor, session }) => {
  const { StockPurchase, InventoryItem, StockLedger, InventoryBatch } = models;
  const { supplier, items, invoiceNumber, purchaseDate, notes } = body;

  if (!Array.isArray(items) || !items.length) {
    const err = new Error("Purchase must include at least one item");
    err.statusCode = 400;
    throw err;
  }

  let totalCost = 0;
  for (const it of items) {
    if (!it.inventoryItem || !(it.quantity > 0) || !(it.costPrice >= 0)) {
      const err = new Error("Each purchase line needs inventoryItem, quantity > 0, costPrice >= 0");
      err.statusCode = 400;
      throw err;
    }
    totalCost += it.quantity * it.costPrice;
  }

  const [purchase] = await StockPurchase.create(
    [{
      supplier: supplier || null,
      items,
      totalCost: money(totalCost),
      invoiceNumber: invoiceNumber || "",
      purchaseDate: purchaseDate || new Date(),
      notes: notes || "",
      createdBy: actor,
    }],
    { session }
  );

  for (const it of items) {
    const updated = await InventoryItem.findByIdAndUpdate(
      it.inventoryItem,
      { $inc: { currentStock: it.quantity }, $set: { costPrice: it.costPrice } },
      { new: true, session }
    );
    if (!updated) continue;

    await StockLedger.create(
      [{
        inventoryItem: updated._id,
        type: "PURCHASE",
        quantity: it.quantity,
        balanceAfter: updated.currentStock,
        relatedPurchase: purchase._id,
        reason: invoiceNumber ? `Purchase (${invoiceNumber})` : "Purchase",
        createdBy: actor,
      }],
      { session }
    );

    if (updated.isBatchTracked) {
      await InventoryBatch.create(
        [{
          inventoryItem: updated._id,
          batchNo: it.batchNo || "",
          quantity: it.quantity,
          costPrice: it.costPrice,
          expiryDate: it.expiryDate || null,
          purchase: purchase._id,
        }],
        { session }
      );
    }
  }

  return purchase;
};

// ── Wastage ──────────────────────────────────────────────────────────────
export const recordWastage = async ({ models, body, actor, session }) => {
  const { WastageLog, InventoryItem, StockLedger } = models;
  const { inventoryItem, quantity, reason, notes, wastageDate } = body;

  if (!inventoryItem || !(quantity > 0)) {
    const err = new Error("inventoryItem and quantity > 0 are required");
    err.statusCode = 400;
    throw err;
  }

  const updated = await InventoryItem.findOneAndUpdate(
    { _id: inventoryItem, currentStock: { $gte: quantity } },
    { $inc: { currentStock: -quantity } },
    { new: true, session }
  );
  if (!updated) {
    const err = new Error("Insufficient stock to record this wastage");
    err.statusCode = 409;
    throw err;
  }

  const costImpact = money(quantity * (updated.costPrice || 0));

  const [log] = await WastageLog.create(
    [{
      inventoryItem: updated._id, quantity, reason: reason || "Other",
      costImpact, notes: notes || "", recordedBy: actor,
      wastageDate: wastageDate || new Date(),
    }],
    { session }
  );

  await StockLedger.create(
    [{
      inventoryItem: updated._id,
      type: "WASTAGE",
      quantity: -quantity,
      balanceAfter: updated.currentStock,
      relatedWastage: log._id,
      reason: reason || "Wastage",
      createdBy: actor,
    }],
    { session }
  );

  return log;
};

// ── Manual adjustment / physical stock count ───────────────────────────────
// Both take an absolute "this is what's actually on the shelf" value rather
// than a delta — the system computes and logs the difference, which matches
// how a physical count naturally works and avoids off-by-one delta bugs.
export const adjustStock = async ({ models, inventoryItemId, newStock, type, reason, actor, session }) => {
  const { InventoryItem, StockLedger } = models;

  if (!(newStock >= 0)) {
    const err = new Error("newStock must be >= 0");
    err.statusCode = 400;
    throw err;
  }

  const item = await InventoryItem.findById(inventoryItemId).session(session || null);
  if (!item) {
    const err = new Error("Inventory item not found");
    err.statusCode = 404;
    throw err;
  }

  const delta = money(newStock - item.currentStock);
  item.currentStock = newStock;
  await item.save({ session });

  await StockLedger.create(
    [{
      inventoryItem: item._id,
      type: type === "PHYSICAL_COUNT" ? "PHYSICAL_COUNT" : "ADJUSTMENT",
      quantity: delta,
      balanceAfter: item.currentStock,
      reason: reason || (type === "PHYSICAL_COUNT" ? "Physical stock count" : "Manual adjustment"),
      createdBy: actor,
    }],
    { session }
  );

  return item;
};

// ── Menu-item ↔ inventory linkage ──────────────────────────────────────────
/**
 * Bulk version of computeMenuItemStockStatus, for menu listing endpoints
 * (avoids N+1 queries). Returns a Map<menuItemId, { tracked, inStock }>.
 * Menu items with no active recipe are always `{ tracked: false, inStock: true }`
 * — i.e. untracked items never get hidden or flagged by this.
 */
export const computeStockStatusForMenuItems = async ({ models, menuItemIds }) => {
  const { Recipe, InventoryItem } = models;
  const result = new Map();
  if (!menuItemIds?.length) return result;

  const recipes = await Recipe.find({ menuItem: { $in: menuItemIds }, status: "Active" }).lean();
  if (!recipes.length) return result; // nobody tracked → caller treats all as inStock

  const allIngredientIds = [...new Set(
    recipes.flatMap((r) => r.ingredients.map((i) => String(i.inventoryItem)))
  )];
  const items = await InventoryItem.find({ _id: { $in: allIngredientIds } }).lean();
  const byId = new Map(items.map((i) => [String(i._id), i]));

  for (const recipe of recipes) {
    let inStock = true;
    for (const ing of recipe.ingredients) {
      const item = byId.get(String(ing.inventoryItem));
      if (!item || item.status !== "Active" || item.currentStock < ing.quantity) {
        inStock = false;
        break;
      }
    }
    result.set(String(recipe.menuItem), { tracked: true, inStock });
  }

  return result;
};

export const computeMenuItemStockStatus = async ({ models, menuItemId }) => {
  const { Recipe, InventoryItem } = models;
  const recipe = await Recipe.findOne({ menuItem: menuItemId, status: "Active" });
  if (!recipe || !recipe.ingredients.length) return { tracked: false, inStock: true, shortages: [] };

  const ids = recipe.ingredients.map((i) => i.inventoryItem);
  const items = await InventoryItem.find({ _id: { $in: ids } });
  const byId = new Map(items.map((i) => [String(i._id), i]));

  const shortages = [];
  for (const ing of recipe.ingredients) {
    const item = byId.get(String(ing.inventoryItem));
    if (!item || item.status !== "Active" || item.currentStock < ing.quantity) {
      shortages.push({
        inventoryItem: ing.inventoryItem,
        name: item?.name || "Unknown ingredient",
        required: ing.quantity,
        available: item?.currentStock ?? 0,
        unit: ing.unit,
      });
    }
  }

  return { tracked: true, inStock: shortages.length === 0, shortages };
};

// ── Overview / dashboard ───────────────────────────────────────────────────
export const computeInventoryOverview = async ({ models, expiringWithinDays = 7 }) => {
  const { InventoryItem, InventoryBatch, StockLedger } = models;

  const items = await InventoryItem.find({ status: "Active" }).lean();

  let stockValue = 0;
  const low = [], critical = [], outOfStock = [];
  for (const it of items) {
    stockValue += (it.currentStock || 0) * (it.costPrice || 0);
    const level = classifyStockLevel(it.currentStock, it.reorderLevel, it.criticalLevel);
    if (level === "OUT_OF_STOCK") outOfStock.push(it);
    else if (level === "CRITICAL") critical.push(it);
    else if (level === "LOW") low.push(it);
  }

  const expiryCutoff = new Date(Date.now() + expiringWithinDays * 24 * 60 * 60 * 1000);
  const expiringSoon = await InventoryBatch.find({
    quantity: { $gt: 0 },
    expiryDate: { $ne: null, $lte: expiryCutoff },
  }).populate("inventoryItem", "name unit").lean();

  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const [consumptionAgg, purchaseAgg, wastageAgg] = await Promise.all([
    StockLedger.aggregate([
      { $match: { type: "SALE_DEDUCTION", createdAt: { $gte: startOfDay } } },
      { $group: { _id: null, qty: { $sum: { $abs: "$quantity" } }, count: { $sum: 1 } } },
    ]),
    StockLedger.aggregate([
      { $match: { type: "PURCHASE", createdAt: { $gte: startOfDay } } },
      { $group: { _id: null, qty: { $sum: "$quantity" }, count: { $sum: 1 } } },
    ]),
    StockLedger.aggregate([
      { $match: { type: "WASTAGE", createdAt: { $gte: startOfDay } } },
      { $group: { _id: null, qty: { $sum: { $abs: "$quantity" } }, count: { $sum: 1 } } },
    ]),
  ]);

  return {
    totalItems: items.length,
    stockValue: money(stockValue),
    lowStock:     { count: low.length,        items: low },
    critical:     { count: critical.length,    items: critical },
    outOfStock:   { count: outOfStock.length,  items: outOfStock },
    expiringSoon: { count: expiringSoon.length, batches: expiringSoon, withinDays: expiringWithinDays },
    today: {
      consumption: { qty: consumptionAgg[0]?.qty || 0, count: consumptionAgg[0]?.count || 0 },
      purchases:   { qty: purchaseAgg[0]?.qty || 0,   count: purchaseAgg[0]?.count || 0 },
      wastage:     { qty: wastageAgg[0]?.qty || 0,    count: wastageAgg[0]?.count || 0 },
    },
  };
};
