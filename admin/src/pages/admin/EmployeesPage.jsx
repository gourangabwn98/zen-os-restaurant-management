// src/pages/admin/EmployeesPage.jsx — Admin → Management → Employees
// Layout: team strip on top, people list on the left, the selected person on
// the right (Overview / Attendance / Orders). Data is all existing endpoints:
//   GET   /admin/employees                 the people (CRUD as before)
//   PATCH /admin/employees/:id/status      activate / deactivate
//   GET   /admin/attendance/today          live duty status + today's hours
//   GET   /admin/employees/performance     today's order counts per person
//   GET   /admin/attendance/duty-history   ON/OFF audit log (employees/DutyHistory.jsx)
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import toast from "react-hot-toast";
import { getEmployees, setEmployeeStatus, getEmployeePerformance, getHrSummary } from "../../services/adminService.js";
import { getAttendanceToday } from "../../services/attendanceService.js";
import { getSocket } from "../../services/socketService.js";
import { useVisibleInterval } from "../../hooks/useVisibleInterval.js";
import { PageHeader, Loader, EmptyState, Badge } from "./shared/index.js";
import ErrorState from "./shared/ErrorState.jsx";
import EmployeeForm from "./employees/EmployeeForm.jsx";
import EmployeeProfile from "./employees/EmployeeProfile.jsx";
import DutyHistory from "./employees/DutyHistory.jsx";
import { DUTY_LABEL, initials, fmtDuration, count, roleText } from "./employees/shared.js";
import { t, N_, tn, fmtTime, fmtNum, fmtDate } from "../../i18n/core.js";
import "./employees/employees.css";
import { useAuth } from "../../hooks/useAuth.js";
import { isManager } from "../../utils/access.js";

const STAFF_ROLES = ["manager", "waiter", "chef", "staff"];
const ROLE_FILTERS = [
  { key: "", label: N_("All") },
  { key: "manager", label: N_("Managers"), adminOnly: true },
  { key: "waiter", label: N_("Waiters") },
  { key: "chef", label: N_("Chefs") },
  { key: "staff", label: N_("Others") },
];
const DUTY_FILTER_LABEL = { on: N_("On duty now"), worked: N_("Worked today") };

export default function EmployeesPage() {
  const managerView = isManager(useAuth().user); // a manager doesn't see other managers
  const [employees, setEmployees] = useState(null); // null = loading
  const [loadError, setLoadError] = useState(false);
  const [attendance, setAttendance] = useState([]); // today's rows, incl. admins
  const [performance, setPerformance] = useState([]);
  const [hr, setHr] = useState(null); // GET /admin/employees/hr/summary
  const [tab, setTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dutyFilter, setDutyFilter] = useState(""); // "" | on | worked
  const [selectedId, setSelectedId] = useState(null);
  const [formFor, setFormFor] = useState(null); // null | "new" | employee
  const [customRoles, setCustomRoles] = useState([]); // EMP-03 job titles already in use
  const profileRef = useRef(null);
  const listRef = useRef(null);

  // The whole team is a few dozen people at most, so it is loaded once and
  // searched / filtered instantly in the browser.
  const loadEmployees = useCallback(async () => {
    try {
      const { data } = await getEmployees({});
      setEmployees(data.employees || []);
      setCustomRoles(data.customRoles || []);
      setLoadError(false);
    } catch {
      setLoadError(true);
      toast.error(t("Couldn't load employees"));
    }
  }, []);

  const loadLive = useCallback(() => {
    getAttendanceToday({}).then(({ data }) => setAttendance(data.employees || [])).catch(() => {});
    getEmployeePerformance({}).then(({ data }) => setPerformance(data.performance || [])).catch(() => {});
  }, []);

  const loadHr = useCallback(() => {
    getHrSummary({}).then(({ data }) => setHr(data)).catch(() => {});
  }, []);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);
  useEffect(() => { loadHr(); }, [loadHr]);
  useVisibleInterval(loadHr, 60000);
  useEffect(() => { loadLive(); }, [loadLive]);
  useVisibleInterval(loadLive, 20000);
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    socket.on("employee:attendance:updated", loadLive);
    return () => socket.off("employee:attendance:updated", loadLive);
  }, [loadLive]);

  const dutyById = useMemo(() => new Map(attendance.map((r) => [String(r.employee._id), r])), [attendance]);
  const ordersById = useMemo(() => new Map(performance.map((p) => [String(p._id), p.orderCount || 0])), [performance]);

  // ── team strip (staff only; admins are attendance-only) ──────────────────
  const staffRows = attendance.filter((r) => STAFF_ROLES.includes(r.employee.role));
  const onDuty = staffRows.filter((r) => r.status === "ONLINE" || r.status === "BREAK");
  const onBreak = staffRows.filter((r) => r.status === "BREAK").length;
  const worked = staffRows.filter((r) => r.firstLogin);
  const hours = staffRows.reduce((s, r) => s + (r.workingSeconds || 0), 0);
  const floorOrders = performance.filter((p) => p.role === "waiter").reduce((s, p) => s + (p.orderCount || 0), 0);
  const kitchenOrders = performance.filter((p) => p.role === "chef").reduce((s, p) => s + (p.orderCount || 0), 0);
  const inactiveCount = (employees || []).filter((e) => e.status === "Inactive").length;
  const activeCount = (employees || []).length - inactiveCount;

  // ── list ──────────────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const matchesSearch = (name, phone) => !q || name?.toLowerCase().includes(q) || String(phone || "").includes(q);
  const dutyOf = (id) => dutyById.get(String(id))?.status || "OFFLINE";
  const passesDuty = (id) => {
    const row = dutyById.get(String(id));
    if (dutyFilter === "on") return row && (row.status === "ONLINE" || row.status === "BREAK");
    if (dutyFilter === "worked") return !!row?.firstLogin;
    return true;
  };

  const visible = useMemo(() => {
    if (!employees) return [];
    const rank = { ONLINE: 0, BREAK: 1, OFFLINE: 2 };
    return employees
      .filter((e) => (!roleFilter || e.role === roleFilter)
        && (!statusFilter || e.status === statusFilter)
        && matchesSearch(e.name, e.phone) && passesDuty(e._id))
      .sort((a, b) => ((a.status === "Inactive") - (b.status === "Inactive"))
        || (rank[dutyOf(a._id)] - rank[dutyOf(b._id)])
        || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, roleFilter, statusFilter, q, dutyFilter, dutyById]);

  const admins = attendance.filter((r) => r.employee.role === "admin"
    && !roleFilter && !statusFilter && dutyFilter !== "worked"
    && matchesSearch(r.employee.name, r.employee.phone)
    && (dutyFilter !== "on" || r.status !== "OFFLINE"));

  // Duty history's employee filter: every staff member plus the admins.
  const historyPeople = useMemo(() => {
    const staff = (employees || []).map((e) => ({ _id: e._id, name: e.name, role: e.role, jobTitle: e.jobTitle }));
    const seen = new Set(staff.map((p) => String(p._id)));
    const adminRows = attendance.filter((r) => r.employee.role === "admin" && !seen.has(String(r.employee._id)))
      .map((r) => ({ _id: r.employee._id, name: r.employee.name, role: "admin" }));
    return [...staff, ...adminRows].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [employees, attendance]);

  const selected = visible.find((e) => e._id === selectedId) || visible[0] || null;
  const visibleIds = () => visible.map((e) => String(e._id));

  const scrollToProfile = () => {
    // Stacked layout (tablet / phone): bring the profile into view.
    requestAnimationFrame(() => {
      const p = profileRef.current, l = listRef.current;
      if (p && l && p.getBoundingClientRect().top > l.getBoundingClientRect().bottom - 4) {
        p.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  };
  const select = (id) => { setSelectedId(id); scrollToProfile(); };
  const handleEmployeeUpdated = (emp) => {
    if (!emp?._id) return;
    setEmployees((list) => list.map((e) => (e._id === emp._id ? { ...e, ...emp } : e)));
    loadHr();
  };

  const handleToggleStatus = async (emp) => {
    const next = emp.status === "Active" ? "Inactive" : "Active";
    try {
      await setEmployeeStatus(emp._id, next);
      setEmployees((list) => list.map((e) => (e._id === emp._id ? { ...e, status: next } : e)));
      toast.success(t("{name} is now {status}", { name: emp.name, status: t(next) }));
      loadLive();
    } catch (err) {
      toast.error(err.response?.data?.message || t("Couldn't update status"));
      throw err;
    }
  };

  const handleSaved = (saved) => {
    setFormFor(null);
    if (saved?._id) {
      setEmployees((list) => {
        const exists = (list || []).some((e) => e._id === saved._id);
        return exists ? list.map((e) => (e._id === saved._id ? { ...e, ...saved } : e)) : [saved, ...(list || [])];
      });
      setSelectedId(saved._id);
    }
    loadEmployees();
  };

  const people = hr?.people || {};
  const totals = hr?.totals;
  const firstWith = (pred) => visibleIds().find((id) => pred(people[id] || {}));
  const monthName = hr ? fmtDate(new Date(`${hr.month}-01T00:00:00`), { month: "long" }) : "";
  const stripCells = [
    { key: "on", k: t("On duty now"), v: `${count(onDuty.length)} / ${count(activeCount)}`, d: `${tn(onBreak, "{n} on break", "{n} on break")} · ${t("Worked today")} ${count(worked.length)}`, color: onDuty.length ? "var(--ready-ink)" : undefined },
    { key: "orders", k: t("Orders today"), v: count(floorOrders + kitchenOrders), d: `${t("{f} floor · {k} kitchen", { f: count(floorOrders), k: count(kitchenOrders) })} · ${fmtDuration(hours)}` },
    { key: "leave", k: t("Leave requests"), v: totals ? count(totals.pendingLeaves) : "—", d: totals?.pendingLeaves ? t("Waiting for you") : "✓", color: totals?.pendingLeaves ? "var(--live-ink)" : undefined },
    { key: "complaints", k: t("Complaints to look into"), v: totals ? count(totals.openComplaints) : "—", d: totals?.openComplaints ? t("From customers") : "✓", color: totals?.openComplaints ? "var(--stop-ink)" : totals ? "var(--ready-ink)" : undefined },
    { key: "pay", k: t("{month} salary", { month: monthName }), v: totals ? `₹${fmtNum(totals.salaryDue)}` : "—", d: totals ? (totals.unpaidPeople ? tn(totals.unpaidPeople, "{n} person to pay", "{n} people to pay") : t("All paid ✓")) : "" },
  ];
  // Each cell jumps to the first person it is about, on the matching tab.
  const onStrip = (key) => {
    if (key === "on") { setStatusFilter(""); setDutyFilter((d) => (d === "on" ? "" : "on")); return; }
    if (key === "orders") { setDutyFilter((d) => (d === "worked" ? "" : "worked")); return; }
    const target = key === "leave" ? firstWith((x) => x.pendingLeave > 0)
      : key === "complaints" ? firstWith((x) => x.openComplaints > 0)
      : firstWith((x) => x.pay && !x.pay.paid && !x.pay.noSalary) || visibleIds()[0];
    if (target) { setSelectedId(target); setTab(key === "complaints" ? "reviews" : key); scrollToProfile(); }
  };
  const stripOn = (key) => (key === "on" ? dutyFilter === "on" : key === "orders" ? dutyFilter === "worked" : false);

  const subLine = employees
    ? [tn(employees.length, "{n} person", "{n} people"), tn(employees.filter((e) => e.role === "waiter").length, "{n} waiter", "{n} waiters"), tn(employees.filter((e) => e.role === "chef").length, "{n} chef", "{n} chefs"),
      ...(employees.some((e) => e.role === "staff") ? [tn(employees.filter((e) => e.role === "staff").length, "{n} other", "{n} others")] : [])].join(" · ")
    : t("Waiters and kitchen staff — created here, log in with their own phone + OTP");

  return (
    <div className="emp">
      <PageHeader
        title={t("Employees")}
        sub={subLine}
        right={<button type="button" className="zc-btn pri" onClick={() => setFormFor("new")}>+ {t("Add Employee")}</button>}
      />

      {loadError && !employees ? (
        <div className="zc-card"><ErrorState onRetry={loadEmployees} /></div>
      ) : employees && employees.length === 0 ? (
        <div className="zc-card">
          <EmptyState
            title={t("No employees yet")}
            sub={t("Add your waiters and kitchen staff. Each one signs in with their own phone and OTP.")}
            action={<button type="button" className="zc-btn pri" onClick={() => setFormFor("new")}>+ {t("Add Employee")}</button>}
          />
        </div>
      ) : (
        <>
          <div className="zc-card emp-strip">
            {stripCells.map((c) => {
              const inner = (
                <>
                  <span className="k">{c.k}</span>
                  <span className="v tnum" style={c.color ? { color: c.color } : undefined}>{c.v}</span>
                  <span className="d">{c.d}</span>
                </>
              );
              return c.key
                ? <button type="button" key={c.k} aria-pressed={!!stripOn(c.key)} onClick={() => onStrip(c.key)}>{inner}</button>
                : <div key={c.k}>{inner}</div>;
            })}
          </div>

          <div className="emp-body">
            <div className="zc-card emp-list" ref={listRef}>
              <div className="emp-tools">
                <input className="zc-input" type="search" placeholder={t("Search name or phone…")} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t("Search name or phone…")} />
                <div className="row">
                  <div className="zc-seg" role="group" aria-label={t("Role")}>
                    {ROLE_FILTERS.filter((r) => !r.adminOnly || !managerView).map((r) => (
                      <button type="button" key={r.key || "all"} className={roleFilter === r.key ? "on" : ""} onClick={() => setRoleFilter(r.key)}>{t(r.label)}</button>
                    ))}
                  </div>
                  <select className="zc-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t("All statuses")}>
                    <option value="">{t("All statuses")}</option>
                    <option value="Active">{t("Active")}</option>
                    <option value="Inactive">{t("Inactive")}</option>
                  </select>
                </div>
                {dutyFilter && (
                  <div className="row">
                    <button type="button" className="zc-btn sm ghost" onClick={() => setDutyFilter("")}>
                      {t(DUTY_FILTER_LABEL[dutyFilter])} ✕
                    </button>
                  </div>
                )}
              </div>

              {!employees ? <Loader rows={4} /> : (
                <>
                  <div className="emp-grp">{t("Staff")} · {count(visible.length)}</div>
                  {visible.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: "var(--text-3)", padding: "14px 6px" }}>{t("No employees found")}</div>
                  ) : (
                    <div className="emp-rows">
                      {visible.map((e) => {
                        const row = dutyById.get(String(e._id));
                        const st = row?.status || "OFFLINE";
                        const inactive = e.status === "Inactive";
                        return (
                          <button
                            type="button" key={e._id}
                            className={`emp-row${inactive ? " off" : ""}`}
                            aria-current={selected?._id === e._id}
                            onClick={() => select(e._id)}
                          >
                            <span className={`emp-av ${e.role}`}>{initials(e.name)}</span>
                            <span style={{ minWidth: 0 }}>
                              <span className="nm"><span>{e.name}</span><Badge label={roleText(e)} kind="vio" dot={false} /></span>
                              <span className="sub">
                                {inactive ? <span>{t("Inactive")}</span> : (
                                  <>
                                    <i className={`emp-dot ${st}`} />
                                    <span>
                                      {t(DUTY_LABEL[st])}
                                      {st !== "OFFLINE" && row?.firstLogin ? ` · ${t("since {time}", { time: fmtTime(row.firstLogin) })}` : ""}
                                    </span>
                                  </>
                                )}
                              </span>
                            </span>
                            {(() => {
                              const x = people[String(e._id)] || {};
                              const flags = [];
                              if (x.openComplaints) flags.push(<Badge key="c" label={N_("Complaint")} kind="stop" dot={false} />);
                              if (x.pendingLeave) flags.push(<Badge key="l" label={N_("Leave request")} kind="live" dot={false} />);
                              return flags.length ? <span className="flags" style={{ gridColumn: "2 / 4" }}>{flags}</span> : null;
                            })()}
                            <span className="cnt tnum" style={{ gridRow: 1, gridColumn: 3 }}>
                              {count(ordersById.get(String(e._id)))}
                              <small>{t("orders today")}</small>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {admins.length > 0 && (
                    <>
                      <div className="emp-grp">{t("Admins · attendance only")}</div>
                      <div className="emp-rows">
                        {admins.map((r) => (
                          <div className="emp-row static" key={r.employee._id}>
                            <span className="emp-av admin">{initials(r.employee.name)}</span>
                            <span style={{ minWidth: 0 }}>
                              <span className="nm"><span>{r.employee.name || t("Admin")}</span></span>
                              <span className="sub">
                                <i className={`emp-dot ${r.status}`} />
                                <span>{t(DUTY_LABEL[r.status] || r.status)}{r.firstLogin && r.status !== "OFFLINE" ? ` · ${t("since {time}", { time: fmtTime(r.firstLogin) })}` : ""}</span>
                              </span>
                            </span>
                            <span />
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            <div ref={profileRef} style={{ minWidth: 0, scrollMarginTop: 16 }}>
              {!employees ? (
                <div className="zc-card emp-prof"><Loader rows={6} /></div>
              ) : selected ? (
                <EmployeeProfile
                  key={selected._id}
                  employee={selected}
                  duty={dutyById.get(String(selected._id))}
                  ordersToday={ordersById.get(String(selected._id))}
                  hr={people[String(selected._id)]}
                  policy={hr?.policy}
                  tab={tab}
                  onTab={setTab}
                  onEdit={(emp) => setFormFor(emp)}
                  onToggleStatus={handleToggleStatus}
                  onEmployeeUpdated={handleEmployeeUpdated}
                  onHrChanged={loadHr}
                />
              ) : (
                <div className="zc-card"><EmptyState title={t("No employees found")} sub={t("Try another search or filter.")} /></div>
              )}
            </div>
          </div>

          <DutyHistory people={historyPeople} />
        </>
      )}

      {formFor && (
        <EmployeeForm
          employee={formFor === "new" ? null : formFor}
          customRoles={customRoles}
          onClose={() => setFormFor(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
