// services/smartCategoryService.js
// ─────────────────────────────────────────────────────────────────────────────
// MNU-01 / 03–07 — the DB half of utils/menuCategories.js.
//
//   ensureSmartCategories  one built-in Category doc per smart key (idempotent,
//                          never overwrites an admin's position / Bengali name /
//                          picture). A manual category that already uses the
//                          name (e.g. one made by hand as a workaround) is
//                          adopted, not duplicated: it becomes the smart one and
//                          its items get the matching flag, so nothing a
//                          customer sees disappears.
//   getDataSets            Most Ordered / Sales-Based Choice / Highest Rated as
//                          item-id sets, from real revenue orders and real FOOD
//                          ratings only (rules: SMART_DATA_RULES). Cached for a
//                          few minutes per process — they move slowly.
//   getMenuContext         everything a menu read needs to list each item under
//                          all of its categories (itemCategoryList).
// ─────────────────────────────────────────────────────────────────────────────
import { revenueOrderMatch } from "./insightsService.js";
import {
  SMART_CATEGORIES, SMART_DATA_RULES, topIds, highestRatedIds,
} from "../utils/menuCategories.js";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CACHE_MS = 5 * 60 * 1000;
let dataCache = { at: 0, sets: null };
let ensured = false;

/** Test hook. */
export const _resetSmartCache = () => { dataCache = { at: 0, sets: null }; ensured = false; };

export const ensureSmartCategories = async ({ models, force = false }) => {
  if (ensured && !force) return;
  const { Category, MenuItem } = models;
  for (const def of SMART_CATEGORIES) {
    const existing = await Category.findOne({ smartKey: def.key }).select("_id").lean();
    if (existing) continue;
    const sameName = await Category.findOne({ name: { $regex: `^${escapeRegex(def.name)}$`, $options: "i" } }).lean();
    if (sameName) {
      const oldName = sameName.name;
      if (def.source === "flag") {
        await MenuItem.updateMany(
          { $or: [{ category: oldName }, { categories: oldName }] },
          { $set: { [def.flag]: true } },
        );
      }
      await Category.updateOne({ _id: sameName._id }, { $set: { kind: "SMART", smartKey: def.key, name: def.name } });
      if (oldName !== def.name) {
        // Same name, other spelling ("chef's picks") — references follow.
        await MenuItem.updateMany({ category: oldName }, { $set: { category: def.name } });
        await MenuItem.updateMany({ categories: oldName }, { $set: { "categories.$[c]": def.name } }, { arrayFilters: [{ c: oldName }] });
      }
      continue;
    }
    const last = await Category.findOne().sort({ sortOrder: -1 }).select("sortOrder").lean();
    try {
      await Category.create({
        name: def.name, nameBn: def.nameBn, kind: "SMART", smartKey: def.key, icon: def.icon,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      });
    } catch (err) {
      if (err?.code !== 11000) throw err; // another instance created it a moment ago
    }
  }
  ensured = true;
};

/** Map<smartKey, Set<menuItemId>> for the data-driven smart categories. */
export const getDataSets = async ({ models, now = new Date(), fresh = false }) => {
  if (!fresh && dataCache.sets && now.getTime() - dataCache.at < CACHE_MS) return dataCache.sets;
  const { Order, StaffReview } = models;
  const from = new Date(now.getTime() - SMART_DATA_RULES.windowDays * 864e5);

  const sales = await Order.aggregate([
    { $match: revenueOrderMatch({ from, to: now }) },
    { $unwind: "$items" },
    { $match: { "items.menuItem": { $ne: null } } },
    { $group: {
      _id: "$items.menuItem",
      qty: { $sum: "$items.qty" },
      revenue: { $sum: { $multiply: ["$items.price", "$items.qty"] } },
    } },
  ]);

  // Highest Rated — customers' FOOD star ratings, spread over the dishes of
  // each rated order (a rating is per order, so every dish on it shares it).
  const ratingFrom = new Date(now.getTime() - SMART_DATA_RULES.ratingWindowDays * 864e5);
  let ratedRows = [];
  if (StaffReview) {
    const reviews = await StaffReview.find({ kind: "FOOD", createdAt: { $gte: ratingFrom } }).select("order rating").lean();
    if (reviews.length) {
      const orders = await Order.find({ _id: { $in: reviews.map((r) => r.order) } }).select("items.menuItem").lean();
      const itemsOf = new Map(orders.map((o) => [String(o._id), [...new Set((o.items || []).map((i) => String(i.menuItem)))]]));
      const acc = new Map();
      for (const r of reviews) {
        for (const id of itemsOf.get(String(r.order)) || []) {
          const a = acc.get(id) || { sum: 0, n: 0 };
          a.sum += Number(r.rating) || 0; a.n += 1;
          acc.set(id, a);
        }
      }
      ratedRows = [...acc.entries()].map(([id, a]) => ({ _id: id, n: a.n, avg: a.sum / a.n }));
    }
  }

  const sets = new Map([
    ["MOST_ORDERED", topIds(sales.map((r) => ({ _id: r._id, value: r.qty })))],
    ["SALES_CHOICE", topIds(sales.map((r) => ({ _id: r._id, value: r.revenue })))],
    ["HIGHEST_RATED", highestRatedIds(ratedRows)],
  ]);
  dataCache = { at: now.getTime(), sets };
  return sets;
};

/** What itemCategoryList needs for one menu read. */
export const getMenuContext = async ({ models, hidden = new Set(), now = new Date() }) => {
  await ensureSmartCategories({ models });
  const smartCats = await models.Category.find({ kind: "SMART" }).select("name smartKey").lean();
  const dataSets = await getDataSets({ models, now });
  return { smartCats, dataSets, hidden };
};
