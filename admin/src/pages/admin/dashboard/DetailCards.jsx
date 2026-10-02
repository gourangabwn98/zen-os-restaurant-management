// src/pages/admin/dashboard/DetailCards.jsx
// "Today in detail" (average bill, paid orders, order type split, status bar)
// and "Totals" (the all-time figures the old tile grid showed).
import Ico from "./icons.jsx";
import { ALL_STATUSES, ORDER_TYPES } from "./model.js";
import { t, tn, fmtNum } from "../../../i18n/core.js";

const money = (n) => `₹${fmtNum(Math.round(n || 0))}`;
const STATUS_COLOR = {
  AWAITING_PAYMENT: "var(--zd-grey)",
  PENDING_CONFIRMATION: "var(--zd-blue)",
  CONFIRMED: "var(--zd-accent2)",
  PREPARING: "var(--zd-amber)",
  READY: "var(--zd-green)",
  DELIVERED: "var(--zd-cyan)",
  COMPLETED: "var(--zd-faint)",
  CANCELLED: "var(--zd-red)",
};
const TYPE_COLOR = { DINE_IN: "var(--zd-accent2)", TAKEAWAY: "var(--zd-cyan)", ONLINE: "var(--zd-amber)" };

export function TodayDetail({ today, statusLabel, typeLabel }) {
  const typeTotal = ORDER_TYPES.reduce((s, ty) => s + today.byType[ty], 0);
  return (
    <div className="zd-card">
      <div className="zd-ch"><h3>{t("Today in detail")}</h3></div>
      {!today.count ? (
        <div className="zd-empty">
          <Ico id="bag" />
          <b>{t("This fills in with the first order")}</b>
          <span>{t("Average bill, dine-in vs takeaway, order status")}</span>
        </div>
      ) : (
        <>
          <div className="zd-stat" style={{ borderTop: 0 }}><span>{t("Average bill")}</span><b>{money(today.avgBill)}</b></div>
          <div className="zd-stat"><span>{t("Paid orders")}</span><b>{fmtNum(today.paidCount)}</b></div>
          <div className="zd-sect">
            <div className="zd-stat" style={{ padding: 0, border: 0 }}>
              <span>{ORDER_TYPES.map(typeLabel).join(" / ")}</span>
              <b>{ORDER_TYPES.map((ty) => fmtNum(today.byType[ty])).join(" / ")}</b>
            </div>
            <div className="zd-mini" aria-hidden="true">
              {ORDER_TYPES.map((ty) => today.byType[ty] > 0 && (
                <i key={ty} style={{ width: `${(today.byType[ty] / (typeTotal || 1)) * 100}%`, background: TYPE_COLOR[ty] }} />
              ))}
            </div>
          </div>
          <div className="zd-sect" style={{ paddingBottom: 0 }}>
            <div className="zd-stat" style={{ padding: "0 0 8px", border: 0 }}><span>{t("Orders by status, today")}</span></div>
            <div className="zd-statusbar" aria-hidden="true">
              {ALL_STATUSES.map((st) => today.byStatus[st].count > 0 && (
                <i key={st} style={{ flex: today.byStatus[st].count, background: STATUS_COLOR[st] }} />
              ))}
            </div>
            <div className="zd-legend">
              {ALL_STATUSES.filter((st) => today.byStatus[st].count > 0).map((st) => (
                <span key={st} style={{ "--c": STATUS_COLOR[st] }} title={money(today.byStatus[st].revenue)}>
                  {statusLabel(st)} {fmtNum(today.byStatus[st].count)}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function TotalsCard({ totals, stats }) {
  const rows = [
    [t("Total collected"), money(totals.totalRev), tn(totals.paidCount, "{n} paid order", "{n} paid orders")],
    [t("Total orders"), fmtNum(totals.orders), null],
    [t("Payment due"), money(totals.due), tn(totals.dueCount, "{n} order", "{n} orders")],
    [t("Average order"), money(totals.avg), t("Across paid orders")],
    [t("Cash collected"), money(totals.cash), tn(totals.cashCount, "{n} order", "{n} orders")],
    [t("Online collected"), money(totals.online), tn(totals.onlineCount, "{n} order", "{n} orders")],
    [t("Registered users"), fmtNum(stats.totalUsers || 0), null],
    [t("Menu items"), fmtNum(stats.totalItems || 0), t("Available")],
  ];
  return (
    <div className="zd-card">
      <div className="zd-ch">
        <h3>{t("Totals")}</h3>
        <span className="zd-hint">{t("Last {n} orders", { n: fmtNum(totals.orders) })}</span>
      </div>
      <div className="zd-totals">
        {rows.map(([label, value, sub]) => (
          <div className="zd-stat" key={label}>
            <span>{label}</span>
            <b>{value}{sub && <small>{sub}</small>}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
