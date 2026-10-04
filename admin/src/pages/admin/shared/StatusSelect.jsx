// src/pages/admin/shared/StatusSelect.jsx
// Canonical order-status filter. Values are the real enum from
// restaurant-server/utils/orderStateMachine.js — never the pre-rename strings.
import { t, N_ } from "../../../i18n/core.js";
import { ORDER_STATUS_LABEL as L } from "./statusLabels.js";

const OPTIONS = [
  ["All", N_("All")],
  ...["AWAITING_PAYMENT", "PENDING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY", "DELIVERED", "COMPLETED", "CANCELLED"]
    .map((s) => [s, L[s]]),
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
