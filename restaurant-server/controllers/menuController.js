// controllers/menuController.js
// ADD at the top of menuController.js
import { v2 as cloudinary } from "cloudinary";
import { computeStockStatusForMenuItems } from "../services/inventoryService.js";

cloudinary.config({
  cloud_name:  process.env.CLOUDINARY_CLOUD_NAME,
  api_key:     process.env.CLOUDINARY_API_KEY,
  api_secret:  process.env.CLOUDINARY_API_SECRET,
});

export const getMenu = async (req, res) => {
  try {
    const { MenuItem } = req.models;
    const { category, search, vegOnly } = req.query;
    const filter = { isAvailable: true };
    if (category) filter.category = category;
    if (search)   filter.name = { $regex: search, $options: "i" };
    if (vegOnly === "true") filter.tag = "Veg";
    const items = await MenuItem.find(filter).sort({ category: 1, name: 1 }).lean();

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
    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
export const deleteMenuItem = async (req, res) => {
  try {
    const { MenuItem } = req.models;
    await MenuItem.findByIdAndDelete(req.params.id);
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
    res.json(item);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const getCategoriesWithImage = async (req, res) => {
  try {
    const { MenuItem, Category } = req.models;
    const cats = await Category.find().sort({ name: 1 });
    const result = await Promise.all(cats.map(async (c) => {
      const item = await MenuItem.findOne({ category: c.name, isAvailable: true }).select("categoryImage");
      return { category: c.name, categoryImage: c.image || "", categoryImageUrl: item?.categoryImage || c.image || "" };
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ message: err.message }); }
};
