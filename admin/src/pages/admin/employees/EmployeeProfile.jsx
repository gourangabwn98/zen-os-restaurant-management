// src/pages/admin/employees/EmployeeProfile.jsx
// Right-hand panel: one person. Header (contact, Edit, ⋯ menu with
// activate/deactivate behind a confirmation), then six tabs:
//   Overview    today + customers + this month + orders (stats endpoint)
//   Attendance  GET /admin/attendance/employee/:id   (per-day sessions)
//   Reviews     GET /admin/employees/:id/reviews      (customer ratings)
//   Pay         GET /admin/employees/:id/pay          (salary / OT / advances)
//   Leave       GET /admin/employees/:id/leave        (requests + history)
//   Documents   User.hr fields + photo
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { getEmployeeStats, setEmployeeShift } from "../../../services/adminService.js";
import { getAttendanceEmployee } from "../../../services/attendanceService.js";
import { StatCard, Loader, Badge } from "../shared/index.js";
import ErrorState from "../shared/ErrorState.jsx";
import { TableShell, Modal } from "../inventory/invUI.jsx";
import { t, N_, fmtNum, fmtDate, fmtTime } from "../../../i18n/core.js";
import { DUTY_LABEL, initials, fmtDuration, toDateInput, phoneLabel, count, missingDocs, roleText, SHIFT_STATES, shiftFromDuty } from "./shared.js";
import ReviewsTab from "./ReviewsTab.jsx";
import PayTab from "./PayTab.jsx";
import LeaveTab from "./LeaveTab.jsx";
import DocumentsTab from "./DocumentsTab.jsx";

const PROFILE_TABS = [
  { key: "overview", label: N_("Overview") },
  { key: "attendance", label: N_("Attendance") },
  { key: "reviews", label: N_("Reviews") },
  { key: "pay", label: N_("Pay") },
  { key: "leave", label: N_("Leave") },
  { key: "documents", label: N_("Documents") },
];
const DUTY_KIND = { ONLINE: "ready", BREAK: "wait", OFFLINE: "done" };

export default function EmployeeProfile({ employee, duty, ordersToday, hr, policy, tab, onTab: setTab, onEdit, onToggleStatus, onEmployeeUpdated, onHrChanged }) {
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef(null);
  const active = employee.status !== "Inactive";

  // Close the ⋯ menu on outside click / Escape.
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) { setMenu(false); setConfirming(false); } };
    const onKey = (e) => { if (e.key === "Escape") { setMenu(false); setConfirming(false); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menu]);

  const doToggle = async () => {
    setBusy(true);
    try { await onToggleStatus(employee); setMenu(false); setConfirming(false); } finally { setBusy(false); }
  };

  const badges = { reviews: hr?.openComplaints || 0, leave: hr?.pendingLeave || 0, documents: missingDocs(employee) };

  return (
    <div className="zc-card emp-prof">
      <div className="emp-ph">
        <div className="emp-who">
          {employee.hr?.photo
            ? <img className={`emp-av lg ${employee.role}`} src={employee.hr.photo} alt="" />
            : <span className={`emp-av lg ${employee.role}`}>{initials(employee.name)}</span>}
          <div style={{ minWidth: 0 }}>
            <h3>
              {employee.name}
              <Badge label={roleText(employee)} kind="vio" dot={false} />
              {employee.role === "staff" && <Badge label={N_("No app login")} kind="done" dot={false} />}
              {!active && <Badge label={N_("Inactive")} kind="done" />}
            </h3>
            <div className="meta">
              {phoneLabel(employee.phone)}
              {employee.address ? ` · ${employee.address}` : ""}
              {(employee.hr?.joinedAt || employee.createdAt) ? ` · ${t("Joined {date}", { date: fmtDate(employee.hr?.joinedAt || employee.createdAt, { day: "numeric", month: "short", year: "numeric" }) })}` : ""}
            </div>
          </div>
        </div>
        <div className="emp-acts" ref={menuRef}>
          {employee.phone && <a className="zc-btn sm ghost" href={`tel:+91${employee.phone}`}>{t("Call")}</a>}
          {employee.phone && (
            <a className="zc-btn sm ghost" href={`https://wa.me/91${employee.phone}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
          )}
          <button type="button" className="zc-btn sm" onClick={() => onEdit(employee)}>✎ {t("Edit")}</button>
          <button type="button" className="zc-btn sm ghost" aria-label={t("More")} aria-expanded={menu} onClick={() => { setMenu((m) => !m); setConfirming(false); }}>⋯</button>
          {menu && (
            <div className="emp-menu" role="menu">
              {!confirming ? (
                <button type="button" role="menuitem" className={`mi ${active ? "danger" : "good"}`} onClick={() => setConfirming(true)}>
                  {active ? t("Deactivate…") : t("Activate…")}
                </button>
              ) : (
                <div className="emp-confirm">
                  {active
                    ? t("Deactivate {name}? They won't be able to sign in until you activate them again. Their attendance and order history stay.", { name: employee.name })
                    : t("Activate {name}? They can sign in again with their phone and OTP.", { name: employee.name })}
                  <div className="row">
                    <button type="button" className="zc-btn sm ghost" onClick={() => setConfirming(false)}>{t("Cancel")}</button>
                    <button type="button" className={`zc-btn sm ${active ? "danger" : "good"}`} disabled={busy} onClick={doToggle}>
                      {active ? t("Deactivate") : t("Activate")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="zc-subnav" role="tablist">
        {PROFILE_TABS.map((tb) => {
          const n = badges[tb.key];
          return (
            <button type="button" role="tab" key={tb.key} aria-selected={tab === tb.key} className={tab === tb.key ? "on" : ""} onClick={() => setTab(tb.key)}>
              {t(tb.label)}
              {n > 0 && <span className={`emp-tabn ${tb.key === "reviews" ? "stop" : "wait"}`}>{fmtNum(n)}</span>}
            </button>
          );
        })}
      </div>

      {tab === "overview" && <OverviewTab employee={employee} duty={duty} ordersToday={ordersToday} hr={hr} />}
      {tab === "attendance" && <AttendanceTab employee={employee} />}
      {tab === "reviews" && <ReviewsTab employee={employee} onChanged={onHrChanged} />}
      {tab === "pay" && <PayTab employee={employee} policy={policy} onEmployeeUpdated={onEmployeeUpdated} onChanged={onHrChanged} />}
      {tab === "leave" && <LeaveTab employee={employee} policy={policy} onChanged={onHrChanged} />}
      {tab === "documents" && <DocumentsTab employee={employee} onEmployeeUpdated={onEmployeeUpdated} />}
    </div>
  );
}

// ── EMP-01: the manager sets someone's shift (they forgot, or can't log in) ──
// The live duty list refreshes from the attendance socket event.
// "On break" asks for a mandatory reason first (saved in Duty history) and
// is only offered while the person is on duty — the server enforces both.
const BREAK_REASON_MAX = 200;

function ShiftControl({ employee, status }) {
  const [busy, setBusy] = useState(false);
  const [askBreak, setAskBreak] = useState(false);
  const cur = shiftFromDuty(status);
  const set = async (state, reason) => {
    if (state === cur) return false;
    setBusy(true);
    try {
      await setEmployeeShift(employee._id, state, reason);
      toast.success(t("{name}: {state}", { name: employee.name, state: t(SHIFT_STATES.find((s) => s.id === state).label) }));
      return true;
    } catch (err) { toast.error(err.response?.data?.message || t("Update failed")); return false; }
    finally { setBusy(false); }
  };
  const pick = (id) => {
    if (id === "ON_BREAK") { if (cur === "ON_SHIFT") setAskBreak(true); return; }
    set(id);
  };
  return (
    <div style={{ marginTop: 10 }}>
      <div className="zc-seg" role="radiogroup" aria-label={t("Set shift")}>
        {SHIFT_STATES.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={cur === s.id} className={cur === s.id ? "on" : ""}
            disabled={busy || (s.id === "ON_BREAK" && cur === "OFF_SHIFT")}
            title={s.id === "ON_BREAK" && cur === "OFF_SHIFT" ? t("Only someone on duty can be put on break") : undefined}
            onClick={() => pick(s.id)}>{t(s.label)}</button>
        ))}
      </div>
      <div className="emp-hint" style={{ marginTop: 6 }}>{t("Set by you — it stays until you or they change it.")}</div>
      {askBreak && (
        <BreakReasonModal
          employee={employee} busy={busy}
          onClose={() => setAskBreak(false)}
          onConfirm={async (reason) => { if (await set("ON_BREAK", reason)) setAskBreak(false); }}
        />
      )}
    </div>
  );
}

function BreakReasonModal({ employee, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const clean = reason.trim();
  const submit = () => { if (clean && !busy) onConfirm(clean); };
  return (
    <Modal
      title={t("Put {name} on break", { name: employee.name })}
      sub={t("The reason is saved in Duty history. They stay on duty — a break is not off duty.")}
      onClose={busy ? () => {} : onClose}
      width={460}
      footer={
        <>
          <button type="button" className="zc-btn" onClick={onClose} disabled={busy}>{t("Cancel")}</button>
          <button type="button" className="zc-btn pri" onClick={submit} disabled={!clean || busy}>{busy ? t("Saving…") : t("Start break")}</button>
        </>
      }
    >
      <label htmlFor="brk-reason" style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--text-2)", marginBottom: 6 }}>{t("Reason")} *</label>
      <textarea
        id="brk-reason" className="zc-textarea" rows={3} autoFocus maxLength={BREAK_REASON_MAX}
        placeholder={t("e.g. Lunch break")} value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
      />
      {!clean && <div className="emp-hint" style={{ marginTop: 6 }}>{t("A reason is required.")}</div>}
    </Modal>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────
function useMonthAttendance(employeeId, monthStart) {
  const [state, setState] = useState({ key: null, data: null, error: false });
  const [nonce, setNonce] = useState(0); // bumped by "Try again"
  const key = `${employeeId}|${toDateInput(monthStart)}|${nonce}`;
  useEffect(() => {
    let cancelled = false;
    const end = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    getAttendanceEmployee(employeeId, { from: toDateInput(monthStart), to: toDateInput(end) })
      .then(({ data }) => { if (!cancelled) setState({ key, data, error: false }); })
      .catch(() => { if (!cancelled) setState({ key, data: null, error: true }); });
    return () => { cancelled = true; };
  }, [employeeId, key, monthStart]);
  const reload = () => setNonce((n) => n + 1);
  return state.key === key ? { ...state, reload } : { key, data: null, error: false, reload };
}

const thisMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };

function OverviewTab({ employee, duty, ordersToday, hr }) {
  const [month] = useState(thisMonth);
  const att = useMonthAttendance(employee._id, month);
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const today = toDateInput(new Date());
    getEmployeeStats(employee._id, { from: today, to: today })
      .then(({ data }) => { if (!cancelled) setStats(data.stats || {}); })
      .catch(() => { if (!cancelled) setStats({}); });
    return () => { cancelled = true; };
  }, [employee._id]);

  const status = duty?.status || "OFFLINE";
  const isChef = employee.role === "chef";
  const s = att.data?.summary;

  return (
    <div className="emp-grid2">
      <div className="zc-panel emp-panel">
        <h4>{t("Today")}</h4>
        <div className="emp-kv"><span>{t("Duty")}</span><b><Badge label={DUTY_LABEL[status]} kind={DUTY_KIND[status]} /></b></div>
        <div className="emp-kv"><span>{t("Signed in at")}</span><b>{duty?.firstLogin ? fmtTime(duty.firstLogin) : "—"}</b></div>
        <div className="emp-kv"><span>{t("Working time")}</span><b>{fmtDuration(duty?.workingSeconds)}</b></div>
        <div className="emp-kv"><span>{t("Break time")}</span><b>{fmtDuration(duty?.breakSeconds)}</b></div>
        {!duty && employee.status === "Inactive" && <div className="emp-kv"><span style={{ color: "var(--text-3)" }}>{t("Inactive accounts aren't tracked.")}</span></div>}
        {employee.status !== "Inactive" && <ShiftControl employee={employee} status={status} />}
      </div>

      {employee.role !== "staff" && <div className="zc-panel emp-panel">
        <h4>{t("Orders today")} <small>{isChef ? t("Kitchen") : t("Floor")}</small></h4>
        {!stats ? <Loader rows={2} /> : isChef ? (
          <>
            <div className="emp-kv"><span>{t("Prepared")}</span><b>{count(stats.preparedToday)}</b></div>
            <div className="emp-kv"><span>{t("Preparing (live)")}</span><b>{count(stats.preparing)}</b></div>
            <div className="emp-kv"><span>{t("Ready (live)")}</span><b>{count(stats.ready)}</b></div>
            <div className="emp-kv"><span>{t("Completed")}</span><b>{count(stats.completedToday)}</b></div>
          </>
        ) : (
          <>
            <div className="emp-kv"><span>{t("Orders")}</span><b>{count(stats.ordersToday ?? ordersToday)}</b></div>
            <div className="emp-kv"><span>{t("Active (live)")}</span><b>{count(stats.pending)}</b></div>
            <div className="emp-kv"><span>{t("Completed")}</span><b>{count(stats.completed)}</b></div>
          </>
        )}
      </div>}

      <div className="zc-panel emp-panel">
        <h4>{t("Customers")} <small>{isChef ? t("Food ratings") : t("Service ratings")}</small></h4>
        <div className="emp-kv"><span>{t("Average rating")}</span><b>{hr?.rating != null ? `${fmtNum(hr.rating)} ★` : "—"}</b></div>
        <div className="emp-kv"><span>{t("Reviews")}</span><b>{count(hr?.reviews)}</b></div>
        <div className="emp-kv"><span>{t("Complaints to look into")}</span><b style={hr?.openComplaints ? { color: "var(--stop-ink)" } : undefined}>{count(hr?.openComplaints)}</b></div>
      </div>

      <div className="zc-panel emp-panel">
        <h4>{t("Pay & leave")} <small>{fmtDate(month, { month: "long" })}</small></h4>
        <div className="emp-kv"><span>{t("Monthly salary")}</span><b>{employee.hr?.salary ? `₹${fmtNum(employee.hr.salary)}` : t("Not set")}</b></div>
        <div className="emp-kv"><span>{t("Salary this month")}</span><b>{hr?.pay?.paid ? t("Paid") : hr?.pay?.net != null ? `₹${fmtNum(hr.pay.net)}` : "—"}</b></div>
        <div className="emp-kv"><span>{t("Leave requests")}</span><b style={hr?.pendingLeave ? { color: "var(--wait-ink)" } : undefined}>{count(hr?.pendingLeave)}</b></div>
      </div>

      <div className="zc-panel emp-panel" style={{ gridColumn: "1 / -1" }}>
        <h4>{t("This month")} <small>{fmtDate(month, { month: "long", year: "numeric" })}</small></h4>
        {att.error ? <ErrorState onRetry={att.reload} /> : !att.data ? <Loader rows={2} /> : (
          <div className="emp-stats">
            <StatCard label={t("Working Days")} value={fmtNum(s.workingDays)} colorIdx={0} />
            <StatCard label={t("Total Hours")} value={fmtDuration(s.totalWorkingSeconds)} colorIdx={1} />
            <StatCard label={t("Break Hours")} value={fmtDuration(s.totalBreakSeconds)} colorIdx={3} />
            <StatCard
              label={t("Avg Hours/Day")}
              value={s.averageWorkingSeconds != null ? fmtDuration(s.averageWorkingSeconds) : "—"}
              sub={s.averageWorkingSeconds == null ? t("Not enough data yet") : undefined}
              colorIdx={2}
            />
          </div>
        )}
      </div>

      <div className="zc-panel emp-panel" style={{ gridColumn: "1 / -1" }}>
        <h4>{t("Orders")}</h4>
        <OrdersTab employee={employee} />
      </div>
    </div>
  );
}

// ── Attendance: month calendar + day list ──────────────────────────────────
const WEEKDAYS = [N_("Mo"), N_("Tu"), N_("We"), N_("Th"), N_("Fr"), N_("Sa"), N_("Su")];

function AttendanceTab({ employee }) {
  const [month, setMonth] = useState(thisMonth);
  const att = useMonthAttendance(employee._id, month);
  const now = new Date();
  const isCurrent = month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();
  const shift = (n) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  const byDay = new Map((att.data?.days || []).map((d) => [new Date(d.date).getDate(), d]));
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const lead = (month.getDay() + 6) % 7; // Monday-first grid

  return (
    <div>
      <div className="emp-calh">
        <button type="button" className="zc-btn sm ghost" onClick={() => shift(-1)} aria-label={t("Previous month")}>‹</button>
        <b>{fmtDate(month, { month: "long", year: "numeric" })}</b>
        <button type="button" className="zc-btn sm ghost" onClick={() => shift(1)} disabled={isCurrent} aria-label={t("Next month")}>›</button>
      </div>

      {att.error ? <ErrorState onRetry={att.reload} /> : !att.data ? <Loader rows={4} /> : (
        <>
          <div className="emp-cal">
            {WEEKDAYS.map((d) => <div key={d} className="h">{t(d)}</div>)}
            {Array.from({ length: lead }).map((_, i) => <div key={`l${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
              const date = new Date(month.getFullYear(), month.getMonth(), day);
              const rec = byDay.get(day);
              const today = isCurrent && day === now.getDate();
              const future = date > now && !today;
              const cls = rec ? (rec.logout ? "work" : "open") : future ? "future" : "";
              return (
                <div key={day} className={`d ${cls}${today ? " today" : ""}`} title={rec ? `${fmtTime(rec.login)} – ${rec.logout ? fmtTime(rec.logout) : t("now")} · ${fmtDuration(rec.workingSeconds)}` : undefined}>
                  {fmtNum(day)}
                  {rec && <small>{fmtDuration(rec.workingSeconds)}</small>}
                </div>
              );
            })}
          </div>
          <div className="emp-legend">
            <span><i style={{ background: "var(--ready-fill)", border: "1px solid var(--ready-line)" }} />{t("Worked")}</span>
            <span><i style={{ background: "var(--live-fill)", border: "1px solid var(--live-line)" }} />{t("On duty now")}</span>
            <span><i style={{ border: "1px dashed var(--edge-hi)" }} />{t("No duty")}</span>
          </div>

          <div style={{ marginTop: 16 }}>
            <TableShell
              headers={[N_("Date"), N_("Login"), N_("Logout"), N_("Break"), N_("Working Time")]}
              isEmpty={att.data.days.length === 0}
              emptyText={t("No attendance this month")}
              minWidth={480}
            >
              {att.data.days.map((d) => (
                <tr key={d.date}>
                  <td>{fmtDate(d.date, { day: "2-digit", month: "short" })}</td>
                  <td>{d.login ? fmtTime(d.login) : "—"}</td>
                  <td>{d.logout ? fmtTime(d.logout) : "—"}</td>
                  <td>{fmtDuration(d.breakSeconds)}</td>
                  <td>{fmtDuration(d.workingSeconds)}</td>
                </tr>
              ))}
            </TableShell>
          </div>
        </>
      )}
    </div>
  );
}

// ── Orders: range presets + the existing stats endpoint ────────────────────
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const RANGE_PRESETS = [
  { key: "today", label: N_("Today"), range: () => ({ from: toDateInput(new Date()), to: toDateInput(new Date()) }) },
  { key: "yesterday", label: N_("Yesterday"), range: () => ({ from: toDateInput(daysAgo(1)), to: toDateInput(daysAgo(1)) }) },
  { key: "week", label: N_("Last 7 Days"), range: () => ({ from: toDateInput(daysAgo(6)), to: toDateInput(new Date()) }) },
  { key: "month", label: N_("Last 30 Days"), range: () => ({ from: toDateInput(daysAgo(29)), to: toDateInput(new Date()) }) },
];

function OrdersTab({ employee, initial = "week" }) {
  const start = RANGE_PRESETS.find((p) => p.key === initial) || RANGE_PRESETS[0];
  const [preset, setPreset] = useState(start.key);
  const [from, setFrom] = useState(() => start.range().from);
  const [to, setTo] = useState(() => start.range().to);
  const [result, setResult] = useState({ key: null, stats: null });
  const key = `${employee._id}|${from}|${to}`;

  useEffect(() => {
    let cancelled = false;
    getEmployeeStats(employee._id, { from, to })
      .then(({ data }) => { if (!cancelled) setResult({ key, stats: data.stats }); })
      .catch(() => { if (!cancelled) { setResult({ key, stats: {} }); toast.error(t("Couldn't load stats")); } });
    return () => { cancelled = true; };
  }, [employee._id, from, to, key]);

  const applyPreset = (k) => { setPreset(k); const r = RANGE_PRESETS.find((p) => p.key === k).range(); setFrom(r.from); setTo(r.to); };
  const stats = result.key === key ? result.stats : null;
  const isChef = employee.role === "chef";

  return (
    <div>
      <div className="emp-presets">
        <div className="zc-seg">
          {RANGE_PRESETS.map((p) => (
            <button type="button" key={p.key} className={preset === p.key ? "on" : ""} onClick={() => applyPreset(p.key)}>{t(p.label)}</button>
          ))}
        </div>
      </div>
      <div className="emp-range">
        <input className="zc-input" type="date" value={from} max={to} onChange={(e) => { setPreset(""); setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} aria-label={t("From")} />
        <span>{t("to")}</span>
        <input className="zc-input" type="date" value={to} min={from} max={toDateInput(new Date())} onChange={(e) => { setPreset(""); setTo(e.target.value); if (from > e.target.value) setFrom(e.target.value); }} aria-label={t("To")} />
      </div>
      {!stats ? <Loader rows={2} /> : (
        <div className="emp-stats">
          {isChef ? (
            <>
              <StatCard label={t("Prepared")} value={count(stats.preparedToday)} colorIdx={0} />
              <StatCard label={t("Preparing (live)")} value={count(stats.preparing)} colorIdx={3} />
              <StatCard label={t("Ready (live)")} value={count(stats.ready)} colorIdx={1} />
              <StatCard label={t("Completed")} value={count(stats.completedToday)} colorIdx={2} />
            </>
          ) : (
            <>
              <StatCard label={t("Orders")} value={count(stats.ordersToday)} colorIdx={0} />
              <StatCard label={t("Active (live)")} value={count(stats.pending)} colorIdx={3} />
              <StatCard label={t("Completed")} value={count(stats.completed)} colorIdx={1} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
