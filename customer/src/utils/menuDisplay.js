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

/** The item's add-ons (an item has at most one today). */
export const itemAddons = (item) => (Array.isArray(item?.addons) ? item.addons.filter((a) => a?._id && a?.name) : []);

/** Snapshot of the picked add-ons for display: [{ addonId, name, price }]. */
export const pickAddons = (item, addonIds = []) => {
  const byId = new Map(itemAddons(item).map((a) => [String(a._id), a]));
  return addonIds.map((id) => byId.get(String(id))).filter(Boolean)
    .map((a) => ({ addonId: String(a._id), name: a.name, price: Number(a.price) || 0 }));
};

/** One cart line per item + add-on combination. */
export const lineKey = (itemId, addonIds = []) => `${itemId}|${[...(addonIds || [])].map(String).sort().join(",")}`;
export const keyOf = (line) => line.key || lineKey(line.item?._id, line.addonIds);

/** ₹ per unit shown for a cart line (item + add-ons). */
export const lineUnitPrice = (line) => line.unitPrice ?? (Number(line.item?.price) || 0);

export const SIGNATURE_LABEL = "Khoai Signature";

/** Items tagged "Not sharable" keep that label (diner tags are display-only). */
export const isNotSharable = (item) => (item?.tags || []).some((t) => /^not\s+shar(e)?able$/i.test(String(t).trim()));
