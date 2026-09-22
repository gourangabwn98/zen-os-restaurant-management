// Pure, DOM-free helpers behind the waiter Tables board: which orders count
// as "occupying" a table, which status/payment state to show when a table
// has several orders at once, and elapsed-time formatting. Kept framework-
// free on purpose so they're unit-testable directly with `node`
// (see test/tableSession.test.js) — mirrors the plain Node+assert
// convention restaurant-server/test already uses, no test runner dependency
// added to this frontend.
//
// This is also the single place that knows the canonical order-status
// strings for this page (same values as components/StatusBadge.jsx:
// PENDING_CONFIRMATION | CONFIRMED | PREPARING | READY | DELIVERED |
// COMPLETED | CANCELLED) — nothing else on the Tables board should
// re-hardcode them.

export const ACTIVE_STATUSES = ["PENDING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY", "DELIVERED"];

export const STATUS_META = {
  PENDING_CONFIRMATION: { label: "Needs confirmation", color: "#F5B83D" },
  CONFIRMED:             { label: "Order placed",       color: "#6AA8FF" },
  PREPARING:             { label: "Preparing",          color: "#FF9152" },
  READY:                 { label: "Ready to serve",     color: "#3DD68C" },
  DELIVERED:             { label: "Served",             color: "#9AA4B2" },
};

// Most-urgent-first. A table with several active orders is colored/labeled
// by whichever status here needs a waiter's attention soonest — not just
// whichever status happens to be the most common among them.
const STATUS_PRIORITY = ["PENDING_CONFIRMATION", "READY", "CONFIRMED", "PREPARING", "DELIVERED"];

export const PAYMENT_META = {
  due:  { label: "PAYMENT DUE", color: "#FF8A8A", bg: "rgba(255,107,107,.16)" },
  paid: { label: "PAID",        color: "#5FE3A1", bg: "rgba(61,214,140,.16)" },
  open: { label: "BILL OPEN",   color: "#C9D1DC", bg: "rgba(154,164,178,.16)" },
};

export function activeOrders(orders) {
  return (orders || []).filter((o) => ACTIVE_STATUSES.includes(o.status));
}

export function priorityStatus(orders) {
  const active = activeOrders(orders);
  if (!active.length) return null;
  const present = new Set(active.map((o) => o.status));
  return STATUS_PRIORITY.find((s) => present.has(s)) || null;
}

/** "due" if any active order is still waiting on a payment result, "paid"
 * once every active order is settled, otherwise "open" (nothing pending —
 * e.g. still just confirmed/preparing, no payment attempt recorded yet). */
export function paymentState(orders) {
  const active = activeOrders(orders);
  if (!active.length) return null;
  if (active.some((o) => o.paymentStatus === "PENDING_VERIFICATION")) return "due";
  if (active.every((o) => o.paymentStatus === "PAID")) return "paid";
  return "open";
}

export function runningTotal(orders) {
  return activeOrders(orders).reduce((sum, o) => sum + (o.total || 0), 0);
}

export function earliestOrderTime(orders) {
  const active = activeOrders(orders);
  if (!active.length) return null;
  return Math.min(...active.map((o) => new Date(o.createdAt).getTime()));
}

export function elapsedMinutes(sinceMs, nowMs = Date.now()) {
  if (!sinceMs) return null;
  return Math.max(0, Math.floor((nowMs - sinceMs) / 60000));
}

export function formatElapsed(mins) {
  if (mins == null) return null;
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

/** Under 45m reads normal, 45-120m is worth a look ("wait"), over 120m is
 * flagged ("stop") — thresholds this page uses for the seated-timer color. */
export function elapsedKind(mins) {
  if (mins == null) return "normal";
  if (mins > 120) return "stop";
  if (mins >= 45) return "wait";
  return "normal";
}

/** One table's full at-a-glance state, derived once so the card, the
 * summary tiles, and the filter chips all agree with each other by
 * construction instead of three separate readings of the same session. */
export function classifyTable(table, session) {
  const orders = session?.orders || [];
  const active = activeOrders(orders);
  const occupied = active.length > 0;
  return {
    table,
    occupied,
    orderCount: active.length,
    status: occupied ? priorityStatus(orders) : null,
    payment: occupied ? paymentState(orders) : null,
    total: occupied ? runningTotal(orders) : 0,
    placedAt: occupied ? earliestOrderTime(orders) : null,
  };
}

/** Board-level counts for the summary tiles. `occupied` is derived purely
 * from each table's own active orders (classifyTable), never a separate
 * table.occupancyStatus flag from the backend — that flag going stale is
 * exactly what made the header always read "10/10 occupied" before. */
export function summarize(classified) {
  let free = 0, occupied = 0, toCollect = 0, needsYou = 0, due = 0;
  for (const c of classified) {
    if (!c.occupied) { free++; continue; }
    occupied++;
    if (c.payment === "due") { toCollect += c.total; due++; }
    if (c.status === "PENDING_CONFIRMATION" || c.status === "READY") needsYou++;
  }
  return { free, occupied, total: classified.length, toCollect, needsYou, due };
}

export function filterMatches(filterKey, c) {
  switch (filterKey) {
    case "FREE": return !c.occupied;
    case "OCCUPIED": return c.occupied;
    case "DUE": return c.occupied && c.payment === "due";
    case "NEEDS_YOU": return c.occupied && (c.status === "PENDING_CONFIRMATION" || c.status === "READY");
    default: return true; // ALL
  }
}
