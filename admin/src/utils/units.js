// src/utils/units.js
// ─────────────────────────────────────────────────────────────────────────────
// Live-preview mirror of restaurant-server/utils/units.js + utils/recipeCost.js
// (keep the unit table in sync). The server re-derives every quantity and
// cost on save and at sale time — this only powers the instant previews in
// the recipe editor and friendlier quantity display.
// ─────────────────────────────────────────────────────────────────────────────

const UNIT_DEFS = {
  g:      { dim: "mass",   factor: 1 },
  kg:     { dim: "mass",   factor: 1000 },
  ml:     { dim: "volume", factor: 1 },
  l:      { dim: "volume", factor: 1000 },
  pcs:    { dim: "count",  factor: 1 },
  dozen:  { dim: "count",  factor: 12 },
  packet: { dim: "packet", factor: 1 },
  box:    { dim: "box",    factor: 1 },
};

export const UNITS = Object.keys(UNIT_DEFS);

const info = (unit) => {
  const key = String(unit ?? "").trim().toLowerCase();
  return UNIT_DEFS[key] ? { key, ...UNIT_DEFS[key] } : { key, dim: `other:${key}`, factor: 1 };
};

/** Units `unit` converts to (incl. itself); stock in "l" → ["ml", "l"]. */
export const compatibleUnits = (unit) => {
  const { dim, key } = info(unit);
  const list = UNITS.filter((u) => UNIT_DEFS[u].dim === dim);
  return list.length ? list : [key];
};

/** How many `to` in one `from` (ml → l = 0.001), or null if they can't convert. */
export const conversionFactor = (from, to) => {
  const f = info(from), t = info(to);
  return f.dim === t.dim ? f.factor / t.factor : null;
};

/** Smaller unit for a stock recipe line by default (stocked in l → ml). */
export const preferredRecipeUnit = (stockUnit) => ({ l: "ml", kg: "g", dozen: "pcs" }[stockUnit] || stockUnit);

const round4 = (n) => Math.round((n + Number.EPSILON) * 1e4) / 1e4;

/**
 * Same rules as the server's computeIngredientCost.
 * line: { sourceType, quantity, unit, cost }, stockItem: { name, unit, costPrice }
 * → { unitCost, cost, error }  (error set ⇒ no cost, never a silent ₹0)
 */
export const ingredientCost = (line, stockItem) => {
  const qty = Number(line.quantity);
  if (line.sourceType === "CUSTOM") {
    if (line.cost === "" || line.cost == null) return { unitCost: null, cost: null, error: "Enter a price" };
    const cost = Number(line.cost);
    if (!Number.isFinite(cost) || cost < 0) return { unitCost: null, cost: null, error: "Price can't be negative" };
    return { unitCost: qty > 0 ? round4(cost / qty) : null, cost: round4(cost), error: null };
  }
  if (!stockItem) return { unitCost: null, cost: null, error: null };
  const factor = conversionFactor(line.unit, stockItem.unit);
  if (factor == null) return { unitCost: null, cost: null, error: `${stockItem.name} is stocked in ${stockItem.unit} — ${line.unit} can't convert` };
  const price = Number(stockItem.costPrice);
  if (!(price > 0)) return { unitCost: null, cost: null, error: `No cost price set for ${stockItem.name}` };
  const unitCost = price * factor;
  return { unitCost, cost: Number.isFinite(qty) && qty > 0 ? round4(unitCost * qty) : null, error: null };
};

const trim = (n, dp) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: dp });

/** "0.2 l" → "200 ml", "1.5 kg" stays; small fractions read in the smaller unit. */
export const formatQty = (qty, unit) => {
  const n = Number(qty || 0);
  const smaller = { l: "ml", kg: "g" }[unit];
  if (smaller && Math.abs(n) > 0 && Math.abs(n) < 1) return `${trim(n * 1000, 1)} ${smaller}`;
  return `${trim(n, 3)} ${unit || ""}`.trim();
};

/** ₹ per unit with enough precision to be meaningful (₹0.06/ml, ₹0.4/g). */
export const formatUnitCost = (n) => {
  if (n == null) return "—";
  const dp = n >= 1 ? 2 : n >= 0.01 ? 3 : 4;
  return `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: dp })}`;
};

export const formatMoney = (n) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
