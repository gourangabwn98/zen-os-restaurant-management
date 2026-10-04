// src/pages/admin/dashboard/TableDetailView.jsx — DSH-02
// One table, in focus, from "On the floor now": where it is in the floor flow
// (Placed → Cooking → Ready to Deliver → Eating → Completed), every order on
// it today, and the next OPERATIONAL step for each (send to kitchen, mark
// ready, served). It is deliberately not a billing screen (DSH-03, BIL-01):
// the bill state is shown for information, with a link to Invoices, where
// bills are settled and the order completes.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "../inventory/invUI.jsx";
import Badge from "../shared/Badge.jsx";
import { FLOOR_FLOW, FLOOR_STATE_OF } from "./model.js";
import { FLOOR_LABEL } from "./floorLabels.js";
import { t, N_, fmtNum, fmtTime, localName } from "../../../i18n/core.js";
import { customerName } from "../shared/customerName.js";

const money = (n) => `₹${fmtNum(Math.round(n || 0))}`;
// The one step the floor can take next — never COMPLETED (billing does that).
const NEXT_STEP = {
  PENDING_CONFIRMATION: { to: "CONFIRMED", label: N_("Accept order") },
  CONFIRMED: { to: "PREPARING", label: N_("Send to kitchen now") },
  PREPARING: { to: "READY", label: N_("Mark ready to deliver") },
  READY: { to: "DELIVERED", label: N_("Served") },
};
const billLabel = (o) => {
  const settled = o.billStatus ? o.billStatus === "SETTLED" : o.status === "COMPLETED";
  if (settled) return { text: N_("Bill settled"), kind: "ready" };
  if (o.paymentStatus === "PAID") return { text: N_("Paid · bill open"), kind: "live" };
  return { text: N_("Bill open"), kind: "wait" };
};

export default function TableDetailView({ table, onClose, onStatusChange, onNavigate, statusKey, typeLabel }) {
  const [busy, setBusy] = useState(null);
  useEffect(() => { setBusy(null); }, [table.tableNo]);
  const stepIdx = FLOOR_FLOW.indexOf(table.state);
  const orders = (table.allToday || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const advance = async (o, to) => {
    setBusy(o._id);
    try { await onStatusChange(o._id, to); } finally { setBusy(null); }
  };

  return createPortal(
    <div className="zd-pop">
      <Modal
        title={t("Table {n}", { n: fmtNum(table.tableNo) })}
        sub={`${t(FLOOR_LABEL[table.state])}${table.seats ? ` · ${t("{n} seats", { n: fmtNum(table.seats) })}` : ""}${table.amount ? ` · ${money(table.amount)} ${t("on the table")}` : ""}`}
        onClose={onClose} width={720}
        footer={<button type="button" className="zc-btn" onClick={() => { onClose(); onNavigate?.("invoices"); }}>{t("Bills for this table in Invoices")} →</button>}
      >
        {/* Floor flow — the current step highlighted */}
        <ol className="zd-flow" aria-label={t("Floor status")}>
          {FLOOR_FLOW.map((st, i) => (
            <li key={st} className={i < stepIdx ? "done" : i === stepIdx ? "on" : ""} aria-current={i === stepIdx ? "step" : undefined}>
              <span className="dot" />{t(FLOOR_LABEL[st])}
            </li>
          ))}
        </ol>

        {orders.length === 0 ? (
          <div className="zd-mempty">{t("This table is free — no order today")}</div>
        ) : orders.map((o) => {
          const step = NEXT_STEP[o.status];
          const bill = billLabel(o);
          const isCurrent = table.current && String(table.current._id) === String(o._id);
          return (
            <div className={`zd-mrow${isCurrent ? " current" : ""}`} key={o._id}>
              <div className="zd-minfo">
                <div className="zd-mtop">
                  <b>{o.orderId}</b>
                  {isCurrent && <span className="zd-chip zd-c-violet">{t("Current")}</span>}
                  <span className="zd-hint">{fmtTime(o.createdAt)} · {customerName(o) || t("Guest")}</span>
                </div>
                <div className="zd-mits">{o.items?.map((i) => `${localName(i)} ×${fmtNum(i.qty)}`).join(", ")}</div>
                <div className="zd-mmeta">
                  <span className="zd-chip zd-c-grey">{t(FLOOR_LABEL[FLOOR_STATE_OF[o.status]] || o.status)}</span>
                  <Badge label={o.status} format={statusKey} />
                  {o.status !== "CANCELLED" && <Badge label={bill.text} kind={bill.kind} />}
                  {o.orderType !== "DINE_IN" && <span className="zd-chip zd-c-violet">{typeLabel(o.orderType)}</span>}
                </div>
              </div>
              <div className="zd-mside">
                <div className="zd-mamt">{money(o.total)}</div>
                {step && (
                  <div className="zd-macts">
                    <button type="button" className="zd-opt good" disabled={busy === o._id} onClick={() => advance(o, step.to)}>{t(step.label)}</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <p className="zd-mnote">{t("Bills are settled in Invoices — settling a served order completes it and frees the table.")}</p>
      </Modal>
    </div>,
    document.body,
  );
}
