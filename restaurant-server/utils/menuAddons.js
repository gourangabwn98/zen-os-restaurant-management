// utils/menuAddons.js — KH-12 add-ons ("Biryani ₹100 + 1 pc chicken ₹40")
// ─────────────────────────────────────────────────────────────────────────────
// An admin defines add-ons per menu item (MenuItem.addons [{ _id, name,
// price }]). An order line picks some of them by id; the SERVER prices it:
//   line unit price = item price + Σ chosen add-on prices
// and snapshots them on the line (Order.items[].addons [{ addonId, name,
// price }], basePrice = item price). Because `price` already includes the
// add-ons, every existing total/bill/report (price × qty) stays correct and
// untouched. A client never sends an add-on price — only ids.
// Items without add-ons (and every old order) behave exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

export const ADDONS_MAX = 10;
export const ADDON_NAME_MAX = 60;
export const ADDON_PRICE_MAX = 100000;

const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

/**
 * Admin input → the add-on list to store. Accepts an array or a JSON string
 * (multipart forms). An entry that names an existing add-on's _id keeps that
 * id, so editing a price never breaks a cart that already picked it.
 * Throws 400 on bad input. undefined → undefined (leave unchanged).
 */
export const normalizeAddons = (raw, existing = []) => {
  if (raw === undefined) return undefined;
  let list = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return [];
    try { list = JSON.parse(raw); } catch { throw httpError("Add-ons must be a list"); }
  }
  if (!Array.isArray(list)) throw httpError("Add-ons must be a list");
  if (list.length > ADDONS_MAX) throw httpError(`At most ${ADDONS_MAX} add-ons per item`);
  const known = new Set((existing || []).map((a) => String(a._id)));
  const seen = new Set();
  return list.map((a) => {
    const name = String(a?.name ?? "").replace(/\s+/g, " ").trim();
    if (!name) throw httpError("Every add-on needs a name");
    if (name.length > ADDON_NAME_MAX) throw httpError(`Add-on names can be at most ${ADDON_NAME_MAX} characters`);
    const key = name.toLowerCase();
    if (seen.has(key)) throw httpError(`Add-on "${name}" is listed twice`);
    seen.add(key);
    const price = Number(a?.price);
    if (!Number.isFinite(price) || price < 0 || price > ADDON_PRICE_MAX) throw httpError(`Price for "${name}" must be between 0 and ${ADDON_PRICE_MAX}`);
    const out = { name, price: Math.round(price * 100) / 100 };
    if (a?._id && known.has(String(a._id))) out._id = a._id;
    return out;
  });
};

/**
 * The add-ons an order line picked (ids) → { addons snapshot, extra ₹ per
 * unit }. Only ids that exist on THIS menu item are accepted (400 otherwise);
 * duplicates collapse. No ids → { addons: [], extra: 0 }.
 */
export const resolveLineAddons = (menuItem, addonIds) => {
  if (addonIds === undefined || addonIds === null || (Array.isArray(addonIds) && !addonIds.length)) return { addons: [], extra: 0 };
  if (!Array.isArray(addonIds)) throw httpError("addonIds must be a list");
  const ids = [...new Set(addonIds.map(String))];
  if (ids.length > ADDONS_MAX) throw httpError("Too many add-ons on one line");
  const byId = new Map((menuItem.addons || []).map((a) => [String(a._id), a]));
  const addons = ids.map((id) => {
    const a = byId.get(id);
    if (!a) throw httpError(`An add-on for "${menuItem.name}" is no longer available — please pick again`);
    return { addonId: a._id, name: a.name, price: Number(a.price) || 0 };
  });
  addons.sort((x, y) => String(x.addonId).localeCompare(String(y.addonId)));
  return { addons, extra: addons.reduce((s, a) => s + a.price, 0) };
};

/** Same item + same add-ons ⇔ same key (used to merge order lines). */
export const lineAddonKey = (addonsOrIds = []) =>
  (addonsOrIds || []).map((a) => String(a?.addonId ?? a?._id ?? a)).sort().join(",");
