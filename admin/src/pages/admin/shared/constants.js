// src/pages/admin/shared/constants.js
export {
  PRIMARY as PINK,
  WHITE as W,
  STAT_COLORS,
  PRIMARY_LIGHT,
  PRIMARY_MID,
  PRIMARY_DARK,
  BG_CARD,
  BG_INPUT,
  BORDER,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_MUTED,
} from "../../../theme.js";

export const STATUS_STYLE = {
  // Legacy (pre Phase-1) status strings — kept so old cached/historic data
  // still renders with a sensible color instead of falling through to grey.
  Placed:    { bg: "rgba(56,122,221,0.15)",  color: "#60a5fa" },
  Preparing: { bg: "rgba(186,117,23,0.15)",  color: "#fbbf24" },
  Ready:     { bg: "rgba(16,185,129,0.15)",  color: "#34d399" },
  Delivered: { bg: "rgba(16,185,129,0.15)",  color: "#34d399" },
  Completed: { bg: "rgba(107,114,128,0.15)", color: "#9ca3af" },
  Cancelled: { bg: "rgba(239,68,68,0.15)",   color: "#f87171" },
  delivered: { bg: "rgba(16,185,129,0.15)",  color: "#34d399" },
  PendingApproval: { bg: "rgba(245,158,11,0.15)", color: "#fbbf24" },

  // Canonical order status (Phase 1+)
  PENDING_CONFIRMATION: { bg: "rgba(245,158,11,0.18)", color: "#fbbf24" },
  CONFIRMED:            { bg: "rgba(56,122,221,0.15)", color: "#60a5fa" },
  PREPARING:            { bg: "rgba(186,117,23,0.15)", color: "#fbbf24" },
  READY:                { bg: "rgba(16,185,129,0.15)", color: "#34d399" },
  DELIVERED:             { bg: "rgba(16,185,129,0.15)", color: "#34d399" },
  COMPLETED:              { bg: "rgba(107,114,128,0.15)", color: "#9ca3af" },
  CANCELLED:               { bg: "rgba(239,68,68,0.15)", color: "#f87171" },

  // Payment status (Phase 3+)
  PENDING_VERIFICATION: { bg: "rgba(245,158,11,0.15)", color: "#fbbf24" },
  PAID:                 { bg: "rgba(16,185,129,0.15)", color: "#34d399" },
  FAILED:                { bg: "rgba(239,68,68,0.15)", color: "#f87171" },
};
