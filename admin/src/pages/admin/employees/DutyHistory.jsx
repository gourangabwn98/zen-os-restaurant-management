// src/pages/admin/employees/DutyHistory.jsx — Employees → Duty history.
// Every real ON/OFF duty change and who made it (the employee or an admin),
// read from the server's append-only DutyHistory log:
//   GET /admin/attendance/duty-history?date=&employeeId=&action=&source=&page=
// Only the chosen day is loaded (today by default) and every filter runs on
// the server. Read-only — there is no way to edit a record from here.
import { useState, useEffect, useCallback, useRef } from "react";
import { getDutyHistory } from "../../../services/attendanceService.js";
import { getSocket } from "../../../services/socketService.js";
import { Loader, EmptyState, Badge } from "../shared/index.js";
import ErrorState from "../shared/ErrorState.jsx";
import { toDateInput, roleText, count } from "./shared.js";
import { t, N_, fmtTime, fmtDate } from "../../../i18n/core.js";

const PAGE_SIZE = 100;
const DUTY_ACTION_LABEL = { ON_DUTY: N_("On duty"), OFF_DUTY: N_("Off duty") };
const ACTOR_ROLE_LABEL = { ADMIN: N_("Admin"), WAITER: N_("Waiter"), CHEF: N_("Chef") };

const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toDateInput(d); };

/** `people`: [{ _id, name, role, jobTitle }] — staff + admins, for the employee filter. */
export default function DutyHistory({ people = [] }) {
  const today = toDateInput(new Date());
  const [date, setDate] = useState(today);
  const [employeeId, setEmployeeId] = useState("");
  const [action, setAction] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null); // { records, total, summary, page, limit }
  const [error, setError] = useState(false);
  // Every filter change starts again at page 1.
  const pick = (current, setter) => (value) => {
    if (value === current) return;
    setter(value); setPage(1); setData(null);
  };

  const reqSeq = useRef(0); // only the latest request may update the table
  const load = useCallback(() => {
    const seq = ++reqSeq.current;
    getDutyHistory({ date, employeeId: employeeId || undefined, action: action || undefined, source: source || undefined, page, limit: PAGE_SIZE })
      .then(({ data: d }) => { if (seq === reqSeq.current) { setData(d); setError(false); } })
      .catch(() => { if (seq === reqSeq.current) setError(true); });
  }, [date, employeeId, action, source, page]);

  useEffect(() => { load(); }, [load]);

  // Live: any duty change (self or admin) re-reads the log; a reconnect
  // re-reads too, so nothing missed while offline stays missing.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    socket.on("employee:attendance:updated", load);
    socket.on("connect", load);
    return () => { socket.off("employee:attendance:updated", load); socket.off("connect", load); };
  }, [load]);

  const s = data?.summary;
  const person = people.find((p) => String(p._id) === employeeId);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const dayLabel = date === today ? t("Today") : date === daysAgo(1) ? t("Yesterday") : fmtDate(new Date(`${date}T00:00:00`));

  return (
    <div className="zc-card emp-dh">
      <div className="zc-card-h">
        <span className="t">{t("Duty history")}</span>
        <span className="s">{dayLabel} · {fmtDate(new Date(`${date}T00:00:00`))}</span>
      </div>

      <div className="emp-dh-tools">
        <div className="zc-seg" role="group" aria-label={t("Day")}>
          <button type="button" className={date === today ? "on" : ""} onClick={() => pick(date, setDate)(today)}>{t("Today")}</button>
          <button type="button" className={date === daysAgo(1) ? "on" : ""} onClick={() => pick(date, setDate)(daysAgo(1))}>{t("Yesterday")}</button>
        </div>
        <input
          className="zc-input" type="date" value={date} max={today} aria-label={t("Date")}
          onChange={(e) => e.target.value && pick(date, setDate)(e.target.value)}
        />
        <select className="zc-select" value={employeeId} onChange={(e) => pick(employeeId, setEmployeeId)(e.target.value)} aria-label={t("Employee")}>
          <option value="">{t("All employees")}</option>
          {people.map((p) => <option key={p._id} value={p._id}>{p.name || t("Admin")} · {roleText(p)}</option>)}
        </select>
        <select className="zc-select" value={action} onChange={(e) => pick(action, setAction)(e.target.value)} aria-label={t("Action")}>
          <option value="">{t("On & off")}</option>
          <option value="ON_DUTY">{t("On duty")}</option>
          <option value="OFF_DUTY">{t("Off duty")}</option>
        </select>
        <select className="zc-select" value={source} onChange={(e) => pick(source, setSource)(e.target.value)} aria-label={t("Changed by")}>
          <option value="">{t("Changed by anyone")}</option>
          <option value="SELF">{t("By the employee")}</option>
          <option value="ADMIN">{t("By an admin")}</option>
        </select>
      </div>

      {s && (
        <div className="emp-dh-sum">
          <span><b className="tnum">{count(s.total)}</b> {person ? t("changes for {name}", { name: person.name }) : t("changes")}</span>
          <span><b className="tnum" style={{ color: "var(--ready-ink)" }}>{count(s.onDuty)}</b> {t("on duty")}</span>
          <span><b className="tnum">{count(s.offDuty)}</b> {t("off duty")}</span>
          <span><b className="tnum">{count(s.bySelf)}</b> {person ? t("by {name}", { name: person.name }) : t("by employees")}</span>
          <span><b className="tnum" style={{ color: s.byAdmin ? "var(--live-ink)" : undefined }}>{count(s.byAdmin)}</b> {t("by admin")}</span>
        </div>
      )}

      <div className="zc-card-b" style={{ paddingTop: 4 }}>
        {error && !data ? <ErrorState onRetry={load} />
          : !data ? <Loader rows={3} />
          : data.records.length === 0 ? (
            <EmptyState title={t("No duty changes")} sub={t("Nobody went on or off duty on this day with these filters.")} />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="zc-ledger">
                <thead>
                  <tr><th>{t("Time")}</th><th>{t("Employee")}</th><th>{t("Action")}</th><th>{t("Changed by")}</th><th>{t("Role")}</th></tr>
                </thead>
                <tbody>
                  {data.records.map((r) => (
                    <tr key={r._id}>
                      <td className="tnum" style={{ whiteSpace: "nowrap" }}>{fmtTime(r.at)}</td>
                      <td>{r.employeeName || "—"}</td>
                      <td><Badge label={DUTY_ACTION_LABEL[r.action]} kind={r.action === "ON_DUTY" ? "ready" : "done"} /></td>
                      <td>
                        {r.changedBy?.name || "—"}
                        {r.source === "ADMIN" && <> <Badge label={N_("Admin change")} kind="live" dot={false} /></>}
                      </td>
                      <td>{t(ACTOR_ROLE_LABEL[r.changedBy?.role] || r.changedBy?.role || "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        {data && pages > 1 && (
          <div className="zc-pager" style={{ marginTop: 10 }}>
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹</button>
            <span>{t("Page {p} of {n}", { p: page, n: pages })}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>›</button>
          </div>
        )}
      </div>
    </div>
  );
}
