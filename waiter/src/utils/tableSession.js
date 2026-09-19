// Derives at-a-glance table-board signals purely from real session/order
// data (TableSession.openedAt, TableSession.orders[].status/.total) — no
// fabricated fields. Mirrors the "Table map" logic on the admin Orders page
// (admin/src/pages/admin/OrdersPage.jsx) so a table looks and behaves the
// same way — same dominant-status coloring, same paid/due/open read — on
// both the waiter and admin apps.

const ACTIVE_STATUSES = ["PENDING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY", "DELIVERED"];

export const activeOrders = (orders) => (orders || []).filter((o) => ACTIVE_STATUSES.includes(o.status));

/** Most-common status among a table's active orders — same "dominant status
 * colors the whole tile" rule the admin table map uses, rather than picking
 * whichever single status is most urgent. */
export function dominantStatus(orders) {
  const active = activeOrders(orders);
  if (!active.length) return null;
  const counts = {};
  active.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
}

/** Any order still awaiting confirmation needs a waiter's attention right
 * now regardless of what the dominant status is — kept as its own signal
 * (e.g. to pulse the tile) rather than folded into dominantStatus. */
export function needsConfirmation(orders) {
  return activeOrders(orders).some((o) => o.status === "PENDING_CONFIRMATION");
}

/** "Due" if any active order still needs payment verification, "Paid" once
 * every active order is settled, otherwise "Open" — same three states the
 * admin table map shows. */
export function paymentLabel(orders) {
  const active = activeOrders(orders);
  if (!active.length) return null;
  if (active.some((o) => o.paymentStatus === "PENDING_VERIFICATION")) return "Due";
  if (active.every((o) => o.paymentStatus === "PAID")) return "Paid";
  return "Open";
}

export function runningTotal(orders) {
  return activeOrders(orders).reduce((sum, o) => sum + (o.total || 0), 0);
}

/** When the earliest still-active order at this table was placed — the same
 * "time since placed" the admin table map times a table by (placedMs in
 * admin/src/pages/admin/OrdersPage.jsx), not TableSession.openedAt. A table
 * can sit OPEN with no active orders for a moment mid-transition; a table
 * with no orders at all has nothing to time — both return null so callers
 * never show a clock with nothing behind it. */
export function earliestOrderTime(orders) {
  const active = activeOrders(orders);
  if (!active.length) return null;
  return Math.min(...active.map((o) => new Date(o.createdAt).getTime()));
}

export function formatElapsed(sinceMs) {
  if (!sinceMs) return null;
  const mins = Math.max(0, Math.floor((Date.now() - sinceMs) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

/** How long the order has been waiting, as an urgency bucket — same 45/90
 * minute thresholds admin's table map uses (durationKind in
 * admin/src/pages/admin/OrdersPage.jsx): normal under 45m, worth a look
 * 45-90m, flagged overdue past 90m. */
export function elapsedKind(sinceMs) {
  if (!sinceMs) return null;
  const mins = Math.max(0, Math.floor((Date.now() - sinceMs) / 60000));
  return mins >= 90 ? "stop" : mins >= 45 ? "wait" : "normal";
}
