// controllers/inventoryController.js
// ─────────────────────────────────────────────────────────────────────────────
// Thin HTTP layer for the Inventory module. Real logic lives in
// services/inventoryService.js (shared with the order lifecycle for
// deduction/reversal) — this file just validates the request shape, calls
// the service, and shapes the response for the Admin UI's 8 sub-pages.
// ─────────────────────────────────────────────────────────────────────────────

import { buildActor } from "../services/orderService.js";
import {
  recordPurchase, recordWastage, adjustStock,
  computeInventoryOverview, computeMenuItemStockStatus,
} from "../services/inventoryService.js";
import { classifyStockLevel } from "../utils/inventoryConstants.js";
import { emitInventoryAlert } from "../sockets/socket.js";

const withLevel = (item) => ({
  ...item,
  stockLevel: classifyStockLevel(item.currentStock, item.reorderLevel, item.criticalLevel),
});

const maybeAlert = (req, item) => {
  const level = classifyStockLevel(item.currentStock, item.reorderLevel, item.criticalLevel);
  if (level !== "OK") emitInventoryAlert(req.tenantKey, { item, level });
};

// ═══════════════════════════════ Overview ═══════════════════════════════════
export const getOverview = async (req, res) => {
  try {
    const days = Number(req.query.expiringWithinDays) || 7;
    const overview = await computeInventoryOverview({ models: req.models, expiringWithinDays: days });
    res.json({ success: true, data: overview });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ═══════════════════════════════ Suppliers ═══════════════════════════════════
export const getSuppliers = async (req, res) => {
  try {
    const { Supplier } = req.models;
    const suppliers = await Supplier.find().sort({ name: 1 });
    res.json({ suppliers });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const createSupplier = async (req, res) => {
  try {
    const { Supplier } = req.models;
    const supplier = await Supplier.create(req.body);
    res.status(201).json({ supplier });
  } catch (err) { res.status(400).json({ message: err.message }); }
};

export const updateSupplier = async (req, res) => {
  try {
    const { Supplier } = req.models;
    const supplier = await Supplier.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!supplier) return res.status(404).json({ message: "Supplier not found" });
    res.json({ supplier });
  } catch (err) { res.status(400).json({ message: err.message }); }
};

export const deleteSupplier = async (req, res) => {
  try {
    const { Supplier } = req.models;
    await Supplier.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ═══════════════════════════════ Stock Items ═════════════════════════════════
export const getItems = async (req, res) => {
  try {
    const { InventoryItem } = req.models;
    const { category, status, search } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (status)   filter.status = status;
    if (search)   filter.name = { $regex: search, $options: "i" };

    const items = await InventoryItem.find(filter).sort({ name: 1 }).populate("supplier", "name").lean();
    res.json({ items: items.map(withLevel) });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const getItemById = async (req, res) => {
  try {
    const { InventoryItem, StockLedger } = req.models;
    const item = await InventoryItem.findById(req.params.id).populate("supplier", "name").lean();
    if (!item) return res.status(404).json({ message: "Item not found" });
    const recentLedger = await StockLedger.find({ inventoryItem: item._id })
      .sort({ createdAt: -1 }).limit(30);
    res.json({ item: withLevel(item), recentLedger });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const createItem = async (req, res) => {
  try {
    const { InventoryItem } = req.models;
    const { name, unit, category, reorderLevel, criticalLevel, costPrice, supplier, isBatchTracked, notes } = req.body;
    if (!name || !unit) return res.status(400).json({ message: "name and unit are required" });

    const item = await InventoryItem.create({
      name, unit, category: category || "",
      reorderLevel: Number(reorderLevel) || 0,
      criticalLevel: Number(criticalLevel) || 0,
      costPrice: Number(costPrice) || 0,
      supplier: supplier || null,
      isBatchTracked: !!isBatchTracked,
      notes: notes || "",
      currentStock: 0, // stock always enters via a Purchase, never set directly at creation
    });
    res.status(201).json({ item: withLevel(item.toObject()) });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: `An item named "${req.body.name}" already exists` });
    res.status(400).json({ message: err.message });
  }
};

export const updateItem = async (req, res) => {
  try {
    const { InventoryItem } = req.models;
    // currentStock is intentionally NOT editable here — it only ever
    // changes via purchase/adjust/wastage/deduction/reversal, each of which
    // writes a StockLedger entry. Editing it directly would create an
    // unaudited stock change.
    const { currentStock, ...rest } = req.body;
    const item = await InventoryItem.findByIdAndUpdate(req.params.id, rest, { new: true });
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json({ item: withLevel(item.toObject()) });
  } catch (err) { res.status(400).json({ message: err.message }); }
};

export const deleteItem = async (req, res) => {
  try {
    const { InventoryItem } = req.models;
    // Soft delete — preserves ledger/recipe history integrity.
    const item = await InventoryItem.findByIdAndUpdate(req.params.id, { status: "Inactive" }, { new: true });
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json({ message: "Item deactivated", item });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// PATCH /:id/adjust — manual adjustment or physical stock count
export const adjustItemStock = async (req, res) => {
  try {
    const { newStock, type, reason } = req.body;
    const actor = buildActor(req.user);
    const item = await adjustStock({
      models: req.models, inventoryItemId: req.params.id, newStock: Number(newStock),
      type, reason, actor,
    });
    maybeAlert(req, item.toObject());
    res.json({ item: withLevel(item.toObject()) });
  } catch (err) { res.status(err.statusCode || 400).json({ message: err.message }); }
};

// ═══════════════════════════════ Purchases ═══════════════════════════════════
export const getPurchases = async (req, res) => {
  try {
    const { StockPurchase } = req.models;
    const purchases = await StockPurchase.find()
      .sort({ createdAt: -1 })
      .populate("supplier", "name")
      .populate("items.inventoryItem", "name unit");
    res.json({ purchases });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const getPurchaseById = async (req, res) => {
  try {
    const { StockPurchase } = req.models;
    const purchase = await StockPurchase.findById(req.params.id)
      .populate("supplier", "name")
      .populate("items.inventoryItem", "name unit");
    if (!purchase) return res.status(404).json({ message: "Purchase not found" });
    res.json({ purchase });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const createPurchase = async (req, res) => {
  const session = await req.db.startSession();
  try {
    const actor = buildActor(req.user);
    let purchase;
    await session.withTransaction(async () => {
      purchase = await recordPurchase({ models: req.models, body: req.body, actor, session });
    });
    res.status(201).json({ purchase });
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message });
  } finally {
    session.endSession();
  }
};

// ═══════════════════════════════ Stock Movements (ledger) ═══════════════════
export const getMovements = async (req, res) => {
  try {
    const { StockLedger } = req.models;
    const { inventoryItem, type, from, to, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (inventoryItem) filter.inventoryItem = inventoryItem;
    if (type) filter.type = type;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to)   filter.createdAt.$lte = new Date(to);
    }

    const [movements, total] = await Promise.all([
      StockLedger.find(filter).sort({ createdAt: -1 })
        .skip((page - 1) * limit).limit(Number(limit))
        .populate("inventoryItem", "name unit"),
      StockLedger.countDocuments(filter),
    ]);
    res.json({ movements, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ═══════════════════════════════ Low Stock ═══════════════════════════════════
export const getLowStock = async (req, res) => {
  try {
    const { InventoryItem } = req.models;
    const items = await InventoryItem.find({ status: "Active" }).populate("supplier", "name").lean();
    const flagged = items.map(withLevel).filter((i) => i.stockLevel !== "OK");
    // Worst-first for a floor-manager glance.
    const order = { OUT_OF_STOCK: 0, CRITICAL: 1, LOW: 2 };
    flagged.sort((a, b) => order[a.stockLevel] - order[b.stockLevel]);
    res.json({ items: flagged });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ═══════════════════════════════ Wastage ═════════════════════════════════════
export const getWastage = async (req, res) => {
  try {
    const { WastageLog } = req.models;
    const { from, to } = req.query;
    const filter = {};
    if (from || to) {
      filter.wastageDate = {};
      if (from) filter.wastageDate.$gte = new Date(from);
      if (to)   filter.wastageDate.$lte = new Date(to);
    }
    const logs = await WastageLog.find(filter).sort({ wastageDate: -1 }).populate("inventoryItem", "name unit");
    res.json({ logs });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const createWastage = async (req, res) => {
  const session = await req.db.startSession();
  try {
    const actor = buildActor(req.user);
    let log, item;
    await session.withTransaction(async () => {
      log = await recordWastage({ models: req.models, body: req.body, actor, session });
      item = await req.models.InventoryItem.findById(log.inventoryItem).session(session);
    });
    if (item) maybeAlert(req, item.toObject());
    res.status(201).json({ log });
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message });
  } finally {
    session.endSession();
  }
};

// ═══════════════════════════════ Recipes ═════════════════════════════════════
export const getRecipes = async (req, res) => {
  try {
    const { Recipe } = req.models;
    const recipes = await Recipe.find()
      .populate("menuItem", "name category image isAvailable")
      .populate("ingredients.inventoryItem", "name unit currentStock");
    res.json({ recipes });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// GET /recipes/menu-item/:menuItemId — recipe + live computed stock status,
// this is the "connect inventory availability with menu availability" surface.
export const getRecipeForMenuItem = async (req, res) => {
  try {
    const { Recipe } = req.models;
    const recipe = await Recipe.findOne({ menuItem: req.params.menuItemId })
      .populate("ingredients.inventoryItem", "name unit currentStock");
    const stockStatus = await computeMenuItemStockStatus({ models: req.models, menuItemId: req.params.menuItemId });
    res.json({ recipe: recipe || null, stockStatus });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const upsertRecipe = async (req, res) => {
  try {
    const { Recipe, InventoryItem } = req.models;
    const { menuItem, ingredients } = req.body;
    if (!menuItem || !Array.isArray(ingredients)) {
      return res.status(400).json({ message: "menuItem and ingredients[] are required" });
    }

    // Unit-mismatch guard — see utils/inventoryConstants.js: no auto-conversion.
    const items = await InventoryItem.find({ _id: { $in: ingredients.map((i) => i.inventoryItem) } });
    const byId = new Map(items.map((i) => [String(i._id), i]));
    for (const ing of ingredients) {
      const stockItem = byId.get(String(ing.inventoryItem));
      if (!stockItem) return res.status(400).json({ message: `Unknown ingredient ${ing.inventoryItem}` });
      if (stockItem.unit !== ing.unit) {
        return res.status(400).json({
          message: `"${stockItem.name}" is stocked in "${stockItem.unit}" — recipe quantity must use the same unit`,
        });
      }
    }

    const recipe = await Recipe.findOneAndUpdate(
      { menuItem },
      { menuItem, ingredients, status: "Active" },
      { new: true, upsert: true }
    );
    res.status(201).json({ recipe });
  } catch (err) { res.status(400).json({ message: err.message }); }
};

export const deleteRecipe = async (req, res) => {
  try {
    const { Recipe } = req.models;
    await Recipe.findByIdAndDelete(req.params.id);
    res.json({ message: "Recipe deleted" });
  } catch (err) { res.status(500).json({ message: err.message }); }
};
