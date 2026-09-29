// controllers/categoryController.js
// Thin HTTP layer over services/categoryService.js (rename cascade, in-use
// delete guard, case-insensitive unique names live there).
import { getScheduleContext } from "../services/menuScheduleService.js";
import {
  listCategoriesWithCounts,
  createCategory as createCategorySvc,
  updateCategory as updateCategorySvc,
  deleteCategory as deleteCategorySvc,
} from "../services/categoryService.js";
import { emitMenuUpdated } from "../sockets/socket.js";

const isAdminUser = (user) => !!(user?.isAdmin || user?.role === "admin");
const fail = (res, err) => res.status(err.statusCode || 500).json({ message: err.message });

/** Uploads a multer memory file to Cloudinary; resolves to its https URL. */
const uploadCategoryImage = async (file) => {
  const cloudinary  = (await import("../config/cloudinary.js")).default;
  const streamifier = (await import("streamifier")).default;
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "adda-categories" },
      (err, result) => (err ? reject(err) : resolve(result.secure_url)),
    );
    streamifier.createReadStream(file.buffer).pipe(stream);
  });
};

// ── GET /api/categories ───────────────────────────────────────────────────────
// Admin gets every category plus `itemCount`; anyone else only sees ones
// whose schedule allows them right now (same rule as GET /api/menu).
export const getCategories = async (req, res) => {
  try {
    if (isAdminUser(req.user)) return res.json(await listCategoriesWithCounts({ models: req.models }));
    const { Category } = req.models;
    const { hiddenCategories } = await getScheduleContext({ models: req.models });
    const cats = (await Category.find().sort({ name: 1 })).filter((c) => !hiddenCategories.has(c.name));
    res.json(cats);
  } catch (err) { fail(res, err); }
};

// ── POST /api/categories  (multipart: name, image?) ──────────────────────────
export const createCategory = async (req, res) => {
  try {
    // "categoryName"/"category" accepted for older admin builds.
    const name = req.body.name ?? req.body.categoryName ?? req.body.category;
    const image = req.file ? await uploadCategoryImage(req.file) : (req.body.image || "");
    const cat = await createCategorySvc({ models: req.models, name, image });
    emitMenuUpdated(req.tenantKey);
    res.status(201).json(cat);
  } catch (err) { fail(res, err); }
};

// ── PUT /api/categories/:id  (multipart: name?, image file?, removeImage?) ───
// Only name and image are writable. Renaming moves the category's items too.
export const updateCategory = async (req, res) => {
  try {
    let image;
    if (req.file) image = await uploadCategoryImage(req.file);
    else if (req.body.removeImage === "true" || req.body.removeImage === true) image = "";
    const result = await updateCategorySvc({
      models: req.models, db: req.db, id: req.params.id, name: req.body.name, image,
    });
    emitMenuUpdated(req.tenantKey);
    res.json(result);
  } catch (err) { fail(res, err); }
};

// ── DELETE /api/categories/:id ────────────────────────────────────────────────
// 409 while any item still uses it (see services/categoryService.js).
export const deleteCategory = async (req, res) => {
  try {
    const cat = await deleteCategorySvc({ models: req.models, id: req.params.id });
    emitMenuUpdated(req.tenantKey);
    res.json({ message: `"${cat.name}" deleted` });
  } catch (err) { fail(res, err); }
};
