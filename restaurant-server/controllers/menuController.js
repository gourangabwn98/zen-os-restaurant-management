// controllers/menuController.js
// ADD at the top of menuController.js
import { v2 as cloudinary } from "cloudinary";
import { computeStockStatusForMenuItems } from "../services/inventoryService.js";
import { getScheduleContext, isItemScheduledNow, applyBulkSchedule } from "../services/menuScheduleService.js";
import { isScheduleActive } from "../utils/menuSchedule.js";
import { emitMenuUpdated } from "../sockets/socket.js";

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
      items = items.filter((i) => isScheduleActive(i.schedule, scheduleCtx.nowMinutes));
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
    const { name, price, originalPrice, category, tag,
            isAvailable, description, rating } = req.body;

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
      name, price: Number(price),
      originalPrice: Number(originalPrice)||0,
      category, tag: tag||"Veg",
      isAvailable: isAvailable !== "false",
      description: description||"",
      rating: Number(rating)||4,
      image: imageUrl,
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
    const { name, price, originalPrice, category, tag,
            isAvailable, description, rating } = req.body;

    if (name)          item.name          = name;
    if (price)         item.price         = Number(price);
    if (originalPrice !== undefined) item.originalPrice = Number(originalPrice)||0;
    if (category)      item.category      = category;
    if (tag)           item.tag           = tag;
    if (isAvailable !== undefined) item.isAvailable = isAvailable === "true" || isAvailable === true;
    if (description !== undefined) item.description  = description;
    if (rating)        item.rating        = Number(rating);

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
    await item.save();
    emitMenuUpdated(req.tenantKey);
    res.json(item);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const getCategoriesWithImage = async (req, res) => {
  try {
    const { MenuItem, Category } = req.models;
    const { hiddenCategories } = await getScheduleContext({ models: req.models });
    const cats = (await Category.find().sort({ name: 1 })).filter((c) => !hiddenCategories.has(c.name));
    const result = await Promise.all(cats.map(async (c) => {
      const item = await MenuItem.findOne({ category: c.name, isAvailable: true }).select("categoryImage");
      return { category: c.name, categoryImage: c.image || "", categoryImageUrl: item?.categoryImage || c.image || "" };
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
