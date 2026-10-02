// utils/units.js
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for unit handling (recipe quantities, stock
// deduction, ingredient cost). Units are grouped into dimensions; a quantity
// only ever converts within its own dimension, via a factor to that
// dimension's base unit:
//   mass   → g    (kg = 1000 g)
//   volume → ml   (l  = 1000 ml)
//   count  → pcs  (dozen = 12 pcs)
//   packet, box   → each its own dimension (a "packet" has no fixed size)
// Converting across dimensions (g ↔ ml) is an error, never a guess.
// Mirrored for live previews in admin/src/utils/units.js — keep in sync.
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

const BASE_UNIT = { mass: "g", volume: "ml", count: "pcs", packet: "packet", box: "box" };

const ALIASES = {
  gm: "g", gms: "g", gram: "g", grams: "g", gr: "g",
  kgs: "kg", kilo: "kg", kilogram: "kg", kilograms: "kg",
  millilitre: "ml", milliliter: "ml", millilitres: "ml", milliliters: "ml", mls: "ml",
  ltr: "l", lt: "l", litre: "l", liter: "l", litres: "l", liters: "l",
  pc: "pcs", piece: "pcs", pieces: "pcs", nos: "pcs", no: "pcs", unit: "pcs", units: "pcs",
  dz: "dozen", doz: "dozen", packets: "packet", pkt: "packet", boxes: "box",
};

/** Canonical unit key ("Litre" → "l"), or null for an unrecognised unit. */
export const normalizeUnit = (unit) => {
  if (unit == null) return null;
  const u = String(unit).trim().toLowerCase();
  if (UNIT_DEFS[u]) return u;
  return ALIASES[u] || null;
};

// An unrecognised unit is treated as its own one-unit dimension, so legacy
// data in an odd unit still works when it's used consistently, but can never
// silently convert into anything else.
const unitInfo = (unit) => {
  const key = normalizeUnit(unit);
  if (key) return { key, ...UNIT_DEFS[key], base: BASE_UNIT[UNIT_DEFS[key].dim] };
  const raw = String(unit ?? "").trim().toLowerCase();
  return { key: raw, dim: `other:${raw}`, factor: 1, base: raw };
};

export const roundQty = (n) => Math.round((Number(n) + Number.EPSILON) * 1e6) / 1e6;

export const areUnitsCompatible = (a, b) => unitInfo(a).dim === unitInfo(b).dim;

/** Every known unit `unit` can convert to (including itself). */
export const compatibleUnits = (unit) => {
  const { dim, key } = unitInfo(unit);
  const known = Object.keys(UNIT_DEFS).filter((u) => UNIT_DEFS[u].dim === dim);
  return known.length ? known : [key];
};

export const unitConversionError = (from, to) => {
  const err = new Error(`Cannot convert "${from}" to "${to}" — they measure different things`);
  err.statusCode = 400;
  err.code = "UNIT_MISMATCH";
  return err;
};

/** How many `to` are in one `from` (ml → l = 0.001). Unrounded. Throws across dimensions. */
export const conversionFactor = (from, to) => {
  const f = unitInfo(from), t = unitInfo(to);
  if (f.dim !== t.dim) throw unitConversionError(from, to);
  return f.factor / t.factor;
};

/** qty in `from` → qty in `to`. Throws (400, UNIT_MISMATCH) across dimensions. */
export const convertQuantity = (qty, from, to) => {
  const f = unitInfo(from), t = unitInfo(to);
  if (f.dim !== t.dim) throw unitConversionError(from, to);
  return roundQty((Number(qty) * f.factor) / t.factor);
};

/** qty → { qty, unit } in its dimension's base unit (100 l → 100000 ml). */
export const toBaseUnit = (qty, unit) => {
  const info = unitInfo(unit);
  return { qty: roundQty(Number(qty) * info.factor), unit: info.base };
};
