// src/pages/admin/shared/addons.js — KH-12 add-on helpers for the admin order screens.
// Mirrors restaurant-server/utils/menuAddons.js: a cart / order line is item +
// chosen add-ons ("Biryani" and "Biryani + 1 pc Chicken" are two lines). Prices
// here are a preview only — the server re-prices every line itself.

export const hasAddons = (item) => Array.isArray(item?.addons) && item.addons.length > 0;
export const addonIdsOf = (line) => (line?.addonIds || (line?.addons || []).map((a) => String(a.addonId ?? a._id))).map(String);
export const cartLineKey = (menuItemId, addonIds = []) => `${menuItemId}|${[...addonIds].map(String).sort().join(",")}`;
export const unitPrice = (item, addonIds = []) => {
  const byId = new Map((item?.addons || []).map((a) => [String(a._id), Number(a.price) || 0]));
  return (Number(item?.price) || 0) + addonIds.reduce((s, id) => s + (byId.get(String(id)) || 0), 0);
};
export const addonNames = (item, line) => {
  if (Array.isArray(line?.addons) && line.addons.length && line.addons[0]?.name) return line.addons.map((a) => a.name);
  const byId = new Map((item?.addons || []).map((a) => [String(a._id), a.name]));
  return (line?.addonIds || []).map((id) => byId.get(String(id))).filter(Boolean);
};
