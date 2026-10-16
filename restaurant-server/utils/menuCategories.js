// utils/menuCategories.js
// ─────────────────────────────────────────────────────────────────────────────
// Pure rules for which categories a menu item appears in (MNU-01, 03–07).
// No DB access — services/smartCategoryService.js feeds it data.
//
//   manual    item.category (the section; the old extra `categories` list is gone)
//   flag      Fast Available / Khoai Signature / Today's Special — item flags
//   data      Most Ordered / Highest Rated / Sales-Based Choice — computed
//             from real orders and real customer food ratings; empty when
//             there is no data yet (never invented)
//
// An item is ONE document wherever it is listed: price, stock and
// availability can't drift between its categories.
// ─────────────────────────────────────────────────────────────────────────────

export const CATEGORY_KINDS = ["MANUAL", "SMART"];

/** Built-in smart categories. `name` is fixed (customers see it); admins can
 * set the Bengali name, image/icon and their position (sortOrder). */
export const SMART_CATEGORIES = [
  { key: "TODAYS_SPECIAL", name: "Today's Special",    nameBn: "আজকের স্পেশাল",     icon: "star",   source: "flag", flag: "isTodaysSpecial" },
  // Shown as "Khoai Signature" (was "Chef's Picks"); key + flag unchanged so old data still matches.
  { key: "CHEFS_PICKS",    name: "Khoai Signature",    nameBn: "খোয়াই সিগনেচার",    icon: "chef",   source: "flag", flag: "isChefsPick" },
  { key: "FAST_AVAILABLE", name: "Fast Available",     nameBn: "দ্রুত পাওয়া যায়",    icon: "bolt",   source: "flag", flag: "isFastAvailable" },
  { key: "MOST_ORDERED",   name: "Most Ordered",       nameBn: "সবচেয়ে বেশি অর্ডার", icon: "flame",  source: "data" },
  { key: "HIGHEST_RATED",  name: "Highest Rated",      nameBn: "সেরা রেটিং",        icon: "thumbs", source: "data" },
  { key: "SALES_CHOICE",   name: "Sales-Based Choice", nameBn: "বিক্রির সেরা",       icon: "trend",  source: "data" },
];
export const SMART_KEYS = SMART_CATEGORIES.map((c) => c.key);
// Item switches an admin can set: the smart-category flags, plus Most Popular (a badge only).
export const ITEM_FLAGS = [...SMART_CATEGORIES.filter((c) => c.source === "flag").map((c) => c.flag), "isMostPopular"];
export const smartByKey = (key) => SMART_CATEGORIES.find((c) => c.key === key) || null;

// Data-driven thresholds — stated, not hidden (see the report's MNU-07 notes).
export const SMART_DATA_RULES = {
  windowDays: 30,       // Most Ordered / Sales-Based Choice look at the last 30 days of revenue orders
  ratingWindowDays: 90, // Highest Rated looks at 90 days of FOOD ratings
  minRatings: 3,        // an item needs at least 3 rated orders …
  minAverage: 4,        // … averaging 4★ or more
  limit: 10,            // at most 10 items per data category
};

// MNU-06 — the shared category icon set (keys only; each app draws them).
export const CATEGORY_ICONS = [
  "plate", "star", "chef", "bolt", "flame", "thumbs", "trend", "tea", "coffee", "drink", "breakfast",
  "rice", "curry", "fish", "chicken", "mutton", "egg", "veg", "bread", "noodles", "roll", "tandoor",
  "soup", "salad", "snack", "dessert", "sweet", "icecream", "pizza", "burger", "thali", "combo",
];

const FALLBACK_ICON_WORDS = [
  [/tea|chai|cha\b/i, "tea"], [/coffee/i, "coffee"], [/juice|drink|shake|lassi|beverage|mocktail|soda/i, "drink"],
  [/breakfast/i, "breakfast"], [/rice|biryani|pulao|fried rice/i, "rice"], [/fish|prawn|machh|mach|seafood/i, "fish"], [/chicken|murgi/i, "chicken"], [/mutton|lamb|goat|khasi/i, "mutton"],
  [/egg|dim/i, "egg"], [/veg|paneer|sabji|sabzi/i, "veg"], [/curry|dal|gravy|kosha/i, "curry"], [/roti|naan|paratha|bread|luchi|kulcha/i, "bread"],
  [/noodle|chowmein|pasta|chinese/i, "noodles"], [/roll|wrap|kathi/i, "roll"], [/tandoor|kebab|tikka|grill/i, "tandoor"],
  [/soup/i, "soup"], [/salad/i, "salad"], [/snack|starter|pakora|fries|chop|cutlet|momo/i, "snack"],
  [/dessert|sweet|mishti|rasgulla|sandesh/i, "sweet"], [/ice ?cream|kulfi/i, "icecream"], [/pizza/i, "pizza"],
  [/burger|sandwich/i, "burger"], [/thali|meal/i, "thali"], [/combo/i, "combo"],
];

/** MNU-06: the icon to draw for a category — its own pick, the smart
 * default, a name-based guess, else a plain plate. Never an emoji. */
export const categoryIcon = (cat) => {
  if (cat?.icon && CATEGORY_ICONS.includes(cat.icon)) return cat.icon;
  const smart = cat?.smartKey && smartByKey(cat.smartKey);
  if (smart) return smart.icon;
  const name = String(cat?.name || cat?.category || "");
  return FALLBACK_ICON_WORDS.find(([rx]) => rx.test(name))?.[1] || "plate";
};

/**
 * Every category name an item is listed under, primary first, no repeats.
 * @param item       a MenuItem (lean)
 * @param smartCats  [{ name, smartKey }] — the smart Category docs that exist
 * @param dataSets   Map<smartKey, Set<itemId>> for the data-driven ones
 * @param hidden     Set<name> of categories scheduled out right now
 */
export const itemCategoryList = (item, { smartCats = [], dataSets = new Map(), hidden = new Set() } = {}) => {
  const out = [];
  const add = (name) => { if (name && !hidden.has(name) && !out.includes(name)) out.push(name); };
  add(item.category);
  const id = String(item._id);
  for (const cat of smartCats) {
    const def = smartByKey(cat.smartKey);
    if (!def) continue;
    const member = def.source === "flag" ? item[def.flag] === true : dataSets.get(def.key)?.has(id);
    if (member) add(cat.name);
  }
  return out;
};

/**
 * KH-05 — the item's own category
 * whose admin switch `notShareable` is on, or "" when none is. Smart
 * categories never count. Apps show "<name> not shareable" in red.
 * @param flaggedNames Set<string> of category names with notShareable: true
 */
export const notShareableCategoryOf = (item, flaggedNames) => {
  if (!flaggedNames?.size) return "";
  return item.category && flaggedNames.has(item.category) ? item.category : "";
};

/** "true"/"false"/boolean → boolean, undefined when absent (multipart forms). */
export const parseFlag = (v) => (v === undefined || v === null || v === "" ? undefined : v === true || v === "true" || v === "1" || v === 1);

/** Pure: top-N ids from aggregate rows [{ _id, value }] (value > 0). */
export const topIds = (rows, limit = SMART_DATA_RULES.limit) =>
  new Set(rows.filter((r) => r._id && Number(r.value) > 0).sort((a, b) => b.value - a.value).slice(0, limit).map((r) => String(r._id)));

/** Pure: per-item average food rating → ids meeting the threshold, best first. */
export const highestRatedIds = (rows, { minRatings = SMART_DATA_RULES.minRatings, minAverage = SMART_DATA_RULES.minAverage, limit = SMART_DATA_RULES.limit } = {}) =>
  new Set(rows
    .filter((r) => r._id && r.n >= minRatings && r.avg >= minAverage)
    .sort((a, b) => b.avg - a.avg || b.n - a.n)
    .slice(0, limit)
    .map((r) => String(r._id)));
