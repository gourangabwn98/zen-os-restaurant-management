// src/pages/admin/shared/addons.js — KH-12 add-on helpers for the admin order screens.
// Mirrors restaurant-server/utils/menuAddons.js: a cart / order line is item +
// chosen add-ons ("Biryani" and "Biryani + 1 pc Chicken" are two lines). Prices
// here are a preview only — the server re-prices every line itself.

export const hasAddons = (item) => Array.isArray(item?.addons) && item.addons.length > 0;
export const addonIdsOf = (line) => (line?.addonIds
  || (line?.addons || []).flatMap((a) => Array(addonQty(a)).fill(String(a.addonId ?? a._id)))).map(String);
export const cartLineKey = (menuItemId, addonIds = []) => `${menuItemId}|${[...addonIds].map(String).sort().join(",")}`;
export const ADDON_QTY_MAX = 10; // per add-on per item — same cap as the server
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
