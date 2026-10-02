// src/pages/admin/invoices/InvoiceDrawer.jsx
// One bill: items, the stored totals, payment, what happened (statusHistory),
// and the actions — Print (existing print service), WhatsApp (wa.me text),
// PDF (browser print of this bill → "Save as PDF").
import { useEffect } from "react";
import { createPortal } from "react-dom";
import Badge from "../shared/Badge.jsx";
import { t, tn, N_, fmtNum, fmtDate, fmtTime, localName } from "../../../i18n/core.js";
import { billState, custName, custPhone, money, lineTotal, daysOld, billText, waLink, tableLabel, printPdf } from "./model.js";

const STATUS_LABEL = {
  AWAITING_PAYMENT: N_("Awaiting payment"), PENDING_CONFIRMATION: N_("Pending"), CONFIRMED: N_("Placed"),
  PREPARING: N_("Preparing"), READY: N_("Ready"), DELIVERED: N_("Delivered"), COMPLETED: N_("Completed"), CANCELLED: N_("Cancelled"),
};
const STATE_DOT = { COMPLETED: "var(--ready)", CANCELLED: "var(--stop)", DELIVERED: "var(--ready)" };

export function StateBadge({ o }) {
  const st = billState(o);
  if (st === "paid") return <Badge label={o.paymentMethod === "Online" ? N_("Paid · Online") : N_("Paid · Cash")} kind="ready" />;
  if (st === "checkUpi") return <Badge label={N_("Check UPI")} kind="vio" dot={false} />;
  if (st === "cancelled") return <Badge label={N_("Cancelled")} kind="done" />;
  return <Badge label={N_("Unpaid")} kind="wait" />;
}


/** Printable copy of one bill (used for "PDF" via the browser's Save as PDF). */
function PrintableBill({ o, restaurantName }) {
  return createPortal(
    <div className="inv-printable">
      <h1>{restaurantName || t("Invoice")}</h1>
      <div className="muted">{t("Invoice")} {o.orderId} · {fmtDate(o.createdAt, { day: "2-digit", month: "2-digit", year: "numeric" })} {fmtTime(o.createdAt)} · {tableLabel(o)}</div>
      {(custName(o) || custPhone(o)) && <div className="muted">{custName(o)}{custPhone(o) ? ` · +91 ${custPhone(o)}` : ""}</div>}
      <table>
        <thead><tr><th>{t("Item")}</th><th className="r">{t("Qty")}</th><th className="r">{t("Price")}</th><th className="r">{t("Amount")}</th></tr></thead>
        <tbody>
          {(o.items || []).map((it, i) => (
            <tr key={i}><td>{localName(it)}</td><td className="r">{fmtNum(it.qty)}</td><td className="r">{money(it.price)}</td><td className="r">{money(lineTotal(it))}</td></tr>
          ))}
        </tbody>
      </table>
      <table>
        <tbody>
          <tr><td>{t("Subtotal")}</td><td className="r">{money(o.subtotal)}</td></tr>
          {o.discount > 0 && <tr><td>{t("Discount")}{o.coupon?.code ? ` (${o.coupon.code})` : ""}</td><td className="r">−{money(o.discount)}</td></tr>}
          {o.serviceCharge > 0 && <tr><td>{t("Service charge")}</td><td className="r">{money(o.serviceCharge)}</td></tr>}
          {o.tax > 0 && <tr><td>{t("GST")}</td><td className="r">{money(o.tax)}</td></tr>}
          <tr><th>{t("Total")}</th><th className="r">{money(o.total)}</th></tr>
        </tbody>
      </table>
      <div className="muted">{o.paymentStatus === "PAID" ? `${t("Paid")} · ${t(o.paymentMethod === "Online" ? "Online" : "Cash")}` : t("Payment pending")}</div>
    </div>,
    document.body,
  );
}

export default function InvoiceDrawer({ o, restaurantName, busy, onClose, onCollect, onPrint, onPaymentChange }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!o) return null;

  const st = billState(o);
  const name = custName(o);
  const phone = custPhone(o);
  const history = (o.statusHistory || []).filter((h) => h.status);
  const age = daysOld(o.createdAt);

  return createPortal(
    <div className="inv-drawer-scrim" onClick={onClose}>
      <aside className="inv-drawer" role="dialog" aria-label={o.orderId} onClick={(e) => e.stopPropagation()}>
        <div className="inv-dr-h">
          <div style={{ minWidth: 0 }}>
            <div className="inv-hint tnum">{o.orderId}</div>
            <h3>{name || t("Walk-in guest")}</h3>
            <div className="inv-hint">
              {fmtDate(o.createdAt, { weekday: "long", day: "numeric", month: "short" })} · {fmtTime(o.createdAt)} · {tableLabel(o)}
              {phone ? ` · +91 ${phone}` : ""}
            </div>
          </div>
          <button type="button" className="zc-x" onClick={onClose} aria-label={t("Close")}>✕</button>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <StateBadge o={o} />
          {st !== "paid" && st !== "cancelled" && age > 0 && <span className="inv-age">{tn(age, "{n} day old", "{n} days old")}</span>}
          <Badge label={STATUS_LABEL[o.status] || o.status} kind="done" dot={false} />
        </div>

        <div>
          <div className="inv-sec-k">{t("Items")}</div>
          <table className="inv-lines">
            <tbody>
              {(o.items || []).map((it, i) => (
                <tr key={i}>
                  <td>{fmtNum(it.qty)} × {localName(it)}{it.notes ? <div className="inv-hint">{it.notes}</div> : null}<div className="inv-hint">{money(it.price)} {t("each")}</div></td>
                  <td className="num">{money(lineTotal(it))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="inv-tot">
          <div><span>{t("Subtotal")}</span><b>{money(o.subtotal)}</b></div>
          {o.discount > 0 && <div><span>{t("Discount")}{o.coupon?.code ? ` (${o.coupon.code})` : ""}</span><b>−{money(o.discount)}</b></div>}
          {o.serviceCharge > 0 && <div><span>{t("Service charge")}</span><b>{money(o.serviceCharge)}</b></div>}
          {o.tax > 0 && <div><span>{t("GST")}</span><b>{money(o.tax)}</b></div>}
          <div className="grand"><span>{t("Total")}</span><b>{money(o.total)}</b></div>
        </div>

        <div>
          <div className="inv-sec-k">{t("Payment")}</div>
          <div className="inv-tot">
            <div><span>{t("Status")}</span><b><StateBadge o={o} /></b></div>
            <div><span>{t("Method")}</span><b>{t(o.paymentMethod === "Online" ? "Online" : "Cash")}</b></div>
            {o.payment?.provider === "PHONEPE" && o.payment.phonepeTransactionId && (
              <div><span>{t("PhonePe transaction")}</span><b>{o.payment.phonepeTransactionId}</b></div>
            )}
          </div>
          {st !== "cancelled" && (
            <div className="inv-dr-acts" style={{ marginTop: 10 }}>
              {["Cash", "Online"].map((m) => (
                <button key={m} type="button" className={`zc-btn sm${(o.paymentMethod || "Cash") === m ? " pri" : " ghost"}`}
                  disabled={busy || (o.paymentMethod || "Cash") === m} onClick={() => onPaymentChange(o._id, { paymentMethod: m })}>
                  {t(m)}
                </button>
              ))}
              {o.paymentStatus === "PAID" && (
                <button type="button" className="zc-btn sm ghost" disabled={busy} onClick={() => onPaymentChange(o._id, { paymentStatus: "PENDING_VERIFICATION" })}>
                  {t("Mark unpaid")}
                </button>
              )}
            </div>
          )}
        </div>

        {(history.length > 0 || o.cancelReason) && (
          <div>
            <div className="inv-sec-k">{t("What happened")}</div>
            <div className="inv-tl">
              {history.map((h, i) => (
                <div key={i} style={{ "--c": STATE_DOT[h.status] || "var(--violet)" }}>
                  <b>{fmtTime(h.changedAt)}</b>
                  {t(STATUS_LABEL[h.status] || h.status)}{h.changedBy?.name ? ` · ${h.changedBy.name}` : ""}{h.note ? ` · “${h.note}”` : ""}
                </div>
              ))}
              {o.cancelReason && !history.some((h) => h.note === o.cancelReason) && (
                <div style={{ "--c": "var(--stop)" }}>{t("Cancelled")}: “{o.cancelReason}”</div>
              )}
            </div>
          </div>
        )}

        <div className="inv-dr-acts">
          <button type="button" className="zc-btn sm" onClick={() => onPrint(o)}>🖨️ {t("Print")}</button>
          <a className="zc-btn sm" href={waLink(phone, billText(o, restaurantName))} target="_blank" rel="noopener noreferrer">WhatsApp</a>
          <button type="button" className="zc-btn sm" onClick={printPdf}>PDF</button>
        </div>

        {(st === "unpaid" || st === "checkUpi") && (
          <button type="button" className="zc-btn pri block" disabled={busy} onClick={() => onCollect(o)}>
            {st === "checkUpi" ? t("Check UPI {amount}", { amount: money(o.total) }) : t("Collect {amount}", { amount: money(o.total) })}
          </button>
        )}
      </aside>
      <PrintableBill o={o} restaurantName={restaurantName} />
    </div>,
    document.body,
  );
}
