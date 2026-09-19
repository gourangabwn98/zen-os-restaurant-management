import { AMBER, GREEN, RED, ACCENT } from "../theme.js";

export const STATUS_LABEL = {
  PENDING_CONFIRMATION: "Awaiting confirmation",
  CONFIRMED: "Placed",
  PREPARING: "Preparing",
  READY: "Ready",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const MUTED_HEX = "#9CA3AF";

// Same wait(amber) / live(blue) / ready(green) / done(grey) / stop(red)
// grouping as statusKind on the admin side (admin/src/pages/admin/shared/
// statusKind.js) — PREPARING groups with PENDING_CONFIRMATION as "still
// waiting on something", not with READY/DELIVERED.
export const statusColor = (s) => {
  if (s === "CANCELLED") return RED;
  if (s === "COMPLETED") return MUTED_HEX;
  if (s === "PENDING_CONFIRMATION" || s === "PREPARING") return AMBER;
  if (s === "CONFIRMED") return ACCENT;
  return GREEN; // READY, DELIVERED
};

export default function StatusBadge({ status, style }) {
  const c = statusColor(status);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 10.5, fontWeight: 800, color: c, background: `${c}1f`, border: `1px solid ${c}40`,
      padding: "4px 10px", borderRadius: 20, whiteSpace: "nowrap", ...style,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />
      {STATUS_LABEL[status] || status}
    </span>
  );
}
