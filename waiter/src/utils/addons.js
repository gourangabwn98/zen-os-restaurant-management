// KH-12 — add-on helpers (mirrors restaurant-server/utils/menuAddons.js).
// A cart / order line is identified by item + chosen add-ons: "Biryani" and
// "Biryani + 1 pc Chicken" are two different lines. Prices shown here are
// only a preview — the server always re-prices (item price + add-on prices).

export const hasAddons = (item) => Array.isArray(item?.addons) && item.addons.length > 0;

/** Add-on ids of a cart line or an order line (order lines store addonId + qty).
 *  A repeated id means more of that add-on: ["a1","a1"] = 2 × chicken. */
export const addonIdsOf = (line) => (line?.addonIds
  || (line?.addons || []).flatMap((a) => Array(addonQty(a)).fill(String(a.addonId ?? a._id)))).map(String);

/** Stable key: menu item + sorted add-on ids. */
export const lineKey = (menuItemId, addonIds = []) => `${menuItemId}|${[...addonIds].map(String).sort().join(",")}`;

export const ADDON_QTY_MAX = 10; // per add-on per item — same cap as the server

/** Preview unit price for a cart line: item price + chosen add-ons (each repeat counts). */
export const unitPrice = (item, addonIds = []) => {
  const byId = new Map((item?.addons || []).map((a) => [String(a._id), Number(a.price) || 0]));
  return (Number(item?.price) || 0) + addonIds.reduce((s, id) => s + (byId.get(String(id)) || 0), 0);
};

/** How many of one add-on (order-line snapshot; missing qty = 1). */
export const addonQty = (a) => Math.max(1, Math.floor(Number(a?.qty) || 1));

/** Add-on → "1 pc Chicken" / "2 × 1 pc Chicken". */
export const addonLabel = (a) => (addonQty(a) > 1 ? `${addonQty(a)} × ${a.name}` : a.name);

/** id → how many times it was picked: ["a1","a1","a2"] → Map{a1:2, a2:1}. */
export const countIds = (ids = []) => {
  const m = new Map();
  for (const id of ids) m.set(String(id), (m.get(String(id)) || 0) + 1);
  return m;
};

/** Labels of the chosen add-ons (cart line: from the menu item; order line: snapshot). */
export const addonNames = (item, line) => {
  if (Array.isArray(line?.addons) && line.addons.length && line.addons[0]?.name) return line.addons.map(addonLabel);
  const byId = new Map((item?.addons || []).map((a) => [String(a._id), a.name]));
  return [...countIds(line?.addonIds || [])].filter(([id]) => byId.has(id)).map(([id, qty]) => addonLabel({ name: byId.get(id), qty }));
};

/** "Boiled Egg (2 pcs)" — name + portion (MenuItem.size, or an order line's
 * size snapshot), unless the name already says it. Mirrors the server. */
export const nameWithSize = (name, size) => {
  const n = String(name || "").trim();
  const sz = String(size || "").trim();
  if (!sz || n.toLowerCase().includes(sz.toLowerCase())) return n;
  return `${n} (${sz})`;
};

/** Subcategory chips for the items of one category: [{ name, count }] in menu
 * order (lowest itemId first, then name). Items without one are only in "All". */
export const subcategoryChips = (items) => {
  const m = new Map();
  for (const it of items || []) {
    const name = String(it.subcategory || "").trim();
    if (!name) continue;
    const id = String(it.itemId || "zzzz");
    const e = m.get(name) || { name, count: 0, first: id };
    e.count += 1;
    if (id < e.first) e.first = id;
    m.set(name, e);
  }
  return [...m.values()].sort((a, b) => a.first.localeCompare(b.first) || a.name.localeCompare(b.name)).map(({ name, count }) => ({ name, count }));
};
