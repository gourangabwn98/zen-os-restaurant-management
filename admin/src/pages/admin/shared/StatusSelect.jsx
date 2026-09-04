// src/pages/admin/shared/StatusSelect.jsx
import { W } from "./constants";

export default function StatusSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "6px 10px",
        borderRadius: 8,
        border: "0.5px solid #ddd",
        fontSize: 13,
        background: W,
        cursor: "pointer",
      }}
    >
      {[
        "All",
        "Placed",
        "Preparing",
        "delivered",
        "Ready",
        "Completed",
        "Cancelled",
      ].map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
