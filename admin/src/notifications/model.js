// src/notifications/model.js — NTF-02 / NTF-03
// ─────────────────────────────────────────────────────────────────────────────
// ONE description of every alert the POS shows, used for both the toast and
// the notification panel, so an alert looks and behaves the same wherever it
// appears (NTF-03). Pure: socket payload in → entry out (or null = ignore).
//
//   kind   "order" | "call" | "system"   (the panel's filter tabs)
//   tone   "info" | "good" | "warn" | "bad"
//   sound  play the alert tone        toast  show a toast too
//   go     { page, order? }           where tapping the entry leads
// Never invents data — every line is built from the event's own payload.
// ─────────────────────────────────────────────────────────────────────────────
import { t, N_ } from "../i18n/core.js";
import { tableLabel } from "../pages/admin/shared/diningArea.js";

export const KINDS = [
  { key: "all", label: N_("All") },
  { key: "order", label: N_("Orders") },
  { key: "call", label: N_("Waiter calls") },
  { key: "system", label: N_("System") },
];

// Floor words (DSH-04) for the status lines.
const FLOOR = {
  PREPARING: N_("Cooking"), READY: N_("Ready to deliver"), DELIVERED: N_("Eating"),
  COMPLETED: N_("Completed"), CONFIRMED: N_("Placed"),
};

const where = (o) => (o?.tableNo ? tableLabel(o) : o?.orderType === "TAKEAWAY" ? t("Takeaway") : "");
const ref = (o) => (o ? { _id: o._id, orderId: o.orderId } : null);

/** → entry fields (without id/at/read) or null when the event isn't worth a line. */
export const describe = (event, p = {}) => {
  const o = p.order;
  switch (event) {
    case "order:new":
      return { kind: "order", tone: "warn", icon: "bell", sound: true, toast: true,
        title: t("New order {id}", { id: o?.orderId || "" }), sub: [where(o), t("needs confirmation")].filter(Boolean).join(" · "),
        go: { page: "orders", order: ref(o) } };
    case "order:confirmed":
      return { kind: "order", tone: "info", icon: "check", toast: false,
        title: t("Order {id} accepted", { id: o?.orderId || "" }), sub: where(o), go: { page: "orders", order: ref(o) } };
    case "order:status_changed": {
      if (p.modified) return { kind: "order", tone: "info", icon: "edit", toast: false,
        title: t("Order {id} changed", { id: o?.orderId || "" }), sub: where(o), go: { page: "orders", order: ref(o) } };
      const label = FLOOR[o?.status];
      if (!label) return null;
      return { kind: "order", tone: o.status === "READY" ? "good" : "info", icon: o.status === "READY" ? "dish" : "flow",
        toast: o.status === "READY",
        title: `${t("Order {id}", { id: o.orderId })} → ${t(label)}`, sub: where(o), go: { page: "orders", order: ref(o) } };
    }
    case "order:cancelled":
      return { kind: "order", tone: "bad", icon: "x", toast: true,
        title: t("Order {id} cancelled", { id: o?.orderId || "" }), sub: p.reason || where(o), go: { page: "orders", order: ref(o) } };
    case "order:payment_changed":
      return { kind: "order", tone: o?.billStatus === "SETTLED" ? "good" : "info", icon: "rupee", toast: false,
        title: o?.billStatus === "SETTLED" ? t("Bill settled · {id}", { id: o?.orderId || "" }) : t("Payment for {id} → {s}", { id: o?.orderId || "", s: t(o?.paymentStatus === "PAID" ? "Paid" : "Unpaid") }),
        sub: where(o), go: { page: "invoices" } };
    case "order:needs_attention":
      return { kind: "system", tone: "bad", icon: "alert", sound: true, toast: true,
        title: t("Order {id} couldn't go to the kitchen", { id: o?.orderId || "" }), sub: p.reason || "", go: { page: "orders", order: ref(o) } };
    case "waiter_call:activity": {
      const c = p.call || {};
      const table = c.tableNo ? tableLabel(c) : t("A table");
      if (p.event === "waiter_call:new") {
        return { kind: "call", tone: "warn", icon: "call", toast: true,
          title: c.attempt === 2 ? t("{table} is calling again", { table }) : t("{table} is calling a waiter", { table }),
          sub: [c.orderNumber && t("Order {id}", { id: c.orderNumber }), c.customerName].filter(Boolean).join(" · "),
          go: { page: "tables" } };
      }
      if (c.status === "ACKNOWLEDGED" && c.acknowledgedBy?.name) {
        return { kind: "call", tone: "good", icon: "walk", toast: false,
          title: t("{name} is going to {table}", { name: c.acknowledgedBy.name, table }), sub: "", go: { page: "tables" } };
      }
      if (c.status === "RESOLVED") return { kind: "call", tone: "good", icon: "check", toast: false, title: t("{table} attended", { table }), sub: "", go: { page: "tables" } };
      return null;
    }
    case "inventory:alert": {
      const it = p.item || {};
      const lvl = { OUT_OF_STOCK: N_("Out of stock"), CRITICAL: N_("Critical"), LOW: N_("Low stock") }[p.level];
      if (!lvl) return null;
      return { kind: "system", tone: p.level === "LOW" ? "warn" : "bad", icon: "box", toast: p.level !== "LOW",
        title: `${it.name || t("Stock item")} · ${t(lvl)}`, sub: it.currentStock != null ? t("{n} {unit} left", { n: it.currentStock, unit: it.unit || "" }) : "",
        go: { page: "inventory" } };
    }
    case "kot:status_changed":
    case "bill:status_changed": {
      if (p.status !== "FAILED") return null;
      const isKot = event === "kot:status_changed";
      return { kind: "system", tone: "bad", icon: "printer", sound: true, toast: true,
        title: isKot ? t("KOT didn't print") : t("Bill didn't print"),
        sub: [p.job?.orderId, p.job?.lastError].filter(Boolean).join(" · "), go: { page: "profile" } };
    }
    case "table:freed":
      return { kind: "system", tone: "good", icon: "table", toast: false,
        title: t("Table {n} is free", { n: p.tableNo }), sub: p.suggestedEntry?.guestName ? t("Next in queue: {name}", { name: p.suggestedEntry.guestName }) : "",
        go: { page: "tables" } };
    default:
      return null;
  }
};

/** Only what describe() reads — the panel stores this, not whole orders, and
 * describes it at render so entries follow a language switch. */
export const slim = (event, p = {}) => {
  const o = p.order;
  return {
    event,
    order: o ? { _id: o._id, orderId: o.orderId, tableNo: o.tableNo, orderType: o.orderType, status: o.status, billStatus: o.billStatus, paymentStatus: o.paymentStatus } : undefined,
    reason: p.reason, modified: p.modified,
    event2: p.event,
    call: p.call ? { tableNo: p.call.tableNo, attempt: p.call.attempt, status: p.call.status, orderNumber: p.call.orderNumber, customerName: p.call.customerName, acknowledgedBy: p.call.acknowledgedBy } : undefined,
    item: p.item ? { name: p.item.name, currentStock: p.item.currentStock, unit: p.item.unit } : undefined,
    level: p.level, status: p.status,
    job: p.job ? { orderId: p.job.orderId, lastError: p.job.lastError } : undefined,
    tableNo: p.tableNo, suggestedEntry: p.suggestedEntry ? { guestName: p.suggestedEntry.guestName } : undefined,
  };
};
export const describeSlim = (s) => describe(s.event, { ...s, event: s.event2 });

export const EVENTS = [
  "order:new", "order:confirmed", "order:status_changed", "order:cancelled", "order:payment_changed",
  "order:needs_attention", "waiter_call:activity", "inventory:alert", "kot:status_changed", "bill:status_changed",
  "table:freed",
];

// ── persistence (per browser tab — survives a refresh / language switch) ────
const KEY = "khoaiNotifications";
const MAX = 60;
export const loadFeed = () => {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY));
    return Array.isArray(v?.items) ? { items: v.items.slice(0, MAX), seenAt: v.seenAt || 0 } : { items: [], seenAt: 0 };
  } catch { return { items: [], seenAt: 0 }; }
};
export const saveFeed = (feed) => {
  try { sessionStorage.setItem(KEY, JSON.stringify({ items: feed.items.slice(0, MAX), seenAt: feed.seenAt })); } catch { /* storage off */ }
};
export const addEntry = (feed, entry) => ({ ...feed, items: [entry, ...feed.items].slice(0, MAX) });
export const unreadCount = (feed) => feed.items.filter((i) => i.at > feed.seenAt).length;
