// src/pages/admin/menu/menuKit.js
// ─────────────────────────────────────────────────────────────────────────────
// Non-component helpers for the Menu items page (components live in
// menuUI.jsx / MenuBoard.jsx / MenuModals.jsx). Nothing here holds menu data —
// items, categories and menu times all come from the API.
// ─────────────────────────────────────────────────────────────────────────────
import { t, N_, fmtNum, LOCALE } from "../../../i18n/core.js";

export const isUrl = (s) => typeof s === "string" && /^https?:\/\//i.test(s);
export const hasSchedule = (x) => x?.schedule?.enabled === true;
export const hasPhoto = (item) => isUrl(item?.image);
export const isOutOfStock = (item) => item?.stockTracked === true && item?.stockAvailable === false;

// ── availability: On · Sold out today · Off ─────────────────────────────────
// "Sold out today" = isAvailable false + soldOutUntil in the future (the
// server switches it back on when the business day ends).
export const isSoldOut = (item, now = Date.now()) =>
  !item?.isAvailable && !!item?.soldOutUntil && new Date(item.soldOutUntil).getTime() > now;
export const availState = (item) => (item?.isAvailable ? "on" : isSoldOut(item) ? "soldout" : "off");

// ── categories an item is listed under (MNU-01, 03–07) ──────────────────────
// Mirrors restaurant-server/utils/menuCategories.js: primary `category`, extra
// `categories`, the three flag-driven built-ins, and the data-driven built-ins
// the server computed into `categoryList` (Most Ordered / Highest Rated /
// Sales-Based Choice — never guessed here).
export const ITEM_FLAGS = [
  { flag: "isTodaysSpecial", label: N_("Today's Special"), hint: N_("Featured on the customer home screen today") },
  { flag: "isChefsPick", label: N_("Chef's Pick"), hint: N_("The kitchen recommends it") },
  { flag: "isFastAvailable", label: N_("Fast Available"), hint: N_("Ready quickly — for guests in a hurry") },
];
// MNU-06 — the icon keys the server accepts (utils/menuCategories.js CATEGORY_ICONS).
export const CATEGORY_ICON_KEYS = [
  "plate", "star", "chef", "bolt", "flame", "thumbs", "trend", "tea", "coffee", "drink", "breakfast",
  "rice", "curry", "fish", "chicken", "mutton", "egg", "veg", "bread", "noodles", "roll", "tandoor",
  "soup", "salad", "snack", "dessert", "sweet", "icecream", "pizza", "burger", "thali", "combo",
];
export const isSmartCat = (c) => c?.kind === "SMART";
export const manualCats = (cats) => cats.filter((c) => !isSmartCat(c));
/** Every category name this item is listed under (primary first). */
export const memberNames = (item, cats) => {
  const out = new Set([item.category, ...(item.categories || [])]);
  for (const c of cats) {
    if (!isSmartCat(c)) continue;
    if (c.smartFlag ? item[c.smartFlag] === true : (item.categoryList || []).includes(c.name)) out.add(c.name);
  }
  out.delete(undefined); out.delete("");
  return out;
};

// ── time formatting ─────────────────────────────────────────────────────────
// "17:00" → "5:00 PM"
export const fmt12 = (hhmm) => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || "");
  if (!m) return hhmm || "";
  const h = Number(m[1]);
  return `${fmtNum(((h + 11) % 12) + 1)}:${fmtNum(Number(m[2]), { minimumIntegerDigits: 2 })} ${h < 12 ? t("AM") : t("PM")}`;
};
export const hhmmOf = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
export const fmtMinutes = (mins) => fmt12(hhmmOf(mins));

export const DAY_SHORT = [N_("Sun"), N_("Mon"), N_("Tue"), N_("Wed"), N_("Thu"), N_("Fri"), N_("Sat")];
const fmtYmd = (ymd) => {
  try {
    return new Date(`${ymd}T00:00:00`).toLocaleDateString(LOCALE(), { day: "numeric", month: "short" });
  } catch { return ymd; }
};

const isAllDay = (sc) => !sc?.startTime && !sc?.endTime;
/** "11:30 AM – 4:30 PM", "All day", "10:00 PM – 2:00 AM (overnight)". */
export const timeLabel = (sc) => (isAllDay(sc)
  ? t("All day")
  : `${fmt12(sc.startTime)} – ${fmt12(sc.endTime)}${sc.endTime < sc.startTime ? ` (${t("overnight")})` : ""}`);
/** "Every day", "Fri, Sat, Sun", "Mon–Fri". */
export const daysLabel = (sc) => {
  const d = Array.isArray(sc?.days) ? [...sc.days].sort((a, b) => a - b) : [];
  if (!d.length || d.length === 7) return t("Every day");
  const contiguous = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  return contiguous ? `${t(DAY_SHORT[d[0]])}–${t(DAY_SHORT[d[d.length - 1]])}` : d.map((x) => t(DAY_SHORT[x])).join(", ");
};
/** "3 Oct – 5 Oct", "from 3 Oct", "until 5 Oct", or "". */
export const datesLabel = (sc) => {
  const a = sc?.startDate, b = sc?.endDate;
  if (a && b) return a === b ? fmtYmd(a) : `${fmtYmd(a)} – ${fmtYmd(b)}`;
  if (a) return t("from {date}", { date: fmtYmd(a) });
  if (b) return t("until {date}", { date: fmtYmd(b) });
  return "";
};
/** One line for badges: "11:30 AM – 4:30 PM · Fri–Sun · 3 Oct – 5 Oct". */
export const schedLabel = (sc) => {
  const parts = [timeLabel(sc)];
  if (sc?.days?.length) parts.push(daysLabel(sc));
  const dl = datesLabel(sc);
  if (dl) parts.push(dl);
  return parts.join(" · ");
};
export const schedError = (start, end) => {
  if (!start || !end) return t("Choose both a start and an end time");
  if (start === end) return t("Start and end time cannot be the same");
  return null;
};

// ── schedule rule, for "Preview as a diner at…" only ────────────────────────
// Mirrors restaurant-server/utils/menuSchedule.js isScheduleActive() so the
// admin can look at another hour or day. It never decides anything: at "Now"
// the page uses the server-computed `scheduledNow` flag, and the server alone
// filters the customer menu. Start inclusive, end exclusive, end < start =
// overnight (belongs to the day it starts), days 0 = Sunday, dates inclusive.
const parseHHMM = (s) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(typeof s === "string" ? s : "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const shiftDate = (ymd, days) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const isScheduleActive = (schedule, clock) => {
  if (!schedule || schedule.enabled !== true) return true;
  const mins = clock.minutes;
  let fromYesterday = false;
  if (!isAllDay(schedule)) {
    const start = parseHHMM(schedule.startTime);
    const end = parseHHMM(schedule.endTime);
    if (start !== null && end !== null && start !== end) {
      if (start < end) { if (!(mins >= start && mins < end)) return false; }
      else if (mins < end) fromYesterday = true;
      else if (mins < start) return false;
    }
  }
  const weekday = fromYesterday ? clock.prevWeekday : clock.weekday;
  const ymd = fromYesterday ? clock.prevDate : clock.date;
  const days = Array.isArray(schedule.days) ? schedule.days : [];
  if (days.length && weekday !== undefined && !days.includes(weekday)) return false;
  if (ymd) {
    if (schedule.startDate && ymd < schedule.startDate) return false;
    if (schedule.endDate && ymd > schedule.endDate) return false;
  }
  return true;
};

/** The restaurant's wall clock (RestaurantProfile.timezone). */
export const clockInTimezone = (tz, date = new Date()) => {
  let ymd, minutes;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz || "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    ymd = `${get("year")}-${get("month")}-${get("day")}`;
    minutes = Number(get("hour")) * 60 + Number(get("minute"));
  } catch {
    ymd = date.toISOString().slice(0, 10);
    minutes = date.getHours() * 60 + date.getMinutes();
  }
  return withDate(ymd, minutes);
};
const withDate = (ymd, minutes) => {
  const weekday = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return { minutes, weekday, date: ymd, prevWeekday: (weekday + 6) % 7, prevDate: shiftDate(ymd, -1) };
};

/**
 * Preview = { minutes, day } (day 0–6, or null for today) → a clock for the
 * next such day this week. null preview → the real clock.
 */
export const previewClock = (now, preview) => {
  if (!preview) return now;
  const day = preview.day ?? now.weekday;
  return withDate(shiftDate(now.date, (day - now.weekday + 7) % 7), preview.minutes ?? now.minutes);
};

/**
 * Schedule half of the visibility rule (isAvailable is separate).
 * `clock` null → the server's own answer for right now (`item.scheduledNow`).
 */
export const scheduledAt = (item, cat, clock) => {
  if (!clock) return item.scheduledNow !== false;
  return isScheduleActive(cat?.schedule, clock) && isScheduleActive(item.schedule, clock);
};

// ── menu times ──────────────────────────────────────────────────────────────
// Color keys are stored on the server; CSS lives here (theme tokens only).
export const MT_COLORS = {
  amber: "var(--wait)", green: "var(--ready)", violet: "var(--violet)", blue: "var(--live)",
  cyan: "var(--cyan)", red: "var(--stop)", indigo: "var(--indigo)", grey: "var(--done)",
};
export const MT_COLOR_KEYS = Object.keys(MT_COLORS);
export const mtColor = (key) => MT_COLORS[key] || MT_COLORS.violet;
export const ALL_DAY = "all-day";

/**
 * Left-rail groups: every Menu time (from the API), then categories with a
 * hand-set window that isn't a menu time ("Own window", grouped by window),
 * then "All day" (categories with no window).
 */
export const buildTimeGroups = ({ menuTimes, cats, countOf, clock }) => {
  const groups = menuTimes.map((mt) => ({
    key: mt._id, mt, name: mt.name, schedule: mt.schedule, color: mtColor(mt.color), cats: [],
  }));
  const byId = new Map(groups.map((g) => [g.key, g]));
  const custom = new Map();
  const allDay = { key: ALL_DAY, name: t("All day"), schedule: null, color: MT_COLORS.grey, cats: [] };
  const swatches = ["cyan", "indigo", "blue", "red", "amber"];
  for (const c of cats) {
    const g = c.menuTime && byId.get(String(c.menuTime));
    if (g) { g.cats.push(c); continue; }
    if (!hasSchedule(c)) { allDay.cats.push(c); continue; }
    const k = `own:${c.schedule.startTime}-${c.schedule.endTime}-${(c.schedule.days || []).join("")}-${c.schedule.startDate}-${c.schedule.endDate}`;
    if (!custom.has(k)) {
      custom.set(k, {
        key: k, name: t("Own window"), schedule: c.schedule, own: true,
        color: mtColor(swatches[custom.size % swatches.length]), cats: [],
      });
    }
    custom.get(k).cats.push(c);
  }
  return [...groups, ...custom.values(), allDay]
    .filter((g) => g.mt || g.cats.length || g.key === ALL_DAY)
    .map((g) => ({
      ...g,
      items: g.cats.reduce((s, c) => s + (c.kind === "SMART" ? 0 : countOf(c)), 0),
      live: isScheduleActive(g.schedule ? { ...g.schedule, enabled: true } : null, clock),
    }));
};

/** Timeline segments for one window: [{left%, width%}] (overnight → two; all day → full). */
export const windowSegments = (schedule) => {
  if (!schedule) return [];
  if (isAllDay(schedule)) return [{ left: 0, width: 100 }];
  const s = parseHHMM(schedule.startTime), e = parseHHMM(schedule.endTime);
  if (s === null || e === null || s === e) return [];
  const pct = (m) => (m / 1440) * 100;
  return s < e
    ? [{ left: pct(s), width: pct(e - s) }]
    : [{ left: pct(s), width: pct(1440 - s) }, { left: 0, width: pct(e) }];
};

// ── "Needs a home": duplicate / test / empty categories ─────────────────────
const STOP = new Set(["dish", "dishes", "item", "items", "menu", "special", "specials", "the"]);
const singular = (w) => (w.endsWith("ies") ? `${w.slice(0, -3)}y`
  : /(ch|sh|x)es$/.test(w) ? w.slice(0, -2)
    : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
export const dupKey = (name) => String(name || "").toLowerCase()
  .replace(/[^a-z0-9ঀ-৿]+/g, " ").trim().split(" ")
  .filter((w) => w && !STOP.has(w)).map(singular).join(" ");
const TEST_RE = /^(test|testing|demo|sample|dummy|temp|tmp|asdf|xyz|abc)\b/i;

/**
 * [{ cat, kind: "duplicate", into }, { cat, kind: "test" }, { cat, kind: "empty" }]
 * A duplicate merges into the spelling with the most items.
 */
export const findCleanup = (allCats, countOf) => {
  const cats = allCats.filter((c) => c.kind !== "SMART"); // built-ins are never "cleanup"
  const out = [];
  const flagged = new Set();
  const groups = new Map();
  for (const c of cats) {
    const k = dupKey(c.name);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const target = [...list].sort((a, b) => countOf(b) - countOf(a))[0];
    for (const c of list) {
      if (c === target) continue;
      out.push({ cat: c, kind: "duplicate", into: target });
      flagged.add(c._id);
    }
  }
  for (const c of cats) {
    if (flagged.has(c._id)) continue;
    if (TEST_RE.test(c.name)) { out.push({ cat: c, kind: "test" }); flagged.add(c._id); }
    else if (countOf(c) === 0) out.push({ cat: c, kind: "empty" });
  }
  return out;
};

// ── views (status strip + chips) ────────────────────────────────────────────
// Each is a predicate over a real item; `ctx` = { catOf, clock, cleanup:Set<name> }.
export const VIEWS = {
  all:      { label: N_("All"),             test: () => true },
  onMenu:   { label: N_("On the menu now"), test: (i, c) => i.isAvailable && scheduledAt(i, c.catOf(i), c.clock) },
  byTime:   { label: N_("Hidden by time"),  test: (i, c) => i.isAvailable && !scheduledAt(i, c.catOf(i), c.clock) },
  soldOut:  { label: N_("Sold out today"),  test: (i) => isSoldOut(i) },
  off:      { label: N_("Turned off"),      test: (i) => !i.isAvailable && !isSoldOut(i) },
  noPhoto:  { label: N_("No photo"),        test: (i) => !hasPhoto(i) },
  noStock:  { label: N_("Out of stock"),    test: (i) => isOutOfStock(i) },
  ownTime:  { label: N_("Own time window"), test: (i) => hasSchedule(i) },
  cleanup:  { label: N_("Needs cleanup"),   test: (i, c) => c.cleanup.has(i.category) },
};
export const VIEW_CHIPS = ["all", "onMenu", "soldOut", "off", "noPhoto", "noStock", "ownTime"];
export const VIEW_KEYS = Object.keys(VIEWS);

// Extra filters a saved view can hold, on top of a view.
export const EMPTY_FILTERS = { type: "", tag: "", minPrice: "", maxPrice: "" };
export const hasExtraFilters = (f) => !!(f.type || f.tag || f.minPrice !== "" || f.maxPrice !== "");
export const matchesFilters = (i, f) => {
  if (f.type && i.tag !== f.type) return false;
  if (f.tag && !(i.tags || []).some((x) => x.toLowerCase() === f.tag.toLowerCase())) return false;
  if (f.minPrice !== "" && Number(i.price) < Number(f.minPrice)) return false;
  if (f.maxPrice !== "" && Number(i.price) > Number(f.maxPrice)) return false;
  return true;
};

export const matchesSearch = (item, q, catName) => {
  if (!q) return true;
  return [item.name, item.nameBn, item.description, item.category, catName, ...(item.tags || [])]
    .some((v) => typeof v === "string" && v.toLowerCase().includes(q));
};

// ── saved views (per admin, this browser) ───────────────────────────────────
const VIEWS_KEY = "adsCafe.menuSavedViews";
const DEFAULT_SAVED = [{ id: "over200", name: "Over ₹200", view: "all", filters: { ...EMPTY_FILTERS, minPrice: "200" } }];
export const loadSavedViews = () => {
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    if (raw == null) return DEFAULT_SAVED;
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => x && x.id && x.name) : DEFAULT_SAVED;
  } catch { return DEFAULT_SAVED; }
};
export const storeSavedViews = (list) => {
  try { localStorage.setItem(VIEWS_KEY, JSON.stringify(list)); } catch { /* storage off — keeps for this visit */ }
};

/** Runs `fn` over `list` a few at a time; resolves to { ok: [...], failed: n }. */
export const runChunked = async (list, fn, size = 6) => {
  const ok = [];
  let failed = 0;
  for (let i = 0; i < list.length; i += size) {
    const res = await Promise.allSettled(list.slice(i, i + size).map(fn));
    res.forEach((r) => (r.status === "fulfilled" ? ok.push(r.value) : failed++));
  }
  return { ok, failed };
};

/** Error text from an axios error. */
export const errMsg = (e, fallback) => e?.response?.data?.message || fallback;
