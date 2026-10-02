// src/pages/admin/shared/StatusSelect.jsx
// Canonical order-status filter. Values are the real enum from
// restaurant-server/utils/orderStateMachine.js — never the pre-rename strings.
import { t, N_ } from "../../../i18n/core.js";

const OPTIONS = [
  ["All", N_("All")],
  ["AWAITING_PAYMENT", N_("Awaiting payment")],
  ["PENDING_CONFIRMATION", N_("Pending confirmation")],
  ["CONFIRMED", N_("Placed")],
  ["PREPARING", N_("Preparing")],
  ["READY", N_("Ready")],
  ["DELIVERED", N_("Delivered")],
  ["COMPLETED", N_("Completed")],
  ["CANCELLED", N_("Cancelled")],
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
        <option key={v} value={v}>{t(label)}</option>
      ))}
    </select>
  );
}
