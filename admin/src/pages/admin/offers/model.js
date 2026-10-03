// src/pages/admin/offers/model.js
// Pure helpers for Admin → Offers. An offer here IS a coupon
// (restaurant-server/services/couponService.js) plus, optionally, its
// announcement push (couponOfferService.js — sent at the coupon's start).
// Every figure comes from the server: coupons from GET /coupons/admin,
// results/reach/signals from GET /coupons/admin/stats, the cost check from
// POST /coupons/admin/check. Nothing here computes a discount.
import { t, N_, fmtNum, fmtDate, fmtTime } from "../../../i18n/core.js";

// Mirrors the server rule (couponService.normalizeCouponCode).
export const COUPON_RE = /^[A-Z0-9_-]{3,20}$/;
export const TITLE_MAX = 60;
export const DESC_MAX = 200;

export const money = (n) => `₹${fmtNum(Math.round(Number(n) || 0))}`;
const pad = (n) => String(n).padStart(2, "0");
export const toDateInput = (d) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "");
export const toDateTimeInput = (d) => (d ? `${toDateInput(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}` : "");
/** End date = until 11:59 PM that day in the admin's local time (unchanged rule). */
export const endOfDay = (v) => (v ? new Date(`${v}T23:59:59.999`) : null);
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** The coupon's last moment: end date + end time (admin's local time).
 * 23:59 means "to the end of that minute", like the old end-of-day rule. */
export const endAt = (f) => {
  if (!f.end) return null;
  const time = /^\d{2}:\d{2}$/.test(f.endTime || "") ? f.endTime : "23:59";
  return new Date(`${f.end}T${time}${time === "23:59" ? ":59.999" : ":00"}`);
};
export const fmtDay = (d) => fmtDate(d, { day: "numeric", month: "short", year: "numeric" });
export const fmtWhen = (d) => `${fmtDate(d, { weekday: "short", day: "numeric", month: "short" })}, ${fmtTime(d, { hour: "numeric", minute: "2-digit" })}`;

export const AUDIENCE = {
  ALL:        { label: N_("All customers"),    hint: N_("Everyone sees it in the cart; customers log in to apply it (guests can't use coupons).") },
  REGISTERED: { label: N_("Registered users"), hint: N_("Only logged-in customers see and can use it. Guests are told to log in.") },
  GUEST:      { label: N_("Guests only"),      hint: N_("Only customers ordering without logging in see and can use it.") },
};

export const describeDiscount = (c) =>
  c.discountType === "PERCENT"
    ? `${t("{pct}% off", { pct: fmtNum(c.discountValue) })}${c.maxDiscount ? ` (${t("up to ₹{amount}", { amount: fmtNum(c.maxDiscount) })})` : ""}`
    : t("₹{amount} off", { amount: fmtNum(c.discountValue) });

/** Where a coupon is in its life right now (same rule as before). */
export const stateOf = (c, now) => {
  if (!c.isActive) return { key: "paused", cls: "done", label: N_("Paused") };
  if (now < new Date(c.startsAt).getTime()) return { key: "upcoming", cls: "vio", label: N_("Upcoming") };
  if (now > new Date(c.endsAt).getTime()) return { key: "ended", cls: "stop", label: N_("Expired") };
  return { key: "live", cls: "ready", label: N_("Live") };
};

/**
 * Preview of the push text. The real one is composed by the server
 * (couponOfferService.couponPushBody) when it is sent — same format.
 */
export const pushBodyPreview = (f) => {
  const value = Number(f.discountValue) || 0;
  const what = f.discountType === "PERCENT"
    ? `${value}% off${Number(f.maxDiscount) > 0 ? ` (up to ₹${Number(f.maxDiscount)})` : ""}`
    : `₹${value} off`;
  const how = `Use code ${f.code || "…"} for ${what}${Number(f.minOrderAmount) > 0 ? ` on orders above ₹${Number(f.minOrderAmount)}` : ""}.`;
  const desc = (f.description || "").trim();
  if (!desc) return how;
  const room = 200 - how.length - 1;
  return room > 10 ? `${desc.length > room ? `${desc.slice(0, room - 1)}…` : desc} ${how}` : how.slice(0, 200);
};

/** Code ideas from the title and the discount — the admin can type any code. */
export const suggestCodes = (title, value, taken = new Set()) => {
  const words = String(title || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const v = Number(value) > 0 ? String(Math.round(Number(value))) : "";
  const out = [];
  if (words[0]) out.push(`${words[0].slice(0, 10)}${v}`);
  if (words.length > 1) out.push(`${words.map((w) => w[0]).join("").slice(0, 6)}${v}`);
  if (words[1]) out.push(`${words[0].slice(0, 6)}${words[1].slice(0, 6)}`);
  if (v) out.push(`SAVE${v}`);
  return [...new Set(out)].filter((c) => COUPON_RE.test(c) && !taken.has(c)).slice(0, 3);
};

export const EMPTY_FORM = {
  code: "", title: "", description: "", discountType: "PERCENT", discountValue: "",
  maxDiscount: "", minOrderAmount: "", audience: "ALL", notify: false,
  startMode: "now", startAt: "", end: "", endTime: "23:59", isActive: true,
};

/** Coupon document → composer form (Edit). Keeps its exact start time. */
export const formFromCoupon = (c) => ({
  code: c.code, title: c.title, description: c.description || "",
  discountType: c.discountType, discountValue: String(c.discountValue),
  maxDiscount: c.maxDiscount ? String(c.maxDiscount) : "", minOrderAmount: c.minOrderAmount ? String(c.minOrderAmount) : "",
  audience: c.audience || "ALL", notify: Boolean(c.announce),
  startMode: "custom", startAt: toDateTimeInput(new Date(c.startsAt)), end: toDateInput(new Date(c.endsAt)), endTime: hhmm(new Date(c.endsAt)),
  isActive: c.isActive,
});

/** The start instant the form describes (null if not chosen yet). */
export const startOf = (f, bestAt, now = new Date()) => {
  if (f.startMode === "now") return now;
  if (f.startMode === "best") return bestAt ? new Date(bestAt) : null;
  return f.startAt ? new Date(f.startAt) : null;
};

/** Form → the existing create/update payload (the server re-validates it all). */
export const payloadOf = (f, start) => {
  const isPercent = f.discountType === "PERCENT";
  return {
    code: f.code, title: f.title.trim(), description: f.description.trim(),
    discountType: f.discountType, discountValue: Number(f.discountValue),
    maxDiscount: isPercent && f.maxDiscount !== "" ? Number(f.maxDiscount) : null,
    minOrderAmount: f.minOrderAmount !== "" ? Number(f.minOrderAmount) : 0,
    startsAt: start.toISOString(), endsAt: endAt(f).toISOString(),
    isActive: f.isActive,
    audience: f.audience, notify: f.audience !== "GUEST" && f.notify,
  };
};

/** Field errors, same limits as the server. */
export const validate = (f, start, taken) => {
  const isPercent = f.discountType === "PERCENT";
  const v = Number(f.discountValue);
  const end = endAt(f);
  return {
    code: !f.code ? "" : !COUPON_RE.test(f.code) ? t("3–20 characters: letters, numbers, - or _")
      : taken.has(f.code) ? t("Another offer already uses this code") : "",
    value: f.discountValue === "" ? ""
      : isPercent && !(v >= 1 && v <= 100) ? t("Enter a % from 1 to 100")
      : !isPercent && !(v >= 1) ? t("Enter an amount of at least ₹1") : "",
    dates: start && end && end <= start ? t("The end date must be after the start") : "",
  };
};

/**
 * Plain-words verdict for one coupon, from the server's results
 * (stats.byCoupon) — never a guess.
 */
export const couponVerdict = (c, r, now) => {
  const st = stateOf(c, now);
  const n = r?.bills || 0;
  if (st.key === "paused") return { cls: "done", text: n ? t("Paused · used {n}×", { n: fmtNum(n) }) : t("Paused") };
  if (st.key === "upcoming") return { cls: "vio", text: t("Starts {when}", { when: fmtWhen(new Date(c.startsAt)) }) };
  const extra = r?.vsNormal?.extra;
  if (st.key === "live") return n ? { cls: "live", text: t("Running · used {n}×", { n: fmtNum(n) }) } : { cls: "wait", text: t("Running · not used yet") };
  if (!n) return { cls: "stop", text: t("Not used") };
  if (extra == null) return { cls: "done", text: t("Used {n}× · not enough earlier orders to compare", { n: fmtNum(n) }) };
  if (extra > 0) return { cls: "ready", text: t("Worked · used {n}×, more orders than normal", { n: fmtNum(n) }) };
  return { cls: "wait", text: t("Used {n}×, but no more orders than normal", { n: fmtNum(n) }) };
};

/** Verdict for a push that isn't linked to a coupon. */
export const pushVerdict = (p) => {
  if (p.status === "SCHEDULED") return { cls: "vio", text: t("Scheduled") };
  if (p.status === "FAILED") return { cls: "stop", text: t("Failed to send") };
  if (p.status === "CANCELLED") return { cls: "done", text: t("Cancelled") };
  if (!p.couponCode) return { cls: "done", text: t("Can't tell: no code") };
  if (!p.codeIsCoupon && !p.bills) return { cls: "stop", text: t("Code {code} was never a real coupon", { code: p.couponCode }) };
  return p.bills ? { cls: "live", text: t("Used {n}×", { n: fmtNum(p.bills) }) } : { cls: "stop", text: t("Not used") };
};

// ── ideas for this week ─────────────────────────────────────────────────────
/** Only ideas backed by a real signal in GET /coupons/admin/stats. */
export const buildIdeas = ({ stats, coupons, now }) => {
  if (!stats) return [];
  const ideas = [];
  const { reach, bills, slipping, minimumGaps } = stats;
  const running = coupons.filter((c) => c.isActive && new Date(c.endsAt).getTime() > now);

  for (const g of minimumGaps || []) {
    const c = coupons.find((x) => String(x._id) === String(g.couponId));
    if (!c) continue;
    const suggested = bills.median ? Math.max(0, Math.floor(bills.median / 50) * 50) : 0;
    ideas.push({
      key: `min-${g.code}`, tag: [N_("Fix an offer"), "vio"],
      title: t("{code} needs bills of ₹{min} or more", { code: g.code, min: fmtNum(g.min) }),
      why: t("Only {pct}% of your bills in the last {d} days were that big. Your typical bill is {median}.", { pct: fmtNum(g.sharePct, { maximumFractionDigits: 0 }), d: bills.days, median: money(bills.median) }),
      action: { label: N_("Lower the minimum"), kind: "edit", coupon: c, patch: { minOrderAmount: suggested ? String(suggested) : "" } },
    });
  }
  if (slipping?.count > 0) {
    ideas.push({
      key: "slip", tag: [N_("Win back"), "live"],
      title: t("{n} customers stopped coming", { n: fmtNum(slipping.count) }),
      why: t("They came 2 or more times, then not for {d}+ days. {r} of them get your notifications — a notification goes to everyone subscribed, it can't pick only them.", { d: slipping.days, r: fmtNum(slipping.reachable) }),
      action: { label: N_("Use this"), kind: "new", patch: { audience: "REGISTERED", notify: true } },
    });
  }
  if (reach.customers > 0 && reach.subscribers < reach.customers) {
    ideas.push({
      key: "reach", tag: [N_("Grow your list"), "ready"],
      title: t("Only {s} of {c} registered customers get your notifications", { s: fmtNum(reach.subscribers), c: fmtNum(reach.customers) }),
      why: t("Guests who order without logging in can't get notifications. Customers turn them on in the customer app under Profile → Offer notifications."),
      action: null,
    });
  }
  if (running.length === 0) {
    ideas.push({
      key: "none", tag: [N_("Nothing running"), "wait"],
      title: t("No offer is live or scheduled"),
      why: bills.count
        ? t("{n} paid bills in the last {d} days, typical bill {median}. An offer with a minimum near that reaches most customers.", { n: fmtNum(bills.count), d: bills.days, median: money(bills.median) })
        : t("Start one below — it shows in every customer's cart while it runs."),
      action: { label: N_("Start one"), kind: "new", patch: {} },
    });
  }
  return ideas.slice(0, 4);
};
