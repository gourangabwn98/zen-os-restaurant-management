import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { getInventoryV3Models } from "../config/inventoryV3Models.js";
import { serverEnabled } from "./inventoryV3SettingsService.js";
import { effectiveRole } from "../middleware/rbac.js";
import { buildActor } from "./orderService.js";
import { cleanSupplierInput } from "../utils/supplierInput.js";
import { STOCK_UNITS } from "../utils/inventoryConstants.js";
import { resolveBillNumber, validateBillDateTime } from "../utils/purchaseBill.js";
import { zonedInstant } from "./offerStatsService.js";
import { resolveTimezone } from "../utils/menuSchedule.js";
import * as calc from "../utils/inventoryV3Calculations.js";

export const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
export const id = (value) => { if (!mongoose.isValidObjectId(value)) throw fail("Invalid record id"); return String(value); };
export const cleanText = (v, max = 200) => typeof v === "string" ? v.trim().slice(0, max) : "";
export const validDate = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || "") || Number.isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw fail("Enter a valid bill date");
  return v;
};
export const localDay = (date, timezone) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
export const profileTimezone = async (models) => resolveTimezone((await models.RestaurantProfile.findOne().select("timezone").lean())?.timezone);
export const dayInstant = (day, tz) => { const [y, m, d] = validDate(day).split("-").map(Number); return zonedInstant(y, m, d, 0, tz); };
export const v3Actor = (user) => ({ user: user._id, name: user.name || "", role: effectiveRole(user) });
export const positiveQty = (v) => { if (calc.quantityMicros(v) <= 0) throw fail("Quantity must be positive"); return Number(v); };
const rate = (v) => { calc.lineAmountPaise({ quantity: "1", unit: "pcs", unitRateRupees: v }); return Number(v); };
const attachment = (v) => {
  if (!v) return "";
  try { const u = new URL(v); if (u.protocol === "https:" && u.hostname === "res.cloudinary.com") return u.href; } catch { /* invalid */ }
  throw fail("Use an uploaded bill photo");
};
export const canonicalPayload = (value) => JSON.stringify(value, (_k, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v);

export const requireV3 = async (req, res, next) => {
  try {
    if (!serverEnabled()) throw fail("Inventory V3 is off", 409);
    req.v3 = getInventoryV3Models(req.db);
    req.v3Settings = await req.v3.InventoryV3Settings.findById("default").lean();
    if (!req.v3Settings?.enabled || req.v3Settings.storageVersion !== 1) throw fail("Inventory V3 is off or storage is not ready", 409);
    next();
  } catch (err) { res.status(err.statusCode || 503).json({ message: err.statusCode ? err.message : "Inventory V3 unavailable" }); }
};

// All stock/money mutations, their audit and retry result commit together.
export const transact = async (req, kind, perform) => {
  const requestKey = req.body?.requestKey;
  if (typeof requestKey !== "string" || !/^[A-Za-z0-9:_-]{8,128}$/.test(requestKey)) throw fail("A request key is required");
  const actor = v3Actor(req.user), legacyActor = buildActor(req.user);
  const hash = createHash("sha256").update(canonicalPayload({ kind, path: req.originalUrl, user: String(req.user._id), body: req.body })).digest("hex");
  const Operation = req.v3.InventoryV3Operation;
  const replay = async (session = null) => {
    const old = await Operation.findOne({ requestKey }).session(session).lean();
    if (old && old.payloadHash !== hash) throw fail("This request key was used for different data", 409);
    return old ? { id: String(old.resultRef.id), replayed: true } : null;
  };
  const existing = await replay(); if (existing) return existing;
  const session = await req.db.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const ready = await req.v3.InventoryV3Settings.findOne({ _id: "default", enabled: true, storageVersion: 1 }).session(session).lean();
      if (!serverEnabled() || !ready) throw fail("Inventory V3 has been switched off", 409);
      result = await replay(session); if (result) return;
      const ref = await perform({ session, actor, legacyActor });
      await Operation.create([{ requestKey, kind, payloadHash: hash, resultRef: ref, createdBy: actor }], { session });
      result = { id: String(ref.id), replayed: false };
    });
    return result;
  } catch (err) {
    if (err.code === 11000) { const old = await replay(); if (old) return old; throw fail("This record already exists", 409); }
    throw err;
  } finally { await session.endSession(); }
};
const create = async (Model, value, session) => (await Model.create([value], { session }))[0];

export const saveItem = (req) => transact(req, req.params.id ? "ITEM_CONFIG" : "OPENING_STOCK", async ({ session, actor, legacyActor }) => {
  const b = req.body, name = cleanText(b.name, 120);
  if (!name || !STOCK_UNITS.includes(b.unit)) throw fail("Name and stock unit are required");
  const supplier = b.supplier ? id(b.supplier) : null;
  if (supplier && !await req.models.Supplier.exists({ _id: supplier }).session(session)) throw fail("Supplier not found");
  calc.quantityMicros(b.reorderLevel || "0");
  const data = { name, unit: b.unit, category: cleanText(b.category, 80), reorderLevel: Number(b.reorderLevel || 0), costPrice: rate(b.costPrice), supplier };
  let item;
  if (req.params.id) {
    const previous = await req.models.InventoryItem.findById(id(req.params.id)).session(session);
    if (!previous) throw fail("Item not found", 404);
    if (previous.unit !== data.unit) throw fail("Keep the existing stock unit to preserve recipes and history");
    item = await req.models.InventoryItem.findOneAndUpdate({ _id: previous._id, updatedAt: b.updatedAt }, { $set: data }, { session, returnDocument: "after", runValidators: true });
    if (!item) throw fail("Stock changed. Refresh before editing", 409);
  } else {
    calc.quantityMicros(b.currentStock);
    item = await create(req.models.InventoryItem, { ...data, currentStock: Number(b.currentStock) }, session);
    await create(req.models.StockLedger, { inventoryItem: item._id, type: "ADJUSTMENT", quantity: item.currentStock, balanceAfter: item.currentStock, reason: "V3 opening stock", createdBy: legacyActor }, session);
  }
  const usualStockQty = b.usualStockQty === "" || b.usualStockQty == null ? null : b.usualStockQty;
  if (usualStockQty != null) calc.quantityMicros(usualStockQty);
  await req.v3.InventoryItemV3Config.findOneAndUpdate({ inventoryItem: item._id }, { $set: { usualStockQty, costClass: b.costClass || "UNKNOWN", updatedBy: actor } }, { session, upsert: true, runValidators: true });
  return { model: "InventoryItem", id: item._id };
});
export const saveSupplier = (req) => transact(req, "SUPPLIER", async ({ session, actor }) => {
  const b = req.body;
  if (!cleanText(b.phone)) throw fail("Supplier phone is required");
  const data = cleanSupplierInput({ name: b.name, phone: b.phone, gstNumber: b.gstNumber, notes: b.notes,
    creditPreference: b.creditFrequency === "YES" ? "GIVES_CREDIT" : b.creditFrequency === "NO" ? "UPFRONT" : "OTHER" });
  const supplier = req.params.id ? await req.models.Supplier.findByIdAndUpdate(id(req.params.id), { $set: data }, { session, runValidators: true, returnDocument: "after" }) : await create(req.models.Supplier, data, session);
  if (!supplier) throw fail("Supplier not found", 404);
  await req.v3.InventorySupplierV3Config.findOneAndUpdate({ supplier: supplier._id }, { $set: { autoOrderMode: b.autoOrderMode || "OFF", creditFrequency: b.creditFrequency || "SOMETIMES", groups: b.groups || [], updatedBy: actor } }, { session, upsert: true, runValidators: true });
  return { model: "Supplier", id: supplier._id };
});

export const purchasePreview = async (req, session = null) => {
  const raw = req.body.items;
  if (!Array.isArray(raw) || !raw.length || raw.length > 200) throw fail("Add 1–200 stock lines");
  const seen = new Set(); const lines = [];
  for (const line of raw) {
    const itemId = id(line.inventoryItem);
    if (seen.has(itemId)) throw fail("Combine duplicate stock items into one line"); seen.add(itemId);
    const item = await req.models.InventoryItem.findOne({ _id: itemId, status: "Active" }).session(session).lean();
    if (!item) throw fail("Stock item not found");
    positiveQty(line.quantity);
    const unit = line.unit || item.unit;
    const stockQty = calc.convertedQuantityMicros(line.quantity, unit, item.unit) / 1000000;
    if (stockQty <= 0) throw fail("Quantity is below the supported precision");
    lines.push({ inventoryItem: item._id, name: item.name, unit, quantity: Number(line.quantity), costPrice: rate(line.costPrice),
      amountPaise: calc.lineAmountPaise({ quantity: line.quantity, unit, unitRateRupees: line.costPrice }), stockQty,
      stockRate: calc.unitRateConverted(line.costPrice, unit, item.unit), batchTracked: item.isBatchTracked });
  }
  return { lines, totalPaise: calc.sumPaise(lines.map((l) => l.amountPaise)) };
};
export const savePurchase = (req) => transact(req, "PURCHASE", async ({ session, legacyActor }) => {
  const b = req.body, p = await purchasePreview(req, session), tz = await profileTimezone(req.models);
  const purchaseDate = validateBillDateTime(b, { now: new Date(), toInstant: (y, m, d, h, min) => new Date(zonedInstant(y, m, d, h, tz).getTime() + min * 60000) });
  if (!["PAID", "CREDIT"].includes(b.paymentType)) throw fail("Choose Paid or Credit");
  if (b.paymentType === "PAID" && !["CASH_DRAWER", "BANK_UPI", "OWNER_POCKET"].includes(b.paymentSource)) throw fail("Choose payment source");
  const supplier = b.supplier ? id(b.supplier) : null;
  if (b.paymentType === "CREDIT" && !supplier) throw fail("A credit purchase needs a supplier");
  if (supplier && !await req.models.Supplier.exists({ _id: supplier }).session(session)) throw fail("Supplier not found");
  const bill = resolveBillNumber({ billNumber: b.billNumber, billNumberSource: "SUPPLIER" });
  const totalCost = calc.legacyRupees(p.totalPaise);
  const purchase = await create(req.models.StockPurchase, { supplier, items: p.lines.map((l) => ({ inventoryItem: l.inventoryItem, name: l.name, unit: l.unit, quantity: l.quantity, costPrice: l.costPrice, amount: calc.legacyRupees(l.amountPaise) })),
    totalCost, purchaseDate, billDate: b.billDate, billTime: b.billTime, invoiceNumber: bill?.number || `AUTO-V3-${b.requestKey}`, billNumberSource: bill?.source || "SYSTEM",
    billPhoto: attachment(b.billPhoto), paymentType: b.paymentType, paymentSource: b.paymentType === "PAID" ? b.paymentSource : undefined,
    payable: b.paymentType === "CREDIT" ? { to: "SUPPLIER", amount: totalCost } : b.paymentSource === "OWNER_POCKET" ? { to: "OWNER", amount: totalCost } : null, createdBy: legacyActor }, session);
  for (const l of p.lines) {
    const item = await req.models.InventoryItem.findByIdAndUpdate(l.inventoryItem, { $inc: { currentStock: l.stockQty }, $set: { costPrice: l.stockRate } }, { session, returnDocument: "after" });
    await create(req.models.StockLedger, { inventoryItem: item._id, type: "PURCHASE", quantity: l.stockQty, balanceAfter: item.currentStock, relatedPurchase: purchase._id, reason: `Purchase (${purchase.invoiceNumber})`, createdBy: legacyActor }, session);
    if (l.batchTracked) await create(req.models.InventoryBatch, { inventoryItem: item._id, quantity: l.stockQty, costPrice: l.stockRate, purchase: purchase._id }, session);
  }
  return { model: "StockPurchase", id: purchase._id };
});
export const settle = (req) => transact(req, "SETTLEMENT", async ({ session, legacyActor }) => {
  if (!["CASH_DRAWER", "BANK_UPI"].includes(req.body.source)) throw fail("Choose cash drawer or bank/UPI");
  const purchase = await req.models.StockPurchase.findOneAndUpdate({ _id: id(req.params.id), "payable.to": { $in: ["SUPPLIER", "OWNER"] }, "payable.settledAt": null },
    { $set: { "payable.settledAt": new Date(), "payable.settledSource": req.body.source, "payable.settledBy": legacyActor } }, { session, returnDocument: "after" });
  if (!purchase) throw fail("This bill is already settled or has no payable", 409);
  return { model: "StockPurchase", id: purchase._id };
});

export const EXPENSE_CATEGORIES = Object.freeze({ Rent: "OPERATING_EXPENSE", "Gas / fuel": "OPERATING_EXPENSE", Electricity: "OPERATING_EXPENSE", Water: "OPERATING_EXPENSE", Repairs: "OPERATING_EXPENSE", Cleaning: "OPERATING_EXPENSE", Transport: "OPERATING_EXPENSE", Marketing: "OPERATING_EXPENSE", "Software & phone": "OPERATING_EXPENSE", Licences: "OPERATING_EXPENSE", "Big purchase (equipment)": "CAPITAL", "Loan interest": "INTEREST", Tax: "TAX", "Other income": "OTHER_INCOME", "Owner took cash": "DRAWING" });
export const saveFinancial = (req) => transact(req, "FINANCIAL_ENTRY", async ({ session, actor }) => {
  const b = req.body, treatment = EXPENSE_CATEGORIES[b.category];
  if (!treatment) throw fail("Choose a valid category");
  const amountPaise = calc.rupeesToPaise(b.amount);
  if (amountPaise <= 0) throw fail("Enter a positive amount");
  const tz = await profileTimezone(req.models), effectiveDate = validDate(b.effectiveDate);
  if (effectiveDate > localDay(new Date(), tz)) throw fail("The entry date cannot be in the future");
  if (!["CASH_DRAWER", "BANK_UPI", "OWNER_POCKET"].includes(b.paymentSource)) throw fail("Choose a payment source");
  if (treatment === "DRAWING" && b.paymentSource === "OWNER_POCKET") throw fail("Drawings must come from business cash or bank");
  if (b.repeats && !["OPERATING_EXPENSE", "OTHER_INCOME", "INTEREST", "TAX"].includes(treatment)) throw fail("This category cannot repeat");
  const spread = treatment === "CAPITAL" || b.category === "Licences" && b.spreadYearly;
  if (spread && b.repeats) throw fail("Choose spreading or repeating, not both");
  let occurrenceKey = null;
  if (b.recurringRule) {
    const rule = await req.v3.InventoryRecurringRule.findById(id(b.recurringRule)).session(session).lean();
    if (!rule || rule.category !== b.category || rule.treatment !== treatment || rule.effectiveFrom > effectiveDate || rule.effectiveTo && rule.effectiveTo < effectiveDate) throw fail("This recurring bill does not match the rule");
    occurrenceKey = `${rule.ruleKey}:${rule.revision}:${effectiveDate.slice(0, 7)}`;
  }
  const doc = await create(req.v3.InventoryFinancialEntry, { requestKey: b.requestKey, treatment, category: b.category, amountPaise, effectiveDate, occurredAt: dayInstant(effectiveDate, tz), paymentSource: b.paymentSource,
    attachmentUrl: attachment(b.attachmentUrl), source: b.attachmentUrl ? "BILL_PHOTO" : "MANUAL", notes: cleanText(b.notes, 1000), occurrenceKey, createdBy: actor }, session);
  if (spread) {
    const periods = treatment === "CAPITAL" ? Number(b.periods) : 12;
    calc.allocateCost({ basisPaise: amountPaise, periods });
    await create(req.v3.InventoryCostSchedule, { financialEntry: doc._id, treatment: treatment === "CAPITAL" ? "DEPRECIATION" : "OPERATING_EXPENSE", basisPaise: amountPaise, periods, startsOn: effectiveDate, createdBy: actor }, session);
  }
  if (b.repeats) {
    const rule = await create(req.v3.InventoryRecurringRule, { ruleKey: b.requestKey, treatment, category: b.category, amountPaise, frequency: "MONTHLY", day: Math.min(28, Number(effectiveDate.slice(-2))), effectiveFrom: effectiveDate, enabled: true, createdBy: actor }, session);
    doc.occurrenceKey = `${rule.ruleKey}:${rule.revision}:${effectiveDate.slice(0, 7)}`; await doc.save({ session });
  }
  return { model: "InventoryFinancialEntry", id: doc._id };
});

export const submitCount = (req) => transact(req, "COUNT", async ({ session, actor }) => {
  const b = req.body;
  if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 1000) throw fail("Choose stock items to count");
  const lines = [], seen = new Set();
  for (const l of b.lines) {
    const item = await req.models.InventoryItem.findOne({ _id: id(l.inventoryItem), status: "Active" }).session(session).lean();
    if (!item || seen.has(String(item._id))) throw fail("Invalid or duplicate stock item"); seen.add(String(item._id));
    calc.quantityMicros(l.countedQty);
    if (String(item.updatedAt.toISOString()) !== l.stockUpdatedAt) throw fail(`${item.name} changed while counting. Refresh and recount.`, 409);
    const latest = await req.models.StockLedger.findOne({ inventoryItem: item._id }).sort({ createdAt: -1, _id: -1 }).session(session).lean();
    lines.push({ inventoryItem: item._id, unit: item.unit, countedQty: String(l.countedQty), expectedQty: calc.legacyDecimal(item.currentStock), unitRateRupees: item.costPrice > 0 ? calc.legacyDecimal(item.costPrice) : null,
      observedAt: new Date(), stockUpdatedAt: item.updatedAt, ledgerWatermark: latest?._id || null });
  }
  const doc = await create(req.v3.InventoryCountSession, { requestKey: b.requestKey, scope: "SELECTED_ITEMS", status: "SUBMITTED", lines, countedBy: actor, submittedAt: new Date() }, session);
  return { model: "InventoryCountSession", id: doc._id };
});
export const approveCount = (req) => transact(req, "COUNT", async ({ session, actor, legacyActor }) => {
  const doc = await req.v3.InventoryCountSession.findOne({ _id: id(req.params.id), status: "SUBMITTED" }).session(session);
  if (!doc) throw fail("Count is no longer awaiting approval", 409);
  for (const l of doc.lines) {
    const latest = await req.models.StockLedger.findOne({ inventoryItem: l.inventoryItem }).sort({ createdAt: -1, _id: -1 }).session(session).lean();
    if (String(latest?._id || "") !== String(l.ledgerWatermark || "")) throw fail("Stock moved after this count. Submit a fresh count.", 409);
    const item = await req.models.InventoryItem.findOneAndUpdate({ _id: l.inventoryItem, currentStock: Number(l.expectedQty), updatedAt: l.stockUpdatedAt }, { $set: { currentStock: Number(l.countedQty) } }, { session, returnDocument: "after" });
    if (!item) throw fail("Stock changed after counting. Submit a fresh count.", 409);
    const movement = await create(req.models.StockLedger, { inventoryItem: item._id, type: "PHYSICAL_COUNT", quantity: (calc.quantityMicros(l.countedQty) - calc.quantityMicros(l.expectedQty)) / 1000000,
      balanceAfter: item.currentStock, reason: `V3 approved count ${doc._id}`, createdBy: legacyActor }, session);
    l.relatedLedger = movement._id;
  }
  doc.status = "APPROVED"; doc.approvedBy = actor; doc.approvedAt = new Date(); await doc.save({ session });
  return { model: "InventoryCountSession", id: doc._id };
});
export const saveWastage = (req) => transact(req, "WASTAGE", async ({ session, actor, legacyActor }) => {
  const b = req.body, quantity = positiveQty(b.quantity);
  const item = await req.models.InventoryItem.findOneAndUpdate({ _id: id(b.inventoryItem), status: "Active", currentStock: { $gte: quantity } }, { $inc: { currentStock: -quantity } }, { session, returnDocument: "after" });
  if (!item) throw fail("Not enough stock, or item is inactive", 409);
  const costPaise = calc.lineAmountPaise({ quantity: b.quantity, unit: item.unit, unitRateRupees: calc.legacyDecimal(item.costPrice || 0) });
  const doc = await create(req.models.WastageLog, { inventoryItem: item._id, itemName: item.name, unit: item.unit, quantity, reason: "Other", reasonText: cleanText(b.reason) || "V3 wastage", costImpact: calc.legacyRupees(costPaise), recordedBy: legacyActor }, session);
  await create(req.models.StockLedger, { inventoryItem: item._id, type: "WASTAGE", quantity: -quantity, balanceAfter: item.currentStock, relatedWastage: doc._id, reason: doc.reasonText, createdBy: legacyActor }, session);
  await create(req.v3.InventoryLossClassification, { wastage: doc._id, kind: b.kind === "STAFF_FREE_MEAL" ? b.kind : "WASTE", createdBy: actor }, session);
  return { model: "WastageLog", id: doc._id };
});

// Simple shift-friendly stock movement. The conditional decrement prevents
// negative stock and the ledger row is written in the same transaction.
export const adjustStock = (req) => transact(req, "STOCK_ADJUSTMENT", async ({ session, legacyActor }) => {
  const b = req.body || {}, quantity = positiveQty(b.quantity), direction = b.direction;
  if (!["IN", "OUT"].includes(direction)) throw fail("Choose stock in or stock out");
  const reason = cleanText(b.reason, 200);
  if (!reason) throw fail("A reason is required");
  const filter = { _id: id(b.inventoryItem), status: "Active", ...(direction === "OUT" ? { currentStock: { $gte: quantity } } : {}) };
  const item = await req.models.InventoryItem.findOneAndUpdate(filter, { $inc: { currentStock: direction === "IN" ? quantity : -quantity } }, { session, returnDocument: "after" });
  if (!item) throw fail(direction === "OUT" ? "Not enough stock, or item is inactive" : "Item is inactive", 409);
  const movement = await create(req.models.StockLedger, { inventoryItem: item._id, type: "ADJUSTMENT", quantity: direction === "IN" ? quantity : -quantity, balanceAfter: item.currentStock, reason, createdBy: legacyActor }, session);
  return { model: "StockLedger", id: movement._id };
});

export const recipePreview = async (req, session = null) => {
  const b = req.body;
  const menu = await req.models.MenuItem.findById(id(b.menuItem)).session(session).lean();
  if (!menu) throw fail("Menu item not found");
  if (!Array.isArray(b.ingredients) || !b.ingredients.length || b.ingredients.length > 60) throw fail("Add 1–60 ingredients");
  const clean = [], seen = new Set();
  for (const l of b.ingredients) {
    if (!STOCK_UNITS.includes(l.unit)) throw fail("Unknown ingredient unit");
    positiveQty(l.quantity);
    if (l.sourceType === "CUSTOM") {
      const name = cleanText(l.name);
      if (!name) throw fail("Custom ingredient name is required");
      const costPaise = l.cost === "" || l.cost == null ? null : calc.rupeesToPaise(l.cost);
      clean.push({ sourceType: "CUSTOM", inventoryItem: null, name, unit: l.unit, quantity: Number(l.quantity), cost: costPaise == null ? null : calc.legacyRupees(costPaise), costPaise });
      continue;
    }
    if (l.sourceType && l.sourceType !== "STOCK") throw fail("Unknown ingredient source");
    const item = await req.models.InventoryItem.findOne({ _id: id(l.inventoryItem), status: "Active" }).session(session).lean();
    if (!item || seen.has(String(item._id))) throw fail("Invalid or duplicate ingredient"); seen.add(String(item._id));
    const costPaise = item.costPrice > 0 ? calc.lineAmountPaise({ quantity: l.quantity, unit: l.unit, stockUnit: item.unit, unitRateRupees: calc.legacyDecimal(item.costPrice) }) : null;
    calc.convertedQuantityMicros(l.quantity, l.unit, item.unit);
    clean.push({ sourceType: "STOCK", inventoryItem: item._id, name: item.name, unit: l.unit, quantity: Number(l.quantity), cost: costPaise == null ? null : calc.legacyRupees(costPaise), costPaise });
  }
  return { ingredients: clean, totalPaise: clean.some((l) => l.costPaise == null) ? null : calc.sumPaise(clean.map((l) => l.costPaise)), menu };
};
export const saveRecipeV3 = (req) => transact(req, "RECIPE", async ({ session }) => {
  const p = await recipePreview(req, session);
  const doc = await req.models.Recipe.findOneAndUpdate({ menuItem: p.menu._id }, { $set: { menuItem: p.menu._id, ingredients: p.ingredients.map(({ costPaise: _cost, ...l }) => l), status: "Active", totalCost: p.totalPaise == null ? null : calc.legacyRupees(p.totalPaise), costIncomplete: p.totalPaise == null, costedAt: new Date() } }, { session, upsert: true, runValidators: true, returnDocument: "after" });
  return { model: "Recipe", id: doc._id };
});
