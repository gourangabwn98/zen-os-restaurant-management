// KH-12 — add-on helpers (mirrors restaurant-server/utils/menuAddons.js).
// A cart / order line is identified by item + chosen add-ons: "Biryani" and
// "Biryani + 1 pc Chicken" are two different lines. Prices shown here are
// only a preview — the server always re-prices (item price + add-on prices).

export const hasAddons = (item) => Array.isArray(item?.addons) && item.addons.length > 0;

/** Add-on ids of a cart line or an order line (order lines store addonId). */
export const addonIdsOf = (line) => (line?.addonIds || (line?.addons || []).map((a) => String(a.addonId ?? a._id))).map(String);

/** Stable key: menu item + sorted add-on ids. */
export const lineKey = (menuItemId, addonIds = []) => `${menuItemId}|${[...addonIds].map(String).sort().join(",")}`;

/** Preview unit price for a cart line: item price + chosen add-ons. */
export const unitPrice = (item, addonIds = []) => {
  const byId = new Map((item?.addons || []).map((a) => [String(a._id), Number(a.price) || 0]));
  return (Number(item?.price) || 0) + addonIds.reduce((s, id) => s + (byId.get(String(id)) || 0), 0);
};

/** Names of the chosen add-ons (cart line: from the menu item; order line: snapshot). */
export const addonNames = (item, line) => {
  if (Array.isArray(line?.addons) && line.addons.length && line.addons[0]?.name) return line.addons.map((a) => a.name);
  const byId = new Map((item?.addons || []).map((a) => [String(a._id), a.name]));
  return (line?.addonIds || []).map((id) => byId.get(String(id))).filter(Boolean);
};
