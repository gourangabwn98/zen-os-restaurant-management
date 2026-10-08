// src/renderers/kotRenderer.js
// ─────────────────────────────────────────────────────────────────────────────
// KITCHEN ORDER TICKET layout. Never shows prices or totals — only what the
// kitchen needs. Data is the KOT job exactly as the backend sends it
// (KOTJob: orderId, orderType, tableNo, items[{name, qty, notes}],
// createdAt); `customerName` is printed only if a job carries one (KOTJob
// doesn't store it today).
//
// `opts`: header – { name, address, city, phone } (src/restaurantProfile.js)
//         width  – characters per line of the target printer (layout.js)
// ─────────────────────────────────────────────────────────────────────────────
import {
  DEFAULT_WIDTH, separator, centered, keyValue, kotItemRows, dateTime,
  orderTypeLabel, restaurantHeader, toPrintable, wrapText,
} from "./layout.js";

export const renderKot = (job, { header = null, width = DEFAULT_WIDTH } = {}) => {
  const d = { ...(job.data || {}), ...job };
  const W = width;
  const lines = [];
  const kv = (label, value) => lines.push(...keyValue(label, value, W));

  lines.push(...restaurantHeader(header, W));

  // An order-change slip (the order was edited after its KOT): only the
  // differences are listed; "CANCEL - …" lines mean stop making that.
  const changed = !!d.changed;
  lines.push(separator(W));
  lines.push({ text: changed ? "*** ORDER CHANGED ***" : "*** KITCHEN ORDER TICKET ***", bold: true, align: "center" });
  if (changed) lines.push({ text: "Only the changes below", align: "center" });
  lines.push(separator(W));

  const customer = d.customerName || d.guestName;
  if (toPrintable(customer)) kv("Customer", customer);
  kv("Order ID", d.orderId || "-");
  kv("Type", orderTypeLabel(d.orderType, d.diningArea));
  // Table numbers are per area ("Indoor-AC 1" → Type: Indoor-AC, Table: 1);
  // older jobs without one print the table number as before.
  const tableShown = d.tableDisplayNo ?? d.tableNo;
  if (tableShown !== null && tableShown !== undefined && tableShown !== "") kv("Table", String(tableShown));
  const { date, time } = dateTime(d.createdAt);
  kv("Date", date);
  kv("Time", time);

  lines.push(separator(W));
  lines.push({ text: "ITEMS", bold: true, align: "center" });
  lines.push(separator(W));

  const items = d.items || [];
  for (const it of items) {
    lines.push(...kotItemRows(it.name, it.qty, W));
    // KH-12: add-ons under the item ("+ 1 pc Chicken"), so the cook sees them.
    for (const a of it.addons || []) {
      const name = typeof a === "string" ? a : a?.name;
      if (toPrintable(name)) for (const n of wrapText(`+ ${name}`, W - 2)) lines.push({ text: `  ${n}`, bold: true });
    }
    if (toPrintable(it.notes)) {
      for (const n of wrapText(`Note: ${it.notes}`, W - 2)) lines.push({ text: `  ${n}` });
    }
  }

  // The whole order's note, after the items so the cook reads it last.
  if (toPrintable(d.notes)) {
    lines.push(separator(W));
    for (const n of wrapText(`ORDER NOTE: ${d.notes}`, W)) lines.push({ text: n, bold: true });
  }

  lines.push(separator(W));
  lines.push({ text: `Total Items: ${items.reduce((s, i) => s + (Number(i.qty) || 0), 0)}`, bold: true, align: "right" });
  lines.push({ type: "feed" });
  lines.push({ text: changed ? "[ KOT CHANGE ]" : "[ KOT ]", bold: true, align: "center" }); // KH-14 (was "[ KITCHEN COPY ]")
  lines.push({ type: "feed" });
  lines.push({ type: "cut" });
  return lines;
};
