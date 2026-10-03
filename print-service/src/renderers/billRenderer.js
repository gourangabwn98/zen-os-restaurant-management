// src/renderers/billRenderer.js
// ─────────────────────────────────────────────────────────────────────────────
// BILL / TAX INVOICE layout. Prints only values the backend already put on
// the job (restaurant-server printBill → BillPrintJob.payload): nothing is
// recalculated here except each line's qty × price, which is how the order's
// own subtotal is made. Pricing rows (discount, GST, service charge) appear
// only when the order actually has them.
//
// `opts`:
//   logo   – receipt bitmap (src/logo.js), printed above the name
//   header – { name, address, city, phone } from the restaurant profile
//            (src/restaurantProfile.js); payload.restaurantName wins for the name
//   width  – characters per line of the target printer (layout.js)
//   footer – "powered by" line under the thank-you
//   payQr  – { bitmap, upiId?, amount? } from src/payQr.js: "Scan & Pay" QR
//            above the thank-you (only ever passed for unpaid bills)
// ─────────────────────────────────────────────────────────────────────────────
import {
  DEFAULT_WIDTH, separator, centered, keyValue, billItemHeader, billItemRows, amountWidth,
  money, dateTime, orderTypeLabel, paymentStatusLabel, restaurantHeader, toPrintable,
} from "./layout.js";

export const renderBill = (job, { logo = null, header = null, width = DEFAULT_WIDTH, footer = "", payQr = null } = {}) => {
  const p = job.payload || job.data?.payload || job.data || {};
  const W = width;
  const lines = [];
  const kv = (label, value, o) => lines.push(...keyValue(label, value, W, o));

  // ── Restaurant header ──
  if (logo) lines.push({ type: "image", bitmap: logo });
  lines.push(...restaurantHeader({ ...header, name: p.restaurantName || header?.name }, W));

  // Combined bill (restaurant-server combinedBillService): several orders of
  // one table on ONE bill — same layout, items grouped under each order.
  const combined = p.combined === true && Array.isArray(p.orders) && p.orders.length > 0;

  lines.push(separator(W));
  lines.push({ text: "TAX INVOICE", bold: true, align: "center" });
  if (combined) lines.push({ text: `COMBINED BILL - ${p.orders.length} ORDERS`, bold: true, align: "center" });
  lines.push(separator(W));

  // ── Order details ──
  const orderType = p.orderType || job.orderType;
  const tableNo = p.tableNo ?? job.tableNo;
  const { date, time } = dateTime(p.createdAt || job.createdAt);
  if (combined) kv("Orders", p.orders.map((o) => o.orderId).join(", "));
  else kv("Bill No", p.orderId || job.orderId || "-");
  kv("Type", orderTypeLabel(orderType));
  if (tableNo !== null && tableNo !== undefined && tableNo !== "") kv("Table", String(tableNo));
  kv("Date", date);
  kv("Time", time);
  const status = paymentStatusLabel(p.paymentStatus);
  if (combined && p.paymentStatus !== "PAID") kv("Payment", status || "Pending");
  else kv("Payment", `${toPrintable(p.paymentMethod || "Cash")}${status ? ` (${status})` : ""}`);
  if (toPrintable(p.guestName)) kv("Customer", p.guestName);
  if (toPrintable(p.guestPhone)) kv("Phone", p.guestPhone);

  // ── Items ──
  lines.push(separator(W));
  const toRows = (items) => (items || []).map((it) => ({ ...it, amt: money((Number(it.price) || 0) * (Number(it.qty) || 0)) }));
  const groups = combined
    ? p.orders.map((o) => ({ title: `Order ${o.orderId}${o.paymentStatus === "PAID" ? " (paid)" : ""}`, rows: toRows(o.items) }))
    : [{ title: null, rows: toRows(p.items) }];
  const amtW = amountWidth(groups.flatMap((g) => g.rows.map((r) => r.amt)));
  lines.push(billItemHeader(W, amtW));
  lines.push(separator(W));
  for (const g of groups) {
    if (g.title) lines.push({ text: g.title, bold: true });
    for (const r of g.rows) lines.push(...billItemRows(r.name, r.qty, r.amt, W, amtW));
  }
  lines.push(separator(W));

  // ── Totals — the order's own figures, only the ones it has ──
  const t = { labelWidth: 13 };
  kv("Subtotal", money(p.subtotal), t);
  if (p.discount) kv("Discount", `${p.couponCode ? `(${p.couponCode}) ` : ""}${money(-p.discount)}`, t);
  if (p.tax) kv("GST", money(p.tax), t);
  if (p.serviceCharge) kv("Service Chg", money(p.serviceCharge), t);
  lines.push(separator(W));
  kv("TOTAL", money(p.total), { ...t, bold: true });
  // Part of a combined bill already paid → show what is still to pay.
  if (combined && p.paymentStatus !== "PAID" && Number(p.dueTotal) > 0 && Number(p.dueTotal) !== Number(p.total))
    kv("DUE NOW", money(p.dueTotal), { ...t, bold: true });
  lines.push(separator(W));

  // ── Scan & Pay ──
  if (payQr?.bitmap) {
    lines.push({ text: payQr.upiId ? "Scan & Pay (UPI)" : "Scan & Pay", bold: true, align: "center" });
    lines.push({ type: "image", bitmap: payQr.bitmap, label: "payment QR" });
    if (payQr.upiId) lines.push(...centered(`UPI: ${payQr.upiId}`, W));
    if (payQr.amount) lines.push(...centered(`Amount: ${money(payQr.amount)}`, W, { bold: true }));
    lines.push(separator(W));
  }

  // ── Footer ──
  lines.push(...centered("Thank you! Visit again :)", W));
  if (toPrintable(footer)) lines.push(...centered(footer, W));
  lines.push({ type: "feed" });
  lines.push({ type: "cut" });
  return lines;
};
