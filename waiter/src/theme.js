// src/theme.js — staff-facing dark glassmorphism theme.
// Same design SYSTEM as the customer app (dark bg, glass surfaces, blur,
// premium typography) but the accent stays a distinct electric blue —
// deliberately different from customer (orange) and admin (purple) so a
// staff member always knows which app is open at a glance.
export const BG_PRIMARY   = "#08070C";
export const BG_SECONDARY = "#0C0A14";

export const GLASS_BG      = "rgba(255,255,255,0.07)";
export const GLASS_BG_SOFT = "rgba(255,255,255,0.05)";
export const GLASS_BORDER  = "rgba(255,255,255,0.12)";

export const ACCENT        = "#3B82F6";
export const ACCENT_LIGHT  = "#60A5FA";
export const ACCENT_SOFT   = "rgba(59,130,246,0.16)";
export const ACCENT_GRADIENT = "linear-gradient(135deg, #60A5FA 0%, #2563EB 100%)";
export const ACCENT_GLOW   = "0 0 0 1px rgba(59,130,246,0.35), 0 8px 24px rgba(59,130,246,0.35)";

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

export const NAV_HEIGHT = 68;

export const STORAGE = {
  token: "waiterToken",
  user:  "waiterUser",
};
