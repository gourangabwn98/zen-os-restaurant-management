// Reports — deliveries by day or month for a date range (restaurant calendar
// days, server-side): totals, completion rate (delivered ÷ delivered+failed),
// durations, COD cash, and per-partner performance.
import { useCallback, useEffect, useState } from "react";
import { getDeliveryReports } from "../../../services/deliveryAdminService.js";
import { EmptyState, Loader } from "../shared";
import { t } from "../../../i18n/core.js";
import { rupees, mins } from "./shared.js";

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const pct = (v) => (v == null ? "—" : `${v}%`);
const th = { textAlign: "left", fontWeight: 600, fontSize: 11.5, color: "var(--text-3)", padding: "6px 8px", borderBottom: "1px solid var(--edge)" };
const td = { padding: "7px 8px", borderBottom: "1px solid var(--edge)", fontSize: 13 };

const Table = ({ head, rows }) => (
  <div style={{ overflowX: "auto" }}>
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr>{head.map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={td}>{c}</td>)}</tr>)}</tbody>
    </table>
  </div>
);

export default function ReportsTab() {
  const today = new Date();
  const [from, setFrom] = useState(ymd(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(ymd(today));
  const [groupBy, setGroupBy] = useState("day");
  const [rep, setRep] = useState(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    getDeliveryReports({ from, to, groupBy }).then((r) => { setRep(r.data); setError(false); }).catch(() => setError(true));
  }, [from, to, groupBy]);
  useEffect(() => { load(); }, [load]);

  const T = rep?.totals;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="zc-card">
        <div className="zc-card-b" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>{t("From")}<input className="zc-input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>{t("To")}<input className="zc-input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
          <div className="zc-seg">
            <button type="button" className={groupBy === "day" ? "on" : ""} onClick={() => setGroupBy("day")}>{t("Daily")}</button>
            <button type="button" className={groupBy === "month" ? "on" : ""} onClick={() => setGroupBy("month")}>{t("Monthly")}</button>
          </div>
        </div>
      </div>
      {error && <div className="zc-card"><EmptyState title={t("Couldn't load the report")} action={<button type="button" className="zc-btn" onClick={load}>{t("Retry")}</button>} /></div>}
      {!error && !rep && <div className="zc-card" style={{ padding: 20 }}><Loader rows={5} /></div>}
      {rep && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            {[
              [t("Deliveries"), T.total], [t("Delivered"), T.delivered], [t("Failed"), T.failed], [t("Completion rate"), pct(T.completionRate)],
              [t("Avg delivery time"), mins(T.avgDeliveryMinutes)], [t("Avg wait for a rider"), mins(T.avgWaitForPartnerMinutes)],
              [t("COD collected"), rupees(rep.cod.collected)], [t("COD awaiting verification"), rupees(rep.cod.awaitingVerification)],
            ].map(([k, v]) => <div key={k} className="zc-metric sm"><div className="k">{k}</div><div className="v">{v}</div></div>)}
          </div>
          <div className="zc-card">
            <div className="zc-card-h"><div className="t">{groupBy === "month" ? t("By month") : t("By day")}</div></div>
            <div className="zc-card-b">
              {rep.periods.length === 0 ? <EmptyState title={t("No deliveries in this range")} /> : (
                <Table head={[t("Period"), t("Total"), t("Delivered"), t("Failed"), t("Cancelled"), t("Completion"), t("Avg time")]}
                  rows={rep.periods.map((p) => [p.period, p.total, p.delivered, p.failed, p.cancelled, pct(p.completionRate), mins(p.avgDeliveryMinutes)])} />
              )}
            </div>
          </div>
          <div className="zc-card">
            <div className="zc-card-h"><div className="t">{t("Partner performance")}</div></div>
            <div className="zc-card-b">
              {rep.partners.length === 0 ? <EmptyState title={t("No partner activity in this range")} /> : (
                <Table head={[t("Partner"), t("Assigned"), t("Delivered"), t("Failed"), t("Completion"), t("Avg time")]}
                  rows={rep.partners.map((p) => [p.name || "—", p.total, p.delivered, p.failed, pct(p.completionRate), mins(p.avgDeliveryMinutes)])} />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
