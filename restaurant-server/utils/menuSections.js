// utils/menuSections.js
// ─────────────────────────────────────────────────────────────────────────────
// THE one place the menu's sections (MenuItem.category values) and their
// display order are defined. GET /api/menu/structure, the category list the
// customer/waiter apps show and scripts/importMenu.js all read this, so the
// order never depends on database order. Add / rename / reorder sections here.
//
// Subcategories are NOT listed here — they are whatever distinct
// `subcategory` values the items of a section carry (services/menuStructureService.js).
// ─────────────────────────────────────────────────────────────────────────────

export const MENU_SECTIONS = [
  "Breakfast",
  "Starters",
  "Bengali Lunch",
  "Main Course",
  "Noodles",
  "Rice",
  "Breads",
  "Soups & Salads",
  "Beverages",
  "Sweets",
  "Counter",
];

/** MenuItem.foodType — display only; `tag` (Veg / Non Veg / Others) stays authoritative. */
export const FOOD_TYPE_LABELS = ["Veg", "Egg", "Non-veg"];

/** MenuItem.addons[].type */
export const ADDON_TYPES = ["Extra egg", "Extra piece", "Butter"];

/** Sort rank of a section name; unknown (old / custom) categories go after the configured ones. */
export const sectionRank = (name) => {
  const i = MENU_SECTIONS.indexOf(name);
  return i === -1 ? MENU_SECTIONS.length : i;
};

/** Sorts anything with a section name (by `get`) into configured order; unknown ones keep their relative order after. */
export const sortBySection = (list, get = (x) => x) =>
  list.map((x, i) => [x, i]).sort((a, b) => (sectionRank(get(a[0])) - sectionRank(get(b[0]))) || (a[1] - b[1])).map(([x]) => x);

export const SUBCATEGORY_MAX = 40;
export const SIZE_MAX = 30;
