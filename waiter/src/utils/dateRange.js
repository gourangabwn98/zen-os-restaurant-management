// Local-day "YYYY-MM-DD" date-range presets — same convention as the admin
// Employees "Stats" filter (admin/src/pages/admin/EmployeesPage.jsx):
// never toISOString() for a date-only value, since that shifts by the UTC
// offset and can land on the wrong day near midnight.
export const toDateInput = (d) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

export const RANGE_PRESETS = [
  { key: "today",     label: "Today",       range: () => ({ from: toDateInput(new Date()), to: toDateInput(new Date()) }) },
  { key: "yesterday", label: "Yesterday",   range: () => ({ from: toDateInput(daysAgo(1)), to: toDateInput(daysAgo(1)) }) },
  { key: "week",      label: "Last 7 Days", range: () => ({ from: toDateInput(daysAgo(6)), to: toDateInput(new Date()) }) },
  { key: "month",     label: "Last 30 Days", range: () => ({ from: toDateInput(daysAgo(29)), to: toDateInput(new Date()) }) },
];

/** "Xh Ym" from a seconds count — same format DutyPanel already uses. */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
