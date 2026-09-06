// src/pages/admin/inventory/invKit.js
// ─────────────────────────────────────────────────────────────────────────────
// Non-component helpers for the Inventory tabs — tokens, status maps, inline
// style objects, and formatters. Split out of invUI.jsx so that file only
// exports React components (keeps Fast Refresh + lint happy). Every colour is
// a token from src/theme/tokens.css → Light / Dark / Auto all work.
// ─────────────────────────────────────────────────────────────────────────────

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
export const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const num = (n) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
export const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
export const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
