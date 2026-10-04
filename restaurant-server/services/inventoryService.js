// services/inventoryService.js
// ─────────────────────────────────────────────────────────────────────────────
// All inventory business logic lives here — controllers are thin HTTP
// wrappers, and services/orderService.js calls into deductStockForOrder /
// reverseStockForOrder so the order lifecycle and inventory stay in lockstep.
// Units convert only through utils/units.js; making cost is computed only by
// utils/recipeCost.js.
// ─────────────────────────────────────────────────────────────────────────────

import { classifyStockLevel, STOCK_UNITS, WASTAGE_REASONS } from "../utils/inventoryConstants.js";
import {
  resolveBillNumber, systemBillNumber, validateBillDateTime, normalizePurchaseLines, paymentPlan,
} from "../utils/purchaseBill.js";
import { zonedInstant } from "./offerStatsService.js";
import { resolveTimezone } from "../utils/menuSchedule.js";
import { convertQuantity, toBaseUnit, roundQty, normalizeUnit, areUnitsCompatible } from "../utils/units.js";
import {
  computeRecipeCost, ingredientSource, stockIngredientIds, INGREDIENT_SOURCES,
} from "../utils/recipeCost.js";

const money = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const httpError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const loadActiveRecipes = (Recipe, items) => {
  const menuItemIds = [...new Set(items.map((i) => String(i.menuItem)))];
  return Recipe.find({ menuItem: { $in: menuItemIds }, status: "Active" });
};

const loadItemsById = async (InventoryItem, ids, session) => {
  if (!ids.length) return new Map();
  const items = await InventoryItem.find({ _id: { $in: ids } }).session(session || null);
  return new Map(items.map((i) => [String(i._id), i]));
};

// ── Recipe consumption calculation ─────────────────────────────────────────
/**
 * Pure: every STOCK ingredient an order's lines need, summed across lines
 * that share an ingredient. Quantities are normalised to their dimension's
 * base unit (ml / g / pcs) so "100 ml" in one recipe and "0.5 l" in another
 * add up correctly. CUSTOM ingredients aren't stocked and are skipped.
 * @returns {Array<{ inventoryItem, unit, qty }>}
 */
export const consumptionFromRecipes = (recipes, items) => {
  const recipeByMenuItem = new Map(recipes.map((r) => [String(r.menuItem), r]));
  const required = new Map(); // inventoryItemId -> { inventoryItem, unit, qty }

  for (const line of items) {
    const recipe = recipeByMenuItem.get(String(line.menuItem));
    if (!recipe) continue; // no recipe → not inventory-tracked

    for (const ing of recipe.ingredients) {
      if (ingredientSource(ing) !== "STOCK" || !ing.inventoryItem) continue;
      const id = ing.inventoryItem?._id || ing.inventoryItem;
      const base = toBaseUnit(ing.quantity * line.qty, ing.unit);
      const prev = required.get(String(id));
      if (prev && prev.unit !== base.unit) {
        // Two recipes use incompatible units for one stock item — recipe
        // save rejects this, so only legacy data can get here.
        throw httpError(`Recipes use incompatible units (${prev.unit} / ${base.unit}) for the same stock item`, 409);
      }
      if (prev) prev.qty = roundQty(prev.qty + base.qty);
      else required.set(String(id), { inventoryItem: id, unit: base.unit, qty: base.qty });
    }
  }

  return [...required.values()];
};

/** Menu items with no active recipe are silently skipped (not inventory-tracked). */
export const calculateRecipeConsumption = async ({ Recipe, order }) => {
  const recipes = await loadActiveRecipes(Recipe, order.items);
  return consumptionFromRecipes(recipes, order.items);
};

// Converts each need into its stock item's own unit and collects shortages.
const resolveAgainstStock = (consumption, byId) => {
  const shortages = [];
  const resolved = [];
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
    const unit = item.unit || need.unit;
    let qty;
    try {
      qty = convertQuantity(need.qty, need.unit, unit);
    } catch {
      shortages.push(`"${item.name}" is stocked in ${item.unit} but a recipe uses ${need.unit}`);
      continue;
    }
    if (item.currentStock < qty) {
      shortages.push(`"${item.name}": need ${qty}${unit}, only ${roundQty(item.currentStock)}${unit} in stock`);
    }
    resolved.push({ inventoryItem: need.inventoryItem, qty, unit });
  }
  return { shortages, resolved };
};

const throwShortages = (shortages) => {
  const err = new Error(`Insufficient stock — ${shortages.join("; ")}`);
  err.statusCode = 409;
  err.shortages = shortages;
  throw err;
};

// ── Validate availability (step 1 of the confirm workflow) ─────────────────
/**
 * Throws (statusCode 409) listing every ingredient that's short, without
 * mutating anything. Call BEFORE deduction so an order can never be
 * confirmed into a state inventory can't actually fulfil.
 */
export const validateInventoryForConsumption = async ({ InventoryItem, consumption, session }) => {
  if (!consumption.length) return;
  const byId = await loadItemsById(InventoryItem, consumption.map((c) => c.inventoryItem), session);
  const { shortages } = resolveAgainstStock(consumption, byId);
  if (shortages.length) throwShortages(shortages);
};

// ── Deduct stock for an order sent to the kitchen ──────────────────────────
/**
 * MUST be called from inside the same Mongo transaction/session as the
 * order's CONFIRMED → PREPARING write (orderService.sendToKitchenTx), next
 * to the KOT creation.
 *
 * Deducts  recipe quantity × qty ordered  of every STOCK ingredient,
 * converted into the stock item's own unit, and snapshots each line's
 * making cost onto `items[].makingCost` at today's stock prices.
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

  const recipes = await loadActiveRecipes(Recipe, order.items);
  if (!recipes.length) return { deducted: true, deductions: [], alerts: [] };

  const consumption = consumptionFromRecipes(recipes, order.items);
  const byId = await loadItemsById(InventoryItem, stockIngredientIds(recipes), session);
  const { shortages, resolved } = resolveAgainstStock(consumption, byId);
  if (shortages.length) throwShortages(shortages);

  const deductions = [];
  const alerts = [];
  for (const need of resolved) {
    let updated = await InventoryItem.findOneAndUpdate(
      { _id: need.inventoryItem, currentStock: { $gte: need.qty } },
      { $inc: { currentStock: -need.qty } },
      { returnDocument: "after", session }
    );
    if (!updated) {
      // Lost a race against another order between validation and deduction.
      const err = new Error(`Stock for ingredient ${need.inventoryItem} changed concurrently — please retry`);
      err.statusCode = 409;
      throw err;
    }
    // Fractional units (0.1 l) leave float residue after $inc (0.19999…) —
    // pin the stored balance to the same 6-dp precision as the quantities.
    if (updated.currentStock !== roundQty(updated.currentStock)) {
      updated = await InventoryItem.findByIdAndUpdate(
        updated._id, { $set: { currentStock: roundQty(updated.currentStock) } }, { returnDocument: "after", session }
      );
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
      alerts.push({ item: typeof updated.toObject === "function" ? updated.toObject() : updated, level });
    }
  }

  // Making-cost snapshot per order line. Uses the items loaded before the
  // $inc — fine, since a deduction changes stock, never cost price.
  const recipeByMenuItem = new Map(recipes.map((r) => [String(r.menuItem), r]));
  const update = { stockDeductions: deductions };
  (order.items || []).forEach((line, idx) => {
    const recipe = recipeByMenuItem.get(String(line.menuItem));
    if (!recipe) return;
    const { totalCost, incomplete } = computeRecipeCost(recipe.ingredients, byId);
    // A partly-costed recipe still records its known lower bound; a recipe
    // with no usable cost at all records nothing rather than a fake ₹0.
    update[`items.${idx}.makingCost`] = incomplete && totalCost === 0 ? null : totalCost;
  });
  await Order.findByIdAndUpdate(order._id, { $set: update }, { session });

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
    { session, returnDocument: "after" }
  );
  if (!claimed) return { reversed: false };

  for (const d of claimed.stockDeductions) {
    let updated = await InventoryItem.findByIdAndUpdate(
      d.inventoryItem,
      { $inc: { currentStock: d.qty } },
      { returnDocument: "after", session }
    );
    if (!updated) continue; // item was deleted since — nothing to credit back to
    if (updated.currentStock !== roundQty(updated.currentStock)) {
      updated = await InventoryItem.findByIdAndUpdate(
        updated._id, { $set: { currentStock: roundQty(updated.currentStock) } }, { returnDocument: "after", session }
      );
    }

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
const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ymdIn = (date, tz) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};

/**
 * INV-04: a typed-in line → a stock item. An item with that name (any case)
 * is reused; otherwise one is created from the line (unit as entered, or
 * pcs), so the item master fills itself as goods arrive.
 */
const stockItemForManualLine = async ({ InventoryItem, line, session }) => {
  const existing = await InventoryItem.findOne({ name: { $regex: `^${escapeRegex(line.name)}$`, $options: "i" } }).session(session || null);
  if (existing) return existing;
  try {
    const [created] = await InventoryItem.create(
      [{ name: line.name, unit: line.unit || "pcs", costPrice: line.costPrice, currentStock: 0 }],
      { session },
    );
    return created;
  } catch (err) {
    if (err?.code === 11000) return InventoryItem.findOne({ name: line.name }).session(session || null);
    throw err;
  }
};

/**
 * Record Purchase (Hotel KHOAI INV-01..07 — rules in utils/purchaseBill.js).
 * @param strict  true for the Record Purchase form: bill date + time and
 *                Paid/Credit are required. The bill-import flow (older) may
 *                send a plain purchaseDate and no payment details.
 */
export const recordPurchase = async ({ models, body, actor, session, strict = false, now = new Date() }) => {
  const { StockPurchase, InventoryItem, StockLedger, InventoryBatch, Counter, RestaurantProfile, Supplier } = models;
  const { supplier, notes } = body;
  const lines = normalizePurchaseLines(body.items);

  // Timezone for the bill's date/time (restaurant time, never the server's).
  const prof = RestaurantProfile ? await RestaurantProfile.findOne().select("timezone").lean() : null;
  const tz = resolveTimezone(prof?.timezone);
  const toInstant = (y, m, d, h, mi) => new Date(zonedInstant(y, m, d, h, tz).getTime() + mi * 60000);

  // INV-03
  let purchaseDate, billDate = "", billTime = "";
  if (strict || body.billDate || body.billTime) {
    purchaseDate = validateBillDateTime(body, { now, toInstant });
    billDate = body.billDate; billTime = body.billTime;
  } else {
    purchaseDate = body.purchaseDate ? new Date(body.purchaseDate) : now;
    if (Number.isNaN(purchaseDate.getTime())) throw httpError("Invalid purchase date");
  }

  if (supplier && Supplier && !(await Supplier.exists({ _id: supplier }))) throw httpError("That supplier no longer exists — refresh and pick again", 404);

  // Resolve every line to a stock item, converting a line entered in another
  // compatible unit (2 kg of an item stocked in g) — rate is per the line's unit.
  const resolved = [];
  for (const line of lines) {
    let stockItem = null;
    if (line.manual) stockItem = await stockItemForManualLine({ InventoryItem, line, session });
    else if (line.unit) {
      stockItem = await InventoryItem.findById(line.inventoryItem).session(session || null);
      if (!stockItem) throw httpError("A stock item on this purchase no longer exists — refresh and try again", 404);
    }
    let qty = line.quantity, unitCost = line.costPrice;
    if (stockItem && line.unit && line.unit !== stockItem.unit) {
      qty = convertQuantity(line.quantity, line.unit, stockItem.unit);
      unitCost = money(line.amount / qty);
    }
    resolved.push({
      ...line,
      inventoryItem: stockItem ? stockItem._id : line.inventoryItem,
      name: line.name || stockItem?.name || "",
      unit: line.unit || stockItem?.unit || "",
      stockQty: qty, stockUnitCost: unitCost,
    });
  }
  const totalCost = money(resolved.reduce((sum, l) => sum + l.amount, 0));

  // INV-06/07
  const pay = paymentPlan(body, totalCost, { required: strict });

  // INV-02 — supplier's number, else a clearly marked system one.
  const typed = resolveBillNumber({ billNumber: body.billNumber ?? body.invoiceNumber, billNumberSource: body.billNumberSource });
  let invoiceNumber = typed?.number || "", billNumberSource = typed?.source;
  if (!typed && Counter) {
    const day = billDate || ymdIn(purchaseDate, tz);
    const c = await Counter.findOneAndUpdate(
      { _id: `purchaseBill:${day}` }, { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after", session },
    );
    invoiceNumber = systemBillNumber(day, c.seq);
    billNumberSource = "SYSTEM";
  }

  const billPhoto = typeof body.billPhoto === "string" && /^https:\/\//i.test(body.billPhoto) ? body.billPhoto : "";

  const [purchase] = await StockPurchase.create(
    [{
      supplier: supplier || null,
      items: resolved.map(({ inventoryItem, name, unit, manual, quantity, costPrice, amount, batchNo, expiryDate }) =>
        ({ inventoryItem, name, unit, manual, quantity, costPrice, amount, batchNo, expiryDate })),
      totalCost,
      invoiceNumber,
      billNumberSource,
      purchaseDate,
      billDate, billTime, billPhoto,
      notes: notes || "",
      paymentType: pay.paymentType,
      paymentSource: pay.paymentSource,
      payable: pay.payable,
      createdBy: actor,
    }],
    { session }
  );

  for (const it of resolved) {
    const updated = await InventoryItem.findByIdAndUpdate(
      it.inventoryItem,
      { $inc: { currentStock: it.stockQty }, $set: { costPrice: it.stockUnitCost } },
      { returnDocument: "after", session }
    );
    if (!updated) continue;

    await StockLedger.create(
      [{
        inventoryItem: updated._id,
        type: "PURCHASE",
        quantity: it.stockQty,
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
          quantity: it.stockQty,
          costPrice: it.stockUnitCost,
          expiryDate: it.expiryDate || null,
          purchase: purchase._id,
        }],
        { session }
      );
    }
  }

  return purchase;
};

/**
 * INV-07 / INV-06 — pay back what a purchase still owes (the owner for
 * Owner's Pocket, the supplier for Credit), from the cash drawer or bank.
 * Atomic and conditional: settles once, a second click is a 409.
 */
export const settlePurchasePayable = async ({ models, purchaseId, source, actor, now = new Date() }) => {
  const { StockPurchase } = models;
  if (!["CASH_DRAWER", "BANK_UPI"].includes(source)) throw httpError("Pay it back from the Cash Drawer or Bank/UPI");
  const updated = await StockPurchase.findOneAndUpdate(
    { _id: purchaseId, "payable.to": { $in: ["OWNER", "SUPPLIER"] }, "payable.settledAt": null },
    { $set: { "payable.settledAt": now, "payable.settledSource": source, "payable.settledBy": actor } },
    { returnDocument: "after" },
  );
  if (!updated) {
    const p = await StockPurchase.findById(purchaseId).select("payable").lean();
    if (!p) throw httpError("Purchase not found", 404);
    throw httpError(p.payable ? "This has already been paid back" : "Nothing is owed on this purchase", 409);
  }
  return updated;
};

/** Open payables: owed to the owner (Owner's Pocket) and to suppliers (Credit). */
export const listOpenPayables = async ({ models }) => {
  const rows = await models.StockPurchase.find({ "payable.settledAt": null, "payable.to": { $in: ["OWNER", "SUPPLIER"] } })
    .sort({ purchaseDate: 1 }).populate("supplier", "name phone").lean();
  const sum = (list) => money(list.reduce((s, p) => s + (p.payable?.amount || 0), 0));
  const owner = rows.filter((p) => p.payable.to === "OWNER");
  const suppliers = rows.filter((p) => p.payable.to === "SUPPLIER");
  return { owner, suppliers, ownerTotal: sum(owner), supplierTotal: sum(suppliers) };
};

// ── Wastage ──────────────────────────────────────────────────────────────
/**
 * INV-08..10: waste of a stock item (deducted, converted from the unit it
 * was weighed in) or of something not stocked (name only — logged for loss
 * reporting, no stock to move). Reason "Other" needs its free text.
 */
export const recordWastage = async ({ models, body, actor, session }) => {
  const { WastageLog, InventoryItem, StockLedger } = models;
  const { inventoryItem, notes, wastageDate } = body;
  const quantity = Number(body.quantity);
  const unit = body.unit ? String(body.unit) : "";
  const reason = body.reason || "Other";
  const reasonText = String(body.reasonText ?? "").trim().slice(0, 200);

  if (!(quantity > 0)) throw httpError("Quantity must be more than 0");
  if (unit && !STOCK_UNITS.includes(unit)) throw httpError(`Unknown unit "${unit}"`);
  if (!WASTAGE_REASONS.includes(reason)) throw httpError(`Reason must be one of: ${WASTAGE_REASONS.join(", ")}`);
  if (reason === "Other" && !reasonText) throw httpError("Write the reason for \"Others\"");

  // INV-08 — not a stock item: name, quantity + unit, optional cost.
  if (!inventoryItem) {
    const itemName = String(body.itemName ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (!itemName) throw httpError("Pick a stock item or type the item name");
    if (!unit) throw httpError("Choose the unit (pcs, kg, …)");
    const cost = body.cost === undefined || body.cost === "" ? 0 : Number(body.cost);
    if (!(cost >= 0)) throw httpError("Cost must be 0 or more");
    const [log] = await WastageLog.create(
      [{ inventoryItem: null, itemName, quantity, unit, reason, reasonText, costImpact: money(cost), notes: notes || "", recordedBy: actor, wastageDate: wastageDate || new Date() }],
      { session },
    );
    return log;
  }

  // INV-09 — weighed in another compatible unit than the item is stocked in.
  let stockQty = quantity;
  if (unit) {
    const item = await InventoryItem.findById(inventoryItem).session(session || null);
    if (!item) throw httpError("Stock item not found", 404);
    if (unit !== item.unit) stockQty = convertQuantity(quantity, unit, item.unit);
  }

  const updated = await InventoryItem.findOneAndUpdate(
    { _id: inventoryItem, currentStock: { $gte: stockQty } },
    { $inc: { currentStock: -stockQty } },
    { returnDocument: "after", session }
  );
  if (!updated) {
    const err = new Error("Insufficient stock to record this wastage");
    err.statusCode = 409;
    throw err;
  }

  const costImpact = money(stockQty * (updated.costPrice || 0));

  const [log] = await WastageLog.create(
    [{
      inventoryItem: updated._id, itemName: updated.name || "", quantity, unit: unit || updated.unit || "",
      reason, reasonText, costImpact, notes: notes || "", recordedBy: actor,
      wastageDate: wastageDate || new Date(),
    }],
    { session }
  );

  await StockLedger.create(
    [{
      inventoryItem: updated._id,
      type: "WASTAGE",
      quantity: -stockQty,
      balanceAfter: updated.currentStock,
      relatedWastage: log._id,
      reason: reason === "Other" ? reasonText : reason,
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
// One serving's shortfall for a STOCK ingredient, in the stock item's unit —
// or null when there's enough. A unit that can't convert counts as short.
const servingShortfall = (ing, item) => {
  let required = Number(ing.quantity);
  if (item?.unit) {
    try { required = convertQuantity(ing.quantity, ing.unit, item.unit); }
    catch { required = Infinity; }
  }
  if (item && item.status === "Active" && item.currentStock >= required) return null;
  return {
    inventoryItem: ing.inventoryItem,
    name: item?.name || ing.name || "Unknown ingredient",
    required: Number.isFinite(required) ? required : ing.quantity,
    available: item?.currentStock ?? 0,
    unit: item?.unit || ing.unit,
  };
};

const stockIngredients = (recipe) =>
  (recipe.ingredients || []).filter((i) => ingredientSource(i) === "STOCK" && i.inventoryItem);

/**
 * Bulk version of computeMenuItemStockStatus, for menu listing endpoints
 * (avoids N+1 queries). Returns a Map<menuItemId, { tracked, inStock }>.
 * Menu items with no active recipe (or a recipe of only CUSTOM ingredients)
 * are always `{ tracked: false, inStock: true }` — i.e. untracked items never
 * get hidden or flagged by this.
 */
export const computeStockStatusForMenuItems = async ({ models, menuItemIds }) => {
  const { Recipe, InventoryItem } = models;
  const result = new Map();
  if (!menuItemIds?.length) return result;

  const recipes = (await Recipe.find({ menuItem: { $in: menuItemIds }, status: "Active" }).lean())
    .filter((r) => stockIngredients(r).length);
  if (!recipes.length) return result; // nobody tracked → caller treats all as inStock

  const items = await InventoryItem.find({ _id: { $in: stockIngredientIds(recipes) } }).lean();
  const byId = new Map(items.map((i) => [String(i._id), i]));

  for (const recipe of recipes) {
    const inStock = stockIngredients(recipe).every((ing) => !servingShortfall(ing, byId.get(String(ing.inventoryItem))));
    result.set(String(recipe.menuItem), { tracked: true, inStock });
  }

  return result;
};

export const computeMenuItemStockStatus = async ({ models, menuItemId }) => {
  const { Recipe, InventoryItem } = models;
  const recipe = await Recipe.findOne({ menuItem: menuItemId, status: "Active" });
  const ings = recipe ? stockIngredients(recipe) : [];
  if (!ings.length) return { tracked: false, inStock: true, shortages: [] };

  const items = await InventoryItem.find({ _id: { $in: ings.map((i) => i.inventoryItem) } });
  const byId = new Map(items.map((i) => [String(i._id), i]));

  const shortages = ings
    .map((ing) => servingShortfall(ing, byId.get(String(ing.inventoryItem))))
    .filter(Boolean);

  return { tracked: true, inStock: shortages.length === 0, shortages };
};

// ── Recipes (save + costed reads) ──────────────────────────────────────────
/**
 * Validates and saves one menu item's recipe, with a cost snapshot.
 * Body: { menuItem, ingredients: [{ sourceType, inventoryItem?, name?, quantity, unit, cost? }] }
 *   STOCK:  inventoryItem required; unit must convert to the stock item's unit.
 *   CUSTOM: name required; `cost` is the price of `quantity` (₹, >= 0).
 * Never trusts a client-sent unitCost/cost for STOCK lines — re-derived here.
 */
export const saveRecipe = async ({ models, body }) => {
  const { Recipe, InventoryItem, MenuItem } = models;
  const { menuItem, ingredients } = body || {};
  if (!menuItem || !Array.isArray(ingredients)) throw httpError("menuItem and ingredients[] are required");
  if (!ingredients.length) throw httpError("Add at least one ingredient");
  if (ingredients.length > 60) throw httpError("A recipe can have at most 60 ingredients");

  const menuDoc = await MenuItem.findById(menuItem).lean();
  if (!menuDoc) throw httpError("Menu item not found", 404);

  const stockIds = ingredients
    .filter((i) => ingredientSource(i) === "STOCK" && i.inventoryItem)
    .map((i) => String(i.inventoryItem));
  const items = stockIds.length ? await InventoryItem.find({ _id: { $in: stockIds } }).lean() : [];
  const byId = new Map(items.map((i) => [String(i._id), i]));
  const stockNames = new Set(
    (await InventoryItem.find({ status: "Active" }, { name: 1 }).lean()).map((i) => i.name.trim().toLowerCase()),
  );

  const seenStock = new Set();
  const seenCustom = new Set();
  const clean = ingredients.map((raw, idx) => {
    const n = idx + 1;
    const sourceType = raw.sourceType ?? "STOCK";
    if (!INGREDIENT_SOURCES.includes(sourceType)) throw httpError(`Ingredient ${n}: unknown type "${sourceType}"`);

    const quantity = Number(raw.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw httpError(`Ingredient ${n}: quantity must be greater than 0`);
    const unit = normalizeUnit(raw.unit);
    if (!unit || !STOCK_UNITS.includes(unit)) throw httpError(`Ingredient ${n}: unknown unit "${raw.unit ?? ""}"`);

    if (sourceType === "STOCK") {
      const item = byId.get(String(raw.inventoryItem));
      if (!item) throw httpError(`Ingredient ${n}: stock item not found`);
      if (item.status !== "Active") throw httpError(`"${item.name}" is inactive — reactivate it or remove it from the recipe`);
      if (seenStock.has(String(item._id))) throw httpError(`"${item.name}" is listed twice — combine it into one line`);
      seenStock.add(String(item._id));
      if (!areUnitsCompatible(unit, item.unit)) {
        throw httpError(`"${item.name}" is stocked in ${item.unit} — ${unit} can't be converted to it`);
      }
      return { sourceType, inventoryItem: item._id, name: item.name, quantity, unit };
    }

    const name = String(raw.name || "").trim();
    if (!name) throw httpError(`Ingredient ${n}: a custom ingredient needs a name`);
    const key = name.toLowerCase();
    if (seenCustom.has(key)) throw httpError(`"${name}" is listed twice — combine it into one line`);
    seenCustom.add(key);
    if (stockNames.has(key)) throw httpError(`"${name}" is a stock item — pick it as a Stock item so its stock is deducted`);
    const cost = Number(raw.cost);
    if (raw.cost === "" || raw.cost == null || !Number.isFinite(cost) || cost < 0) {
      throw httpError(`"${name}": price must be 0 or more`);
    }
    return { sourceType, inventoryItem: null, name, quantity, unit, cost };
  });

  const { lines, totalCost, incomplete } = computeRecipeCost(clean, byId);
  const snapshot = clean.map((ing, i) => ({ ...ing, unitCost: lines[i].unitCost, cost: lines[i].cost }));

  return Recipe.findOneAndUpdate(
    { menuItem },
    {
      menuItem, ingredients: snapshot, status: "Active",
      totalCost, costIncomplete: incomplete, costedAt: new Date(),
    },
    { returnDocument: "after", upsert: true, runValidators: true },
  );
};

/**
 * Recipes with their live cost (today's stock prices) and the menu price
 * margin. `savedCost` is the snapshot from the last save, for comparison.
 */
export const listRecipesWithCost = async ({ models, menuItemId }) => {
  const { Recipe, InventoryItem } = models;
  const filter = menuItemId ? { menuItem: menuItemId } : {};
  const recipes = await Recipe.find(filter)
    .populate("menuItem", "name nameBn category image isAvailable price")
    .lean();

  const items = await InventoryItem.find({ _id: { $in: stockIngredientIds(recipes) } })
    .select("name nameBn unit currentStock costPrice status reorderLevel criticalLevel").lean();
  const byId = new Map(items.map((i) => [String(i._id), i]));

  return recipes.map((r) => {
    const { lines, totalCost, incomplete } = computeRecipeCost(r.ingredients, byId);
    const price = Number(r.menuItem?.price) || 0;
    const ingredients = r.ingredients.map((ing, i) => {
      const stockItem = ing.inventoryItem ? byId.get(String(ing.inventoryItem)) : null;
      return {
        ...ing,
        sourceType: ingredientSource(ing),
        name: stockItem?.name || ing.name || "",
        nameBn: stockItem?.nameBn || "",
        // Populated-shape kept for existing UI consumers ({ _id, name, unit, … }).
        inventoryItem: stockItem || ing.inventoryItem || null,
        liveUnitCost: lines[i].unitCost,
        liveCost: lines[i].cost,
        costError: lines[i].error,
      };
    });
    return {
      ...r,
      ingredients,
      savedCost: r.totalCost ?? null,
      makingCost: totalCost,
      costIncomplete: incomplete,
      sellingPrice: price,
      grossMargin: price ? money(price - totalCost) : null,
      foodCostPct: price ? Math.round((totalCost / price) * 1000) / 10 : null,
    };
  });
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
  }).populate("inventoryItem", "name nameBn unit").lean();

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
