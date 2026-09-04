// src/renderers/kotRenderer.js
// Converts a KOT job payload into printer-agnostic "lines" that any driver
// (real or mock) knows how to render.
export const renderKot = (job) => {
  const lines = [];
  lines.push({ text: "KITCHEN ORDER TICKET", bold: true, align: "center", size: "large" });
  lines.push({ type: "feed" });
  lines.push({ text: `Order: ${job.orderId || job.data?.orderId || "-"}`, bold: true });
  lines.push({ text: `Type: ${job.orderType || job.data?.orderType || "-"}` });
  if (job.tableNo || job.data?.tableNo) {
    lines.push({ text: `Table: ${job.tableNo || job.data?.tableNo}`, bold: true });
  }
  lines.push({ text: new Date().toLocaleString() });
  lines.push({ text: "--------------------------------" });

  const items = job.items || job.data?.items || [];
  for (const it of items) {
    lines.push({ text: `${it.qty} x ${it.name}`, bold: true });
    if (it.notes) lines.push({ text: `   note: ${it.notes}` });
  }

  lines.push({ text: "--------------------------------" });
  lines.push({ text: `Items: ${items.reduce((s, i) => s + (i.qty || 0), 0)}`, align: "right" });
  lines.push({ type: "feed" });
  lines.push({ type: "cut" });
  return lines;
};
