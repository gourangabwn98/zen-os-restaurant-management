// src/pages/admin/dashboard/model.js
// Pure derivations for the Dashboard — everything here is computed from the
// real orders / tables / invoices / inventory / printer data the page already
// fetches. No numbers are invented. Status / type / payment values are the
// canonical enums from restaurant-server/utils/orderStateMachine.js.

export const ALL_STATUSES = [
  "AWAITING_PAYMENT", "PENDING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY",
  "DELIVERED", "COMPLETED", "CANCELLED",
];
export const ORDER_TYPES = ["DINE_IN", "TAKEAWAY", "ONLINE"];
// "not on the floor": finished, or a pay-first order nobody has paid for yet
export const ACTIVE_EXCLUDE = ["COMPLETED", "CANCELLED", "AWAITING_PAYMENT"];

// ── DSH-04: the floor status flow, driven only by named events ──────────────
//   Placed (held — ORD-01, nothing has reached the kitchen yet)
//   → Cooking           the KOT fired (CONFIRMED → PREPARING)
//   → Ready to Deliver  the kitchen marked it ready (PREPARING → READY)
//   → Eating            the waiter tapped Served (READY → DELIVERED)
//   → Completed         the bill was settled in billing (→ COMPLETED)
// Each state is read straight off the order status the event set — never
// guessed from timers, payments or other orders.
export const FLOOR_STATE_OF = {
  PENDING_CONFIRMATION: "placed",
  CONFIRMED: "placed",
  PREPARING: "cooking",
  READY: "ready",
  DELIVERED: "eating",
  COMPLETED: "completed",
};
export const FLOOR_FLOW = ["placed", "cooking", "ready", "eating", "completed"];
const onFloor = (o) => o.status !== "CANCELLED" && o.status !== "AWAITING_PAYMENT";
const isBillSettled = (o) => (o.billStatus ? o.billStatus === "SETTLED" : o.status === "COMPLETED");
const newest = (list, field = "createdAt") => list.reduce((a, b) => (new Date(b[field] || b.createdAt) > new Date(a[field] || a.createdAt) ? b : a));

/**
 * DSH-05: the order a table is "on" right now — the newest still-active one;
 * if none is active, the newest completed one (shown as Completed until the
 * next order arrives, which puts the table straight back to its new state).
 * Returns null for a table nobody ordered at today.
 */
export function currentTableOrder(orders) {
  const list = (orders || []).filter(onFloor);
  if (!list.length) return null;
  const active = list.filter((o) => o.status !== "COMPLETED");
  return active.length ? newest(active) : newest(list, "completedAt");
}

// A table whose oldest open order is this old shows as "Long stay" (amber).
export const LONG_STAY_MIN = 90;

export const isSameDay = (d, ref = new Date()) => {
  const dt = new Date(d);
  return dt.getFullYear() === ref.getFullYear() && dt.getMonth() === ref.getMonth() && dt.getDate() === ref.getDate();
};
export const isToday = (d) => isSameDay(d, new Date());
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const sum = (list) => list.reduce((acc, o) => acc + Number(o.total || 0), 0);
const isActive = (o) => !ACTIVE_EXCLUDE.includes(o.status);
// Payment still to be collected on an order the restaurant has ACCEPTED.
// Not yet accepted (PENDING_CONFIRMATION) is not money owed — it may still be
// rejected — and it shows separately under "Needs your attention".
const NOT_OWED = ["CANCELLED", "AWAITING_PAYMENT", "PENDING_CONFIRMATION"];
const isUnpaid = (o) => o.paymentStatus === "PENDING_VERIFICATION" && !NOT_OWED.includes(o.status);
// Money taken = PAID and not CANCELLED — the same rule as Insights, Invoices
// and the server (insightsService.revenueOrderMatch). A paid-then-cancelled
// order is not revenue.
const isRevenue = (o) => o.paymentStatus === "PAID" && o.status !== "CANCELLED";

// ── "Three answers" + today's detail ──────────────────────────────────────
export function todaySummary(todayOrders) {
  const paid = todayOrders.filter(isRevenue);
  const cash = paid.filter((o) => o.paymentMethod === "Cash");
  const online = paid.filter((o) => o.paymentMethod === "Online");
  const open = todayOrders.filter(isUnpaid);
  const openTables = new Set(open.filter((o) => o.orderType === "DINE_IN" && o.tableNo).map((o) => Number(o.tableNo)));
  const byStatus = Object.fromEntries(ALL_STATUSES.map((st) => [st, todayOrders.filter((o) => o.status === st)]));
  const byType = Object.fromEntries(ORDER_TYPES.map((ty) => [ty, todayOrders.filter((o) => o.orderType === ty).length]));
  const collected = sum(paid);
  return {
    count: todayOrders.length,
    collected,
    cash: sum(cash),
    online: sum(online),
    paidCount: paid.length,
    avgBill: paid.length ? Math.round(collected / paid.length) : 0,
    openAmount: sum(open),
    openCount: open.length,
    openTables: openTables.size,
    inProgress: todayOrders.filter(isActive).length,
    done: byStatus.COMPLETED.length,
    cancelled: byStatus.CANCELLED.length,
    byStatus: Object.fromEntries(ALL_STATUSES.map((st) => [st, { count: byStatus[st].length, revenue: sum(byStatus[st]) }])),
    byType,
    lastOrderAt: todayOrders[0]?.createdAt || null,
  };
}

// Same figures the old tile grid showed (last 1000 orders the page loads).
export function overallTotals(allOrders) {
  const paid = allOrders.filter(isRevenue);
  const due = allOrders.filter(isUnpaid);
  const cash = paid.filter((o) => o.paymentMethod === "Cash");
  const online = paid.filter((o) => o.paymentMethod === "Online");
  const totalRev = sum(paid);
  return {
    orders: allOrders.length,
    totalRev, paidCount: paid.length,
    due: sum(due), dueCount: due.length,
    cash: sum(cash), cashCount: cash.length,
    online: sum(online), onlineCount: online.length,
    avg: paid.length ? Math.round(totalRev / paid.length) : 0,
  };
}

// Unpaid orders from before today, kept apart from today's open bills.
export function olderUnpaid(allOrders) {
  const start = startOfToday();
  const list = allOrders.filter((o) => isUnpaid(o) && new Date(o.createdAt) < start);
  if (!list.length) return null;
  const times = list.map((o) => new Date(o.createdAt).getTime());
  const orders = list.slice().sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt)); // oldest first
  return { count: list.length, amount: sum(list), from: new Date(Math.min(...times)), to: new Date(Math.max(...times)), orders };
}

// ── floor ─────────────────────────────────────────────────────────────────
// One entry per active table: its state (current order — DSH-04/05), the
// still-active orders (oldest first), what is on them, how long the table has
// been seated, and — information only, the Dashboard never bills (BIL-01) —
// whether a served order still has its bill open.
export function floorTables(tables, todayOrders, now = Date.now()) {
  const byTable = {};
  todayOrders
    .filter((o) => o.orderType === "DINE_IN" && o.tableNo && onFloor(o))
    .forEach((o) => { (byTable[Number(o.tableNo)] ||= []).push(o); });

  return tables
    .filter((tb) => tb.status === "Active" || !tb.status)
    .sort((a, b) => a.tableNo - b.tableNo)
    .map((tb) => {
      const all = byTable[tb.tableNo] || [];
      const current = currentTableOrder(all);
      const orders = all.filter(isActive).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const state = current ? FLOOR_STATE_OF[current.status] || "placed" : "free";
      const minutes = orders.length ? Math.max(0, Math.floor((now - new Date(orders[0].createdAt).getTime()) / 60000)) : 0;
      return {
        tableNo: tb.tableNo, seats: tb.seats, state, current, orders, allToday: all,
        amount: sum(orders), minutes, longStay: minutes >= LONG_STAY_MIN,
        billOpen: orders.filter((o) => o.status === "DELIVERED" && !isBillSettled(o)).length,
      };
    });
}

// ── 7-day sales ───────────────────────────────────────────────────────────
// weeklyRevenue (GET /admin/dashboard) only has days that had sales; fill the
// gaps so an empty day is drawn as "No sales" instead of being skipped. Today's
// bar uses the live figure, because the dashboard payload is loaded once.
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function lastSevenDays(weeklyRevenue = [], todayCollected = 0) {
  const map = new Map(weeklyRevenue.map((d) => [d._id, Number(d.revenue || 0)]));
  const out = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
    const today = i === 0;
    out.push({ date: d, today, value: today ? todayCollected : map.get(dayKey(d)) || 0 });
  }
  return out;
}

// Rounded axis top with four gridlines (0 and three steps), like the reference.
export function niceAxis(max) {
  if (max <= 0) return [0, 1000, 2000, 3000];
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  return [0, step, step * 2, step * 3];
}

// ── attention list ────────────────────────────────────────────────────────
// Most serious first. Each item carries a navigation target or an action key
// the page knows how to handle — never a made-up number.
// awaitingConfirm: the PENDING_CONFIRMATION orders themselves (shown in the detail modal).
export function attentionItems({ inv, printer, billsToSettle = [], awaitingConfirm, older }) {
  const items = [];
  const names = (list) => (list || []).slice(0, 3);
  if (inv?.outOfStock?.count > 0) items.push({ sev: "red", kind: "out", count: inv.outOfStock.count, names: names(inv.outOfStock.items), action: "stock" });
  if (printer && !printer.online) items.push({ sev: "red", kind: "printerOff", pending: printer.queue?.pending ?? 0, action: "profile" });
  if (printer?.queue?.failed > 0) items.push({ sev: "red", kind: "printerFailed", count: printer.queue.failed, action: "profile" });
  // Served but the bill isn't settled yet — settled in Invoices, not here (BIL-01).
  if (billsToSettle.length > 0) items.push({ sev: "amber", kind: "settle", count: billsToSettle.length, orders: billsToSettle, action: "invoices" });
  if (awaitingConfirm.length > 0) items.push({ sev: "amber", kind: "confirm", count: awaitingConfirm.length, orders: awaitingConfirm, action: "orders" });
  if (older) items.push({ sev: "amber", kind: "olderUnpaid", ...older, action: "orders" });
  const lowCount = (inv?.critical?.count || 0) + (inv?.lowStock?.count || 0);
  if (lowCount > 0) items.push({ sev: "amber", kind: "low", count: lowCount, names: names([...(inv.critical?.items || []), ...(inv.lowStock?.items || [])]), action: "stock" });
  if (inv?.expiringSoon?.count > 0) items.push({ sev: "amber", kind: "expiring", count: inv.expiringSoon.count, withinDays: inv.expiringSoon.withinDays, action: "stock" });
  return items;
}

