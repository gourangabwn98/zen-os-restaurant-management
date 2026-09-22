// src/pages/admin/AttendancePage.jsx — Admin → Employees → Attendance
import { useState, useEffect, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import {
  getAttendanceToday, getAttendanceHistory, getAttendanceEmployee, getAttendanceSummary,
} from "../../services/attendanceService.js";
import { getSocket } from "../../services/socketService.js";
import { PageHeader, StatCard, Badge, Loader, EmptyState } from "./shared/index.js";
import ErrorState from "./shared/ErrorState.jsx";
import { Modal, TableShell } from "./inventory/invUI.jsx";
import { statusKind } from "./shared/statusKind.js";

const presenceKind = (status) => (status === "ONLINE" ? "ready" : statusKind(status));
const presenceLabel = { ONLINE: "Online", BREAK: "On Break", OFFLINE: "Offline" };

const fmtDuration = (totalSeconds) => {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
};
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString([], { day: "2-digit", month: "short" }) : "—");
const toDateInput = (d) => new Date(d).toISOString().slice(0, 10);

export default function AttendancePage() {
  const [tab, setTab] = useState("live"); // live | history
  const [summary, setSummary] = useState(null);
  const [today, setToday] = useState(null); // null = loading, [] = empty
  const [error, setError] = useState(false);
  const [roleFilter, setRoleFilter] = useState("");
  const [search, setSearch] = useState("");
  const [detailEmployee, setDetailEmployee] = useState(null); // { _id, name, role } | null

  const loadLive = useCallback(async () => {
    try {
      const [{ data: sum }, { data: liveData }] = await Promise.all([
        getAttendanceSummary(),
        getAttendanceToday({ role: roleFilter || undefined }),
      ]);
      setSummary(sum);
      setToday(liveData.employees || []);
      setError(false);
    } catch {
      setError(true);
    }
  }, [roleFilter]);

  useEffect(() => { loadLive(); }, [loadLive]);

  // Live board refresh — poll as a safety net, plus socket-driven refetch on
  // any attendance change, mirroring OpsAlertsPanel's polling pattern and
  // OrdersPage's socket-merge pattern.
  useEffect(() => {
    const iv = setInterval(loadLive, 20000);
    const socket = getSocket();
    const onUpdate = () => loadLive();
    if (socket) socket.on("employee:attendance:updated", onUpdate);
    return () => {
      clearInterval(iv);
      if (socket) socket.off("employee:attendance:updated", onUpdate);
    };
  }, [loadLive]);

  const filteredToday = useMemo(() => {
    if (!today) return today;
    const q = search.trim().toLowerCase();
    if (!q) return today;
    return today.filter((row) => row.employee.name?.toLowerCase().includes(q));
  }, [today, search]);

  const grouped = useMemo(() => {
    if (!filteredToday) return {};
    return filteredToday.reduce((acc, row) => {
      (acc[row.employee.role] ||= []).push(row);
      return acc;
    }, {});
  }, [filteredToday]);

  return (
    <div>
      <PageHeader
        title="Attendance"
        sub="Live duty status, break time, and working hours for every employee."
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <button className={`zc-btn sm${tab === "live" ? " pri" : ""}`} onClick={() => setTab("live")}>Live</button>
            <button className={`zc-btn sm${tab === "history" ? " pri" : ""}`} onClick={() => setTab("history")}>History</button>
          </div>
        }
      />

      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
          <StatCard label="Total Employees" value={summary.totalEmployees} colorIdx={0} />
          <StatCard label="Online" value={summary.online} colorIdx={1} />
          <StatCard label="On Break" value={summary.onBreak} colorIdx={3} />
          <StatCard label="Offline" value={summary.offline} colorIdx={2} />
          <StatCard label="Working Today" value={summary.workingToday} colorIdx={0} />
          <StatCard label="Today's Total Hours" value={fmtDuration(summary.totalWorkingSeconds)} colorIdx={1} />
        </div>
      )}

      {tab === "live" ? (
        <LiveBoard
          today={filteredToday}
          error={error}
          onRetry={loadLive}
          search={search} setSearch={setSearch}
          roleFilter={roleFilter} setRoleFilter={setRoleFilter}
          grouped={grouped}
          onOpenEmployee={(emp) => setDetailEmployee(emp)}
        />
      ) : (
        <HistoryView onOpenEmployee={(emp) => setDetailEmployee(emp)} />
      )}

      {detailEmployee && (
        <EmployeeDetailModal employee={detailEmployee} onClose={() => setDetailEmployee(null)} />
      )}
    </div>
  );
}

// ── Live board ───────────────────────────────────────────────────────────────
function LiveBoard({ today, error, onRetry, search, setSearch, roleFilter, setRoleFilter, grouped, onOpenEmployee }) {
  if (error) return <ErrorState onRetry={onRetry} />;
  if (today === null) return <Loader rows={5} />;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <input
          className="zc-input" placeholder="Search employee…" value={search}
          onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 220 }}
        />
        <select className="zc-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={{ maxWidth: 160 }}>
          <option value="">All Roles</option>
          <option value="waiter">Waiter</option>
          <option value="chef">Chef</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      {today.length === 0 ? (
        <EmptyState title="No employees found" />
      ) : (
        Object.entries(grouped).map(([role, rows]) => (
          <div key={role} style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>
              {role}s
            </div>
            <TableShell headers={["Employee", "Status", "Login", "Break", "Working Time", ""]} isEmpty={false} minWidth={640}>
              {rows.map((row) => (
                <tr key={row.employee._id} style={{ cursor: "pointer" }} onClick={() => onOpenEmployee(row.employee)}>
                  <td>{row.employee.name}</td>
                  <td><Badge label={presenceLabel[row.status] || row.status} kind={presenceKind(row.status)} /></td>
                  <td>{fmtTime(row.firstLogin)}</td>
                  <td>{fmtDuration(row.breakSeconds)}</td>
                  <td>{fmtDuration(row.workingSeconds)}</td>
                  <td><button className="zc-btn sm ghost" onClick={(e) => { e.stopPropagation(); onOpenEmployee(row.employee); }}>Details</button></td>
                </tr>
              ))}
            </TableShell>
          </div>
        ))
      )}
    </div>
  );
}

// ── Date-wise history ────────────────────────────────────────────────────────
function HistoryView({ onOpenEmployee }) {
  const today = new Date();
  const [from, setFrom] = useState(toDateInput(today));
  const [to, setTo] = useState(toDateInput(today));
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);

  const applyPreset = (preset) => {
    const now = new Date();
    if (preset === "today") { setFrom(toDateInput(now)); setTo(toDateInput(now)); }
    if (preset === "yesterday") {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      setFrom(toDateInput(y)); setTo(toDateInput(y));
    }
    if (preset === "week") {
      const start = new Date(now); start.setDate(start.getDate() - 6);
      setFrom(toDateInput(start)); setTo(toDateInput(now));
    }
    if (preset === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      setFrom(toDateInput(start)); setTo(toDateInput(now));
    }
  };

  const load = useCallback(async () => {
    try {
      const { data } = await getAttendanceHistory({
        from, to, role: role || undefined, status: status || undefined, limit: 100,
      });
      setRows(data.sessions || []);
      setError(false);
    } catch {
      setError(true);
    }
  }, [from, to, role, status]);

  useEffect(() => { const id = setTimeout(load, 200); return () => clearTimeout(id); }, [load]);

  if (error) return <ErrorState onRetry={load} />;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button className="zc-btn sm" onClick={() => applyPreset("today")}>Today</button>
        <button className="zc-btn sm" onClick={() => applyPreset("yesterday")}>Yesterday</button>
        <button className="zc-btn sm" onClick={() => applyPreset("week")}>This Week</button>
        <button className="zc-btn sm" onClick={() => applyPreset("month")}>This Month</button>
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <input type="date" className="zc-input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <span style={{ color: "var(--text-3)" }}>to</span>
        <input type="date" className="zc-input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        <select className="zc-select" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All Roles</option>
          <option value="waiter">Waiter</option>
          <option value="chef">Chef</option>
          <option value="admin">Admin</option>
        </select>
        <select className="zc-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any Status</option>
          <option value="OPEN">Currently Open</option>
          <option value="CLOSED">Closed</option>
        </select>
      </div>

      {rows === null ? (
        <Loader rows={5} />
      ) : (
        <TableShell
          headers={["Employee", "Role", "Date", "Login", "Logout", "Break", "Working Time"]}
          isEmpty={rows.length === 0}
          emptyText="No attendance records in this range"
          minWidth={700}
        >
          {rows.map((s) => (
            <tr key={s._id} style={{ cursor: "pointer" }} onClick={() => onOpenEmployee({ _id: s.employee, name: s.employeeName, role: s.role })}>
              <td>{s.employeeName || "—"}</td>
              <td style={{ textTransform: "capitalize" }}>{s.role}</td>
              <td>{fmtDate(s.loginAt)}</td>
              <td>{fmtTime(s.loginAt)}</td>
              <td>{s.status === "OPEN" ? "—" : fmtTime(s.logoutAt)}</td>
              <td>{fmtDuration(s.totalBreakSeconds)}</td>
              <td>{fmtDuration(s.totalWorkingSeconds)}</td>
            </tr>
          ))}
        </TableShell>
      )}
    </div>
  );
}

// ── Employee detail modal ───────────────────────────────────────────────────
function EmployeeDetailModal({ employee, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAttendanceEmployee(employee._id)
      .then(({ data }) => { if (!cancelled) setData(data); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [employee._id]);

  return (
    <Modal title={employee.name} sub={employee.role ? employee.role[0].toUpperCase() + employee.role.slice(1) : ""} onClose={onClose} width={620}>
      {error ? (
        <ErrorState onRetry={() => setError(false)} />
      ) : !data ? (
        <Loader rows={3} />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 10, marginBottom: 16 }}>
            <StatCard label="Working Days" value={data.summary.workingDays} colorIdx={0} />
            <StatCard label="Total Hours" value={fmtDuration(data.summary.totalWorkingSeconds)} colorIdx={1} />
            <StatCard label="Break Hours" value={fmtDuration(data.summary.totalBreakSeconds)} colorIdx={3} />
            <StatCard
              label="Avg Hours/Day"
              value={data.summary.averageWorkingSeconds != null ? fmtDuration(data.summary.averageWorkingSeconds) : "—"}
              sub={data.summary.averageWorkingSeconds == null ? "Not enough data yet" : undefined}
              colorIdx={2}
            />
          </div>
          <TableShell
            headers={["Date", "Login", "Logout", "Break", "Working Time"]}
            isEmpty={data.days.length === 0}
            emptyText="No attendance history yet"
            minWidth={520}
          >
            {data.days.map((d) => (
              <tr key={d.date}>
                <td>{fmtDate(d.date)}</td>
                <td>{fmtTime(d.login)}</td>
                <td>{d.logout ? fmtTime(d.logout) : "—"}</td>
                <td>{fmtDuration(d.breakSeconds)}</td>
                <td>{fmtDuration(d.workingSeconds)}</td>
              </tr>
            ))}
          </TableShell>
        </>
      )}
    </Modal>
  );
}
