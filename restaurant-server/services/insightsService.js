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

import mongoose from "mongoose";
import { ORDER_STATUSES, PAYMENT_STATUSES, ORDER_SOURCES } from "../utils/orderStateMachine.js";
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
export const buildSalesBreakdown = ({ rows, menuById, liveCostByMenuItem, categoryBnByName = new Map() }) => {
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
      nameBn: menu?.nameBn || "",
      category: menu?.category || UNCATEGORISED,
      qty,
      revenue,
      makingCost: hasCost ? roundMoney(makingCost) : null,
      grossProfit: hasCost ? roundMoney(costedRevenue - makingCost) : null,
      costEstimated: uncostedQty > 0 && liveCost != null,
      // plates whose cost is known (grossProfit ÷ costedQty = profit per plate)
      costedQty: hasCost ? coveredQty : 0,
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
    categoryBn: categoryBnByName.get(c.category) || "",
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
  const { Category } = models;
  const [menuDocs, recipes, categories] = await Promise.all([
    MenuItem.find({ _id: { $in: menuIds } }, { name: 1, nameBn: 1, category: 1 }).lean(),
    // Only needed for the fallback cost of lines without a snapshot.
    rows.some((r) => (r.costedQty || 0) < (r.qty || 0))
      ? Recipe.find({ menuItem: { $in: menuIds }, status: "Active" }).lean()
      : [],
    Category ? Category.find({}, { name: 1, nameBn: 1 }).lean() : [],
  ]);
  const categoryBnByName = new Map(categories.filter((c) => c.nameBn).map((c) => [c.name, c.nameBn]));
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

  const breakdown = buildSalesBreakdown({ rows, menuById, liveCostByMenuItem, categoryBnByName });
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

// ═════════════════════════════════════════════════════════════════════════════
// Insights overview (GET /admin/insights/overview) — everything the Insights
// page shows for one period, in one round trip. Read-only, and every money
// figure is built on the SAME revenue rule as above (revenueOrderMatch:
// PAID, not CANCELLED) — no second definition of revenue lives here.
//   sales      computeSalesBreakdown (items, categories, food cost, orders totals)
//   series     money collected + bill count per local day/hour (restaurant tz)
//   split      by orderType and by paymentMethod
//   wastage    WastageLog.costImpact (cost recorded when the waste was logged)
//   staffPay   StaffPay rows paid out in the period (advances + salaries —
//              a SALARY row already holds the net after advances, so the sum
//              is exactly the cash that went out, never double counted)
//   customers  new vs returning, by user id or guest phone
//   reviews, offers (coupon use), cancelled bills (excluded from revenue)
// Running costs (rent, gas, power…) are not recorded anywhere in the app, so
// nothing here estimates them.
// ═════════════════════════════════════════════════════════════════════════════

// Who the CUSTOMER is. On a staff-placed order `user` is the waiter/admin who
// keyed it (orderService.placeOrderTx) and the customer is guestName/Phone —
// so `user` only identifies the customer on a customer-placed order. (It used
// to count every waiter as a regular customer of their own orders.)
const STAFF_SOURCES = ORDER_SOURCES.filter((s) => s !== "CUSTOMER");
export const customerKeyExpr = {
  $cond: [
    { $and: [{ $ifNull: ["$user", false] }, { $not: [{ $in: [{ $ifNull: ["$source", "CUSTOMER"] }, STAFF_SOURCES] }] }] },
    { $concat: ["u:", { $toString: "$user" }] },
    { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$guestPhone", ""] } }, 0] }, { $concat: ["p:", "$guestPhone"] }, null] },
  ],
};

/** Pure: per-customer rows in the period + keys seen before it → counts. */
export const summariseCustomers = (rows = [], priorKeys = new Set()) => {
  const out = { bills: 0, walkInBills: 0, identified: 0, newCount: 0, returning: 0, repeatInPeriod: 0, identifiedSpend: 0 };
  for (const r of rows) {
    out.bills += r.bills;
    if (!r._id) { out.walkInBills += r.bills; continue; }
    out.identified += 1;
    out.identifiedSpend += r.spent || 0;
    if (priorKeys.has(r._id)) out.returning += 1; else out.newCount += 1;
    if (r.bills >= 2) out.repeatInPeriod += 1;
  }
  out.identifiedSpend = roundMoney(out.identifiedSpend);
  return out;
};

const sumBy = async (Model, match, field) => {
  if (!Model) return { amount: 0, count: 0 };
  const [r] = await Model.aggregate([{ $match: match }, { $group: { _id: null, amount: { $sum: `$${field}` }, count: { $sum: 1 } } }]);
  return { amount: roundMoney(r?.amount || 0), count: r?.count || 0 };
};

const range = (field, from, to) => ({ [field]: { $gte: from, $lte: to } });

/** Money figures for one period (used for the selected AND the previous one). */
const periodMoney = async ({ models, from, to, tz }) => {
  const { Order, WastageLog, StaffPay } = models;
  const match = revenueOrderMatch({ from, to });
  const [sales, series, wastage, payRows] = await Promise.all([
    computeSalesBreakdown({ models, from, to }),
    Order.aggregate([
      { $match: match },
      { $group: {
        _id: { d: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: tz } }, h: { $hour: { date: "$createdAt", timezone: tz } } },
        revenue: { $sum: "$total" }, orders: { $sum: 1 },
      } },
    ]),
    sumBy(WastageLog, range("wastageDate", from, to), "costImpact"),
    StaffPay ? StaffPay.aggregate([{ $match: range("createdAt", from, to) }, { $group: { _id: "$type", amount: { $sum: "$amount" }, count: { $sum: 1 } } }]) : [],
  ]);
  const pay = Object.fromEntries(payRows.map((r) => [r._id, { amount: roundMoney(r.amount), count: r.count }]));
  return {
    sales,
    series: series.map((r) => ({ d: r._id.d, h: r._id.h, revenue: roundMoney(r.revenue), orders: r.orders }))
      .sort((a, b) => a.d.localeCompare(b.d) || a.h - b.h),
    wastage,
    staffPay: {
      advances: pay.ADVANCE || { amount: 0, count: 0 },
      salaries: pay.SALARY || { amount: 0, count: 0 },
      amount: roundMoney((pay.ADVANCE?.amount || 0) + (pay.SALARY?.amount || 0)),
    },
  };
};

export const computeInsightsOverview = async ({ models, from, to, prevFrom, prevTo, tz, now = new Date() }) => {
  const { Order, StaffReview, Coupon } = models;
  const match = revenueOrderMatch({ from, to });

  const [current, previous, split, customerRows, cancelled, reviews, couponUse, coupons] = await Promise.all([
    periodMoney({ models, from, to, tz }),
    prevFrom && prevTo ? periodMoney({ models, from: prevFrom, to: prevTo, tz }) : null,
    Order.aggregate([
      { $match: match },
      { $facet: {
        type:   [{ $group: { _id: "$orderType",     orders: { $sum: 1 }, revenue: { $sum: "$total" } } }],
        method: [{ $group: { _id: "$paymentMethod", orders: { $sum: 1 }, revenue: { $sum: "$total" } } }],
      } },
    ]),
    Order.aggregate([
      { $match: match },
      { $group: { _id: customerKeyExpr, bills: { $sum: 1 }, spent: { $sum: "$total" } } },
    ]),
    sumBy(Order, { status: CANCELLED, ...range("createdAt", from, to) }, "total"),
    StaffReview ? StaffReview.aggregate([
      { $match: range("createdAt", from, to) },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$rating" }, complaints: { $sum: { $cond: ["$complaint", 1, 0] } } } },
    ]) : [],
    Order.aggregate([
      { $match: { ...match, coupon: { $ne: null } } },
      { $group: { _id: "$coupon.code", bills: { $sum: 1 }, discount: { $sum: "$discount" }, revenue: { $sum: "$total" } } },
      { $sort: { bills: -1 } },
    ]),
    Coupon ? Coupon.find({ isActive: true, endsAt: { $gte: now } }, { code: 1, title: 1, startsAt: 1, endsAt: 1 }).sort({ startsAt: 1 }).limit(5).lean() : [],
  ]);

  // Was each identified customer here (a paid bill) before this period?
  const keys = customerRows.map((r) => r._id).filter(Boolean);
  const userIds = keys.filter((k) => k.startsWith("u:")).map((k) => k.slice(2));
  const phones = keys.filter((k) => k.startsWith("p:")).map((k) => k.slice(2));
  const priorRows = keys.length
    ? await Order.aggregate([
      { $match: { ...revenueOrderMatch({ to: new Date(from.getTime() - 1) }), $or: [
        ...(userIds.length ? [{ user: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) } }] : []),
        ...(phones.length ? [{ guestPhone: { $in: phones } }] : []),
      ] } },
      { $group: { _id: customerKeyExpr } },
    ])
    : [];
  const priorKeys = new Set(priorRows.map((r) => r._id).filter(Boolean));

  const rv = reviews[0];
  const s = split[0] || { type: [], method: [] };
  const rows = (list) => list.map((r) => ({ key: r._id, orders: r.orders, revenue: roundMoney(r.revenue) })).sort((a, b) => b.revenue - a.revenue);
  return {
    timezone: tz,
    range: { from, to, prevFrom: prevFrom || null, prevTo: prevTo || null },
    current,
    previous,
    split: { type: rows(s.type), method: rows(s.method) },
    customers: summariseCustomers(customerRows, priorKeys),
    cancelled,
    reviews: rv ? { count: rv.count, avg: Math.round((rv.total / rv.count) * 10) / 10, complaints: rv.complaints } : { count: 0, avg: null, complaints: 0 },
    offers: {
      used: couponUse.map((c) => ({ code: c._id, bills: c.bills, discount: roundMoney(c.discount), revenue: roundMoney(c.revenue) })),
      live: coupons.filter((c) => new Date(c.startsAt) <= now).map((c) => ({ code: c.code, title: c.title, endsAt: c.endsAt })),
      upcoming: coupons.filter((c) => new Date(c.startsAt) > now).map((c) => ({ code: c.code, title: c.title, startsAt: c.startsAt })),
    },
  };
};
