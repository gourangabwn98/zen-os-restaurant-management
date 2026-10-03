// services/menuItemService.js
// ─────────────────────────────────────────────────────────────────────────────
// Menu item operations behind Admin → Menu items that go beyond the plain
// create / edit form (controllers/menuController.js):
//
//   • Availability with three states — On · Sold out today · Off. "Sold out
//     today" is the existing isAvailable=false plus `soldOutUntil` (the next
//     end of the business day, RestaurantProfile.businessDayEndsAt). Expired
//     ones are switched back on by restoreSoldOutItems(), which
//     menuScheduleService.getScheduleContext runs before every menu read and
//     every order pricing — so nothing ever reads a stale isAvailable, and no
//     background timer is needed (a restart can't skip it).
//   • Diner tags ("Fish", "Spicy", …) — display/filter only.
//   • Bulk edit — move category, add/remove tags, change price by a percent.
//     Prices are always computed here, never accepted from the client.
//   • Import commit — admin-reviewed rows become categories + items.
//
// Must not import menuScheduleService (it imports this file).
// ─────────────────────────────────────────────────────────────────────────────
import mongoose from "mongoose";
import { nextBusinessDayEnd, resolveTimezone } from "../utils/menuSchedule.js";
import { normalizeCategoryName } from "./categoryService.js";

const MAX_BULK_IDS = 1000;
const MAX_TAGS = 10;
const MAX_TAG_LEN = 24;
const MAX_IMPORT_ROWS = 500;
const FOOD_TYPES = ["Veg", "Non Veg"];

const httpError = (msg, statusCode = 400) => {
  const e = new Error(msg);
  e.statusCode = statusCode;
  return e;
};
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── availability ────────────────────────────────────────────────────────────
export const AVAILABILITY_STATES = ["on", "soldout", "off"];

/** Switches every expired "Sold out today" item back on. Idempotent. */
export const restoreSoldOutItems = async ({ models, now = new Date() }) => {
  const r = await models.MenuItem.updateMany(
    { soldOutUntil: { $ne: null, $lte: now } },
    { $set: { isAvailable: true, soldOutUntil: null } },
  );
  return r?.modifiedCount ?? 0;
};

/** The update for one availability state (also used by the bulk bar). */
export const availabilityUpdate = (state, { now = new Date(), timezone, dayEnd } = {}) => {
  if (state === "on") return { isAvailable: true, soldOutUntil: null };
  if (state === "off") return { isAvailable: false, soldOutUntil: null };
  if (state === "soldout") {
    return { isAvailable: false, soldOutUntil: nextBusinessDayEnd(now, resolveTimezone(timezone), dayEnd || "03:00") };
  }
  throw httpError(`state must be one of: ${AVAILABILITY_STATES.join(", ")}`);
};

/** Sets On / Sold out today / Off on one or many items. */
export const setAvailability = async ({ models, ids, state, now = new Date() }) => {
  const { MenuItem, RestaurantProfile } = models;
  const list = normalizeIds(ids, "ids");
  if (!list.length) throw httpError("Select at least one item");
  const prof = state === "soldout"
    ? await RestaurantProfile.findOne().select("timezone businessDayEndsAt").lean()
    : null;
  const set = availabilityUpdate(state, { now, timezone: prof?.timezone, dayEnd: prof?.businessDayEndsAt });
  const found = await MenuItem.countDocuments({ _id: { $in: list } });
  if (found !== list.length) throw httpError(`${list.length - found} selected item(s) no longer exist — refresh and try again`, 404);
  await MenuItem.updateMany({ _id: { $in: list } }, { $set: set });
  return { ...set, updated: list.length };
};

// ── diner tags ──────────────────────────────────────────────────────────────
/**
 * Accepts an array, a JSON array string (multipart forms) or "a, b" text.
 * Trims, collapses spaces, drops case-insensitive duplicates (first spelling
 * wins), max 10 tags of 24 characters.
 */
export const normalizeTags = (raw) => {
  let list = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s.startsWith("[")) {
      try { list = JSON.parse(s); } catch { throw httpError("tags must be a list of words"); }
    } else list = s ? s.split(",") : [];
  }
  if (list == null) return [];
  if (!Array.isArray(list)) throw httpError("tags must be a list of words");
  const out = [];
  const seen = new Set();
  for (const t of list) {
    if (typeof t !== "string") throw httpError("tags must be a list of words");
    const clean = t.trim().replace(/\s+/g, " ");
    if (!clean) continue;
    if (clean.length > MAX_TAG_LEN) throw httpError(`A tag can be at most ${MAX_TAG_LEN} characters`);
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  if (out.length > MAX_TAGS) throw httpError(`An item can have at most ${MAX_TAGS} tags`);
  return out;
};

// ── bulk edit ───────────────────────────────────────────────────────────────
const normalizeIds = (raw, label) => {
  if (!Array.isArray(raw)) throw httpError(`${label} must be an array`);
  const ids = [...new Set(raw.map(String))];
  if (ids.length > MAX_BULK_IDS) throw httpError(`At most ${MAX_BULK_IDS} items per request`);
  for (const id of ids) if (!mongoose.isValidObjectId(id)) throw httpError(`Invalid id in ${label}: ${id}`);
  return ids;
};

/** Price after a percent change, whole rupees, never below zero. */
export const applyPercent = (price, percent) => Math.max(0, Math.round(Number(price || 0) * (1 + percent / 100)));

/**
 * Bulk edit for many items at once. Any combination of:
 *   category      — move to this existing category (by name)
 *   addTags       — diner tags to add
 *   removeTags    — diner tags to remove (case-insensitive)
 *   pricePercent  — e.g. 10 = +10 %, -5 = −5 % (−90 … +500)
 * Everything is validated before anything is written.
 */
export const bulkEditItems = async ({ models, ids, category, addTags, removeTags, pricePercent }) => {
  const { MenuItem, Category } = models;
  const list = normalizeIds(ids, "ids");
  if (!list.length) throw httpError("Select at least one item");

  let catName;
  if (category !== undefined && category !== null && category !== "") {
    const wanted = normalizeCategoryName(category);
    const cat = await Category.findOne({ name: { $regex: `^${escapeRegex(wanted)}$`, $options: "i" } }).select("name").lean();
    if (!cat) throw httpError(`No category named "${wanted}"`, 404);
    catName = cat.name;
  }
  const add = addTags === undefined ? [] : normalizeTags(addTags);
  const remove = new Set((removeTags === undefined ? [] : normalizeTags(removeTags)).map((t) => t.toLowerCase()));
  let pct = null;
  if (pricePercent !== undefined && pricePercent !== null && pricePercent !== "") {
    pct = Number(pricePercent);
    if (!Number.isFinite(pct) || pct < -90 || pct > 500) throw httpError("pricePercent must be between -90 and 500");
    if (pct === 0) pct = null;
  }
  if (catName === undefined && !add.length && !remove.size && pct === null) throw httpError("Nothing to change");

  const items = await MenuItem.find({ _id: { $in: list } }).select("price tags category").lean();
  if (items.length !== list.length) throw httpError(`${list.length - items.length} selected item(s) no longer exist — refresh and try again`, 404);

  const ops = items.map((i) => {
    const set = {};
    if (catName !== undefined) set.category = catName;
    if (pct !== null) set.price = applyPercent(i.price, pct);
    if (add.length || remove.size) {
      const kept = (i.tags || []).filter((t) => !remove.has(t.toLowerCase()));
      const have = new Set(kept.map((t) => t.toLowerCase()));
      const next = [...kept, ...add.filter((t) => !have.has(t.toLowerCase()) && !remove.has(t.toLowerCase()))];
      if (next.length > MAX_TAGS) throw httpError(`An item can have at most ${MAX_TAGS} tags`);
      set.tags = next;
    }
    return { updateOne: { filter: { _id: i._id }, update: { $set: set } } };
  });
  if (ops.length) await MenuItem.bulkWrite(ops, { ordered: true });
  return { updated: ops.length, category: catName ?? null, pricePercent: pct };
};

// ── import commit ───────────────────────────────────────────────────────────
const cleanText = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

/** Validates one reviewed import row; throws a 400 naming the row. */
export const normalizeImportRow = (row, index) => {
  const where = `Row ${index + 1}`;
  if (!row || typeof row !== "object") throw httpError(`${where}: not a dish`);
  const name = cleanText(row.name, 80);
  if (!name) throw httpError(`${where}: a name is required`);
  const price = Number(row.price);
  if (!Number.isFinite(price) || price < 0 || price > 1e6) throw httpError(`${where} (${name}): price must be a number`);
  let category;
  try { category = normalizeCategoryName(row.category); }
  catch (e) { throw httpError(`${where} (${name}): ${e.message}`); }
  const tag = FOOD_TYPES.includes(row.tag) ? row.tag : "Veg";
  return {
    name, price: Math.round(price * 100) / 100, category, tag,
    description: cleanText(row.description, 300),
    tags: normalizeTags(row.tags ?? []),
  };
};

/**
 * Creates the reviewed rows. Missing categories are created (matched to
 * existing ones case-insensitively); a dish whose name already exists in the
 * same category is skipped, so pressing Add twice never duplicates the menu.
 */
export const commitImport = async ({ models, rows }) => {
  const { MenuItem, Category } = models;
  if (!Array.isArray(rows) || !rows.length) throw httpError("Nothing to add");
  if (rows.length > MAX_IMPORT_ROWS) throw httpError(`At most ${MAX_IMPORT_ROWS} dishes per import`);
  const clean = rows.map(normalizeImportRow);

  const existingCats = await Category.find().select("name").lean();
  const catByKey = new Map(existingCats.map((c) => [c.name.toLowerCase(), c.name]));
  const newCats = [];
  for (const r of clean) {
    const key = r.category.toLowerCase();
    if (!catByKey.has(key)) { catByKey.set(key, r.category); newCats.push(r.category); }
    r.category = catByKey.get(key);
  }
  if (newCats.length) {
    try { await Category.insertMany(newCats.map((name) => ({ name })), { ordered: false }); }
    catch (err) { if (err?.code !== 11000 && !err?.writeErrors) throw err; } // created meanwhile — fine
  }

  const existing = await MenuItem.find({ category: { $in: [...new Set(clean.map((r) => r.category))] } }).select("name category").lean();
  const have = new Set(existing.map((i) => `${i.category}\u0000${i.name.toLowerCase()}`));
  const toCreate = [];
  let skipped = 0;
  for (const r of clean) {
    const key = `${r.category}\u0000${r.name.toLowerCase()}`;
    if (have.has(key)) { skipped++; continue; }
    have.add(key);
    toCreate.push({ ...r, isAvailable: true, rating: 4, image: "" });
  }
  if (toCreate.length) await MenuItem.insertMany(toCreate, { ordered: true });
  return { created: toCreate.length, skipped, categoriesCreated: newCats };
};
