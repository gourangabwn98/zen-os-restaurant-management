// services/categoryService.js
// ─────────────────────────────────────────────────────────────────────────────
// Menu categories (Admin → Menu items → Categories).
//
// A MenuItem references its category by NAME (menuItem.category is a string),
// and so does the category schedule (menuScheduleService hides items whose
// category name is scheduled-out). So:
//   • rename  = category name + every item's `category` in ONE transaction —
//               otherwise items are orphaned under the old name and escape
//               their category's schedule;
//   • delete  = refused while any item still uses the category (409) — the
//               admin moves or deletes those items first;
//   • names   = unique case-insensitively ("Pizza" vs "pizza" would look like
//               one category to customers but be two in the data).
//   • merge   = move every item into another category and delete this one,
//               in ONE transaction (duplicate cleanup: "Extra" → "Extras");
//   • order   = `sortOrder`, set by drag-and-drop; every category list
//               (admin and customer) sorts by it, then by name.
// `schedule` is never written here — only via PATCH /api/menu/schedule or a
// Menu time (services/menuTimeService.js).
// ─────────────────────────────────────────────────────────────────────────────

const MAX_NAME = 40;
export const CATEGORY_SORT = { sortOrder: 1, name: 1 };

const httpError = (msg, statusCode = 400) => {
  const e = new Error(msg);
  e.statusCode = statusCode;
  return e;
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const normalizeCategoryName = (raw) => {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw httpError("Category name is required");
  if (name.length > MAX_NAME) throw httpError(`Category name must be ${MAX_NAME} characters or fewer`);
  return name;
};

const assertNameFree = async (Category, name, exceptId = null) => {
  const clash = await Category.findOne({
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
    ...(exceptId && { _id: { $ne: exceptId } }),
  }).select("name").lean();
  if (clash) throw httpError(`A category named "${clash.name}" already exists`, 409);
};

/** Admin view: every category with how many items use it. */
export const listCategoriesWithCounts = async ({ models }) => {
  const { Category, MenuItem } = models;
  const [cats, counts] = await Promise.all([
    Category.find().sort(CATEGORY_SORT).lean(),
    MenuItem.aggregate([{ $group: { _id: "$category", n: { $sum: 1 } } }]),
  ]);
  const byName = new Map(counts.map((c) => [c._id, c.n]));
  return cats.map((c) => ({ ...c, itemCount: byName.get(c.name) || 0 }));
};

const cleanNameBn = (v) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_NAME);

export const createCategory = async ({ models, name, nameBn = "", image = "" }) => {
  const { Category } = models;
  const clean = normalizeCategoryName(name);
  await assertNameFree(Category, clean);
  try {
    return await Category.create({ name: clean, nameBn: cleanNameBn(nameBn), image: image || "" });
  } catch (err) {
    if (err?.code === 11000) throw httpError(`A category named "${clean}" already exists`, 409);
    throw err;
  }
};

/**
 * Updates name, Bengali name and/or image (nothing else is writable). A rename moves every
 * item in the category along with it, atomically.
 * @param image  new image URL, "" to remove it, undefined to keep it.
 * @returns {{ category, renamedFrom: string|null, itemsMoved: number }}
 */
export const updateCategory = async ({ models, db, id, name, nameBn, image }) => {
  const { Category, MenuItem } = models;
  const current = await Category.findById(id);
  if (!current) throw httpError("Category not found", 404);

  const newName = name === undefined ? current.name : normalizeCategoryName(name);
  const renaming = newName !== current.name;
  if (renaming) await assertNameFree(Category, newName, current._id);

  const set = {};
  if (renaming) set.name = newName;
  if (nameBn !== undefined && cleanNameBn(nameBn) !== (current.nameBn || "")) set.nameBn = cleanNameBn(nameBn);
  if (image !== undefined) set.image = image || "";
  if (!Object.keys(set).length) return { category: current, renamedFrom: null, itemsMoved: 0 };

  if (!renaming) {
    const category = await Category.findByIdAndUpdate(id, { $set: set }, { new: true });
    return { category, renamedFrom: null, itemsMoved: 0 };
  }

  const session = await db.startSession();
  let category, itemsMoved = 0;
  try {
    await session.withTransaction(async () => {
      // Conditional on the old name, so two admins renaming at once can't
      // both move the items (the loser gets 409 below).
      category = await Category.findOneAndUpdate(
        { _id: id, name: current.name }, { $set: set }, { new: true, session },
      );
      if (!category) throw httpError("This category was changed by someone else — refresh and try again", 409);
      const r = await MenuItem.updateMany({ category: current.name }, { $set: { category: newName } }, { session });
      itemsMoved = r.modifiedCount || 0;
    });
  } catch (err) {
    if (err?.code === 11000) throw httpError(`A category named "${newName}" already exists`, 409);
    throw err;
  } finally {
    await session.endSession();
  }
  return { category, renamedFrom: current.name, itemsMoved };
};

/** Refuses while items still use the category, so none are left orphaned. */
export const deleteCategory = async ({ models, id }) => {
  const { Category, MenuItem } = models;
  const cat = await Category.findById(id).select("name").lean();
  if (!cat) throw httpError("Category not found", 404);
  const inUse = await MenuItem.countDocuments({ category: cat.name });
  if (inUse) {
    throw httpError(
      `"${cat.name}" still has ${inUse} item${inUse === 1 ? "" : "s"} — move them to another category or delete them first`,
      409,
    );
  }
  await Category.deleteOne({ _id: id });
  return cat;
};

/**
 * Saves the drag order: `ids` must list every category exactly once.
 * sortOrder = position, written in one bulkWrite.
 */
export const reorderCategories = async ({ models, ids }) => {
  const { Category } = models;
  if (!Array.isArray(ids) || !ids.length) throw httpError("ids must list every category in the new order");
  const list = ids.map(String);
  if (new Set(list).size !== list.length) throw httpError("ids must not repeat a category");
  const all = await Category.find().select("_id").lean();
  const known = new Set(all.map((c) => String(c._id)));
  if (list.length !== known.size || list.some((id) => !known.has(id))) {
    throw httpError("The category list changed — refresh and try again", 409);
  }
  await Category.bulkWrite(list.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { sortOrder: i } } } })));
  return { ordered: list.length };
};

/**
 * Moves every item of category `id` into category `intoId`, then deletes
 * `id` — one transaction, so items are never left under a deleted name.
 * @returns {{ from: string, into: string, itemsMoved: number }}
 */
export const mergeCategory = async ({ models, db, id, intoId }) => {
  const { Category, MenuItem } = models;
  if (!intoId || String(intoId) === String(id)) throw httpError("Pick a different category to merge into");
  const [from, into] = await Promise.all([
    Category.findById(id).select("name").lean(),
    Category.findById(intoId).select("name").lean(),
  ]);
  if (!from) throw httpError("Category not found", 404);
  if (!into) throw httpError("The category to merge into no longer exists — refresh and try again", 404);

  const session = await db.startSession();
  let itemsMoved = 0;
  try {
    await session.withTransaction(async () => {
      const r = await MenuItem.updateMany({ category: from.name }, { $set: { category: into.name } }, { session });
      itemsMoved = r.modifiedCount || 0;
      const del = await Category.deleteOne({ _id: from._id, name: from.name }, { session });
      if (!del.deletedCount) throw httpError("This category was changed by someone else — refresh and try again", 409);
    });
  } finally {
    await session.endSession();
  }
  return { from: from.name, into: into.name, itemsMoved };
};
