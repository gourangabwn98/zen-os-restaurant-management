// controllers/inventoryController.js
// ─────────────────────────────────────────────────────────────────────────────
// Thin HTTP layer for the Inventory module. Real logic lives in
// services/inventoryService.js (shared with the order lifecycle for
// deduction/reversal) — this file just validates the request shape, calls
// the service, and shapes the response for the Admin UI's 8 sub-pages.
// ─────────────────────────────────────────────────────────────────────────────

import { buildActor } from "../services/orderService.js";
import {
  recordPurchase, recordWastage, adjustStock, settlePurchasePayable, listOpenPayables,
  computeInventoryOverview, computeMenuItemStockStatus,
  listRecipesWithCost, saveRecipe,
} from "../services/inventoryService.js";
import { classifyStockLevel } from "../utils/inventoryConstants.js";
import { emitInventoryAlert } from "../sockets/socket.js";
import { cleanSupplierInput } from "../utils/supplierInput.js";
import { cashOutBySource } from "../utils/purchaseBill.js";
import { extractDocumentText } from "../utils/purchaseImportExtract.js";
import { extractDocumentMeta } from "../utils/purchaseImportParser.js";
import { sniffFileType } from "../middleware/importUploadMiddleware.js";
import cloudinary from "../config/cloudinary.js";
import { Readable } from "stream";

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
    const suppliers = await Supplier.find().sort({ name: 1 }).populate("suppliedItems.inventoryItem", "name nameBn unit");
    res.json({ suppliers });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// INV-01/11..14 — validated fields only; creatable inline from Record Purchase.
export const createSupplier = async (req, res) => {
  try {
    const { Supplier } = req.models;
    const supplier = await Supplier.create(cleanSupplierInput(req.body));
    res.status(201).json({ supplier });
  } catch (err) { res.status(err.statusCode || 400).json({ message: err.message }); }
};

export const updateSupplier = async (req, res) => {
  try {
    const { Supplier } = req.models;
    const supplier = await Supplier.findByIdAndUpdate(
      req.params.id, { $set: cleanSupplierInput(req.body, { partial: true }) }, { returnDocument: "after", runValidators: true },
    );
    if (!supplier) return res.status(404).json({ message: "Supplier not found" });
    res.json({ supplier });
  } catch (err) { res.status(err.statusCode || 400).json({ message: err.message }); }
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
    const { name, nameBn, unit, category, reorderLevel, criticalLevel, costPrice, supplier, isBatchTracked, notes } = req.body;
    if (!name || !unit) return res.status(400).json({ message: "name and unit are required" });

    const item = await InventoryItem.create({
      name, nameBn: String(nameBn || "").trim(), unit, category: category || "",
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
    const item = await InventoryItem.findByIdAndUpdate(req.params.id, rest, { returnDocument: "after" });
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json({ item: withLevel(item.toObject()) });
  } catch (err) { res.status(400).json({ message: err.message }); }
};

export const deleteItem = async (req, res) => {
  try {
    const { InventoryItem } = req.models;
    // Soft delete — preserves ledger/recipe history integrity.
    const item = await InventoryItem.findByIdAndUpdate(req.params.id, { status: "Inactive" }, { returnDocument: "after" });
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
      .populate("items.inventoryItem", "name nameBn unit");
    res.json({ purchases });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const getPurchaseById = async (req, res) => {
  try {
    const { StockPurchase } = req.models;
    const purchase = await StockPurchase.findById(req.params.id)
      .populate("supplier", "name")
      .populate("items.inventoryItem", "name nameBn unit");
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
      // strict: the Record Purchase form — bill date + time and Paid/Credit required.
      purchase = await recordPurchase({ models: req.models, body: req.body, actor, session, strict: true });
    });
    res.status(201).json({ purchase });
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message });
  } finally {
    session.endSession();
  }
};

// ═══════════════════════ Bill photo (INV-05 → INV-02) ═══════════════════════
// The photo is kept (it's the purchase's proof), and its text is read to
// suggest the supplier's bill number / date. A failed or slow read never
// loses the photo — the user just types the number.
const BILL_PHOTO_OCR_MS = 20_000;
const uploadBillPhoto = (buffer) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(
    { folder: "khoai-purchase-bills", resource_type: "image", transformation: [{ width: 1800, height: 1800, crop: "limit", quality: "auto" }] },
    (err, result) => (err ? reject(err) : resolve(result.secure_url)),
  );
  Readable.from(buffer).pipe(stream);
});

export const uploadPurchaseBillPhoto = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No photo uploaded" });
    const type = sniffFileType(req.file.buffer);
    if (!type || type === "application/pdf") return res.status(400).json({ message: "Upload a JPG, PNG or WEBP photo of the bill" });
    const billPhoto = await uploadBillPhoto(req.file.buffer);
    let guess = { billNumberGuess: "", billDateGuess: null, totalGuess: null, ocr: "unavailable" };
    try {
      const extraction = await Promise.race([
        extractDocumentText(req.file.buffer, type),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), BILL_PHOTO_OCR_MS)),
      ]);
      const meta = extractDocumentMeta(extraction.rawText || "");
      guess = {
        billNumberGuess: meta.invoiceNumberGuess || "",
        billDateGuess: meta.purchaseDateGuess || null,
        totalGuess: meta.totalAmountGuess ?? null,
        ocr: "done",
      };
    } catch { /* keep the photo; the number is typed by hand */ }
    res.status(201).json({ billPhoto, ...guess });
  } catch (err) { res.status(err.statusCode || 500).json({ message: err.message || "Couldn't save the photo" }); }
};

// ═══════════════════════ Payables (INV-06/07) ═══════════════════════════════
export const getPayables = async (req, res) => {
  try { res.json(await listOpenPayables({ models: req.models })); }
  catch (err) { res.status(err.statusCode || 500).json({ message: err.message }); }
};

// POST /purchases/:id/settle-payable  { source: "CASH_DRAWER" | "BANK_UPI" }
export const settlePayable = async (req, res) => {
  try {
    const purchase = await settlePurchasePayable({ models: req.models, purchaseId: req.params.id, source: req.body?.source, actor: buildActor(req.user) });
    res.json({ purchase });
  } catch (err) { res.status(err.statusCode || 500).json({ message: err.message }); }
};

// GET /cash-out?from&to — money that left the drawer / bank for purchases
// and payable pay-backs (Close the day, Insights). Owner's Pocket isn't
// business money out until it is repaid.
export const getCashOut = async (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) return res.status(400).json({ message: "Invalid date" });
    const range = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
    const filter = from || to ? { $or: [{ purchaseDate: range }, { "payable.settledAt": range }] } : {};
    const purchases = await req.models.StockPurchase.find(filter).select("totalCost purchaseDate paymentType paymentSource payable").lean();
    res.json({ from, to, ...cashOutBySource(purchases, { from, to }) });
  } catch (err) { res.status(err.statusCode || 500).json({ message: err.message }); }
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
        .populate("inventoryItem", "name nameBn unit"),
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
    const logs = await WastageLog.find(filter).sort({ wastageDate: -1 }).populate("inventoryItem", "name nameBn unit");
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
      // INV-08: hand-typed waste has no stock item to re-check.
      item = log.inventoryItem ? await req.models.InventoryItem.findById(log.inventoryItem).session(session) : null;
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
    const recipes = await listRecipesWithCost({ models: req.models });
    res.json({ recipes });
  } catch (err) { res.status(err.statusCode || 500).json({ message: err.message }); }
};

// GET /recipes/menu-item/:menuItemId — recipe (with live cost) + live computed
// stock status; the "connect inventory availability with menu availability" surface.
export const getRecipeForMenuItem = async (req, res) => {
  try {
    const [recipe] = await listRecipesWithCost({ models: req.models, menuItemId: req.params.menuItemId });
    const stockStatus = await computeMenuItemStockStatus({ models: req.models, menuItemId: req.params.menuItemId });
    res.json({ recipe: recipe || null, stockStatus });
  } catch (err) { res.status(err.statusCode || 500).json({ message: err.message }); }
};

// Validation, unit compatibility and the cost snapshot live in
// inventoryService.saveRecipe.
export const upsertRecipe = async (req, res) => {
  try {
    const recipe = await saveRecipe({ models: req.models, body: req.body });
    res.status(201).json({ recipe });
  } catch (err) { res.status(err.statusCode || 400).json({ message: err.message }); }
};

export const deleteRecipe = async (req, res) => {
  try {
    const { Recipe } = req.models;
    await Recipe.findByIdAndDelete(req.params.id);
    res.json({ message: "Recipe deleted" });
  } catch (err) { res.status(500).json({ message: err.message }); }
};
