// src/pages/admin/employees/StaffCollections.jsx — Employees → Staff performance & collections.
// Per person, for the chosen days: orders taken, served, completed, and the
// money they RECORDED as paid (cash / online), plus every payment and who
// collected it. All figures come from the server:
//   GET /admin/employees/staff-report?from=&to=   (services/staffReportService.js)
// Admin and managers only. Read-only. Collapsed until opened (nothing loads before).
import { useState, useEffect, useCallback, useRef } from "react";
import { getStaffReport } from "../../../services/adminService.js";
import { getSocket } from "../../../services/socketService.js";
import { Loader, EmptyState, Badge } from "../shared/index.js";
import ErrorState from "../shared/ErrorState.jsx";
import SectionToggle from "./SectionToggle.jsx";
import { toDateInput, roleText, count } from "./shared.js";
import { t, N_, fmtMoney, fmtTime, fmtDate } from "../../../i18n/core.js";

const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toDateInput(d); };
// Rows that are not a person (services/staffReportService.js ROW_KINDS).
const KIND_NAME = { GATEWAY: N_("Online gateway (customer paid)"), UNATTRIBUTED: N_("Unattributed") };
const METHOD_LABEL = { Cash: N_("Cash"), Online: N_("Online"), Both: N_("Cash + Online") };
const PAY_STATUS = { PAID: N_("Paid"), PENDING_VERIFICATION: N_("Pending"), FAILED: N_("Failed") };

const whoName = (r) => (r.kind === "EMPLOYEE" ? r.name || "—" : t(KIND_NAME[r.kind] || r.kind));
const whoRole = (r) => (r.kind === "EMPLOYEE" && r.role ? roleText({ role: r.role }) : "—");
const num = { textAlign: "right", whiteSpace: "nowrap" };

export default function StaffCollections() {
  const today = toDateInput(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [payFilter, setPayFilter] = useState(""); // row key → only that person's payments
  const [showPayments, setShowPayments] = useState(false);
  const [open, setOpen] = useState(false);

  const setRange = (f, tt) => {
    if (f === from && tt === to) return;
    setFrom(f); setTo(tt); setData(null); setPayFilter("");
  };

  const reqSeq = useRef(0); // only the latest request may update the table
  const load = useCallback(() => {
    const seq = ++reqSeq.current;
    getStaffReport({ from, to })
      .then(({ data: d }) => { if (seq === reqSeq.current) { setData(d); setError(false); } })
      .catch(() => { if (seq === reqSeq.current) setError(true); });
  }, [from, to]);
  useEffect(() => { if (open) load(); }, [load, open]);

  // Live while the range includes today: a payment, a serve or a completion
  // re-reads the report (debounced — a table settle fires several events).
  const timer = useRef(null);
  useEffect(() => {
    const socket = getSocket();
    if (!open || !socket || to < today) return undefined;
    const soon = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 1500); };
    const events = ["order:payment_changed", "order:status_changed", "order:new", "order:confirmed", "connect"];
    events.forEach((e) => socket.on(e, soon));
    return () => { clearTimeout(timer.current); events.forEach((e) => socket.off(e, soon)); };
  }, [load, open, to, today]);

  const single = from === to;
  const rangeLabel = single
    ? (from === today ? t("Today") : from === daysAgo(1) ? t("Yesterday") : fmtDate(new Date(`${from}T00:00:00`)))
    : `${fmtDate(new Date(`${from}T00:00:00`))} → ${fmtDate(new Date(`${to}T00:00:00`))}`;
  const s = data?.summary;
  const payments = (data?.payments || []).filter((p) => !payFilter
    || (p.collector.kind === "EMPLOYEE" ? p.collector.employeeId === payFilter : p.collector.kind.toLowerCase() === payFilter));
  const filterRow = data?.rows.find((r) => r.key === payFilter);

  return (
    <div className="zc-card emp-dh">
      <SectionToggle title={t("Staff performance & collections")} sub={rangeLabel} open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (<>

      <div className="emp-dh-tools">
        <div className="zc-seg" role="group" aria-label={t("Day")}>
          <button type="button" className={single && from === today ? "on" : ""} onClick={() => setRange(today, today)}>{t("Today")}</button>
          <button type="button" className={single && from === daysAgo(1) ? "on" : ""} onClick={() => setRange(daysAgo(1), daysAgo(1))}>{t("Yesterday")}</button>
        </div>
        <input
          className="zc-input" type="date" value={from} max={today} aria-label={t("From")}
          onChange={(e) => e.target.value && setRange(e.target.value, e.target.value > to ? e.target.value : to)}
        />
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{t("to")}</span>
        <input
          className="zc-input" type="date" value={to} min={from} max={today} aria-label={t("To")}
          onChange={(e) => e.target.value && setRange(e.target.value < from ? e.target.value : from, e.target.value)}
        />
      </div>

      {s && (
        <div className="emp-dh-sum">
          <span><b className="tnum">{count(s.taken)}</b> {t("orders taken")}</span>
          <span><b className="tnum">{count(s.served)}</b> {t("served")}</span>
          <span><b className="tnum">{count(s.completed)}</b> {t("completed")}</span>
          <span><b className="tnum" style={{ color: "var(--ready-ink)" }}>{fmtMoney(s.collected)}</b> {t("collected")}</span>
          <span><b className="tnum">{fmtMoney(s.cash)}</b> {t("cash")}</span>
          <span><b className="tnum">{fmtMoney(s.online)}</b> {t("online")}</span>
        </div>
      )}

      <div className="zc-card-b" style={{ paddingTop: 4 }}>
        {error && !data ? <ErrorState onRetry={load} />
          : !data ? <Loader rows={3} />
          : data.rows.length === 0 ? (
            <EmptyState title={t("No staff activity")} sub={t("Nobody took, served, completed or collected an order in these days.")} />
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
                <table className="zc-ledger">
                  <thead>
                    <tr>
                      <th>{t("Employee")}</th><th>{t("Role")}</th>
                      <th style={num}>{t("Orders taken")}</th><th style={num}>{t("Served")}</th><th style={num}>{t("Completed")}</th>
                      <th style={num}>{t("Total collected")}</th><th style={num}>{t("Cash")}</th><th style={num}>{t("Online")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.key}>
                        <td>
                          {r.payments > 0 ? (
                            <button
                              type="button" className="zc-btn sm ghost" style={{ padding: "2px 6px" }}
                              title={t("Show this person's payments")}
                              onClick={() => { setPayFilter(r.key); setShowPayments(true); }}
                            >
                              {whoName(r)}
                            </button>
                          ) : <span style={{ color: r.kind === "EMPLOYEE" ? undefined : "var(--text-3)" }}>{whoName(r)}</span>}
                        </td>
                        <td>{whoRole(r)}</td>
                        <td className="tnum" style={num}>{count(r.taken)}</td>
                        <td className="tnum" style={num}>{count(r.served)}</td>
                        <td className="tnum" style={num}>{count(r.completed)}</td>
                        <td className="tnum" style={{ ...num, fontWeight: 700 }}>{fmtMoney(r.collected)}</td>
                        <td className="tnum" style={num}>{fmtMoney(r.cash)}</td>
                        <td className="tnum" style={num}>{fmtMoney(r.online)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 700 }}>
                      <td>{t("Total")}</td><td />
                      <td className="tnum" style={num}>{count(s.taken)}</td>
                      <td className="tnum" style={num}>{count(s.served)}</td>
                      <td className="tnum" style={num}>{count(s.completed)}</td>
                      <td className="tnum" style={num}>{fmtMoney(s.collected)}</td>
                      <td className="tnum" style={num}>{fmtMoney(s.cash)}</td>
                      <td className="tnum" style={num}>{fmtMoney(s.online)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {data.rows.some((r) => r.kind === "UNATTRIBUTED") && (
                <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 8 }}>
                  {t("Unattributed = the order does not record who did it (e.g. paid before collections were tracked). It is never guessed.")}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
                <button type="button" className="zc-btn sm" onClick={() => setShowPayments((v) => !v)} aria-expanded={showPayments}>
                  {showPayments ? t("Hide payments") : t("Show payments ({n})", { n: s.payments })}
                </button>
                {showPayments && payFilter && (
                  <button type="button" className="zc-btn sm ghost" onClick={() => setPayFilter("")}>
                    {filterRow ? whoName(filterRow) : t("Filtered")} ✕
                  </button>
                )}
              </div>

              {showPayments && (
                payments.length === 0 ? (
                  <EmptyState title={t("No payments")} sub={t("No payment was recorded in these days.")} />
                ) : (
                  <div style={{ overflowX: "auto", marginTop: 8 }}>
                    <table className="zc-ledger">
                      <thead>
                        <tr>
                          <th>{t("Time")}</th><th>{t("Order")}</th><th>{t("Collected by")}</th><th>{t("Role")}</th>
                          <th>{t("Method")}</th><th style={num}>{t("Cash")}</th><th style={num}>{t("Online")}</th>
                          <th style={num}>{t("Amount")}</th><th>{t("Status")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((p) => (
                          <tr key={p._id}>
                            <td className="tnum" style={{ whiteSpace: "nowrap" }}>
                              {single ? fmtTime(p.at) : `${fmtDate(p.at, { day: "2-digit", month: "short" })} ${fmtTime(p.at)}`}
                              {p.legacy && <div style={{ fontSize: 11, color: "var(--text-3)" }}>{t("order time — paid time not recorded")}</div>}
                            </td>
                            <td>{p.orderId}</td>
                            <td>{whoName(p.collector)}</td>
                            <td>{whoRole(p.collector)}</td>
                            <td>{t(METHOD_LABEL[p.method] || p.method)}</td>
                            <td className="tnum" style={num}>{p.cash ? fmtMoney(p.cash) : "—"}</td>
                            <td className="tnum" style={num}>{p.online ? fmtMoney(p.online) : "—"}</td>
                            <td className="tnum" style={{ ...num, fontWeight: 700 }}>{fmtMoney(p.amount)}</td>
                            <td><Badge label={PAY_STATUS[p.paymentStatus] || p.paymentStatus} kind="ready" dot={false} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {data.paymentsTruncated && (
                      <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 6 }}>
                        {t("Showing the latest {n} payments — choose fewer days to see all. The totals above include every payment.", { n: data.payments.length })}
                      </div>
                    )}
                  </div>
                )
              )}
            </>
          )}
      </div>
      </>)}
    </div>
  );
}
