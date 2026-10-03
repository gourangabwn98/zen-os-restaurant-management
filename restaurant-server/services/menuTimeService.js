// services/menuTimeService.js
// ─────────────────────────────────────────────────────────────────────────────
// Menu times — named windows ("Breakfast 8:00–11:30", "Weekend fish special
// Fri–Sun 12:00–22:00", "Puja special" on chosen dates) that categories sit in.
//
// Enforcement never reads MenuTime: assigning a category copies the menu
// time's window onto category.schedule, and editing a menu time re-copies it
// onto every category in it, in the same transaction. So the customer menu,
// waiter menu and order pricing keep using the one rule in
// menuScheduleService (category schedule AND item schedule AND isAvailable).
//
// A category is in at most one menu time (category.menuTime). Taking it out
// clears its window (it becomes "All day"). A hand-set window from
// PATCH /api/menu/schedule also detaches it (applyBulkSchedule).
// ─────────────────────────────────────────────────────────────────────────────
import mongoose from "mongoose";
import { validateSchedule, EMPTY_SCHEDULE } from "../utils/menuSchedule.js";

const MAX_NAME = 30;
export const MENU_TIME_COLORS = ["amber", "green", "violet", "blue", "cyan", "red", "indigo", "grey"];

const httpError = (msg, statusCode = 400) => {
  const e = new Error(msg);
  e.statusCode = statusCode;
  return e;
};
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Runs fn(session) in a transaction when a db connection is given (tests pass none). */
const withTx = async (db, fn) => {
  if (!db?.startSession) return fn(undefined);
  const session = await db.startSession();
  try {
    let out;
    await session.withTransaction(async () => { out = await fn(session); });
    return out;
  } finally {
    await session.endSession();
  }
};

const cleanName = (raw) => {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw httpError("Give the menu time a name");
  if (name.length > MAX_NAME) throw httpError(`Name must be ${MAX_NAME} characters or fewer`);
  return name;
};

const cleanColor = (c) => (MENU_TIME_COLORS.includes(c) ? c : "violet");

const cleanCategoryIds = (raw) => {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw httpError("categoryIds must be an array");
  const ids = [...new Set(raw.map(String))];
  for (const id of ids) if (!mongoose.isValidObjectId(id)) throw httpError(`Invalid category id: ${id}`);
  return ids;
};

const assertNameFree = async (MenuTime, name, exceptId = null) => {
  const clash = await MenuTime.findOne({
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
    ...(exceptId && { _id: { $ne: exceptId } }),
  }).select("name").lean();
  if (clash) throw httpError(`A menu time named "${clash.name}" already exists`, 409);
};

export const listMenuTimes = async ({ models }) =>
  models.MenuTime.find().sort({ sortOrder: 1, "schedule.startTime": 1, name: 1 }).lean();

/**
 * Makes `categoryIds` exactly the categories in menu time `mt`: they get its
 * window; categories that were in it and are no longer listed go back to
 * All day. Categories moving in from another menu time simply switch.
 */
const syncCategories = async ({ Category, mt, categoryIds, session }) => {
  if (categoryIds === undefined) {
    await Category.updateMany({ menuTime: mt._id }, { $set: { schedule: mt.schedule } }, { session });
    return;
  }
  if (categoryIds.length) {
    const found = await Category.countDocuments({ _id: { $in: categoryIds } }, { session });
    if (found !== categoryIds.length) throw httpError("Some selected categories no longer exist — refresh and try again", 404);
  }
  await Category.updateMany(
    { menuTime: mt._id, _id: { $nin: categoryIds } },
    { $set: { menuTime: null, schedule: { ...EMPTY_SCHEDULE, days: [] } } },
    { session },
  );
  if (categoryIds.length) {
    await Category.updateMany(
      { _id: { $in: categoryIds } },
      { $set: { menuTime: mt._id, schedule: mt.schedule } },
      { session },
    );
  }
};

/** input: { name, schedule: {startTime,endTime,days,startDate,endDate}, color, categoryIds? } */
export const createMenuTime = async ({ models, db, input = {} }) => {
  const { MenuTime, Category } = models;
  const name = cleanName(input.name);
  const schedule = validateSchedule(input.schedule ?? {});
  const categoryIds = cleanCategoryIds(input.categoryIds);
  await assertNameFree(MenuTime, name);
  const count = await MenuTime.countDocuments();
  return withTx(db, async (session) => {
    const [mt] = await MenuTime.create([{ name, schedule, color: cleanColor(input.color), sortOrder: count }], { session });
    if (categoryIds?.length) await syncCategories({ Category, mt, categoryIds, session });
    return mt;
  });
};

export const updateMenuTime = async ({ models, db, id, input = {} }) => {
  const { MenuTime, Category } = models;
  if (!mongoose.isValidObjectId(id)) throw httpError("Menu time not found", 404);
  const current = await MenuTime.findById(id).lean();
  if (!current) throw httpError("Menu time not found", 404);
  const set = {};
  if (input.name !== undefined) {
    set.name = cleanName(input.name);
    if (set.name.toLowerCase() !== current.name.toLowerCase()) await assertNameFree(MenuTime, set.name, current._id);
  }
  if (input.schedule !== undefined) set.schedule = validateSchedule(input.schedule);
  if (input.color !== undefined) set.color = cleanColor(input.color);
  const categoryIds = cleanCategoryIds(input.categoryIds);

  return withTx(db, async (session) => {
    const mt = Object.keys(set).length
      ? await MenuTime.findByIdAndUpdate(id, { $set: set }, { new: true, session }).lean()
      : current;
    if (!mt) throw httpError("Menu time not found", 404);
    if (set.schedule || categoryIds !== undefined) await syncCategories({ Category, mt, categoryIds, session });
    return mt;
  });
};

/** Its categories go back to All day; their items are untouched. */
export const deleteMenuTime = async ({ models, db, id }) => {
  const { MenuTime, Category } = models;
  if (!mongoose.isValidObjectId(id)) throw httpError("Menu time not found", 404);
  const mt = await MenuTime.findById(id).lean();
  if (!mt) throw httpError("Menu time not found", 404);
  return withTx(db, async (session) => {
    const r = await Category.updateMany(
      { menuTime: mt._id },
      { $set: { menuTime: null, schedule: { ...EMPTY_SCHEDULE, days: [] } } },
      { session },
    );
    await MenuTime.deleteOne({ _id: mt._id }, { session });
    return { deleted: mt.name, categoriesFreed: r?.modifiedCount ?? 0 };
  });
};
