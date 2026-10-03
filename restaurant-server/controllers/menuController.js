// controllers/menuController.js
// ADD at the top of menuController.js
import { v2 as cloudinary } from "cloudinary";
import { computeStockStatusForMenuItems } from "../services/inventoryService.js";
import { getScheduleContext, isItemScheduledNow, applyBulkSchedule } from "../services/menuScheduleService.js";
import { isScheduleActive } from "../utils/menuSchedule.js";
import { emitMenuUpdated } from "../sockets/socket.js";
import { setAvailability, bulkEditItems, normalizeTags, commitImport } from "../services/menuItemService.js";
import { listMenuTimes, createMenuTime, updateMenuTime, deleteMenuTime } from "../services/menuTimeService.js";
import { parseMenuText, parseMenuCsv } from "../utils/menuImportParser.js";
import { extractDocumentText } from "../utils/purchaseImportExtract.js";
import { sniffFileType } from "../middleware/importUploadMiddleware.js";
import { CATEGORY_SORT } from "../services/categoryService.js";

cloudinary.config({
  cloud_name:  process.env.CLOUDINARY_CLOUD_NAME,
  api_key:     process.env.CLOUDINARY_API_KEY,
  api_secret:  process.env.CLOUDINARY_API_SECRET,
});

export const getMenu = async (req, res) => {
  try {
    const { MenuItem } = req.models;
    const { category, search, vegOnly, includeUnavailable, ignoreSchedule } = req.query;
    const isAdmin = !!(req.user?.isAdmin || req.user?.role === "admin");
    const filter = { isAvailable: true };
    // Admin menu management needs to see hidden items too (to un-hide them or
    // filter by "Hidden"). Opt-in only — customer/waiter never pass this, so
    // their menu stays "available items only" exactly as before.
    const manageView = includeUnavailable === "true" && isAdmin;
    if (manageView) delete filter.isAvailable;
    if (category) filter.category = category;
    if (search)   filter.name = { $regex: search, $options: "i" };
    if (vegOnly === "true") filter.tag = "Veg";

    // ── Scheduled visibility (services/menuScheduleService.js) ──────────────
    // Enforced here for everyone (customer, guest, waiter, admin ordering)
    // except the admin management views, which need the full catalog.
    // Scheduled-out categories are excluded in the query itself; item
    // windows (which may cross midnight) are checked on the lean results.
    const skipSchedule = manageView || (ignoreSchedule === "true" && isAdmin);
    const scheduleCtx = await getScheduleContext({ models: req.models });
    if (!skipSchedule && scheduleCtx.hiddenCategories.size) {
      if (category && scheduleCtx.hiddenCategories.has(category)) return res.json([]);
      if (!category) filter.category = { $nin: [...scheduleCtx.hiddenCategories] };
    }
    let items = await MenuItem.find(filter).sort({ category: 1, name: 1 }).lean();
    if (skipSchedule) {
      // Annotate so the admin can see what customers currently can't.
      items = items.map((i) => ({ ...i, scheduledNow: isItemScheduledNow(i, scheduleCtx) }));
    } else {
      items = items.filter((i) => isScheduleActive(i.schedule, scheduleCtx.clock));
    }

    // ── Connect inventory availability with menu availability (Phase 2) ──────
    // Purely additive: `isAvailable` (the manual staff toggle) is untouched
    // and menu items are never removed/hidden here — we only attach a
    // read-time `stockAvailable` flag so a future frontend can show
    // "out of stock" without the item disappearing from the menu.
    const stockStatus = await computeStockStatusForMenuItems({
      models: req.models,
      menuItemIds: items.map((i) => i._id),
    });
    const withStock = items.map((i) => {
      const s = stockStatus.get(String(i._id));
      return { ...i, stockAvailable: s ? s.inStock : true, stockTracked: !!s?.tracked };
    });

    res.json(withStock);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const getCategories = async (req, res) => {
  try {
    const { MenuItem } = req.models;
    const cats = await MenuItem.aggregate([
      { $match: { isAvailable: true } },
      { $group: { _id: "$category", categoryImage: { $first: "$categoryImage" }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json(cats.map(c => ({ category: c._id, categoryImage: c.categoryImage, count: c.count })));
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// export const addMenuItem = async (req, res) => {
//   try {
//     const { MenuItem } = req.models;
//     const item = await MenuItem.create(req.body);
//     res.status(201).json(item);
//   } catch (err) { res.status(400).json({ message: err.message }); }
// };
export const addMenuItem = async (req, res) => {
  try {
    const { MenuItem } = req.models;
    const { name, nameBn, price, originalPrice, category, tag,
            isAvailable, description, rating } = req.body;
    let tags;
    try { tags = normalizeTags(req.body.tags); }
    catch (e) { return res.status(400).json({ message: e.message }); }

    if (!name || !price || !category)
      return res.status(400).json({ message: "name, price, category required" });

    let imageUrl = "";
    if (req.file) {
    const result = await new Promise((resolve, reject) => {
  cloudinary.uploader.upload_stream(
    { folder: "menu-items", resource_type: "image" },
    (error, result) => { if (error) reject(error); else resolve(result); }
  ).end(req.file.buffer);
});
      imageUrl = result.secure_url;
    }

    const item = await MenuItem.create({
      name, nameBn: String(nameBn || "").trim(), price: Number(price),
      originalPrice: Number(originalPrice)||0,
      category, tag: tag||"Veg",
      isAvailable: isAvailable !== "false",
      description: description||"",
      rating: Number(rating)||4,
      image: imageUrl,
      tags,
    });

    emitMenuUpdated(req.tenantKey);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// export const updateMenuItem = async (req, res) => {
//   try {
//     const { MenuItem } = req.models;
//     const item = await MenuItem.findByIdAndUpdate(req.params.id, req.body, { new: true });
//     if (!item) return res.status(404).json({ message: "Item not found" });
//     res.json(item);
//   } catch (err) { res.status(400).json({ message: err.message }); }
// };
export const updateMenuItem = async (req, res) => {
  try {
    const { MenuItem } = req.models;
    const item = await MenuItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Item not found" });

    // If new image file uploaded → upload to Cloudinary
    if (req.file) {
     const result = await new Promise((resolve, reject) => {
  cloudinary.uploader.upload_stream(
    { folder: "menu-items", resource_type: "image" },
    (error, result) => { if (error) reject(error); else resolve(result); }
  ).end(req.file.buffer);
});
      item.image = result.secure_url;
    }
    // else → keep item.image as is (don't touch it)

    // Update other fields
    const { name, nameBn, price, originalPrice, category, tag,
            isAvailable, description, rating } = req.body;

    if (name)          item.name          = name;
    if (nameBn !== undefined) item.nameBn = String(nameBn).trim(); // "" clears it
    if (price)         item.price         = Number(price);
    if (originalPrice !== undefined) item.originalPrice = Number(originalPrice)||0;
    if (category)      item.category      = category;
    if (tag)           item.tag           = tag;
    if (isAvailable !== undefined) {
      item.isAvailable = isAvailable === "true" || isAvailable === true;
      item.soldOutUntil = null; // an explicit On/Off replaces "Sold out today"
    }
    if (description !== undefined) item.description  = description;
    if (rating)        item.rating        = Number(rating);
    if (req.body.tags !== undefined) {
      try { item.tags = normalizeTags(req.body.tags); }
      catch (e) { return res.status(400).json({ message: e.message }); }
    }

    await item.save();
    emitMenuUpdated(req.tenantKey);
    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
export const deleteMenuItem = async (req, res) => {
  try {
    const { MenuItem } = req.models;
    await MenuItem.findByIdAndDelete(req.params.id);
    emitMenuUpdated(req.tenantKey);
    res.json({ message: "Deleted" });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const toggleAvailability = async (req, res) => {
  try {
    const { MenuItem } = req.models;
    const item = await MenuItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Not found" });
    item.isAvailable = !item.isAvailable;
    item.soldOutUntil = null;
    await item.save();
    emitMenuUpdated(req.tenantKey);
    res.json(item);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const isImageUrl = (s) => typeof s === "string" && /^(https?:\/\/|data:image\/)/i.test(s);

export const getCategoriesWithImage = async (req, res) => {
  try {
    const { MenuItem, Category } = req.models;
    const { hiddenCategories } = await getScheduleContext({ models: req.models });
    const cats = (await Category.find().sort(CATEGORY_SORT)).filter((c) => !hiddenCategories.has(c.name));
    const result = await Promise.all(cats.map(async (c) => {
      const item = await MenuItem.findOne({ category: c.name, isAvailable: true }).select("categoryImage");
      // `image` fields may hold a real URL or a legacy emoji placeholder —
      // categoryImageUrl is only ever an actual URL, the category's own first.
      const url = [c.image, item?.categoryImage].find(isImageUrl) || "";
      return { category: c.name, categoryImage: c.image || "", categoryImageUrl: url };
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── PATCH /api/menu/schedule (admin) ─────────────────────────────────────────
// Body: { itemIds?: [id], categoryIds?: [id], schedule: { startTime, endTime } | null }
// One request applies (or, with null, clears) the same window on every
// selected category/item.
export const bulkUpdateSchedule = async (req, res) => {
  try {
    const { itemIds, categoryIds, schedule } = req.body || {};
    const result = await applyBulkSchedule({ models: req.models, itemIds, categoryIds, schedule });
    emitMenuUpdated(req.tenantKey);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ═════════════════ Menu items page: big-menu tools ══════════════════════════
// Business rules live in services/menuItemService.js, services/menuTimeService.js
// and utils/menuImportParser.js — these are thin HTTP wrappers.

const fail = (res, err) => res.status(err.statusCode || 500).json({ message: err.message });

// ── PATCH /api/menu/availability  { ids: [id], state: "on"|"soldout"|"off" } ─
// "soldout" = off until the business day ends (RestaurantProfile.businessDayEndsAt).
// Staff, like the existing toggle — marking a dish finished is a floor action.
export const setItemsAvailability = async (req, res) => {
  try {
    const { ids, state } = req.body || {};
    const result = await setAvailability({ models: req.models, ids, state });
    emitMenuUpdated(req.tenantKey);
    res.json(result);
  } catch (err) { fail(res, err); }
};

// ── POST /api/menu/bulk  { ids, category?, addTags?, removeTags?, pricePercent? }
export const bulkEditMenuItems = async (req, res) => {
  try {
    const { ids, category, addTags, removeTags, pricePercent } = req.body || {};
    const result = await bulkEditItems({ models: req.models, ids, category, addTags, removeTags, pricePercent });
    emitMenuUpdated(req.tenantKey);
    res.json(result);
  } catch (err) { fail(res, err); }
};

// ── Menu times ───────────────────────────────────────────────────────────────
export const getMenuTimes = async (req, res) => {
  try { res.json(await listMenuTimes({ models: req.models })); }
  catch (err) { fail(res, err); }
};
export const createMenuTimeHandler = async (req, res) => {
  try {
    const mt = await createMenuTime({ models: req.models, db: req.db, input: req.body || {} });
    emitMenuUpdated(req.tenantKey);
    res.status(201).json(mt);
  } catch (err) { fail(res, err); }
};
export const updateMenuTimeHandler = async (req, res) => {
  try {
    const mt = await updateMenuTime({ models: req.models, db: req.db, id: req.params.id, input: req.body || {} });
    emitMenuUpdated(req.tenantKey);
    res.json(mt);
  } catch (err) { fail(res, err); }
};
export const deleteMenuTimeHandler = async (req, res) => {
  try {
    const result = await deleteMenuTime({ models: req.models, db: req.db, id: req.params.id });
    emitMenuUpdated(req.tenantKey);
    res.json(result);
  } catch (err) { fail(res, err); }
};

// ── Import menu ──────────────────────────────────────────────────────────────
// read → candidate rows only (never writes); commit → admin-reviewed rows.
const MAX_IMPORT_TEXT = 200_000;
const READ_TIMEOUT_MS = 25_000; // under the host proxy timeout, see purchaseImportController

// POST /api/menu/import/read  { text, format: "text"|"csv" }
export const readMenuImportText = async (req, res) => {
  try {
    const { text, format } = req.body || {};
    if (typeof text !== "string" || !text.trim()) return res.status(400).json({ message: "Paste or upload some menu text first" });
    if (text.length > MAX_IMPORT_TEXT) return res.status(400).json({ message: "That is too much text for one import — split it into parts" });
    const parsed = format === "csv" ? parseMenuCsv(text) : parseMenuText(text);
    if (!parsed.rows.length) return res.status(422).json({ message: "No dishes with prices were found. Each line needs a name and a price, e.g. “Veg Thali 160”." });
    res.json({ ...parsed, source: format === "csv" ? "CSV" : "TEXT" });
  } catch (err) { fail(res, err); }
};

// POST /api/menu/import/read-file  (multipart "file": PDF / JPG / PNG / WEBP)
// Reuses the Inventory purchase-import reader (pdf-parse + local OCR).
export const readMenuImportFile = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const sniffed = sniffFileType(req.file.buffer);
    if (!sniffed) return res.status(400).json({ message: "This file doesn't look like a valid PDF, JPG, PNG or WEBP" });
    let extraction;
    try {
      extraction = await Promise.race([
        extractDocumentText(req.file.buffer, sniffed),
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(
          new Error("Reading this file is taking too long — try a clearer photo, one page at a time, or paste the text instead."),
          { statusCode: 504 },
        )), READ_TIMEOUT_MS)),
      ]);
    } catch (err) {
      const offline = /fetch|network|ENOTFOUND|ECONNREFUSED/i.test(err.message || "");
      return res.status(err.statusCode || 502).json({
        message: offline
          ? "The photo reader is unavailable right now (couldn't download its language data). Try again shortly, or paste the text."
          : err.message,
      });
    }
    const parsed = parseMenuText(extraction.rawText || "");
    if (!parsed.rows.length) {
      return res.status(422).json({ message: "No dishes with prices could be read from this file. Try a sharper, straight-on photo, or paste the text instead." });
    }
    const ocr = extraction.sourceType === "IMAGE" || extraction.sourceType === "SCANNED_PDF";
    res.json({ ...parsed, source: extraction.sourceType, ocr });
  } catch (err) { fail(res, err); }
};

// POST /api/menu/import  { rows: [{ name, price, category, tag, description, tags }] }
export const commitMenuImport = async (req, res) => {
  try {
    const result = await commitImport({ models: req.models, rows: req.body?.rows });
    emitMenuUpdated(req.tenantKey);
    res.status(201).json(result);
  } catch (err) { fail(res, err); }
};
