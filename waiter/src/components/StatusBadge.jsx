import { AMBER, GREEN, RED, TEXT_MUTED, BLUE } from "../theme.js";

export const STATUS_LABEL = {
  PENDING_CONFIRMATION: "Awaiting confirmation",
  CONFIRMED: "Confirmed",
  PREPARING: "Preparing",
  READY: "Ready",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const statusColor = (s) => {
  if (s === "CANCELLED") return RED;
  if (s === "COMPLETED") return TEXT_MUTED;
  if (s === "PENDING_CONFIRMATION") return AMBER;
  if (s === "CONFIRMED") return BLUE;
  return GREEN;
};

export default function StatusBadge({ status }) {
  const c = statusColor(status);
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 800, color: c, background: `${c}18`,
      padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap",
    }}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}
