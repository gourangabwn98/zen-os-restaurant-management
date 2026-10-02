// services/insightsService.js
// ─────────────────────────────────────────────────────────────────────────────
// Server-side sales aggregation for Admin → Insights (revenue by item /
// category, making cost, gross profit) so the browser never has to pull
// thousands of orders to add them up.
//
// What counts as revenue (same rule as the Insights headline and the
// dashboard's totalRevenue): orders with paymentStatus PAID that are not
// CANCELLED. Unpaid, FAILED-payment and cancelled orders never count. The
// system has no separate refund state — a refund is a cancellation.
//
// Item revenue = order line price × qty (the price snapshotted on the order),
// i.e. gross item sales BEFORE tax, service charge and order-level coupon
// discounts. `orders` totals are returned alongside so the UI can reconcile
// item sales with money actually collected.
//
// Making cost (COGS) = Order.items[].makingCost × qty — the snapshot taken
// when the order went to the kitchen. Older orders without a snapshot fall
// back to the recipe's cost at today's prices and are flagged `estimated`.
// Items with no recipe at all have no cost (null), never ₹0.
// ─────────────────────────────────────────────────────────────────────────────

import { ORDER_STATUSES, PAYMENT_STATUSES } from "../utils/orderStateMachine.js";
import { computeRecipeCost, stockIngredientIds, roundMoney } from "../utils/recipeCost.js";

// Fails at boot, not silently at query time, if an enum is ever renamed.
const enumValue = (list, value) => {
  if (!list.includes(value)) throw new Error(`insightsService: "${value}" is not a known enum value`);
  return value;
};
const CANCELLED = enumValue(ORDER_STATUSES, "CANCELLED");
const PAID      = enumValue(PAYMENT_STATUSES, "PAID");

export const UNCATEGORISED = "Uncategorised";

/** Mongo $match for orders that count as revenue in [from, to]. */
export const revenueOrderMatch = ({ from, to } = {}) => {
  const match = { status: { $ne: CANCELLED }, paymentStatus: PAID };
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = from;
    if (to)   match.createdAt.$lte = to;
  }
  return match;
};

/**
 * Pure: per-item rows (from the aggregation) + menu/recipe lookups →
 * { items, categories, totals }. Categories are summed from the exact same
 * item rows, so Category view and Item view always add up to the same total.
 */
export const buildSalesBreakdown = ({ rows, menuById, liveCostByMenuItem }) => {
  const items = rows.map((r) => {
    const id = r._id ? String(r._id) : "";
    const menu = menuById.get(id);
    const qty = r.qty || 0;
    const revenue = roundMoney(r.revenue || 0);
    const uncostedQty = Math.max(0, qty - (r.costedQty || 0));
    const liveCost = liveCostByMenuItem.get(id) ?? null;

    let makingCost = r.snapshotCost || 0;
    let coveredQty = r.costedQty || 0;
    if (uncostedQty > 0 && liveCost != null) {
      makingCost += liveCost * uncostedQty;
      coveredQty += uncostedQty;
    }
    const hasCost = coveredQty > 0;
    // Revenue of the units we know the cost of, for an honest margin.
    const costedRevenue = qty ? revenue * (coveredQty / qty) : 0;

    return {
      menuItem: id || null,
      name: menu?.name || r.name || "Unknown item",
      category: menu?.category || UNCATEGORISED,
      qty,
      revenue,
      makingCost: hasCost ? roundMoney(makingCost) : null,
      grossProfit: hasCost ? roundMoney(costedRevenue - makingCost) : null,
      costEstimated: uncostedQty > 0 && liveCost != null,
      costPartial: hasCost && coveredQty < qty,
      _costedRevenue: costedRevenue,
    };
  }).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));

  const catMap = new Map();
  const totals = { qty: 0, revenue: 0, makingCost: 0, costedRevenue: 0, itemsWithoutCost: 0 };
  for (const it of items) {
    const c = catMap.get(it.category) || { category: it.category, qty: 0, revenue: 0, makingCost: 0, costedRevenue: 0, items: 0 };
    c.qty += it.qty; c.revenue += it.revenue; c.items += 1;
    totals.qty += it.qty; totals.revenue += it.revenue;
    if (it.makingCost != null) {
      c.makingCost += it.makingCost; c.costedRevenue += it._costedRevenue;
      totals.makingCost += it.makingCost; totals.costedRevenue += it._costedRevenue;
    } else {
      totals.itemsWithoutCost += 1;
    }
    catMap.set(it.category, c);
  }

  const categories = [...catMap.values()].map((c) => ({
    category: c.category,
    qty: c.qty,
    items: c.items,
    revenue: roundMoney(c.revenue),
    makingCost: c.costedRevenue > 0 ? roundMoney(c.makingCost) : null,
    grossProfit: c.costedRevenue > 0 ? roundMoney(c.costedRevenue - c.makingCost) : null,
  })).sort((a, b) => b.revenue - a.revenue || a.category.localeCompare(b.category));

  const grossProfit = totals.costedRevenue - totals.makingCost;
  return {
    items: items.map(({ _costedRevenue, ...rest }) => rest),
    categories,
    totals: {
      qty: totals.qty,
      revenue: roundMoney(totals.revenue),
      costedRevenue: roundMoney(totals.costedRevenue),
      makingCost: roundMoney(totals.makingCost),
      grossProfit: roundMoney(grossProfit),
      grossMarginPct: totals.costedRevenue > 0 ? Math.round((grossProfit / totals.costedRevenue) * 1000) / 10 : null,
      itemsWithoutCost: totals.itemsWithoutCost,
    },
  };
};

export const computeSalesBreakdown = async ({ models, from, to }) => {
  const { Order, MenuItem, Recipe, InventoryItem } = models;
  const match = revenueOrderMatch({ from, to });

  const [rows, orderAgg] = await Promise.all([
    Order.aggregate([
      { $match: match },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.menuItem",
          name: { $last: "$items.name" },
          qty: { $sum: "$items.qty" },
          revenue: { $sum: { $multiply: ["$items.price", "$items.qty"] } },
          // qty of lines carrying a cost snapshot (makingCost missing or null → 0)
          costedQty: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$items.makingCost", null] }, null] }, 0, "$items.qty"] } },
          snapshotCost: { $sum: { $multiply: [{ $ifNull: ["$items.makingCost", 0] }, "$items.qty"] } },
        },
      },
    ]),
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null, count: { $sum: 1 }, total: { $sum: "$total" }, subtotal: { $sum: "$subtotal" },
          tax: { $sum: "$tax" }, serviceCharge: { $sum: "$serviceCharge" }, discount: { $sum: "$discount" },
        },
      },
    ]),
  ]);

  const menuIds = rows.map((r) => r._id).filter(Boolean);
  const [menuDocs, recipes] = await Promise.all([
    MenuItem.find({ _id: { $in: menuIds } }, { name: 1, category: 1 }).lean(),
    // Only needed for the fallback cost of lines without a snapshot.
    rows.some((r) => (r.costedQty || 0) < (r.qty || 0))
      ? Recipe.find({ menuItem: { $in: menuIds }, status: "Active" }).lean()
      : [],
  ]);
  const menuById = new Map(menuDocs.map((m) => [String(m._id), m]));

  const liveCostByMenuItem = new Map();
  if (recipes.length) {
    const stock = await InventoryItem.find({ _id: { $in: stockIngredientIds(recipes) } }, { name: 1, unit: 1, costPrice: 1 }).lean();
    const byId = new Map(stock.map((i) => [String(i._id), i]));
    for (const r of recipes) {
      const { totalCost, incomplete } = computeRecipeCost(r.ingredients, byId);
      if (!(incomplete && totalCost === 0)) liveCostByMenuItem.set(String(r.menuItem), totalCost);
    }
  }

  const breakdown = buildSalesBreakdown({ rows, menuById, liveCostByMenuItem });
  const o = orderAgg[0] || {};
  return {
    ...breakdown,
    orders: {
      count: o.count || 0,
      collected: roundMoney(o.total || 0),
      subtotal: roundMoney(o.subtotal || 0),
      tax: roundMoney(o.tax || 0),
      serviceCharge: roundMoney(o.serviceCharge || 0),
      discount: roundMoney(o.discount || 0),
    },
    range: { from: from || null, to: to || null },
  };
};
