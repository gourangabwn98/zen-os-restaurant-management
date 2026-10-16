import { addonIdsOf, addonQty, countIds, lineKey, ADDON_QTY_MAX } from "./addons.js";

const menuId = (line) => String(line.menuItemId ?? line.menuItem?._id ?? line.menuItem);

// A row's identity must survive changing its extras, and must include rows
// that happen to have the same menu item but different kitchen instructions.
export const editLinesOf = (items = []) => items.map((line, index) => ({
  ...line, key: `edit-${index}`, menuItemId: menuId(line),
  notes: line.notes || "", addonIds: addonIdsOf(line),
  addons: (line.addons || []).map((a) => ({ ...a })),
  basePrice: line.basePrice ?? (line.price - (line.addons || []).reduce((s, a) => s + a.price * addonQty(a), 0)),
}));

export const stepAddonIds = (ids, id, delta) => {
  id = String(id);
  if (delta > 0) return (countIds(ids).get(id) || 0) >= ADDON_QTY_MAX ? ids : [...ids, id];
  const index = ids.lastIndexOf(id);
  return index < 0 ? ids : [...ids.slice(0, index), ...ids.slice(index + 1)];
};

export const replaceLineAddons = (lines, key, ids, menu = null) => lines.map((line) => {
  if (line.key !== key) return line;
  const choices = menu ? menu.addons || [] : line.addons;
  const byId = new Map(choices.map((a) => [String(a.addonId ?? a._id), a]));
  const addons = [...countIds(ids)].map(([addonId, qty]) => ({ ...byId.get(addonId), addonId, qty }));
  const basePrice = menu ? Number(menu.price) : line.basePrice;
  return { ...line, addonIds: [...ids], addons, basePrice,
    price: basePrice + addons.reduce((s, a) => s + Number(a.price) * a.qty, 0) };
});

export const stepLineAddon = (lines, key, id, delta) => {
  const line = lines.find((l) => l.key === key);
  return line ? replaceLineAddons(lines, key, stepAddonIds(line.addonIds, id, delta)) : lines;
};

export const stepLineQty = (lines, key, delta) => lines.map((line) => line.key === key
  ? { ...line, qty: Math.max(1, Math.min(99, line.qty + delta)) } : line);

export const orderItemsPayload = (lines) => lines.map((line) => ({
  menuItemId: menuId(line), qty: line.qty, notes: line.notes || "", addonIds: addonIdsOf(line),
}));

// Preserve every existing row. Only an identical unnoted variant may absorb
// a new unnoted item; a Map keyed just by menu/add-ons would lose noted rows.
export const mergeOrderAdditions = (existing, additions) => {
  const result = orderItemsPayload(existing);
  for (const item of orderItemsPayload(additions)) {
    const match = result.find((line) => line.notes === item.notes
      && lineKey(line.menuItemId, line.addonIds) === lineKey(item.menuItemId, item.addonIds));
    if (match) match.qty += item.qty;
    else result.push(item);
  }
  return result;
};

export const draftSubtotal = (lines, acCharge = 0) => lines.reduce((s, line) => s + line.price * line.qty, 0) + (Number(acCharge) || 0);
