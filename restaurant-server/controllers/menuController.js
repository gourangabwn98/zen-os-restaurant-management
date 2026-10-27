// controllers/menuController.js
// ADD at the top of menuController.js
import { isManagementRole } from "../utils/roles.js";
import { v2 as cloudinary } from "cloudinary";
import { computeStockStatusForActiveRecipes } from "../services/inventoryService.js";
import { getScheduleContext, isItemScheduledNow, applyBulkSchedule } from "../services/menuScheduleService.js";
import { emitMenuUpdated } from "../sockets/socket.js";
import { setAvailability, bulkEditItems, normalizeTags, commitImport } from "../services/menuItemService.js";
import { listMenuTimes, createMenuTime, updateMenuTime, deleteMenuTime } from "../services/menuTimeService.js";
import { parseMenuText, parseMenuCsv } from "../utils/menuImportParser.js";
import { extractDocumentText } from "../utils/purchaseImportExtract.js";
import { sniffFileType } from "../middleware/importUploadMiddleware.js";
import { CATEGORY_SORT, ensureMenuSections } from "../services/categoryService.js";
import { normalizeAddons, menuAddonRecords } from "../utils/menuAddons.js";
import { listBestSellers } from "../services/bestSellerService.js";
import { getMenuContext, ensureSmartCategories } from "../services/smartCategoryService.js";
import {
  smartByKey, itemCategoryList, parseFlag, ITEM_FLAGS, categoryIcon, notShareableCategoryOf,
} from "../utils/menuCategories.js";
import { FOOD_TYPES } from "../utils/foodTypes.js";
import { sortBySection } from "../utils/menuSections.js";
import {
  buildMenuStructure, readMenuItemFields, parseSubcategoryFilter, escapeRegex,
} from "../services/menuStructureService.js";

cloudinary.config({
  cloud_name:  process.env.CLOUDINARY_CLOUD_NAME,
  api_key:     process.env.CLOUDINARY_API_KEY,
  api_secret:  process.env.CLOUDINARY_API_SECRET,
});

// GET /api/menu/best-sellers — real top sellers (last 30 days of paid,
// not-cancelled orders) that are on the menu right now. Public, read-only.
export const getBestSellers = async (req, res) => {
  try { res.json({ items: await listBestSellers({ models: req.models }) }); }
  catch (err) { res.status(500).json({ message: err.message }); }
};

// GET /api/menu/structure — { sections: [{ name, count, subcategories: [{ name, count }] }] }
// in the configured section order. Counts follow the same visibility as GET
// /api/menu (available + category schedule); the admin's manage view
// (?includeUnavailable=true) counts every item.
export const getMenuStructure = async (req, res) => {
  try {
    const isAdmin = !!(req.user?.isAdmin || isManagementRole(req.user?.role));
    const manageView = req.query.includeUnavailable === "true" && isAdmin;
    const filter = manageView ? {} : { isAvailable: true };
    if (!manageView) {
      const { hiddenCategories } = await getScheduleContext({ models: req.models });
      if (hiddenCategories.size) filter.category = { $nin: [...hiddenCategories] };
    }
    const items = await req.models.MenuItem.find(filter).select("category subcategory itemId name").lean();
    res.json(buildMenuStructure(items));
  } catch (err) { res.status(err.statusCode || 500).json({ message: err.message }); }
};

// MNU-03/04/05 (+ Most Popular) — only the flags actually sent are changed.
const readFlags = (body) => {
  const out = {};
  for (const f of ITEM_FLAGS) { const v = parseFlag(body?.[f]); if (v !== undefined) out[f] = v; }
  return out;
};

export const getMenu = async (req, res) => {
  try {
    const { MenuItem, Category } = req.models;
    const { category, search, vegOnly, includeUnavailable, ignoreSchedule, tag } = req.query;
    const subcategories = parseSubcategoryFilter(req.query.subcategory);
    const isAdmin = !!(req.user?.isAdmin || isManagementRole(req.user?.role)); // admin or manager (Menu page)
    const filter = { isAvailable: true };
    const and = [];
    // Admin menu management needs to see hidden items too (to un-hide them or
    // filter by "Hidden"). Opt-in only — customer/waiter never pass this, so
    // their menu stays "available items only" exactly as before.
    const manageView = includeUnavailable === "true" && isAdmin;
    if (manageView) delete filter.isAvailable;
    // Escaped: a customer's search text is never a regex (a stray "(" used to 500).
    if (typeof search === "string" && search.trim()) {
      const rx = { $regex: escapeRegex(search.trim().slice(0, 80)), $options: "i" };
      and.push({ $or: [{ name: rx }, { subcategory: rx }] });
    }
    if (vegOnly === "true") filter.tag = "Veg";
    else if (FOOD_TYPES.includes(tag)) filter.tag = tag; // unknown values are ignored, never an error
    // Chips inside a section (one or several) narrow the list; "All" = none sent.
    if (subcategories.length) filter.subcategory = { $in: subcategories };

    // ── Scheduled visibility (services/menuScheduleService.js) ──────────────
    // Enforced here for everyone (customer, guest, waiter, admin ordering)
    // except the admin management views, which need the full catalog.
    // Scheduled-out categories are excluded in the query itself; item
    // windows (which may cross midnight) are checked on the lean results.
    // An item whose PRIMARY category is scheduled out is hidden everywhere.
    const skipSchedule = manageView || (ignoreSchedule === "true" && isAdmin);

    // The items this request lists (null = the asked category is scheduled out).
    const listMenuItems = async () => {
      // Schedule context and the smart-category context don't depend on each
      // other — read them together (getMenuContext only carries `hidden` through).
      const [scheduleCtx, baseMenuCtx] = await Promise.all([
        getScheduleContext({ models: req.models }),
        readyMenuContext(req.models),
      ]);
      const hidden = skipSchedule ? new Set() : scheduleCtx.hiddenCategories;
      if (category && hidden.has(category)) return null;
      if (hidden.size) and.push({ category: { $nin: [...hidden] } });

      // ── One category's items (MNU-03–07) ─────────────────────────────────
      // An item is listed under its section (`category`) and any smart
      // category it qualifies for — always the same document. An unknown
      // (e.g. old) category name simply matches nothing.
      const menuCtx = { ...baseMenuCtx, hidden };
      if (category) {
        const smart = menuCtx.smartCats.find((c) => c.name === category);
        const def = smart && smartByKey(smart.smartKey);
        if (def?.source === "flag") filter[def.flag] = true;
        else if (def) filter._id = { $in: [...(menuCtx.dataSets.get(def.key) || [])] };
        else and.push({ category: String(category) });
      }
      if (and.length) filter.$and = and;
      let items = await MenuItem.find(filter).sort({ category: 1, itemId: 1, name: 1 }).lean();
      items = items.map((i) => ({ ...i, addons: menuAddonRecords(i), categoryList: itemCategoryList(i, menuCtx) }));
      if (skipSchedule) {
        // Annotate so the admin can see what customers currently can't (its
        // category is scheduled out). Items have no time schedule of their own.
        items = items.map((i) => ({ ...i, scheduledNow: isItemScheduledNow(i, scheduleCtx) }));
      }
      return items;
    };

    // Performance: the reads that don't depend on which items are listed
    // start NOW, together with the item list — stock status (recipes → stock
    // items) and the "not shareable" categories used to wait for the item
    // query, one after another (≈5 DB round trips in a row → ≈2). Same
    // results: stock status is computed for every active recipe and looked up
    // per listed item. One Promise.all, so any failure is still caught below.
    const [items, stockStatus, flaggedCats, orderingCats] = await Promise.all([
      listMenuItems(),
      computeStockStatusForActiveRecipes({ models: req.models }),
      Category.find({ notShareable: true }).select("name").lean(),
      Category.find().select("name orderingEnabled").lean(),
    ]);
    if (!items) return res.json([]); // the asked category is scheduled out

    // ── Connect inventory availability with menu availability (Phase 2) ──────
    // Purely additive: `isAvailable` (the manual staff toggle) is untouched
    // and menu items are never removed/hidden here — we only attach a
    // read-time `stockAvailable` flag so a future frontend can show
    // "out of stock" without the item disappearing from the menu.
    // KH-05: "<category> not shareable" note (e.g. Thali) — display only.
    // Added after every visibility rule, so it never changes which items are
    // listed. Field present only on flagged items.
    const flagged = new Set(flaggedCats.map((c) => c.name));
    const orderingByName = new Map(orderingCats.map((c) => [c.name, c.orderingEnabled !== false]));
    const withStock = items.map((i) => {
      const s = stockStatus.get(String(i._id));
      const notShareableCategory = notShareableCategoryOf(i, flagged);
      return {
        ...i, stockAvailable: s ? s.inStock : true, stockTracked: !!s?.tracked,
        categoryOrderingEnabled: orderingByName.get(i.category) !== false,
        ...(notShareableCategory && { notShareableCategory }),
      };
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

    let addons, fields; // KH-12 add-ons · subcategory / size / foodType
    try { addons = normalizeAddons(req.body.addons) || []; fields = readMenuItemFields(req.body); }
    catch (e) { return res.status(e.statusCode || 400).json({ message: e.message }); }
    if ((await req.models.Category.findOne({ name: category }).select("kind").lean())?.kind === "SMART")
      return res.status(400).json({ message: `"${category}" fills itself — pick an ordinary category and switch on its flag instead` });

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
      addons,
      ...fields,
      ...readFlags(req.body),
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
//     const item = await MenuItem.findByIdAndUpdate(req.params.id, req.body, { returnDocument: "after" });
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

    if (category && category !== item.category &&
        (await req.models.Category.findOne({ name: category }).select("kind").lean())?.kind === "SMART")
      return res.status(400).json({ message: `"${category}" fills itself — pick an ordinary category and switch on its flag instead` });
    if (name)          item.name          = name;
    if (nameBn !== undefined) item.nameBn = String(nameBn).trim(); // "" clears it
    if (price)         item.price         = Number(price);
    if (originalPrice !== undefined) item.originalPrice = Number(originalPrice)||0;
    if (category)      item.category      = category;
    try { Object.assign(item, readMenuItemFields(req.body)); } // subcategory / size / foodType
    catch (e) { return res.status(e.statusCode || 400).json({ message: e.message }); }
    Object.assign(item, readFlags(req.body)); // MNU-03/04/05 + Most Popular
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
    // KH-12: add-ons (sent only when the form changed them; ids are kept).
    if (req.body.addons !== undefined) {
      try { item.addons = normalizeAddons(req.body.addons, item.addons); }
      catch (e) { return res.status(e.statusCode || 400).json({ message: e.message }); }
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

// The smart-category context without `hidden` (callers add it). On the first
// call in a process ensureSmartCategories may create/rename a category, so it
// completes before the category reads — exactly as when this ran in sequence.
// One shared run, so two parallel callers never create the same category twice.
let ensuring = null;
const ensureOnce = (models) => {
  if (!ensuring) {
    ensuring = ensureSmartCategories({ models })
      .then(() => ensureMenuSections({ models })) // every configured section has a Category record
      .finally(() => { ensuring = null; });
  }
  return ensuring;
};
const readyMenuContext = async (models) => {
  await ensureOnce(models);
  return getMenuContext({ models });
};
const readyCategories = async (models) => {
  await ensureOnce(models);
  return models.Category.find().sort(CATEGORY_SORT).lean();
};

export const getCategoriesWithImage = async (req, res) => {
  try {
    const { MenuItem, Category } = req.models;
    // Three independent reads, together (they used to run one after another).
    const [{ hiddenCategories }, menuCtx, allCats] = await Promise.all([
      getScheduleContext({ models: req.models }),
      readyMenuContext(req.models),
      readyCategories(req.models),
    ]);
    // Sections in the configured order (utils/menuSections.js), then any
    // other category (built-in smart ones, old ones) in the saved admin order.
    const cats = sortBySection(allCats.filter((c) => !hiddenCategories.has(c.name)), (c) => c.name);
    const visibleBase = { isAvailable: true, ...(hiddenCategories.size && { category: { $nin: [...hiddenCategories] } }) };
    const result = await Promise.all(cats.map(async (c) => {
      let item = null;
      if (c.kind === "SMART") {
        // A smart category only shows while something qualifies for it.
        const def = smartByKey(c.smartKey);
        if (!def) return null;
        const match = def.source === "flag"
          ? { ...visibleBase, [def.flag]: true }
          : { ...visibleBase, _id: { $in: [...(menuCtx.dataSets.get(def.key) || [])] } };
        item = await MenuItem.findOne(match).select("categoryImage image").lean();
        if (!item) return null;
      } else {
        item = await MenuItem.findOne({ ...visibleBase, category: c.name }).select("categoryImage").lean();
        // Nothing on the menu under it (an old category, or all items off) →
        // not listed, so the apps never offer a category that shows nothing.
        if (!item) return null;
      }
      // `image` fields may hold a real URL or a legacy emoji placeholder —
      // categoryImageUrl is only ever an actual URL, the category's own first.
      const url = [c.image, item?.categoryImage].find(isImageUrl) || "";
      return {
        _id: c._id, category: c.name, nameBn: c.nameBn || "", categoryImage: c.image || "", categoryImageUrl: url,
        kind: c.kind || "MANUAL", smartKey: c.smartKey || null, icon: categoryIcon(c), sortOrder: c.sortOrder ?? 0,
        orderingEnabled: c.orderingEnabled !== false,
      };
    }));
    res.json(result.filter(Boolean));
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── PATCH /api/menu/schedule (admin) ─────────────────────────────────────────
// Body: { categoryIds: [id], schedule: { startTime, endTime } | null } — categories only.
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
