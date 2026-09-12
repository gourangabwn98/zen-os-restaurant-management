import { GREEN, RED, AMBER } from "../../theme.js";

const MUTED_HEX = "#9CA3AF";

export function orderStatusColor(status) {
  if (status === "CANCELLED") return RED;
  if (status === "COMPLETED") return MUTED_HEX;
  if (status === "PENDING_CONFIRMATION") return AMBER;
  return GREEN;
}

export function paymentStatusColor(status) {
  if (status === "PAID") return GREEN;
  if (status === "FAILED") return RED;
  return AMBER;
}

export default function StatusBadge({ label, color, style }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 11.5, fontWeight: 800, color,
        background: `${color}1f`, border: `1px solid ${color}40`,
        padding: "4px 10px", borderRadius: 999, ...style,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}
