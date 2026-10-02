// src/pages/admin/dashboard/AttentionCard.jsx
// Every alert in one list (stock, printer, pending invoices, orders waiting to
// be confirmed, unpaid bills from earlier days), most serious first, each with
// a one-tap button to the screen that fixes it.
import Ico from "./icons.jsx";
import { t, tn, fmtNum, fmtDate, localName } from "../../../i18n/core.js";

const SEV_COLOR = { red: "var(--zd-red)", amber: "var(--zd-amber)", violet: "var(--zd-accent2)" };
const money = (n) => `₹${fmtNum(Math.round(n || 0))}`;
const nameList = (items) => items.map((i) => localName(i)).filter(Boolean).join(", ");

function describe(a) {
  switch (a.kind) {
    case "out": return {
      tag: t("Out of stock"),
      text: tn(a.count, "{n} stock item is out of stock", "{n} stock items are out of stock"),
      detail: nameList(a.names), btn: t("View stock"),
    };
    case "printerOff": return {
      tag: t("Printer"), text: t("No printer connected"),
      detail: a.pending ? tn(a.pending, "{n} print job waiting", "{n} print jobs waiting") : t("Kitchen slips and bills won't print"),
      btn: t("View details"),
    };
    case "printerFailed": return {
      tag: t("Printer"), text: tn(a.count, "{n} print job failed", "{n} print jobs failed"),
      detail: t("Check the printer and its paper"), btn: t("View details"),
    };
    case "invoices": return {
      tag: t("Payment due"), text: tn(a.count, "{n} table has an invoice pending", "{n} tables have an invoice pending"),
      detail: t("Collect payment and mark it paid"), btn: t("Review"),
    };
    case "confirm": return {
      tag: t("New orders"), text: tn(a.count, "{n} customer order is waiting for confirmation", "{n} customer orders are waiting for confirmation"),
      detail: t("The kitchen won't start until you confirm"), btn: t("Review"),
    };
    case "olderUnpaid": return {
      tag: t("Old unpaid"),
      text: tn(a.count, "{amount} still unpaid from {n} order on an earlier day", "{amount} still unpaid from {n} orders on earlier days", { amount: money(a.amount) }),
      detail: `${fmtDate(a.from, { day: "numeric", month: "short" })} – ${fmtDate(a.to, { day: "numeric", month: "short" })}`,
      btn: t("Review"),
    };
    case "low": return {
      tag: t("Low stock"), text: tn(a.count, "{n} stock item is running low", "{n} stock items are running low"),
      detail: nameList(a.names), btn: t("View stock"),
    };
    case "expiring": return {
      tag: t("Expiring"), text: tn(a.count, "{n} batch expiring soon", "{n} batches expiring soon"),
      detail: t("Within {n} days", { n: fmtNum(a.withinDays ?? 0) }), btn: t("View stock"),
    };
    default: return { tag: "", text: "", detail: "", btn: "" };
  }
}

export default function AttentionCard({ items, loading, onAction }) {
  const reds = items.filter((a) => a.sev === "red").length;
  return (
    <div className="zd-card">
      <div className="zd-ch">
        <h3>
          {t("Needs your attention")}
          {items.length > 0 && <span className={`zd-chip ${reds ? "zd-c-red" : "zd-c-amber"}`}>{fmtNum(items.length)}</span>}
        </h3>
      </div>
      <div className="zd-att-list">
        {items.length === 0 ? (
          <div className="zd-allgood">
            <Ico id="check" />
            {loading ? t("Checking stock and printer…") : t("All clear. Nothing needs you right now.")}
          </div>
        ) : items.map((a) => {
          const d = describe(a);
          return (
            <div className="zd-att" key={a.kind}>
              <span className="zd-sevdot" style={{ background: SEV_COLOR[a.sev] }} />
              <div style={{ minWidth: 0 }}>
                <div><span className={`zd-chip zd-c-${a.sev}`}>{d.tag}</span></div>
                <div className="t">{d.text}</div>
                {d.detail && <div className="d">{d.detail}</div>}
              </div>
              <button type="button" className="zd-btn ghost sm" onClick={() => onAction(a)}>{d.btn}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
