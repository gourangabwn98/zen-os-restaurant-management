// src/pages/admin/dashboard/AttentionModal.jsx
// Detail behind a "Needs your attention" item: the exact orders / printer
// state the line was counted from. Operational actions (accept / reject an
// order) happen right here; money never does — unpaid and open bills link to
// Invoices, the one billing workflow (BIL-01, DSH-03). Stock items keep using
// the shared StockAlertsModal.
import { useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "../inventory/invUI.jsx";
import Badge from "../shared/Badge.jsx";
import { t, tn, fmtNum, fmtDate, fmtTime, localName } from "../../../i18n/core.js";
import { tableLabel } from "../shared/diningArea.js";
import { customerName } from "../shared/customerName.js";

const money = (n) => `₹${fmtNum(Math.round(n || 0))}`;
const total = (list) => list.reduce((s, o) => s + Number(o.total || 0), 0);
const when = (d) => `${fmtDate(d, { day: "numeric", month: "short" })} · ${fmtTime(d)}`;

function OrderRow({ o, typeLabel, statusKey, children }) {
  const who = customerName(o);
  const phone = o.guestPhone || o.user?.phone;
  return (
    <div className="zd-mrow">
      <div className="zd-minfo">
        <div className="zd-mtop">
          <b>{o.orderId}</b>
          <span className="zd-hint">{when(o.createdAt)}</span>
        </div>
        <div className="zd-mwho">
          {who || t("Guest")}{phone ? ` · ${phone}` : ""}
        </div>
        <div className="zd-mits">{o.items?.map((i) => `${localName(i)} ×${fmtNum(i.qty)}`).join(", ")}</div>
        <div className="zd-mmeta">
          <Badge label={o.status} format={statusKey} />
          <span className="zd-chip zd-c-violet">{typeLabel(o.orderType)}</span>
          {o.tableNo && <span className="zd-chip zd-c-grey">{tableLabel(o)}</span>}
        </div>
      </div>
      <div className="zd-mside">
        <div className="zd-mamt">{money(o.total)}</div>
        <div className="zd-macts">{children}</div>
      </div>
    </div>
  );
}

export default function AttentionModal({
  item, printer, typeLabel, statusKey,
  onAccept, onReject, onNavigate, onClose,
}) {
  const [busy, setBusy] = useState(null); // order / invoice id being updated
  const run = async (id, fn) => {
    setBusy(id);
    try { await fn(); } catch { /* the handler already showed a toast */ } finally { setBusy(null); }
  };
  const go = (page) => { onClose(); onNavigate?.(page); };

  let title = "", sub = "", body = null, footer = null;

  if (item.kind === "olderUnpaid") {
    const list = item.orders;
    title = t("Unpaid orders from earlier days");
    sub = list.length
      ? `${tn(list.length, "{n} order", "{n} orders")} · ${money(total(list))} · ${fmtDate(item.from, { day: "numeric", month: "short" })} – ${fmtDate(item.to, { day: "numeric", month: "short" })}`
      : t("All settled.");
    body = list.length === 0
      ? <div className="zd-mempty">{t("Every one of these orders is now paid.")}</div>
      : list.map((o) => <OrderRow key={o._id} o={o} typeLabel={typeLabel} statusKey={statusKey} />);
    footer = <button type="button" className="zc-btn" onClick={() => go("invoices")}>{t("Collect in Invoices")} →</button>;
  } else if (item.kind === "confirm") {
    const list = item.orders;
    title = t("Orders waiting for confirmation");
    sub = list.length ? `${tn(list.length, "{n} order", "{n} orders")} · ${money(total(list))}` : t("All settled.");
    body = list.length === 0
      ? <div className="zd-mempty">{t("No orders are waiting now.")}</div>
      : list.map((o) => (
        <OrderRow key={o._id} o={o} typeLabel={typeLabel} statusKey={statusKey}>
          <button type="button" className="zd-opt good" disabled={busy === o._id} onClick={() => run(o._id, () => onAccept(o))}>{t("Accept")}</button>
          <button type="button" className="zd-opt bad" disabled={busy === o._id} onClick={() => run(o._id, () => onReject(o))}>{t("Reject")}</button>
        </OrderRow>
      ));
    footer = <button type="button" className="zc-btn" onClick={() => go("orders")}>{t("Open Orders")} →</button>;
  } else if (item.kind === "settle") {
    const list = item.orders || [];
    title = t("Served orders with the bill open");
    sub = list.length ? `${tn(list.length, "{n} order", "{n} orders")} · ${money(total(list))}` : t("All settled.");
    body = list.length === 0
      ? <div className="zd-mempty">{t("Every served order is settled.")}</div>
      : list.map((o) => <OrderRow key={o._id} o={o} typeLabel={typeLabel} statusKey={statusKey} />);
    footer = <button type="button" className="zc-btn" onClick={() => go("invoices")}>{t("Settle in Invoices")} →</button>;
  } else if (item.kind === "printerOff" || item.kind === "printerFailed") {
    const q = printer?.queue || {};
    title = t("Printer");
    sub = printer?.online ? t("{n} connected", { n: fmtNum(printer.connectedPrinters || 0) }) : t("No printer connected");
    const rows = [
      [t("Status"), printer?.online ? t("Connected") : t("Offline")],
      [t("Printers connected"), fmtNum(printer?.connectedPrinters || 0)],
      [t("Waiting to print"), fmtNum(q.pending || 0)],
      [t("Failed"), fmtNum(q.failed || 0)],
      [t("Printed today"), fmtNum(q.printedToday || 0)],
    ];
    body = (
      <>
        {rows.map(([k, v]) => <div className="zd-stat" key={k}><span>{k}</span><b>{v}</b></div>)}
        {!printer?.online && <p className="zd-mnote">{t("Start the print service on the counter computer, then check the printer settings.")}</p>}
      </>
    );
    footer = <button type="button" className="zc-btn" onClick={() => go("profile")}>{t("Printer settings")} →</button>;
  }

  return createPortal(
    <div className="zd-pop">
      <Modal title={title} sub={sub} onClose={onClose} width={720} footer={footer}>
        {body}
      </Modal>
    </div>,
    document.body,
  );
}
