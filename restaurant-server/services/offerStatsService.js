// services/offerStatsService.js
// ─────────────────────────────────────────────────────────────────────────────
// Read-only figures for Admin → Offers (the coupon page): who can be reached,
// what each coupon earned, whether orders went up while it ran, and a cost
// check of a draft offer against the restaurant's own recent bills.
//
// Nothing here changes a coupon, an order or a price. It reuses:
//   revenueOrderMatch       (insightsService) — PAID and not CANCELLED, the
//                           one revenue rule shared with Insights/Invoices
//   customerKeyExpr         (insightsService) — a customer = logged-in user
//                           or guest phone, the same as Insights
//   computeCouponDiscount   (utils/pricing.js) — the ONLY discount maths; the
//                           cost check runs it on real bill subtotals
//   computeSalesBreakdown   (insightsService) — food margin for the cost check
// Push "opened" counts don't exist (FCM topic sends report nothing back), so
// none are shown. Kept out of couponService.js / couponOfferService.js:
// those are on the order path and the push path respectively.
// ─────────────────────────────────────────────────────────────────────────────
import { revenueOrderMatch, customerKeyExpr, computeSalesBreakdown } from "./insightsService.js";
import { computeCouponDiscount } from "../utils/pricing.js";
import { roundMoney } from "../utils/recipeCost.js";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "../utils/orderStateMachine.js";

const enumValue = (list, value) => {
  if (!list.includes(value)) throw new Error(`offerStatsService: "${value}" is not a known enum value`);
  return value;
};
const CANCELLED = enumValue(ORDER_STATUSES, "CANCELLED");
const PAID = enumValue(PAYMENT_STATUSES, "PAID");

const DAY = 864e5;
export const LOOKBACK_DAYS = 28;      // "your last 4 weeks of orders"
export const SLIPPING_DAYS = 21;      // came 2+ times, none in 21+ days
const MIN_BASELINE_DAYS = 7;          // fewer earlier days → no "vs normal"
const MIN_BILLS_FOR_SIGNAL = 10;      // fewer bills → no bill-size advice
const MIN_BILLS_FOR_RUSH = 5;

// ── timezone helpers (restaurant's own zone, never the server's) ────────────
const partsIn = (date, tz) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
};
/** Instant of local wall-clock time (y, m, d, h) in `tz`. */
export const zonedInstant = (y, m, d, h, tz) => {
  const guess = Date.UTC(y, m - 1, d, h);
  const p = partsIn(new Date(guess), tz);
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - guess;
  return new Date(guess - offset);
};
const startOfMonthIn = (now, tz) => { const p = partsIn(now, tz); return zonedInstant(p.y, p.m, 1, 0, tz); };
export const hourIn = (date, tz) => partsIn(date, tz).h;

// ── pure helpers (unit-tested in test/offerStats.test.js) ───────────────────

/**
 * Orders while a coupon ran vs the restaurant's normal rate before it:
 * paid bills in [startsAt, min(endsAt, now)] against the per-day rate of the
 * (up to) 28 days before startsAt. null when it hasn't started, or there are
 * fewer than 7 earlier days of orders to call "normal".
 */
export const ordersVsNormal = ({ startsAt, endsAt, times, firstOrderAt, now }) => {
  const s = new Date(startsAt).getTime();
  const e = Math.min(new Date(endsAt).getTime(), now.getTime());
  if (!(s < now.getTime()) || !firstOrderAt) return null;
  const windowDays = (e - s) / DAY;
  const baseFrom = Math.max(s - LOOKBACK_DAYS * DAY, new Date(firstOrderAt).getTime());
  const baseDays = (s - baseFrom) / DAY;
  let during = 0, before = 0;
  for (const t of times) {
    if (t >= s && t <= e) during += 1;
    else if (t >= baseFrom && t < s) before += 1;
  }
  if (baseDays < MIN_BASELINE_DAYS) return { during, windowDays, expected: null, extra: null };
  const expected = (before / baseDays) * windowDays;
  return { during, windowDays, expected: Math.round(expected * 10) / 10, extra: Math.round((during - expected) * 10) / 10 };
};

/** Busiest hour of day by bill count, and the send time 2 hours before it. */
export const rushFromHours = (byHour) => {
  const total = byHour.reduce((a, b) => a + b, 0);
  if (total < MIN_BILLS_FOR_RUSH) return null;
  const hour = byHour.indexOf(Math.max(...byHour));
  return { hour, sendHour: (hour + 22) % 24, bills: byHour[hour], share: Math.round((byHour[hour] / total) * 1000) / 10 };
};

/** Customers who came 2+ times but not in the last 21 days. */
export const slippingAway = (rows, now) => {
  const cutoff = now.getTime() - SLIPPING_DAYS * DAY;
  const list = rows.filter((r) => r._id && r.bills >= 2 && new Date(r.last).getTime() < cutoff);
  return { count: list.length, userIds: list.filter((r) => r._id.startsWith("u:")).map((r) => r._id.slice(2)) };
};

const median = (xs) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((p, q) => p - q), mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};

/**
 * Cost check of draft terms against real recent bill subtotals (the coupon
 * minimum and discount both apply to the item subtotal — utils/pricing.js).
 * marginPct = food margin on dishes with a recipe (null if unknown).
 */
export const checkTerms = (terms, subtotals, marginPct = null) => {
  const coupon = {
    discountType: terms.discountType === "FLAT" ? "FLAT" : "PERCENT",
    discountValue: Number(terms.discountValue) || 0,
    maxDiscount: terms.maxDiscount === "" || terms.maxDiscount == null ? null : Number(terms.maxDiscount),
    minOrderAmount: Number(terms.minOrderAmount) || 0,
  };
  const bills = subtotals.length;
  const qual = subtotals.filter((s) => s >= coupon.minOrderAmount && s > 0);
  const discounts = qual.map((s) => computeCouponDiscount(coupon, s));
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const avgQual = qual.length ? sum(qual) / qual.length : 0;
  const avgDiscount = qual.length ? sum(discounts) / qual.length : 0;
  const keep = marginPct == null || !qual.length ? null : (avgQual * marginPct) / 100 - avgDiscount;
  return {
    bills,
    qualifying: qual.length,
    sharePct: bills ? Math.round((qual.length / bills) * 1000) / 10 : null,
    avgBill: bills ? roundMoney(sum(subtotals) / bills) : null,
    medianBill: bills ? roundMoney(median(subtotals)) : null,
    avgQualifyingBill: qual.length ? roundMoney(avgQual) : null,
    avgDiscount: qual.length ? roundMoney(avgDiscount) : null,
    discountPctOfBill: avgQual ? Math.round((avgDiscount / avgQual) * 1000) / 10 : null,
    marginPct,
    keepPerUse: keep == null ? null : roundMoney(keep),
  };
};

// ── data loading ────────────────────────────────────────────────────────────

/** Paid bills of the last 28 days (subtotal + time) and the food margin. */
const recentBills = async ({ models, now }) => {
  const from = new Date(now.getTime() - LOOKBACK_DAYS * DAY);
  const [rows, sales] = await Promise.all([
    models.Order.find(revenueOrderMatch({ from, to: now }), { subtotal: 1, createdAt: 1 }).lean(),
    computeSalesBreakdown({ models, from, to: now }),
  ]);
  const t = sales.totals;
  // Margin is only trusted when most item sales have a known food cost.
  const coverage = t.revenue > 0 ? (t.costedRevenue / t.revenue) * 100 : 0;
  return {
    rows,
    subtotals: rows.map((r) => Number(r.subtotal) || 0),
    marginPct: coverage >= 50 ? t.grossMarginPct : null,
    costCoveragePct: Math.round(coverage),
  };
};

const PUSH_REACHABLE = { pushTokens: { $exists: true, $not: { $size: 0 } } }; // same rule as notificationService

/** GET /api/coupons/admin/stats */
export const computeOfferStats = async ({ models, tz, now = new Date() }) => {
  const { Order, User, Coupon, NotificationLog } = models;
  const monthFrom = startOfMonthIn(now, tz);

  const [subscribers, customers, couponUse, month, recent, customerRows, coupons, logs, first] = await Promise.all([
    User.countDocuments(PUSH_REACHABLE),
    User.countDocuments({ role: "customer" }),
    Order.aggregate([
      { $match: { "coupon.code": { $exists: true, $ne: null } } },
      { $group: {
        _id: "$coupon.code",
        bills:    { $sum: { $cond: [{ $and: [{ $eq: ["$paymentStatus", PAID] }, { $ne: ["$status", CANCELLED] }] }, 1, 0] } },
        earned:   { $sum: { $cond: [{ $and: [{ $eq: ["$paymentStatus", PAID] }, { $ne: ["$status", CANCELLED] }] }, "$total", 0] } },
        discount: { $sum: { $cond: [{ $and: [{ $eq: ["$paymentStatus", PAID] }, { $ne: ["$status", CANCELLED] }] }, "$discount", 0] } },
        unpaid:   { $sum: { $cond: [{ $and: [{ $ne: ["$paymentStatus", PAID] }, { $ne: ["$status", CANCELLED] }] }, 1, 0] } },
      } },
    ]),
    Order.aggregate([
      { $match: { ...revenueOrderMatch({ from: monthFrom, to: now }), "coupon.code": { $exists: true, $ne: null } } },
      { $group: { _id: null, bills: { $sum: 1 }, earned: { $sum: "$total" }, discount: { $sum: "$discount" } } },
    ]),
    recentBills({ models, now }),
    Order.aggregate([
      { $match: revenueOrderMatch() },
      { $group: { _id: customerKeyExpr, bills: { $sum: 1 }, last: { $max: "$createdAt" } } },
    ]),
    Coupon.find({}, { code: 1, startsAt: 1, endsAt: 1, isActive: 1, minOrderAmount: 1, notification: 1, audience: 1 }).lean(),
    NotificationLog.find({}, { title: 1, body: 1, couponCode: 1, status: 1, recipientCount: 1, startsAt: 1, sentAt: 1, createdAt: 1, expiresAt: 1, sentBy: 1, error: 1 })
      .sort({ createdAt: -1 }).limit(100).lean(),
    Order.findOne(revenueOrderMatch(), { createdAt: 1 }).sort({ createdAt: 1 }).lean(),
  ]);

  const useByCode = new Map(couponUse.map((u) => [u._id, u]));
  const logById = new Map(logs.map((l) => [String(l._id), l]));

  // Paid-bill timestamps from 28 days before the earliest coupon start.
  const earliest = coupons.reduce((m, c) => Math.min(m, new Date(c.startsAt).getTime()), now.getTime());
  const times = earliest < now.getTime()
    ? (await Order.find(revenueOrderMatch({ from: new Date(earliest - LOOKBACK_DAYS * DAY), to: now }), { createdAt: 1 }).lean())
      .map((o) => new Date(o.createdAt).getTime())
    : [];
  const firstOrderAt = first?.createdAt || null;

  const byCoupon = {};
  for (const c of coupons) {
    const u = useByCode.get(c.code);
    const log = c.notification ? logById.get(String(c.notification)) : null;
    byCoupon[String(c._id)] = {
      bills: u?.bills || 0,
      earned: roundMoney(u?.earned || 0),
      discount: roundMoney(u?.discount || 0),
      unpaidBills: u?.unpaid || 0,
      recipients: log && (log.status || "SENT") === "SENT" ? log.recipientCount || 0 : null,
      vsNormal: ordersVsNormal({ startsAt: c.startsAt, endsAt: c.endsAt, times, firstOrderAt, now }),
    };
  }

  // Pushes not linked to a coupon (plain messages, or a code typed into an
  // old offer push). Legacy rows have no status — they were sent at once.
  const linked = new Set(coupons.filter((c) => c.notification).map((c) => String(c.notification)));
  const codes = new Set(coupons.map((c) => c.code));
  const pushes = logs.filter((l) => !linked.has(String(l._id))).map((l) => {
    const u = l.couponCode ? useByCode.get(l.couponCode) : null;
    return {
      _id: l._id, title: l.title, body: l.body, couponCode: l.couponCode || "",
      status: l.status || "SENT", recipients: l.recipientCount || 0, error: l.error || "",
      startsAt: l.startsAt, sentAt: l.sentAt || (l.status ? null : l.createdAt), createdAt: l.createdAt, expiresAt: l.expiresAt,
      sentBy: l.sentBy?.name || "",
      codeIsCoupon: l.couponCode ? codes.has(l.couponCode) : false,
      bills: u?.bills || 0, earned: roundMoney(u?.earned || 0), discount: roundMoney(u?.discount || 0),
    };
  });

  // Rush hour over the last 28 days, and the next send time 2 hours before it.
  const byHour = new Array(24).fill(0);
  for (const r of recent.rows) byHour[hourIn(new Date(r.createdAt), tz)] += 1;
  const rush = rushFromHours(byHour);
  let nextSendAt = null;
  if (rush) {
    const p = partsIn(now, tz);
    let at = zonedInstant(p.y, p.m, p.d, rush.sendHour, tz);
    if (at.getTime() < now.getTime() + 10 * 60 * 1000) at = new Date(at.getTime() + DAY);
    nextSendAt = at;
  }

  const slip = slippingAway(customerRows, now);
  const slipReachable = slip.userIds.length
    ? await User.countDocuments({ _id: { $in: slip.userIds }, ...PUSH_REACHABLE })
    : 0;

  // Live / upcoming coupons whose minimum only a few recent bills reach.
  const minimumGaps = recent.subtotals.length >= MIN_BILLS_FOR_SIGNAL
    ? coupons.filter((c) => c.isActive && c.minOrderAmount > 0 && new Date(c.endsAt) > now).map((c) => ({
      couponId: c._id, code: c.code, min: c.minOrderAmount,
      sharePct: Math.round((recent.subtotals.filter((s) => s >= c.minOrderAmount).length / recent.subtotals.length) * 1000) / 10,
    })).filter((g) => g.sharePct < 25)
    : [];

  const m = month[0] || {};
  return {
    now,
    timezone: tz,
    reach: {
      subscribers, customers,
      identifiedCustomers: customerRows.filter((r) => r._id).length,
      walkInBills: customerRows.filter((r) => !r._id).reduce((s, r) => s + r.bills, 0),
    },
    month: { from: monthFrom, bills: m.bills || 0, earned: roundMoney(m.earned || 0), discount: roundMoney(m.discount || 0) },
    bills: {
      days: LOOKBACK_DAYS, count: recent.subtotals.length,
      avg: recent.subtotals.length ? roundMoney(recent.subtotals.reduce((a, b) => a + b, 0) / recent.subtotals.length) : null,
      median: recent.subtotals.length ? roundMoney(median(recent.subtotals)) : null,
      marginPct: recent.marginPct, costCoveragePct: recent.costCoveragePct,
    },
    rush: rush ? { ...rush, nextSendAt } : null,
    slipping: { count: slip.count, reachable: slipReachable, days: SLIPPING_DAYS },
    minimumGaps,
    byCoupon,
    pushes,
  };
};

/** POST /api/coupons/admin/check — cost check of a draft (nothing is saved). */
export const checkOfferDraft = async ({ models, terms = {}, now = new Date() }) => {
  const type = String(terms.discountType || "").toUpperCase();
  if (!["PERCENT", "FLAT"].includes(type)) {
    const e = new Error("discountType must be PERCENT or FLAT"); e.statusCode = 400; throw e;
  }
  const recent = await recentBills({ models, now });
  return {
    days: LOOKBACK_DAYS,
    costCoveragePct: recent.costCoveragePct,
    ...checkTerms({ ...terms, discountType: type }, recent.subtotals, recent.marginPct),
  };
};
