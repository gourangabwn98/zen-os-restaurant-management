// src/pages/admin/shared/addons.js — KH-12 add-on helpers for the admin order screens.
// Mirrors restaurant-server/utils/menuAddons.js: a cart / order line is item +
// chosen add-ons ("Biryani" and "Biryani + 1 pc Chicken" are two lines). Prices
// here are a preview only — the server re-prices every line itself.

export const hasAddons = (item) => Array.isArray(item?.addons) && item.addons.some((a) => a.isAvailable !== false);
export const addonIdsOf = (line) => (line?.addonIds
  || (line?.addons || []).flatMap((a) => Array(addonQty(a)).fill(String(a.addonId ?? a._id)))).map(String);
export const cartLineKey = (menuItemId, addonIds = [], notes = "") => `${menuItemId}|${[...addonIds].map(String).sort().join(",")}${notes ? `|${JSON.stringify(notes)}` : ""}`;
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

// Functional state updates must count the current state, not a render's
// captured counts (rapid taps can otherwise lose steps or exceed the cap).
export const stepAddonIds = (ids, addonId, delta) => {
  const id = String(addonId);
  const current = ids.map(String);
  if (delta > 0) return (countIds(current).get(id) || 0) >= ADDON_QTY_MAX ? current : [...current, id];
  const index = current.lastIndexOf(id);
  return index < 0 ? current : [...current.slice(0, index), ...current.slice(index + 1)];
};

// Quantity is per parent item, matching server price × parent qty. Merge
// identical variants after an edit, but never discard different kitchen notes.
export const stepLineAddon = (lines, key, addonId, delta) => {
  const changed = lines.map((line) => {
    if (line.key !== key) return line;
    const addonIds = stepAddonIds(addonIdsOf(line), addonId, delta);
    const itemId = line.item?._id ?? line.menuItemId;
    const counts = countIds(addonIds);
    const addons = (line.addons || []).filter((a) => counts.has(String(a.addonId ?? a._id)))
      .map((a) => ({ ...a, qty: counts.get(String(a.addonId ?? a._id)) }));
    const basePrice = line.basePrice ?? (line.price - (line.addons || []).reduce((sum, a) => sum + Number(a.price) * addonQty(a), 0));
    return { ...line, key: cartLineKey(itemId, addonIds, line.notes), addonIds, addons,
      ...(!line.item && { basePrice, price: basePrice + addons.reduce((sum, a) => sum + Number(a.price) * addonQty(a), 0) }) };
  });
  return changed.reduce((out, line) => {
    const same = out.findIndex((v) => v.key === line.key && (v.notes || "") === (line.notes || ""));
    if (same < 0) out.push(line);
    else out[same] = { ...out[same], qty: out[same].qty + line.qty };
    return out;
  }, []);
};

export const replaceLineAddons = (lines, key, ids, item) => {
  const counts = countIds(ids);
  const addons = (item.addons || []).filter((a) => counts.has(String(a._id)))
    .map((a) => ({ addonId: String(a._id), name: a.name, price: Number(a.price), qty: counts.get(String(a._id)) }));
  const updated = lines.map((line) => line.key !== key ? line : {
    ...line, key: cartLineKey(item._id, ids, line.notes), addonIds: ids.map(String), addons,
    ...(line.item ? { item } : { basePrice: Number(item.price), price: unitPrice(item, ids) }),
  });
  return updated.reduce((out, line) => {
    const same = out.findIndex((v) => v.key === line.key && (v.notes || "") === (line.notes || ""));
    if (same < 0) out.push(line);
    else out[same] = { ...out[same], qty: out[same].qty + line.qty };
    return out;
  }, []);
};

/** Labels of the chosen add-ons (cart line: from the menu item; order line: snapshot). */
export const addonNames = (item, line) => {
  if (Array.isArray(line?.addons) && line.addons.length && line.addons[0]?.name) return line.addons.map(addonLabel);
  const byId = new Map((item?.addons || []).map((a) => [String(a._id), a.name]));
  return [...countIds(line?.addonIds || [])].filter(([id]) => byId.has(id)).map(([id, qty]) => addonLabel({ name: byId.get(id), qty }));
};
