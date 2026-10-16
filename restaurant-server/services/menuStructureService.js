// services/menuStructureService.js
// ─────────────────────────────────────────────────────────────────────────────
// Sections → subcategories, for GET /api/menu/structure and the admin form.
//
//   sections       utils/menuSections.js MENU_SECTIONS, in that order, always
//                  listed (an empty one has count 0); a category that isn't in
//                  the config but still has items (an old / hand-made one) is
//                  listed after them, so nothing silently disappears.
//   subcategories  the distinct `subcategory` values of a section's items —
//                  never configured — ordered like the printed menu (lowest
//                  itemId first, then name). Items without one are only in "All".
//
// Visibility is the caller's: it passes the items it may see (customer: the
// same isAvailable + category-schedule rule as GET /api/menu).
// ─────────────────────────────────────────────────────────────────────────────
import { MENU_SECTIONS, SUBCATEGORY_MAX, SIZE_MAX, FOOD_TYPE_LABELS } from "../utils/menuSections.js";

const httpError = (msg, statusCode = 400) => Object.assign(new Error(msg), { statusCode });
const clean = (v) => String(v ?? "").trim().replace(/\s+/g, " ");

/**
 * Pure: items [{ category, subcategory, itemId, name }] → { sections }.
 * @returns {{ sections: { name: string, count: number, subcategories: { name: string, count: number }[] }[] }}
 */
export const buildMenuStructure = (items = [], sectionNames = MENU_SECTIONS) => {
  const byCat = new Map(sectionNames.map((n) => [n, { count: 0, subs: new Map() }]));
  for (const it of items) {
    const cat = clean(it.category);
    if (!cat) continue;
    if (!byCat.has(cat)) byCat.set(cat, { count: 0, subs: new Map() });
    const entry = byCat.get(cat);
    entry.count += 1;
    const sub = clean(it.subcategory);
    if (!sub) continue;
    const s = entry.subs.get(sub) || { count: 0, firstId: null };
    s.count += 1;
    const id = clean(it.itemId);
    if (id && (s.firstId === null || id < s.firstId)) s.firstId = id;
    entry.subs.set(sub, s);
  }
  const sections = [];
  for (const [name, { count, subs }] of byCat) {
    if (!sectionNames.includes(name) && count === 0) continue;
    const subcategories = [...subs.entries()]
      .sort(([an, a], [bn, b]) => {
        if (a.firstId && b.firstId && a.firstId !== b.firstId) return a.firstId < b.firstId ? -1 : 1;
        if (!!a.firstId !== !!b.firstId) return a.firstId ? -1 : 1;
        return an.localeCompare(bn);
      })
      .map(([n, s]) => ({ name: n, count: s.count }));
    sections.push({ name, count, subcategories });
  }
  return { sections };
};

/**
 * Admin create/update input → the new menu fields to set (only the ones
 * sent). Accepts multipart strings. Throws 400 on bad input.
 *   subcategory  ≤ 40 chars, spaces collapsed ("" clears)
 *   size         ≤ 30 chars ("" clears)
 *   foodType     Veg | Egg | Non-veg | "" (display only — `tag` stays authoritative)
 */
export const readMenuItemFields = (body = {}) => {
  const out = {};
  if (body.subcategory !== undefined) {
    const v = clean(body.subcategory);
    if (v.length > SUBCATEGORY_MAX) throw httpError(`Subcategory can be at most ${SUBCATEGORY_MAX} characters`);
    out.subcategory = v;
  }
  if (body.size !== undefined) {
    const v = clean(body.size);
    if (v.length > SIZE_MAX) throw httpError(`Size can be at most ${SIZE_MAX} characters`);
    out.size = v;
  }
  if (body.foodType !== undefined) {
    const v = clean(body.foodType);
    if (v && !FOOD_TYPE_LABELS.includes(v)) throw httpError(`Food type must be one of: ${FOOD_TYPE_LABELS.join(", ")}`);
    out.foodType = v;
  }
  return out;
};

/** GET /api/menu ?subcategory= — one name or a comma-separated list (multi-select chips). */
export const parseSubcategoryFilter = (raw) => {
  if (raw === undefined || raw === null || raw === "") return [];
  const list = (Array.isArray(raw) ? raw : String(raw).split(",")).map(clean).filter(Boolean);
  return [...new Set(list)].slice(0, 30);
};

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
