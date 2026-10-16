// Display-only menu helpers. Prices shown here are a preview — the server
// re-prices every line (item + add-on) from the database when ordering.

/** "Boiled Egg (2 pcs)" — the name with its portion, unless the name already
 * says it ("Chicken Kosha (3 pcs)" + "3 pcs"). Mirrors the server's nameWithSize. */
export const nameWithSize = (name, size) => {
  const n = String(name || "").trim();
  const sz = String(size || "").trim();
  if (!sz || n.toLowerCase().includes(sz.toLowerCase())) return n;
  return `${n} (${sz})`;
};

/** Active menu add-ons; availability is also checked by the server. */
export const itemAddons = (item) => (Array.isArray(item?.addons) ? item.addons.filter((a) => a?._id && a?.name && a.isAvailable !== false) : []);

export const ADDON_QTY_MAX = 10;
export const addonQty = (a) => Math.max(1, Math.floor(Number(a?.qty) || 1));
export const addonLabel = (a) => addonQty(a) > 1 ? `${addonQty(a)} × ${a.name}` : a.name;
export const countAddonIds = (ids = []) => {
  const counts = new Map();
  for (const id of ids) counts.set(String(id), (counts.get(String(id)) || 0) + 1);
  return counts;
};
export const stepAddonIds = (ids, id, delta) => {
  id = String(id);
  if (delta > 0) return (countAddonIds(ids).get(id) || 0) >= ADDON_QTY_MAX ? ids : [...ids, id];
  const index = ids.lastIndexOf(id);
  return index < 0 ? ids : [...ids.slice(0, index), ...ids.slice(index + 1)];
};

/** Snapshot of the picked add-ons for display: [{ addonId, name, price }]. */
export const pickAddons = (item, addonIds = []) => {
  const byId = new Map(itemAddons(item).map((a) => [String(a._id), a]));
  return [...countAddonIds(addonIds)].filter(([id]) => byId.has(id))
    .map(([id, qty]) => ({ addonId: id, name: byId.get(id).name, price: Number(byId.get(id).price) || 0, qty }));
};

/** Consolidate old carts that stored one snapshot per repeated id. */
export const cartLineAddons = (line) => {
  const choices = new Map((line.addons || []).map((a) => [String(a.addonId), a]));
  const ids = line.addonIds || (line.addons || []).flatMap((a) => Array(addonQty(a)).fill(String(a.addonId)));
  return [...countAddonIds(ids)].filter(([id]) => choices.has(id))
    .map(([addonId, qty]) => ({ ...choices.get(addonId), addonId, qty }));
};

/** Change one extra without changing the parent quantity or row identity.
 * Existing snapshots also support extras no longer in the live menu; the
 * backend remains responsible for rejecting unavailable selections on save. */
export const stepLineAddon = (line, id, delta) => {
  const ids = line.addonIds || (line.addons || []).flatMap((a) => Array(addonQty(a)).fill(String(a.addonId)));
  if (!ids.includes(String(id))) return line;
  const basePrice = lineUnitPrice(line) - (line.addons || []).reduce((s, a) => s + Number(a.price) * addonQty(a), 0);
  const nextIds = stepAddonIds(ids, id, delta);
  const byId = new Map((line.addons || []).map((a) => [String(a.addonId), a]));
  const addons = [...countAddonIds(nextIds)].map(([addonId, qty]) => ({ ...byId.get(addonId), addonId, qty }));
  return { ...line, addonIds: nextIds, addons,
    unitPrice: basePrice + addons.reduce((s, a) => s + Number(a.price) * a.qty, 0) };
};

/** One cart line per item + add-on combination. */
export const lineKey = (itemId, addonIds = []) => `${itemId}|${[...(addonIds || [])].map(String).sort().join(",")}`;
export const keyOf = (line) => line.key || lineKey(line.item?._id, line.addonIds);

/** ₹ per unit shown for a cart line (item + add-ons). */
export const lineUnitPrice = (line) => line.unitPrice ?? (Number(line.item?.price) || 0);

export const SIGNATURE_LABEL = "Khoai Signature";

/** Items tagged "Not sharable" keep that label (diner tags are display-only). */
export const isNotSharable = (item) => (item?.tags || []).some((t) => /^not\s+shar(e)?able$/i.test(String(t).trim()));
