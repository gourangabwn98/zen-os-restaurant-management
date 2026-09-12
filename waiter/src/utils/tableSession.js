// Derives at-a-glance table-board signals purely from real session/order
// data (TableSession.openedAt, TableSession.orders[].status/.total) — no
// fabricated fields.

// Priority order for "what does this table need right now" — a table with
// ANY order still awaiting confirmation is the most urgent thing on the
// board, ahead of a table that's merely mid-preparation.
const URGENCY_ORDER = ["PENDING_CONFIRMATION", "READY", "PREPARING", "CONFIRMED", "DELIVERED"];

export function mostUrgentStatus(orders) {
  const active = (orders || []).filter((o) => o.status !== "CANCELLED" && o.status !== "COMPLETED");
  if (!active.length) return null;
  for (const s of URGENCY_ORDER) {
    if (active.some((o) => o.status === s)) return s;
  }
  return active[0].status;
}

export function runningTotal(orders) {
  return (orders || [])
    .filter((o) => o.status !== "CANCELLED")
    .reduce((sum, o) => sum + (o.total || 0), 0);
}

export function formatElapsed(openedAt) {
  if (!openedAt) return null;
  const mins = Math.max(0, Math.floor((Date.now() - new Date(openedAt).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}
