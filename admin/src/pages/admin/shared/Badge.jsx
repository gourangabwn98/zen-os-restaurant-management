// src/pages/admin/shared/Badge.jsx
import { STATUS_STYLE } from "./constants";
import { PRIMARY, PRIMARY_LIGHT, STAT_COLORS } from "../../../theme.js";

export default function Badge({ label, type }) {
  const s = STATUS_STYLE[label] ||
    STATUS_STYLE[type] || { bg: "#eee", color: "#9ca3af" };

  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: "3px 10px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}
