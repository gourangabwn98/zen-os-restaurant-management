// services/bestSellerService.js
// ── Best sellers (customer Home slider) ─────────────────────────────────────
// Real sales only: the menu items sold most (by quantity) on revenue orders
// — PAID and not CANCELLED, the shared insightsService rule — in the last
// `days` days, limited to items a customer can order right now (available +
// category/item schedule). No stored "bestseller" flag exists; this is a
// small aggregation, not a new field. (Own module: menuItemService must not
// import menuScheduleService.)
import { revenueOrderMatch } from "./insightsService.js";
import { getScheduleContext, isItemScheduledNow } from "./menuScheduleService.js";

/** Pure: ranked aggregate rows + visible items → top N items with sold qty. */
export const pickBestSellers = (rows, visibleById, limit) => rows
  .map((r) => ({ item: visibleById.get(String(r._id)), sold: r.qty }))
  .filter((x) => x.item && x.sold > 0)
  .slice(0, limit)
  .map(({ item, sold }) => ({
    _id: item._id, name: item.name, nameBn: item.nameBn || "", price: item.price, originalPrice: item.originalPrice ?? null,
    image: item.image || "", category: item.category, tag: item.tag, description: item.description || "", sold,
  }));

export const listBestSellers = async ({ models, days = 30, limit = 6, now = new Date() }) => {
  const from = new Date(now.getTime() - days * 864e5);
  const rows = await models.Order.aggregate([
    { $match: revenueOrderMatch({ from, to: now }) },
    { $unwind: "$items" },
    { $match: { "items.menuItem": { $ne: null } } },
    { $group: { _id: "$items.menuItem", qty: { $sum: "$items.qty" } } },
    { $sort: { qty: -1 } },
    { $limit: 60 },
  ]);
  if (!rows.length) return [];
  const ctx = await getScheduleContext({ models, now });
  const items = await models.MenuItem.find({ _id: { $in: rows.map((r) => r._id) }, isAvailable: true }).lean();
  const visible = new Map(items.filter((i) => isItemScheduledNow(i, ctx)).map((i) => [String(i._id), i]));
  return pickBestSellers(rows, visible, limit);
};
