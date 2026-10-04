// src/pages/admin/invoices/model.js
// Pure helpers for the Invoices page. Every amount comes straight from the
// order document (subtotal / discount / serviceCharge / tax / total are
// calculated once by the server — utils/pricing.js); nothing here re-prices a
// bill. Canonical enums: restaurant-server/utils/orderStateMachine.js.
import { t, N_, fmtNum, fmtDate, fmtTime, localName } from "../../../i18n/core.js";

/** BIL-02: is the bill settled? (Orders from before billStatus: COMPLETED ⇒ settled.) */
export const isSettled = (o) => (o.billStatus ? o.billStatus === "SETTLED" : o.status === "COMPLETED");
/**
 * A billable order: settled, paid, or served (DELIVERED — the guests have
 * eaten and the bill is waiting to be settled). Cancelled ones are isVoid.
 */
export const isInvoice = (o) => o.status !== "CANCELLED" && (isSettled(o) || o.paymentStatus === "PAID" || o.status === "DELIVERED");
/** Paid but the bill is still open — one tap settles it (completes it if served). */
export const needsSettle = (o) => o.status !== "CANCELLED" && o.paymentStatus === "PAID" && !isSettled(o);
/**
 * Cancelled orders — shown, but never counted as billed or received. This
 * includes a cancelled order that had been marked PAID: the system has no
 * separate refund state (a refund IS a cancellation), and the backend's
 * revenue rule (insightsService.revenueOrderMatch: PAID and not CANCELLED)
 * leaves it out too, so Invoices and Insights agree.
 */
export const isVoid = (o) => o.status === "CANCELLED";
/** A cancelled order that had been marked paid (money to hand back, if not already). */
export const wasPaidVoid = (o) => isVoid(o) && o.paymentStatus === "PAID";
/**
 * Not billed yet: an unpaid order still in the kitchen or on the table.
 * Pay-first orders still AWAITING_PAYMENT are left out — they aren't on the
 * floor yet and are cancelled automatically if never paid.
 */
export const isNotBilledYet = (o) => !isInvoice(o) && !isVoid(o) && o.status !== "AWAITING_PAYMENT";

/**
 * Bill state from real fields:
 *   paid      paymentStatus PAID
 *   checkUpi  not yet PAID and the customer chose Online (UPI) — the system
 *             never trusts an opened UPI app, so staff must confirm it
 *   unpaid    not yet PAID, cash (or a failed gateway attempt)
 *   cancelled order CANCELLED and never paid
 */
export const billState = (o) => {
  if (isVoid(o)) return "cancelled";
  if (o.paymentStatus === "PAID") return "paid";
  if (o.paymentMethod === "Online" && o.paymentStatus !== "FAILED") return "checkUpi";
  return "unpaid";
};

export const custName = (o) => o.guestName || o.user?.name || "";
export const custPhone = (o) => o.guestPhone || o.user?.phone || "";
// Stored amounts shown as stored (paise kept, e.g. GST ₹11.34) — never rounded to rupees.
export const money = (n) => `₹${fmtNum(Number(n) || 0, { maximumFractionDigits: 2 })}`;
export const lineTotal = (it) => (Number(it.price) || 0) * (Number(it.qty) || 0);

/** Summary-strip totals for a list (pure). Billed = Received + To collect + Check UPI. */
export const totalsOf = (list) => {
  const o = { count: 0, billed: 0, cash: 0, online: 0, toCollect: 0, toCollectN: 0, checkUpi: 0, checkUpiN: 0, discount: 0, discountN: 0, cancelled: 0, cancelledN: 0, paidN: 0 };
  for (const b of list) {
    const total = Number(b.total) || 0;
    const st = billState(b);
    if (st === "cancelled") { o.cancelled += total; o.cancelledN += 1; continue; }
    o.count += 1;
    o.billed += total;
    if (b.discount > 0) { o.discount += Number(b.discount); o.discountN += 1; }
    if (st === "paid") { o.paidN += 1; if (b.paymentMethod === "Online") o.online += total; else o.cash += total; }
    else if (st === "checkUpi") { o.checkUpi += total; o.checkUpiN += 1; }
    else { o.toCollect += total; o.toCollectN += 1; }
  }
  return o;
};

const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; };

/** Newest-first rows grouped by calendar day: [{ key, date, rows, totals }]. */
export const groupByDay = (rows) => {
  const groups = [];
  let cur = null;
  for (const r of rows) {
    const k = dayKey(r.createdAt);
    if (!cur || cur.key !== k) { cur = { key: k, date: new Date(r.createdAt), rows: [] }; groups.push(cur); }
    cur.rows.push(r);
  }
  return groups.map((g) => ({ ...g, totals: totalsOf(g.rows) }));
};

/** Whole days since the bill (0 = today). */
export const daysOld = (d) => {
  const a = new Date(d); a.setHours(0, 0, 0, 0);
  const b = new Date(); b.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((b - a) / 864e5));
};

/** Local-midnight period bounds for the presets. */
export const periodRange = (key) => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  if (key === "yesterday") { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
  if (key === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
  if (key === "month") start.setDate(1);
  if (key === "lastMonth") { start.setDate(1); start.setMonth(start.getMonth() - 1); end.setDate(0); } // whole previous month
  return { from: start, to: end };
};

export const ymd = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

/** Plain-text bill for WhatsApp — the stored figures, line by line. */
export const billText = (o, restaurantName) => {
  const lines = [];
  if (restaurantName) lines.push(`*${restaurantName}*`);
  lines.push(`${t("Invoice")} ${o.orderId} · ${fmtDate(o.createdAt, { day: "2-digit", month: "2-digit", year: "numeric" })} ${fmtTime(o.createdAt)}`);
  lines.push("");
  for (const it of o.items || []) lines.push(`${fmtNum(it.qty)} × ${localName(it)} — ${money(lineTotal(it))}`);
  lines.push("");
  lines.push(`${t("Subtotal")}: ${money(o.subtotal)}`);
  if (o.discount > 0) lines.push(`${t("Discount")}${o.coupon?.code ? ` (${o.coupon.code})` : ""}: −${money(o.discount)}`);
  if (o.serviceCharge > 0) lines.push(`${t("Service charge")}: ${money(o.serviceCharge)}`);
  if (o.tax > 0) lines.push(`${t("GST")}: ${money(o.tax)}`);
  lines.push(`*${t("Total")}: ${money(o.total)}*`);
  lines.push(o.paymentStatus === "PAID" ? `${t("Paid")} · ${t(o.paymentMethod === "Online" ? "Online" : "Cash")}` : t("Payment pending"));
  return lines.join("\n");
};

/** wa.me link — to the customer's number when we have it, else pick a contact. */
export const waLink = (phone, text) =>
  `https://wa.me/${phone ? `91${String(phone).replace(/\D/g, "").slice(-10)}` : ""}?text=${encodeURIComponent(text)}`;

/** CSV for the accountant — one row per invoice, stored figures only. */
export const toCsv = (rows) => {
  const head = ["Invoice no.", "Date", "Time", "Customer", "Phone", "Type", "Table", "Items", "Subtotal", "Discount", "Coupon", "Service charge", "GST", "Total", "Payment status", "Payment method", "Order status"];
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const out = [head.join(",")];
  for (const o of rows) {
    const d = new Date(o.createdAt);
    out.push([
      o.orderId, ymd(d), `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
      custName(o), custPhone(o), o.orderType, o.tableNo ?? "",
      (o.items || []).map((i) => `${i.qty}x ${i.name}`).join("; "),
      o.subtotal ?? 0, o.discount ?? 0, o.coupon?.code || "", o.serviceCharge ?? 0, o.tax ?? 0, o.total ?? 0,
      o.paymentStatus, o.paymentMethod, o.status,
    ].map(esc).join(","));
  }
  return out.join("\r\n");
};

/** Close-the-day CSV: the day's totals on top, then every bill of the day. */
export const closeDayCsv = (bills, notBilled, date = new Date()) => {
  const o = totalsOf(bills);
  const notBilledAmt = notBilled.reduce((s, b) => s + (Number(b.total) || 0), 0);
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const summary = [
    ["Day close", ymd(date)],
    ["Invoices", o.count],
    ["Billed", o.billed],
    ["Cash received", o.cash],
    ["Online received", o.online],
    ["To collect", o.toCollect],
    ["UPI to check", o.checkUpi],
    ["Discounts", o.discount],
    ["Cancelled", o.cancelled],
    ["Orders not billed yet", `${notBilled.length} (${notBilledAmt})`],
    [],
  ].map((r) => r.map(esc).join(","));
  return [...summary, toCsv([...bills, ...notBilled])].join("\r\n");
};

export const downloadText = (filename, text, type = "text/csv;charset=utf-8") => {
  const blob = new Blob(["﻿" + text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const TYPE_LABEL = { DINE_IN: N_("Dine-in"), TAKEAWAY: N_("Takeaway"), ONLINE: N_("Online") };
export const tableLabel = (o) => (o.tableNo ? t("T{n}", { n: fmtNum(o.tableNo) }) : t(TYPE_LABEL[o.orderType] || o.orderType || "—"));

/** "PDF": print only the bill (body.inv-printing hides the app) → Save as PDF. */
export const printPdf = () => {
  document.body.classList.add("inv-printing");
  const done = () => { document.body.classList.remove("inv-printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => window.print(), 50);
};
