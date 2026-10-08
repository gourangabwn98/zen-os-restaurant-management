// utils/menuAddons.js — KH-12 add-ons ("Biryani ₹100 + 1 pc chicken ₹40")
// ─────────────────────────────────────────────────────────────────────────────
// An admin defines add-ons per menu item (MenuItem.addons [{ _id, name,
// price }]). An order line picks some of them by id; the SERVER prices it:
//   line unit price = item price + Σ chosen add-on price × add-on qty
// and snapshots them on the line (Order.items[].addons [{ addonId, name,
// price }], basePrice = item price). Because `price` already includes the
// add-ons, every existing total/bill/report (price × qty) stays correct and
// untouched. A client never sends an add-on price — only ids.
// Items without add-ons (and every old order) behave exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

export const ADDONS_MAX = 10;
export const ADDON_NAME_MAX = 60;
export const ADDON_PRICE_MAX = 100000;
export const ADDON_QTY_MAX = 10; // of ONE add-on on ONE item ("10 × chicken")

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
 * unit }. Only ids that exist on THIS menu item are accepted (400 otherwise).
 * Repeating an id means more of that add-on: ["a1","a1"] = 2 × chicken, and
 * the snapshot says so with `qty` (only written when > 1, so a single add-on
 * looks exactly as before; readers treat a missing qty as 1).
 * No ids → { addons: [], extra: 0 }.
 */
export const resolveLineAddons = (menuItem, addonIds) => {
  if (addonIds === undefined || addonIds === null || (Array.isArray(addonIds) && !addonIds.length)) return { addons: [], extra: 0 };
  if (!Array.isArray(addonIds)) throw httpError("addonIds must be a list");
  if (addonIds.length > ADDONS_MAX * ADDON_QTY_MAX) throw httpError("Too many add-ons on one line");
  const counts = new Map();
  for (const id of addonIds.map(String)) counts.set(id, (counts.get(id) || 0) + 1);
  if (counts.size > ADDONS_MAX) throw httpError("Too many add-ons on one line");
  const byId = new Map((menuItem.addons || []).map((a) => [String(a._id), a]));
  const addons = [...counts].map(([id, qty]) => {
    const a = byId.get(id);
    if (!a) throw httpError(`An add-on for "${menuItem.name}" is no longer available — please pick again`);
    if (qty > ADDON_QTY_MAX) throw httpError(`At most ${ADDON_QTY_MAX} × "${a.name}" on one item`);
    return { addonId: a._id, name: a.name, price: Number(a.price) || 0, ...(qty > 1 && { qty }) };
  });
  addons.sort((x, y) => String(x.addonId).localeCompare(String(y.addonId)));
  return { addons, extra: addons.reduce((s, a) => s + a.price * addonQty(a), 0) };
};

/** How many of one snapshotted add-on (old lines have no qty → 1). */
export const addonQty = (a) => Math.max(1, Math.floor(Number(a?.qty) || 1));

/** "1 pc Chicken" / "2 x 1 pc Chicken" — the printed / listed add-on label. */
export const addonLabel = (a) => (addonQty(a) > 1 ? `${addonQty(a)} x ${a.name}` : a.name);

/**
 * Snapshot add-ons → what a KOT / bill print job carries. The quantity is
 * folded into the name ("2 x 1 pc Chicken", price stays per piece), so the
 * on-prem print-service renders it without needing a new build.
 */
export const addonsForPrint = (addons = []) =>
  (addons || []).map((a) => ({ name: addonLabel(a), price: Number(a.price) || 0 }));

/**
 * Same item + same add-ons (with the same quantities) ⇔ same key (used to
 * merge order lines). Accepts snapshots ({ addonId, qty }) or raw ids, where
 * a repeated id counts once per repeat.
 */
export const lineAddonKey = (addonsOrIds = []) => {
  const counts = new Map();
  for (const a of addonsOrIds || []) {
    const id = String(a?.addonId ?? a?._id ?? a);
    counts.set(id, (counts.get(id) || 0) + (a && typeof a === "object" ? addonQty(a) : 1));
  }
  return [...counts].map(([id, n]) => (n > 1 ? `${id}x${n}` : id)).sort().join(",");
};
