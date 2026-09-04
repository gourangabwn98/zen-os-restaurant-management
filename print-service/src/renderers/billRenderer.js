// src/renderers/billRenderer.js
export const renderBill = (job) => {
  const p = job.payload || job.data?.payload || job.data || {};
  const lines = [];
  lines.push({ text: p.restaurantName || "RECEIPT", bold: true, align: "center", size: "large" });
  lines.push({ type: "feed" });
  lines.push({ text: `Order: ${p.orderId || job.orderId || "-"}` });
  lines.push({ text: `Type: ${p.orderType || job.orderType || "-"}` });
  if (p.tableNo || job.tableNo) lines.push({ text: `Table: ${p.tableNo || job.tableNo}` });
  lines.push({ text: new Date().toLocaleString() });
  lines.push({ text: "--------------------------------" });

  for (const it of p.items || []) {
    lines.push({ text: `${it.qty} x ${it.name}` });
    lines.push({ text: `      Rs.${(it.price * it.qty).toFixed(2)}`, align: "right" });
  }

  lines.push({ text: "--------------------------------" });
  lines.push({ text: `Subtotal: Rs.${(p.subtotal || 0).toFixed(2)}`, align: "right" });
  if (p.tax) lines.push({ text: `GST: Rs.${p.tax.toFixed(2)}`, align: "right" });
  if (p.serviceCharge) lines.push({ text: `Service: Rs.${p.serviceCharge.toFixed(2)}`, align: "right" });
  lines.push({ text: `TOTAL: Rs.${(p.total || 0).toFixed(2)}`, bold: true, align: "right", size: "large" });
  lines.push({ type: "feed" });
  lines.push({ text: `Payment: ${p.paymentMethod || "Cash"} (${p.paymentStatus || "PENDING_VERIFICATION"})`, align: "center" });
  lines.push({ text: "Thank you, visit again!", align: "center" });
  lines.push({ type: "feed" });
  lines.push({ type: "cut" });
  return lines;
};
