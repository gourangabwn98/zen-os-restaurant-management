// src/theme.js — dark, premium, glassmorphism customer theme
export const BG_PRIMARY   = "#08070C";
export const BG_SECONDARY = "#0C0A14";

export const GLASS_BG      = "rgba(255,255,255,0.07)";
export const GLASS_BG_SOFT = "rgba(255,255,255,0.05)";
export const GLASS_BORDER  = "rgba(255,255,255,0.12)";

export const ACCENT        = "#FF8A00";
export const ACCENT_LIGHT  = "#FFB347";
export const ACCENT_SOFT   = "rgba(255,138,0,0.16)";
export const ACCENT_GRADIENT = "linear-gradient(135deg, #FF9F1C 0%, #FF8A00 100%)";
export const ACCENT_GLOW   = "0 0 0 1px rgba(255,138,0,0.35), 0 8px 24px rgba(255,138,0,0.35)";

export const TEXT        = "#FFFFFF";
export const TEXT_MUTED  = "rgba(255,255,255,0.68)";
export const TEXT_FAINT  = "rgba(255,255,255,0.56)";

export const GREEN = "#34D399";
export const AMBER  = "#FBBF24";
export const RED   = "#F87171";

export const RADIUS_SM = 10;
export const RADIUS_MD = 16;
export const RADIUS_LG = 22;

export const SHADOW_GLASS = "0 8px 30px rgba(0,0,0,0.35)";
export const BLUR = "blur(20px)";

// Bottom nav / top-of-viewport safe-area heights (mobile-first)
export const NAV_HEIGHT = 68;
export const TOPBAR_HEIGHT = 56;

export const STORAGE = {
  cartOrderType: "sohoj_orderType",
  customerToken: "customerToken",
  customerUser:  "customerUser",
  tableCtx:      "sohoj_table_ctx", // { tableNo, tableToken, label }
  favorites:     "sohoj_favorites_v1",
};
