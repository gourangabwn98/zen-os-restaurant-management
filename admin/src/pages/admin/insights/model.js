// src/pages/admin/insights/model.js
// Pure helpers for the Insights page. Every figure comes from
// GET /admin/insights/overview (restaurant-server/services/insightsService.js):
// revenue = PAID and not CANCELLED, the same rule the old Insights page,
// the sales breakdown and the Dashboard's revenue already use. Nothing here
// estimates a cost the app doesn't record.
import { t, N_, fmtNum, fmtDate, fmtTime, localName } from "../../../i18n/core.js";

export const PERIODS = [
  { key: "today", label: N_("Today") },
  { key: "week", label: N_("This week") },
  { key: "month", label: N_("This month") },
  { key: "year", label: N_("This year (FY)") },
  { key: "custom", label: N_("Custom") },
];
/** What the selected period is compared with (always the same length). */
export const PREV_LABEL = {
  today: N_("same time yesterday"),
  week: N_("same time last week"),
  month: N_("same days last month"),
  year: N_("same time last year"),
  custom: N_("the same number of days before"),
};
/** Lower-case period name used inside sentences ("plates sold · this week"). */
export const PERIOD_WORD = {
  today: N_("today"), week: N_("this week"), month: N_("this month"), year: N_("this financial year"), custom: N_("in these dates"),
};

export const money = (n) => `₹${fmtNum(Math.round(Number(n) || 0))}`;
export const signedMoney = (n) => `${n < 0 ? "−" : ""}${money(Math.abs(n))}`;
/** Short axis/bar label: ₹840 · ₹4.6k · ₹1.8L */
export const compact = (n) => {
  const v = Math.abs(Number(n) || 0), s = n < 0 ? "−" : "";
  if (v >= 100000) return `${s}₹${fmtNum(v / 100000, { maximumFractionDigits: 1 })}${t("L")}`;
  if (v >= 1000) return `${s}₹${fmtNum(v / 1000, { maximumFractionDigits: 1 })}${t("k")}`;
  return `${s}₹${fmtNum(Math.round(v))}`;
};
/** % change, or null when there is nothing to compare with (never a fake 0%). */
export const pctChange = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
export const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);

const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const shiftMonths = (d, n) => {
  const x = new Date(d), day = x.getDate();
  x.setDate(1); x.setMonth(x.getMonth() + n);
  x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
  return x;
};
const parseYmd = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Indian financial year (Apr–Mar) that `d` falls in → its starting calendar year. */
export const fyStartYear = (d) => (d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1);

/**
 * Selected period (start → now) and the comparison period of the same length.
 * unit = how the revenue chart is split: hour / day / week (7-day blocks) / month.
 */
export const periodBounds = (key, custom, now = new Date()) => {
  const to = new Date(now);
  if (key === "today") {
    const from = sod(now);
    return { key, from, to, prevFrom: addDays(from, -1), prevTo: addDays(to, -1), unit: "hour" };
  }
  if (key === "week") {
    const from = sod(now); from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); // Monday
    return { key, from, to, prevFrom: addDays(from, -7), prevTo: addDays(to, -7), unit: "day" };
  }
  if (key === "month") {
    const from = sod(now); from.setDate(1);
    return { key, from, to, prevFrom: shiftMonths(from, -1), prevTo: shiftMonths(to, -1), unit: "week" };
  }
  if (key === "year") {
    const from = new Date(fyStartYear(now), 3, 1);
    const prevTo = new Date(to); prevTo.setFullYear(prevTo.getFullYear() - 1);
    return { key, from, to, prevFrom: new Date(from.getFullYear() - 1, 3, 1), prevTo, unit: "month" };
  }
  const from = parseYmd(custom.from);
  const end = parseYmd(custom.to); end.setHours(23, 59, 59, 999);
  const until = end > now ? to : end;
  const days = Math.round((sod(until) - from) / 864e5) + 1;
  const prevFrom = addDays(from, -days);
  return {
    key, from, to: until, prevFrom, prevTo: new Date(prevFrom.getTime() + (until - from)), days,
    unit: days <= 1 ? "hour" : days <= 31 ? "day" : days <= 26 * 7 ? "week" : "month",
  };
};

// ── revenue chart slots ─────────────────────────────────────────────────────
const dayNum = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const localDayNum = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5;

const slotIndex = (unit, row, start) => {
  const dn = dayNum(row.d) - localDayNum(start);
  if (unit === "hour") return dn === 0 ? row.h : -1;
  if (unit === "day") return dn;
  if (unit === "week") return Math.floor(dn / 7);
  const [y, m] = row.d.split("-").map(Number);
  return y * 12 + (m - 1) - (start.getFullYear() * 12 + start.getMonth());
};

const slotCount = (b) => {
  if (b.unit === "hour") return 24;
  const days = Math.round((sod(b.to) - sod(b.from)) / 864e5) + 1;
  if (b.key === "week") return 7;
  if (b.key === "month") return Math.ceil(new Date(b.from.getFullYear(), b.from.getMonth() + 1, 0).getDate() / 7);
  if (b.key === "year") return 12;
  if (b.unit === "day") return days;
  if (b.unit === "week") return Math.ceil(days / 7);
  return (b.to.getFullYear() * 12 + b.to.getMonth()) - (b.from.getFullYear() * 12 + b.from.getMonth()) + 1;
};

const slotStart = (unit, from, i) => {
  if (unit === "hour") { const x = new Date(from); x.setHours(i); return x; }
  if (unit === "day") return addDays(from, i);
  if (unit === "week") return addDays(from, 7 * i);
  return new Date(from.getFullYear(), from.getMonth() + i, 1);
};

const slotLabels = (b, i, start) => {
  if (b.unit === "hour") {
    const end = new Date(start); end.setHours(i + 1);
    return { short: fmtTime(start, { hour: "numeric" }), full: `${fmtTime(start, { hour: "numeric" })} – ${fmtTime(end, { hour: "numeric" })}` };
  }
  if (b.unit === "day") {
    return {
      short: b.key === "week" ? fmtDate(start, { weekday: "short" }) : fmtDate(start, { day: "numeric", month: "short" }),
      full: fmtDate(start, { weekday: "long", day: "numeric", month: "short" }),
    };
  }
  if (b.unit === "week") {
    const last = b.key === "month"
      ? new Date(Math.min(addDays(start, 6), new Date(start.getFullYear(), start.getMonth() + 1, 0)))
      : addDays(start, 6);
    const range = b.key === "month"
      ? `${fmtNum(start.getDate())}–${fmtNum(last.getDate())}`
      : `${fmtDate(start, { day: "numeric", month: "short" })}`;
    return { short: range, full: `${fmtDate(start, { day: "numeric", month: "short" })} – ${fmtDate(last, { day: "numeric", month: "short" })}` };
  }
  return { short: fmtDate(start, { month: "short" }), full: fmtDate(start, { month: "long", year: "numeric" }) };
};

/**
 * Server rows ({ d: "YYYY-MM-DD" in the restaurant's timezone, h, revenue,
 * orders }) → one slot per hour/day/week/month of the period, with the
 * comparison period in the same slot (slot i of each). Slots still in the
 * future are null ("—"), never ₹0.
 */
export const buildSeries = ({ bounds, current = [], previous = [], now = new Date() }) => {
  const n = slotCount(bounds);
  const cur = Array.from({ length: n }, () => ({ revenue: 0, orders: 0 }));
  const prev = Array.from({ length: n }, () => ({ revenue: 0, orders: 0 }));
  const fill = (rows, start, into) => {
    for (const r of rows) {
      const i = slotIndex(bounds.unit, r, start);
      if (i >= 0 && i < n) { into[i].revenue += r.revenue; into[i].orders += r.orders; }
    }
  };
  fill(current, bounds.from, cur);
  if (bounds.prevFrom) fill(previous, bounds.prevFrom, prev);

  let slots = cur.map((c, i) => {
    const start = slotStart(bounds.unit, bounds.from, i);
    const future = start > now;
    return { i, ...slotLabels(bounds, i, start), value: future ? null : c.revenue, orders: c.orders, prev: previous.length ? prev[i].revenue : null };
  });
  if (bounds.unit === "hour") {
    // Opening hours only: from the first hour with any sale (or 9 am) to the last (or 9 pm).
    const used = slots.filter((s) => s.value > 0 || s.prev > 0).map((s) => s.i);
    const lo = Math.min(9, ...used), hi = Math.max(21, ...used);
    slots = slots.slice(lo, hi + 1);
  }

  // Busiest hour of day over the whole period, by money collected.
  const byHour = new Array(24).fill(0);
  for (const r of current) byHour[r.h] += r.revenue;
  const total = byHour.reduce((s, v) => s + v, 0);
  const h = byHour.indexOf(Math.max(...byHour));
  const busiest = total > 0 ? (() => {
    const a = new Date(bounds.from); a.setHours(h, 0, 0, 0);
    const b = new Date(a); b.setHours(h + 1);
    return { label: `${fmtTime(a, { hour: "numeric" })} – ${fmtTime(b, { hour: "numeric" })}`, share: pct(byHour[h], total) };
  })() : null;

  const filled = slots.filter((s) => s.value > 0);
  const best = filled.length ? filled.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  return { slots, best, busiest };
};

// ── earnings ladder ─────────────────────────────────────────────────────────
/**
 * "Where every rupee went". Two honest blocks — no figure the app doesn't hold:
 *   money:  item sales − discounts + service charge + GST = money collected
 *           (the Insights revenue figure)
 *   profit: sales of dishes with a recipe − food cost = gross profit
 *           (insightsService's own calculation) − stock wasted − staff pay
 *           paid out = what's left. Rent, gas, power… aren't recorded.
 * Each row: value + the bar's [a, b] extent on a shared scale.
 */
export const buildLadder = (cur) => {
  const o = cur.sales.orders, tt = cur.sales.totals;
  const S = o.subtotal, D = o.discount, SC = o.serviceCharge, T = o.tax, C = o.collected;
  const CR = tt.costedRevenue, M = tt.makingCost, GP = tt.grossProfit;
  const W = cur.wastage.amount, P = cur.staffPay.amount, L = GP - W - P;
  const money = [
    { id: "sales", label: N_("Item sales billed"), sub: N_("paid bills, before discount and tax"), value: S, a: 0, b: S, tone: "base" },
    { id: "disc", label: N_("− Discounts"), sub: N_("coupons on paid bills"), value: -D, a: S - D, b: S, tone: "stop", hide: !D },
    { id: "sc", label: N_("+ Service charge"), value: SC, a: S - D, b: S - D + SC, tone: "add", hide: !SC },
    { id: "gst", label: N_("+ GST collected"), sub: N_("goes to the government"), value: T, a: S - D + SC, b: S - D + SC + T, tone: "add", hide: !T },
    { id: "collected", label: N_("Money collected"), sub: N_("what customers really paid"), value: C, a: 0, b: C, tone: "total", total: true, key: true },
  ];
  const profit = [
    { id: "costed", label: N_("Sales of dishes with a recipe"), sub: N_("the part of item sales whose food cost is known"), value: CR, a: 0, b: CR, tone: "base" },
    { id: "cogs", label: N_("− Food cost"), sub: N_("recipe cost when the order went to the kitchen"), value: -M, a: CR - M, b: CR, tone: "cost" },
    { id: "gp", label: N_("Gross profit"), sub: N_("food margin"), value: GP, a: Math.min(0, GP), b: Math.max(0, GP), tone: "total", total: true, pct: CR > 0 ? pct(GP, CR) : null },
    { id: "waste", label: N_("− Stock wasted"), sub: N_("wastage entries in Inventory"), value: -W, a: GP - W, b: GP, tone: "stop", hide: !W },
    { id: "pay", label: N_("− Staff pay paid out"), sub: N_("advances and salaries paid in this period"), value: -P, a: GP - W - P, b: GP - W, tone: "cost", hide: !P },
    { id: "left", label: N_("Left after food, waste and staff"), sub: N_("before rent, gas and power"), value: L, a: Math.min(0, L), b: Math.max(0, L), tone: L < 0 ? "stop" : "good", total: true, key: true, hide: !W && !P },
  ];
  const scale = Math.max(S, C, CR, 1);
  return { money: money.filter((r) => !r.hide), profit: profit.filter((r) => !r.hide), scale, left: L, costShare: pct(CR, tt.revenue) };
};

// ── dishes ──────────────────────────────────────────────────────────────────
/** Dishes with a known food cost → plates sold × profit per plate. */
export const dishPoints = (items = []) => items
  .filter((i) => i.makingCost != null && i.costedQty > 0 && i.qty > 0)
  .map((i) => ({ id: i.menuItem || i.name, name: localName(i), sold: i.qty, perPlate: i.grossProfit / i.costedQty, profit: i.grossProfit, costedQty: i.costedQty }));

export const QUADS = [
  { label: N_("Winners"), act: N_("Keep them at the top of the menu"), color: "var(--ready-ink)", dot: "var(--ready)" },
  { label: N_("Popular, low profit"), act: N_("Raise the price a little or cut the portion"), color: "var(--wait-ink)", dot: "var(--wait)" },
  { label: N_("Profitable, slow"), act: N_("Promote with an offer"), color: "var(--live-ink)", dot: "var(--live)" },
  { label: N_("Fix or remove"), act: N_("Change the recipe or drop it"), color: "var(--stop-ink)", dot: "var(--stop)" },
];

/**
 * Menu-engineering split against YOUR averages (not a fixed target):
 * plates sold vs the average dish, profit per plate vs the average plate.
 */
export const classifyDishes = (pts) => {
  if (pts.length < 2) return null;
  const avgSold = pts.reduce((s, p) => s + p.sold, 0) / pts.length;
  const avgPlate = pts.reduce((s, p) => s + p.profit, 0) / (pts.reduce((s, p) => s + p.costedQty, 0) || 1);
  const quad = (p) => (p.sold >= avgSold ? (p.perPlate >= avgPlate ? 0 : 1) : (p.perPlate >= avgPlate ? 2 : 3));
  return { avgSold, avgPlate, points: pts.map((p) => ({ ...p, q: quad(p) })) };
};

/** Nice axis ticks for a max value: 0 → max in 2–5 round steps. */
export const niceMax = (v) => {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
};

// ── export ──────────────────────────────────────────────────────────────────
/** Accountant-friendly CSV of the period: the ladder, splits and every item. */
export const insightsCsv = ({ bounds, data, ladder }) => {
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const rows = [
    ["Period", `${ymd(bounds.from)} to ${ymd(bounds.to)}`],
    ["Paid bills", data.current.sales.orders.count],
    [],
    ["Section", "Line", "Amount (Rs)"],
    ...[...ladder.money, ...ladder.profit].map((l) => ["Earnings", l.label.replace(/^[−+] /, ""), r2(l.value)]),
    ["Earnings", "Cancelled bills (not counted)", r2(data.cancelled.amount)],
    [],
    ...data.split.type.map((s) => ["Order type", s.key, r2(s.revenue)]),
    ...data.split.method.map((s) => ["Payment method", s.key, r2(s.revenue)]),
    [],
    ["Item", "Category", "Plates sold", "Item sales (Rs)", "Food cost (Rs)", "Gross profit (Rs)"],
    ...data.current.sales.items.map((i) => [i.name, i.category, i.qty, r2(i.revenue), i.makingCost == null ? "" : r2(i.makingCost), i.grossProfit == null ? "" : r2(i.grossProfit)]),
  ];
  return rows.map((r) => r.map(esc).join(",")).join("\n");
};
