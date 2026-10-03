// src/pages/admin/invoices/reports.js
// ─────────────────────────────────────────────────────────────────────────────
// "For your accountant" reports on the Invoices page. Pure builders over the
// orders the page already loaded — every amount is the order's stored figure
// (subtotal / discount / serviceCharge / tax / total); nothing is re-priced.
// Same rules as the page (model.js): a bill = COMPLETED or PAID; cancelled
// bills are listed but never counted as billed or received.
//
// The documents are in English on purpose (like the old CSV export): they go
// to a CA, a bank or accounting software, not to the admin's screen.
//   Excel → xlsx.js (real .xlsx, no library)
//   PDF   → a print-ready page in a hidden frame → the browser's "Save as PDF"
// ─────────────────────────────────────────────────────────────────────────────
import { billState, custName, custPhone, totalsOf, ymd, daysOld, isInvoice, isVoid } from "./model.js";
import { buildXlsx } from "./xlsx.js";

// ── formatting (fixed English / Indian grouping, independent of UI language) ─
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const inr = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const dayLabel = (d) => new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
const hhmm = (d) => { const x = new Date(d); return `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
const esc = (s) => String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
export const periodLabel = (range) => (ymd(range.from) === ymd(range.to) ? dmy(range.from) : `${dmy(range.from)} – ${dmy(range.to)}`);

const STATUS_TEXT = { paid: "Paid", unpaid: "Unpaid", checkUpi: "UPI to check", cancelled: "Cancelled" };
const METHOD_TEXT = (o) => (o.paymentStatus === "PAID" ? (o.paymentMethod === "Online" ? "UPI / Online" : "Cash") : "");
const TYPE_TEXT = { DINE_IN: "Dine-in", TAKEAWAY: "Takeaway", ONLINE: "Online" };

/** Bills of the period, oldest first (cancelled included, flagged). */
export const billsOf = (orders) => (orders || [])
  .filter((o) => isInvoice(o) || isVoid(o))
  .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

/** One entry per calendar day that has bills, oldest first. */
export const dailyRows = (bills) => {
  const map = new Map();
  for (const o of bills) {
    const k = ymd(o.createdAt);
    if (!map.has(k)) map.set(k, { key: k, date: new Date(o.createdAt), list: [] });
    map.get(k).list.push(o);
  }
  return [...map.values()].map((d) => {
    const live = d.list.filter((o) => !isVoid(o));
    const sum = (f) => r2(live.reduce((s, o) => s + (Number(o[f]) || 0), 0));
    const tt = totalsOf(d.list);
    return {
      ...d, bills: tt.count, subtotal: sum("subtotal"), discount: sum("discount"), serviceCharge: sum("serviceCharge"),
      tax: sum("tax"), billed: r2(tt.billed), cash: r2(tt.cash), online: r2(tt.online),
      toCollect: r2(tt.toCollect + tt.checkUpi), cancelled: r2(tt.cancelled), cancelledN: tt.cancelledN,
    };
  });
};
const sumRows = (rows, f) => r2(rows.reduce((s, r) => s + (r[f] || 0), 0));

// ═══════════════════════════ Excel ══════════════════════════════════════════
/** Sales register: every bill (sheet 1) and every item line (sheet 2). */
export const salesRegisterXlsx = (orders, range, profile) => {
  const bills = billsOf(orders);
  const live = bills.filter((o) => !isVoid(o));
  const sum = (f) => r2(live.reduce((s, o) => s + (Number(o[f]) || 0), 0));
  const billRows = bills.map((o) => [
    o.orderId, ymd(o.createdAt), hhmm(o.createdAt), custName(o), custPhone(o), TYPE_TEXT[o.orderType] || o.orderType || "",
    o.tableNo ?? "", (o.items || []).map((i) => `${i.qty} x ${i.name}`).join("; "),
    r2(o.subtotal), r2(o.discount), o.coupon?.code || "", r2(o.serviceCharge), r2(o.tax), r2(o.total),
    STATUS_TEXT[billState(o)], METHOD_TEXT(o),
  ]);
  billRows.push([{ bold: true }, "TOTAL (excl. cancelled)", "", "", "", "", "", "", `${live.length} bills`,
    sum("subtotal"), sum("discount"), "", sum("serviceCharge"), sum("tax"), sum("total"), "", ""]);

  const itemRows = [];
  for (const o of bills) {
    for (const it of o.items || []) {
      itemRows.push([o.orderId, ymd(o.createdAt), it.name, Number(it.qty) || 0, r2(it.price), r2((Number(it.price) || 0) * (Number(it.qty) || 0)),
        isVoid(o) ? "Cancelled" : ""]);
    }
  }
  const tt = totalsOf(bills);
  const info = [
    ["Restaurant", profile?.restaurantName || ""],
    ["GSTIN", profile?.gstNumber || ""],
    ["Period", periodLabel(range)],
    ["Bills (excl. cancelled)", String(tt.count)],
    ["Gross (before discount)", sum("subtotal")],
    ["Discounts", sum("discount")],
    ["Service charge", sum("serviceCharge")],
    ["GST collected", sum("tax")],
    ["Total billed", r2(tt.billed)],
    ["Received in cash", r2(tt.cash)],
    ["Received by UPI / online", r2(tt.online)],
    ["Not yet received", r2(tt.toCollect + tt.checkUpi)],
    ["Cancelled bills", `${tt.cancelledN} (${inr(tt.cancelled)})`],
    ["Prepared on", dmy(new Date())],
  ];
  return buildXlsx([
    {
      name: "Bills",
      columns: [
        { header: "Invoice no.", width: 16 }, { header: "Date", width: 11 }, { header: "Time", width: 7 },
        { header: "Customer", width: 18 }, { header: "Phone", width: 13 }, { header: "Type", width: 10 },
        { header: "Table", width: 7 }, { header: "Items", width: 48 },
        { header: "Subtotal", width: 11, money: true }, { header: "Discount", width: 10, money: true },
        { header: "Coupon", width: 10 }, { header: "Service charge", width: 13, money: true },
        { header: "GST", width: 10, money: true }, { header: "Total", width: 12, money: true },
        { header: "Status", width: 12 }, { header: "Paid by", width: 13 },
      ],
      rows: billRows,
    },
    {
      name: "Items",
      columns: [
        { header: "Invoice no.", width: 16 }, { header: "Date", width: 11 }, { header: "Item", width: 30 },
        { header: "Qty", width: 6 }, { header: "Rate", width: 10, money: true }, { header: "Amount", width: 12, money: true },
        { header: "Note", width: 11 },
      ],
      rows: itemRows,
    },
    { name: "Summary", columns: [{ header: "Sales register", width: 26 }, { header: "", width: 26, money: true }], rows: info },
  ]);
};

/** Payments by method: cash vs UPI per day, plus every received payment. */
export const paymentsXlsx = (orders, range, profile) => {
  const bills = billsOf(orders);
  const days = dailyRows(bills);
  const dayRows = days.map((d) => [d.key, r2(d.cash), r2(d.online), r2(d.cash + d.online), r2(d.toCollect)]);
  dayRows.push([{ bold: true }, "TOTAL", sumRows(days, "cash"), sumRows(days, "online"),
    r2(sumRows(days, "cash") + sumRows(days, "online")), sumRows(days, "toCollect")]);
  const paid = bills.filter((o) => billState(o) === "paid");
  const payRows = paid.map((o) => [o.orderId, ymd(o.createdAt), hhmm(o.createdAt), METHOD_TEXT(o),
    o.payment?.phonepeTransactionId || o.payment?.merchantTransactionId || "", r2(o.total)]);
  return buildXlsx([
    {
      name: "By day",
      columns: [
        { header: "Date", width: 12 }, { header: "Cash", width: 13, money: true }, { header: "UPI / Online", width: 13, money: true },
        { header: "Total received", width: 15, money: true }, { header: "Not yet received", width: 16, money: true },
      ],
      rows: dayRows,
    },
    {
      name: "Payments",
      columns: [
        { header: "Invoice no.", width: 16 }, { header: "Date", width: 11 }, { header: "Time", width: 7 },
        { header: "Method", width: 13 }, { header: "Gateway ref.", width: 24 }, { header: "Amount", width: 12, money: true },
      ],
      rows: payRows,
    },
    {
      name: "Summary",
      columns: [{ header: "Payments by method", width: 24 }, { header: "", width: 22, money: true }],
      rows: [
        ["Restaurant", profile?.restaurantName || ""], ["Period", periodLabel(range)],
        ["Cash", sumRows(days, "cash")], ["UPI / Online", sumRows(days, "online")],
        ["Total received", r2(sumRows(days, "cash") + sumRows(days, "online"))],
        ["Not yet received", sumRows(days, "toCollect")],
      ],
    },
  ]);
};

// ═══════════════════════════ PDF (print) ════════════════════════════════════
const DOC_CSS = `
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.45 "Segoe UI", Arial, sans-serif; color: #111; margin: 0; }
  .lh { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
  .lh h1 { font-size: 18px; margin: 0 0 2px; }
  .lh .meta { color: #444; font-size: 10.5px; }
  .lh .doc { text-align: right; }
  .lh .doc b { display: block; font-size: 14px; }
  h2 { font-size: 12.5px; margin: 16px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 4px 6px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
  th { font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em; color: #555; border-bottom: 1.5px solid #111; }
  .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.tot td { font-weight: 700; border-top: 1.5px solid #111; border-bottom: 0; }
  .kv { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 6px 0 4px; }
  .kv div { border: 1px solid #ddd; border-radius: 6px; padding: 6px 8px; }
  .kv span { display: block; color: #555; font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em; }
  .kv b { font-size: 13px; }
  .muted { color: #666; }
  .warn { color: #a15c00; }
  .foot { margin-top: 22px; display: flex; justify-content: space-between; color: #555; font-size: 10px; }
  .sign { margin-top: 36px; text-align: right; }
  .sign div { display: inline-block; border-top: 1px solid #111; padding-top: 4px; min-width: 200px; text-align: center; }
`;

const letterhead = (profile, docTitle, sub) => {
  const p = profile || {};
  const addr = [p.address, p.city].filter(Boolean).join(", ");
  const ids = [p.gstNumber && `GSTIN ${p.gstNumber}`, p.fssaiNumber && `FSSAI ${p.fssaiNumber}`].filter(Boolean).join(" · ");
  const contact = [p.phone && `Ph ${p.phone}`, p.email].filter(Boolean).join(" · ");
  return `<div class="lh"><div><h1>${esc(p.restaurantName || "Restaurant")}</h1>
    ${addr ? `<div class="meta">${esc(addr)}</div>` : ""}${contact ? `<div class="meta">${esc(contact)}</div>` : ""}${ids ? `<div class="meta">${esc(ids)}</div>` : ""}</div>
    <div class="doc"><b>${esc(docTitle)}</b><div class="meta">${esc(sub)}</div></div></div>`;
};
const footer = () => `<div class="foot"><span>Prepared on ${esc(dmy(new Date()))} ${esc(hhmm(new Date()))} from the restaurant's billing system.</span><span>Amounts in Indian Rupees (₹)</span></div>`;

/** Opens the browser's print dialog for a standalone document (Save as PDF). */
export const printDocument = (title, bodyHtml) => {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${DOC_CSS}</style></head><body>${bodyHtml}</body></html>`);
  doc.close();
  const win = frame.contentWindow;
  const cleanup = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener("afterprint", cleanup);
  setTimeout(() => {
    try { win.focus(); win.print(); } finally { setTimeout(() => frame.isConnected && frame.remove(), 60_000); }
  }, 150);
};

const dayTable = (days, { withTax = true } = {}) => {
  const head = `<tr><th>Date</th><th class="r">Bills</th><th class="r">Gross</th><th class="r">Discount</th>${withTax ? '<th class="r">GST</th>' : ""}
    <th class="r">Billed</th><th class="r">Cash</th><th class="r">UPI / Online</th><th class="r">Not received</th><th class="r">Cancelled</th></tr>`;
  const body = days.map((d) => `<tr><td>${esc(dayLabel(d.date))}</td><td class="r">${d.bills}</td><td class="r">${inr(d.subtotal)}</td>
    <td class="r">${d.discount ? inr(d.discount) : "—"}</td>${withTax ? `<td class="r">${inr(d.tax)}</td>` : ""}<td class="r"><b>${inr(d.billed)}</b></td>
    <td class="r">${inr(d.cash)}</td><td class="r">${inr(d.online)}</td><td class="r${d.toCollect ? " warn" : ""}">${d.toCollect ? inr(d.toCollect) : "—"}</td>
    <td class="r muted">${d.cancelledN ? `${d.cancelledN} · ${inr(d.cancelled)}` : "—"}</td></tr>`).join("");
  const n = days.reduce((s, d) => s + d.bills, 0);
  const cn = days.reduce((s, d) => s + d.cancelledN, 0);
  const tot = `<tr class="tot"><td>Total</td><td class="r">${n}</td><td class="r">${inr(sumRows(days, "subtotal"))}</td><td class="r">${inr(sumRows(days, "discount"))}</td>
    ${withTax ? `<td class="r">${inr(sumRows(days, "tax"))}</td>` : ""}<td class="r">${inr(sumRows(days, "billed"))}</td><td class="r">${inr(sumRows(days, "cash"))}</td>
    <td class="r">${inr(sumRows(days, "online"))}</td><td class="r">${inr(sumRows(days, "toCollect"))}</td><td class="r">${cn ? `${cn} · ${inr(sumRows(days, "cancelled"))}` : "—"}</td></tr>`;
  return `<table><thead>${head}</thead><tbody>${body}${tot}</tbody></table>`;
};

/** Day-by-day summary — one line per day. */
export const printDaySummary = (orders, range, profile) => {
  const days = dailyRows(billsOf(orders));
  const html = letterhead(profile, "Day-by-day sales summary", periodLabel(range))
    + (days.length ? dayTable(days) : `<p class="muted">No bills in this period.</p>`)
    + `<p class="muted" style="margin-top:8px">Gross = before discount. Billed = total of the bills (after discount, with service charge and GST). Cancelled bills are not counted in any total.</p>`
    + footer();
  printDocument(`Day summary ${ymd(range.from)} to ${ymd(range.to)}`, html);
};

/** Dues list — who owes what, how old (oldest first). */
export const printDuesList = (dues, profile) => {
  const open = (dues || []).filter((o) => ["unpaid", "checkUpi"].includes(billState(o)))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const total = r2(open.reduce((s, o) => s + (Number(o.total) || 0), 0));
  const bucket = (lo, hi) => open.filter((o) => { const a = daysOld(o.createdAt); return a >= lo && a <= hi; });
  const buckets = [["0–7 days", bucket(0, 7)], ["8–30 days", bucket(8, 30)], ["Over 30 days", bucket(31, 1e9)]];
  // Group by customer (phone, else name; walk-in guests stay separate bills).
  const byCust = new Map();
  for (const o of open) {
    const key = custPhone(o) || custName(o) || `__${o._id}`;
    if (!byCust.has(key)) byCust.set(key, { name: custName(o) || "Walk-in guest", phone: custPhone(o), list: [] });
    byCust.get(key).list.push(o);
  }
  const cust = [...byCust.values()].map((c) => ({ ...c, amount: r2(c.list.reduce((s, o) => s + (Number(o.total) || 0), 0)), oldest: Math.max(...c.list.map((o) => daysOld(o.createdAt))) }))
    .sort((a, b) => b.amount - a.amount);

  const html = letterhead(profile, "Dues list", `As on ${dmy(new Date())}`)
    + `<div class="kv"><div><span>Total due</span><b>${inr(total)}</b></div><div><span>Unpaid bills</span><b>${open.length}</b></div><div><span>Customers</span><b>${cust.length}</b></div></div>`
    + `<div class="kv">${buckets.map(([l, list]) => `<div><span>${l}</span><b>${inr(list.reduce((s, o) => s + (Number(o.total) || 0), 0))}</b> <span style="display:inline">· ${list.length} bills</span></div>`).join("")}</div>`
    + `<h2>Who owes what</h2><table><thead><tr><th>Customer</th><th>Phone</th><th class="r">Bills</th><th class="r">Oldest</th><th class="r">Amount due</th></tr></thead><tbody>`
    + cust.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone ? `+91 ${c.phone}` : "—")}</td><td class="r">${c.list.length}</td><td class="r${c.oldest > 30 ? " warn" : ""}">${c.oldest} days</td><td class="r"><b>${inr(c.amount)}</b></td></tr>`).join("")
    + `<tr class="tot"><td colspan="4">Total</td><td class="r">${inr(total)}</td></tr></tbody></table>`
    + `<h2>Every unpaid bill (oldest first)</h2><table><thead><tr><th>Invoice no.</th><th>Date</th><th>Customer</th><th>Phone</th><th>Status</th><th class="r">Age</th><th class="r">Amount</th></tr></thead><tbody>`
    + open.map((o) => { const a = daysOld(o.createdAt); return `<tr><td>${esc(o.orderId)}</td><td>${esc(dmy(o.createdAt))}</td><td>${esc(custName(o) || "Walk-in guest")}</td><td>${esc(custPhone(o) || "—")}</td><td>${STATUS_TEXT[billState(o)]}</td><td class="r${a > 30 ? " warn" : ""}">${a} days</td><td class="r">${inr(o.total)}</td></tr>`; }).join("")
    + `</tbody></table>${open.length ? "" : `<p class="muted">Nothing is due. Every bill is paid.</p>`}`
    + `<p class="muted" style="margin-top:8px">“UPI to check” = the customer chose UPI but the payment has not been confirmed yet.</p>`
    + footer();
  printDocument(`Dues list ${ymd(new Date())}`, html);
};

/** Monthly sales statement for a bank / loan — letterhead, totals, day table, signature. */
export const printMonthlyStatement = (orders, monthKey, profile) => {
  const [y, m] = monthKey.split("-").map(Number);
  const from = new Date(y, m - 1, 1), to = new Date(y, m, 0, 23, 59, 59, 999);
  const monthName = from.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const bills = billsOf(orders);
  const days = dailyRows(bills);
  const tt = totalsOf(bills);
  const live = bills.filter((o) => !isVoid(o));
  const sum = (f) => r2(live.reduce((s, o) => s + (Number(o[f]) || 0), 0));
  const avg = tt.count ? r2(tt.billed / tt.count) : 0;
  const daysOpen = days.filter((d) => d.bills > 0).length;
  const html = letterhead(profile, "Monthly sales statement", `${monthName} (${dmy(from)} – ${dmy(to)})`)
    + `<div class="kv">
        <div><span>Total sales (billed)</span><b>${inr(tt.billed)}</b></div>
        <div><span>Received</span><b>${inr(tt.cash + tt.online)}</b></div>
        <div><span>Bills</span><b>${tt.count}</b></div>
        <div><span>Cash</span><b>${inr(tt.cash)}</b></div>
        <div><span>UPI / Online</span><b>${inr(tt.online)}</b></div>
        <div><span>Not yet received</span><b>${inr(tt.toCollect + tt.checkUpi)}</b></div>
        <div><span>Days with sales</span><b>${daysOpen}</b></div>
        <div><span>Average per day</span><b>${inr(daysOpen ? tt.billed / daysOpen : 0)}</b></div>
        <div><span>Average bill</span><b>${inr(avg)}</b></div>
      </div>`
    + `<h2>Breakdown</h2><table><tbody>
        <tr><td>Gross sales (before discount)</td><td class="r">${inr(sum("subtotal"))}</td></tr>
        <tr><td>Less: discounts</td><td class="r">− ${inr(sum("discount"))}</td></tr>
        <tr><td>Add: service charge</td><td class="r">${inr(sum("serviceCharge"))}</td></tr>
        <tr><td>Add: GST collected</td><td class="r">${inr(sum("tax"))}</td></tr>
        <tr class="tot"><td>Total sales (billed)</td><td class="r">${inr(tt.billed)}</td></tr>
        <tr><td class="muted">Cancelled bills (not included above)</td><td class="r muted">${tt.cancelledN} · ${inr(tt.cancelled)}</td></tr>
      </tbody></table>`
    + `<h2>Day by day</h2>${days.length ? dayTable(days) : `<p class="muted">No bills in this month.</p>`}`
    + `<div class="sign"><div>${esc(profile?.contactPerson || "Authorised signatory")}<br><span class="muted">For ${esc(profile?.restaurantName || "the restaurant")}</span></div></div>`
    + footer();
  printDocument(`Sales statement ${monthKey}`, html);
};

// ═══════════════════════════ Owner summary text ═════════════════════════════
export const ownerSummaryText = (orders, range, dues, profile) => {
  const bills = billsOf(orders);
  const tt = totalsOf(bills);
  const live = bills.filter((o) => !isVoid(o));
  const tax = r2(live.reduce((s, o) => s + (Number(o.tax) || 0), 0));
  const open = (dues || []).filter((o) => ["unpaid", "checkUpi"].includes(billState(o)));
  const dueAmt = open.reduce((s, o) => s + (Number(o.total) || 0), 0);
  return [
    `*${profile?.restaurantName || "Sales"} — accounts summary*`,
    `Period: ${periodLabel(range)}`,
    "",
    `Bills: ${tt.count}`,
    `Total billed: ${inr(tt.billed)}`,
    `Received — Cash: ${inr(tt.cash)} · UPI: ${inr(tt.online)}`,
    `Not yet received (this period): ${inr(tt.toCollect + tt.checkUpi)}`,
    `Discounts: ${inr(tt.discount)} · GST collected: ${inr(tax)}`,
    tt.cancelledN ? `Cancelled: ${tt.cancelledN} bills (${inr(tt.cancelled)})` : "",
    "",
    `All customer dues today: ${inr(dueAmt)} across ${open.length} bills`,
  ].filter((l, i, a) => l !== "" || (a[i - 1] !== "" && i > 0)).join("\n");
};
