// src/pages/admin/shared/StatusSelect.jsx
// Canonical order-status filter. Values are the real enum from
// restaurant-server/utils/orderStateMachine.js — never the pre-rename strings.
const OPTIONS = [
  ["All", "All"],
  ["PENDING_CONFIRMATION", "Pending confirmation"],
  ["CONFIRMED", "Confirmed"],
  ["PREPARING", "Preparing"],
  ["READY", "Ready"],
  ["DELIVERED", "Delivered"],
  ["COMPLETED", "Completed"],
  ["CANCELLED", "Cancelled"],
];

export default function StatusSelect({ value, onChange }) {
  return (
    <select
      className="zc-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: "auto", cursor: "pointer" }}
    >
      {OPTIONS.map(([v, label]) => (
        <option key={v} value={v}>{label}</option>
      ))}
    </select>
  );
}
