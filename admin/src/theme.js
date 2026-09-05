// src/theme.js — Ad's Cafe theme constants
// ─────────────────────────────────────────────────────────────────────────────
// Every value here is a reference to a CSS custom property defined in
// src/theme/tokens.css, so inline styles that use these constants follow the
// light/dark toggle with no per-file change. Prefer the .zc-* classes in
// src/theme/surfaces.css, or the raw var(--token) names, for new code.
// ─────────────────────────────────────────────────────────────────────────────

// Branding.  TODO(Ad's Cafe): fill the contact/support fields with real values.
export const BRAND_NAME    = "Ad's Cafe";
export const BRAND_VERSION = "v1.0";
export const BRAND_MAKER   = "TODO: operator / company name";
export const SUPPORT_EMAIL = "TODO: support@adscafe.example";
export const SUPPORT_PHONE = "TODO: +91 00000 00000";
export const SUPPORT_WEB   = "TODO: https://adscafe.example";
export const STORAGE_KEY   = "adminUser";

// ── Background layers ────────────────────────────────────────────────────────
export const BG_SIDEBAR     = "var(--bg)";
export const BG_MAIN        = "var(--surface)";
export const BG_CARD        = "var(--card)";
export const BG_CARD_HOVER  = "var(--raise)";
export const BG_INPUT       = "var(--card-2)";
export const BG_HEADER      = "var(--bg)";

// ── Borders ─────────────────────────────────────────────────────────────────
export const BORDER         = "var(--edge)";
export const BORDER_ACTIVE  = "var(--edge-hi)";

// ── Text ────────────────────────────────────────────────────────────────────
export const TEXT_PRIMARY   = "var(--text-1)";
export const TEXT_SECONDARY = "var(--text-2)";
export const TEXT_MUTED     = "var(--text-3)";

// ── Brand ───────────────────────────────────────────────────────────────────
export const PRIMARY        = "var(--violet)";
export const PRIMARY_DARK   = "var(--indigo)";
export const PRIMARY_LIGHT  = "var(--violet-weak)";
export const PRIMARY_MID    = "var(--violet-mid)";
export const PRIMARY_MUTED  = "var(--violet-faint)";
export const PRIMARY_GLOW   = "var(--violet-glow)";

// ── Gradients ───────────────────────────────────────────────────────────────
export const GRADIENT        = "var(--grad-panel)";
export const GRADIENT_BTN    = "var(--grad-btn)";
export const GRADIENT_PURPLE = "var(--glow-main)";
export const GRADIENT_SIDEBAR = "var(--grad-rail)";

// ── Stat / chart accent colours ─────────────────────────────────────────────
export const STAT_COLORS    = [
  "var(--violet)",
  "var(--ready)",
  "var(--live)",
  "var(--wait)",
];

// ── Kept for back-compat with existing imports ──────────────────────────────
export const WHITE           = "var(--card)";
export const GREEN           = "var(--ready-ink)";
export const GREEN_LIGHT     = "var(--ready-fill)";
