// src/pages/admin/inventory/invKit.js
// ─────────────────────────────────────────────────────────────────────────────
// Non-component helpers for the Inventory tabs — tokens, status maps, inline
// style objects, and formatters. Split out of invUI.jsx so that file only
// exports React components (keeps Fast Refresh + lint happy). Every colour is
// a token from src/theme/tokens.css → Light / Dark / Auto all work.
// ─────────────────────────────────────────────────────────────────────────────

import { t, N_, fmtNum, fmtDate as fmtDateL, fmtDateTime as fmtDateTimeL } from "../../../i18n/core.js";

// token aliases kept for backward-compat with the tab files
export const PINK   = "var(--violet)";
export const CARD   = "var(--card)";
export const CARD2  = "var(--card-2)";
export const BORDER = "var(--edge)";
export const T1     = "var(--text-1)";
export const T2     = "var(--text-2)";
export const T3     = "var(--text-3)";

// computed stock-health levels (restaurant-server/utils/inventoryConstants.js)
export const LEVEL_COLORS = {
  OK:           { bg: "var(--ready-fill)", color: "var(--ready-ink)", border: "var(--ready-line)" },
  LOW:          { bg: "var(--wait-fill)",  color: "var(--wait-ink)",  border: "var(--wait-line)" },
  CRITICAL:     { bg: "var(--wait-fill)",  color: "var(--wait-ink)",  border: "var(--wait-line)" },
  OUT_OF_STOCK: { bg: "var(--stop-fill)",  color: "var(--stop-ink)",  border: "var(--stop-line)" },
};
export const levelKind = (level) =>
  level === "OK" ? "ready" : level === "OUT_OF_STOCK" ? "stop" : "wait";
export const levelInk = (level) => `var(--${levelKind(level)}-ink)`;

// ── inline-style helpers used by the tab forms (token-based) ─────────────────
export const inp = {
  width: "100%", padding: "9px 13px", borderRadius: "var(--r-ctl)", boxSizing: "border-box",
  border: "1px solid var(--edge)", background: "var(--card-2)",
  color: "var(--text-1)", fontSize: 12.5, outline: "none", fontFamily: "inherit",
};
export const label = {
  fontSize: 11.5, color: "var(--text-2)", fontWeight: 500, display: "block", marginBottom: 6,
};
export const btnPrimary = (disabled) => ({
  padding: "9px 16px", borderRadius: "var(--r-ctl)", fontFamily: "inherit",
  background: disabled ? "var(--raise)" : "var(--grad-btn)",
  color: disabled ? "var(--text-3)" : "#fff", border: "1px solid transparent", fontWeight: 600,
  cursor: disabled ? "not-allowed" : "pointer", fontSize: 12.5,
  boxShadow: disabled ? "none" : "0 8px 22px -8px var(--violet-glow), inset 0 1px 0 rgba(255,255,255,0.25)",
});
export const btnGhost = {
  padding: "9px 15px", borderRadius: "var(--r-ctl)", border: "1px solid var(--edge)", fontFamily: "inherit",
  background: "var(--card-2)", color: "var(--text-1)", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
};
export const btnDanger = {
  padding: "6px 12px", borderRadius: "var(--r-ctl)", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
  fontFamily: "inherit",
  border: "1px solid var(--stop-line)", background: "var(--stop-fill)", color: "var(--stop-ink)",
};

// ── formatting ──────────────────────────────────────────────────────────────
// Locale-aware (Bengali digits / month names in bn) — see i18n/core.js.
export const money = (n) => `₹${fmtNum(n)}`;
export const num = (n) => fmtNum(n);
export const fmtDate = (d) => fmtDateL(d);
export const fmtDateTime = (d) => fmtDateTimeL(d);

// ── ledger types (restaurant-server/utils/inventoryConstants.js LEDGER_TYPES) ──
export const LEDGER_TYPES = ["PURCHASE", "SALE_DEDUCTION", "WASTAGE", "ADJUSTMENT", "PHYSICAL_COUNT", "REVERSAL"];
export const LEDGER_LABEL = {
  PURCHASE: N_("Purchase"), SALE_DEDUCTION: N_("Sale Deduction"), WASTAGE: N_("Wastage"),
  ADJUSTMENT: N_("Adjustment"), PHYSICAL_COUNT: N_("Physical Count"), REVERSAL: N_("Reversal"),
};
export const LEDGER_KIND = {
  PURCHASE: "ready", SALE_DEDUCTION: "live", WASTAGE: "stop",
  ADJUSTMENT: "wait", PHYSICAL_COUNT: "vio", REVERSAL: "done",
};
// WASTAGE_REASONS — same file. Stored enum values; t() shows them translated.
export const WASTAGE_REASONS = [N_("Spoilage"), N_("Expired"), N_("Damaged"), N_("Accident"), N_("Other")];
export const STOCK_UNITS = ["g", "kg", "ml", "l", "pcs", "dozen", "packet", "box"];

// Stock value = currentStock × costPrice over Active items — the exact
// formula computeInventoryOverview uses server-side for `stockValue`.
export const itemValue = (it) => Number(it.currentStock || 0) * Number(it.costPrice || 0);

// Worst first, for the "Stock status" sort.
export const LEVEL_RANK = { OUT_OF_STOCK: 0, CRITICAL: 1, LOW: 2, OK: 3 };
export const needsReorder = (it) => it.stockLevel && it.stockLevel !== "OK";

/** Midnight `days` days ago (local) — the start of a "last N days" window. */
export const daysAgo = (days) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
};

// Ledger reasons are written by the server in English (audit trail) — show
// the known shapes translated; anything typed by a person is shown as-is.
const REASON_PATTERNS = [
  [/^Order (\S+) cancelled$/, (m) => t("Order {id} cancelled", { id: m[1] })],
  [/^Order (\S+)$/, (m) => t("Order {id}", { id: m[1] })],
  [/^Purchase \((.+)\)$/, (m) => t("Purchase ({ref})", { ref: m[1] })],
];
export const reasonLabel = (r) => {
  if (!r) return "";
  for (const [re, fn] of REASON_PATTERNS) { const m = re.exec(r); if (m) return fn(m); }
  return t(r);
};
