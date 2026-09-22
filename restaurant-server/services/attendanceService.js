// services/attendanceService.js
// ─────────────────────────────────────────────────────────────────────────────
// Employee attendance/presence/break tracking. "Employee" here means the
// same User doc used everywhere else in this system (role: admin|waiter|
// chef) — see services/employeeService.js. Pure functions taking specific
// models directly, matching employeeService.js's style (no req/res, no
// multi-collection transaction — every mutation touches exactly one
// AttendanceSession document).
//
// Duplicate-session protection is enforced at the DB layer by the partial
// unique index on {employee,status:"OPEN"} (config/getModels.js) — the
// SAME pattern as TableSession's "one open session per table". startDuty()
// below catches the resulting duplicate-key error and resumes the existing
// session instead of erroring, mirroring services/kotService.js.
// ─────────────────────────────────────────────────────────────────────────────

import {
  assertCanStartBreak, assertCanEndBreak, assertCanEndDuty,
} from "../utils/attendanceStateMachine.js";

export const DEFAULT_HEARTBEAT_GRACE_MS = 5 * 60 * 1000; // 5 minutes — ~10 missed 30s heartbeats

// ── "Today" boundary — server-local time, same idiom as employeeService.js's
// todayRange() and every other "today" query in this codebase. No TZ env
// var exists anywhere in this repo; deliberately not introducing one here. ──
const todayRange = (ref = new Date()) => {
  const start = new Date(ref); start.setHours(0, 0, 0, 0);
  const end = new Date(ref); end.setHours(23, 59, 59, 999);
  return { start, end };
};

const dayRangeFilter = (from, to) => {
  const filter = {};
  if (from) { const d = new Date(from); d.setHours(0, 0, 0, 0); filter.$gte = d; }
  if (to)   { const d = new Date(to);   d.setHours(23, 59, 59, 999); filter.$lte = d; }
  return Object.keys(filter).length ? filter : null;
};

// ── Closure math — pure, no I/O ─────────────────────────────────────────────
// Closes any still-open break as of `at`, then computes net working time.
// Never mutates the input; returns the fields to $set.
const closeSessionFields = (session, { at, autoClosed }) => {
  let breaks = session.breaks || [];
  let totalBreakSeconds = session.totalBreakSeconds || 0;

  if (session.presenceStatus === "BREAK" && breaks.length) {
    const lastIdx = breaks.length - 1;
    const last = breaks[lastIdx];
    if (last && !last.endedAt) {
      const duration = Math.max(0, Math.round((at - new Date(last.startedAt)) / 1000));
      breaks = [
        ...breaks.slice(0, lastIdx),
        { startedAt: last.startedAt, endedAt: at, durationSeconds: duration },
      ];
      totalBreakSeconds += duration;
    }
  }

  const grossSeconds = Math.max(0, Math.round((at - new Date(session.loginAt)) / 1000));
  const totalWorkingSeconds = Math.max(0, grossSeconds - totalBreakSeconds);

  return {
    status: "CLOSED",
    presenceStatus: "OFFLINE",
    logoutAt: at,
    breaks,
    totalBreakSeconds,
    totalWorkingSeconds,
    autoClosed: !!autoClosed,
  };
};

/** Working seconds so far for a session that may still be OPEN — used for
 * live "today" / live dashboard displays. For a CLOSED session, the stored
 * totalWorkingSeconds is authoritative and returned as-is. */
const liveWorkingSeconds = (session, now = new Date()) => {
  if (session.status === "CLOSED") return session.totalWorkingSeconds || 0;
  const openBreak = (session.breaks || []).find((b) => !b.endedAt);
  const uptoTime = session.presenceStatus === "BREAK" && openBreak ? new Date(openBreak.startedAt) : now;
  const grossSeconds = Math.max(0, Math.round((uptoTime - new Date(session.loginAt)) / 1000));
  return Math.max(0, grossSeconds - (session.totalBreakSeconds || 0));
};

/** Aggregates a list of sessions (same employee, one day or all-time) into
 * one summary — used by both the self-service "today" view and the admin
 * live board's per-employee row. */
export const summarizeAttendanceSessions = (sessions, now = new Date()) => {
  let totalWorkingSeconds = 0, totalBreakSeconds = 0;
  let firstLogin = null, lastLogout = null, currentStatus = "OFFLINE";

  for (const s of sessions) {
    totalWorkingSeconds += liveWorkingSeconds(s, now);
    totalBreakSeconds += s.totalBreakSeconds || 0;
    if (!firstLogin || s.loginAt < firstLogin) firstLogin = s.loginAt;
    if (s.status === "CLOSED" && s.logoutAt && (!lastLogout || s.logoutAt > lastLogout)) lastLogout = s.logoutAt;
    if (s.status === "OPEN") currentStatus = s.presenceStatus;
  }

  return { sessions, totalWorkingSeconds, totalBreakSeconds, firstLogin, lastLogout, currentStatus };
};

// ── Self-service mutations ──────────────────────────────────────────────────

export const startDuty = async ({ AttendanceSession, employeeId, role, employeeName }) => {
  const now = new Date();
  try {
    const created = await AttendanceSession.create({
      employee: employeeId, role, employeeName: employeeName || "",
      status: "OPEN", presenceStatus: "ONLINE",
      loginAt: now, lastSeenAt: now,
    });
    return { session: created, resumed: false };
  } catch (err) {
    if (err?.code === 11000) {
      const existing = await AttendanceSession.findOne({ employee: employeeId, status: "OPEN" });
      if (existing) return { session: existing, resumed: true };
    }
    throw err;
  }
};

export const startBreak = async ({ AttendanceSession, employeeId }) => {
  const session = await AttendanceSession.findOne({ employee: employeeId, status: "OPEN" });
  assertCanStartBreak(session);

  const at = new Date();
  const updated = await AttendanceSession.findOneAndUpdate(
    { _id: session._id, status: "OPEN", presenceStatus: "ONLINE" },
    {
      $set:  { presenceStatus: "BREAK" },
      $push: { breaks: { startedAt: at, endedAt: null, durationSeconds: 0 } },
    },
    { new: true }
  );
  if (!updated) {
    const err = new Error("Could not start break — status changed, please retry");
    err.statusCode = 409;
    throw err;
  }
  return updated;
};

export const endBreak = async ({ AttendanceSession, employeeId }) => {
  const session = await AttendanceSession.findOne({ employee: employeeId, status: "OPEN" });
  assertCanEndBreak(session);

  const breaks = session.breaks || [];
  const lastIdx = breaks.length - 1;
  const last = breaks[lastIdx];
  if (!last || last.endedAt) {
    const err = new Error("No open break to end");
    err.statusCode = 409;
    throw err;
  }

  const at = new Date();
  const duration = Math.max(0, Math.round((at - new Date(last.startedAt)) / 1000));
  const newBreaks = [...breaks.slice(0, lastIdx), { startedAt: last.startedAt, endedAt: at, durationSeconds: duration }];
  const totalBreakSeconds = (session.totalBreakSeconds || 0) + duration;

  const updated = await AttendanceSession.findOneAndUpdate(
    { _id: session._id, status: "OPEN", presenceStatus: "BREAK" },
    { $set: { presenceStatus: "ONLINE", breaks: newBreaks, totalBreakSeconds } },
    { new: true }
  );
  if (!updated) {
    const err = new Error("Could not resume duty — status changed, please retry");
    err.statusCode = 409;
    throw err;
  }
  return updated;
};

export const endDuty = async ({ AttendanceSession, employeeId }) => {
  const session = await AttendanceSession.findOne({ employee: employeeId, status: "OPEN" });
  assertCanEndDuty(session);

  const at = new Date();
  const fields = closeSessionFields(session, { at, autoClosed: false });
  const updated = await AttendanceSession.findOneAndUpdate(
    { _id: session._id, status: "OPEN" },
    { $set: fields },
    { new: true }
  );
  if (!updated) {
    const err = new Error("Duty session was already ended");
    err.statusCode = 409;
    throw err;
  }
  return updated;
};

/** Called on the `employee:attendance:heartbeat` socket event — one cheap
 * single-field conditional update, never a per-second write. Best-effort:
 * a stray heartbeat after the session already closed is a silent no-op. */
export const recordHeartbeat = async ({ AttendanceSession, employeeId }) => {
  await AttendanceSession.findOneAndUpdate(
    { employee: employeeId, status: "OPEN" },
    { $set: { lastSeenAt: new Date() } }
  );
};

/** Closes OPEN sessions whose heartbeat has gone quiet for longer than the
 * grace period. Uses each session's own last known `lastSeenAt` as the
 * logout time — never "now" — so no session ever gets a fabricated logout
 * time. Race-safe against a heartbeat/manual-end arriving concurrently: the
 * closing update is guarded by the exact `lastSeenAt` read, so if either
 * one lands first this sweep simply skips that document instead of
 * double-closing or overwriting fresher data. */
export const sweepStaleAttendanceSessions = async ({ AttendanceSession, graceMs = DEFAULT_HEARTBEAT_GRACE_MS, now = new Date() }) => {
  const staleThreshold = new Date(now.getTime() - graceMs);
  const candidates = await AttendanceSession.find({ status: "OPEN", lastSeenAt: { $lt: staleThreshold } });

  const closed = [];
  for (const doc of candidates) {
    const at = doc.lastSeenAt;
    const fields = closeSessionFields(doc, { at, autoClosed: true });
    const updated = await AttendanceSession.findOneAndUpdate(
      { _id: doc._id, status: "OPEN", lastSeenAt: doc.lastSeenAt },
      { $set: fields },
      { new: true }
    );
    if (updated) closed.push(updated);
  }
  return closed;
};

// ── Self-service reads ──────────────────────────────────────────────────────

export const getMySession = ({ AttendanceSession, employeeId }) =>
  AttendanceSession.findOne({ employee: employeeId, status: "OPEN" });

export const getMyToday = async ({ AttendanceSession, employeeId }) => {
  const { start, end } = todayRange();
  const sessions = await AttendanceSession.find({
    employee: employeeId, loginAt: { $gte: start, $lte: end },
  }).sort({ loginAt: 1 });
  return summarizeAttendanceSessions(sessions);
};

// ── Admin reads ──────────────────────────────────────────────────────────────

const EMPLOYEE_ROLES_ALL = ["admin", "waiter", "chef"];

/** Live board: every active employee + their today status, grouped by role
 * on the frontend (kept flat here — filtering/grouping is a display
 * concern, not a data-shape one). */
export const listTodayForAdmin = async ({ AttendanceSession, User, role }) => {
  const roleFilter = role && EMPLOYEE_ROLES_ALL.includes(role) ? [role] : EMPLOYEE_ROLES_ALL;
  const employees = await User.find({ role: { $in: roleFilter }, status: { $ne: "Inactive" } })
    .select("name phone role").sort({ name: 1 });

  const { start, end } = todayRange();
  const sessions = await AttendanceSession.find({
    employee: { $in: employees.map((e) => e._id) },
    loginAt: { $gte: start, $lte: end },
  }).sort({ loginAt: 1 });

  const byEmployee = new Map();
  for (const s of sessions) {
    const key = String(s.employee);
    if (!byEmployee.has(key)) byEmployee.set(key, []);
    byEmployee.get(key).push(s);
  }

  return employees.map((emp) => {
    const summary = summarizeAttendanceSessions(byEmployee.get(String(emp._id)) || []);
    return {
      employee: { _id: emp._id, name: emp.name, phone: emp.phone, role: emp.role },
      status: summary.currentStatus,
      workingSeconds: summary.totalWorkingSeconds,
      breakSeconds: summary.totalBreakSeconds,
      firstLogin: summary.firstLogin,
      lastLogout: summary.lastLogout,
    };
  });
};

/** Date-wise / filterable attendance history, paginated so the frontend
 * never has to download the whole collection to filter client-side. */
export const listHistory = async ({ AttendanceSession, from, to, employeeId, role, status, page = 1, limit = 50 }) => {
  const filter = {};
  if (employeeId) filter.employee = employeeId;
  if (role && EMPLOYEE_ROLES_ALL.includes(role)) filter.role = role;
  if (status === "OPEN" || status === "CLOSED") filter.status = status;
  const loginAtFilter = dayRangeFilter(from, to);
  if (loginAtFilter) filter.loginAt = loginAtFilter;

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const skip = (safePage - 1) * safeLimit;

  const [sessions, total] = await Promise.all([
    AttendanceSession.find(filter).sort({ loginAt: -1 }).skip(skip).limit(safeLimit),
    AttendanceSession.countDocuments(filter),
  ]);
  return { sessions, total, page: safePage, limit: safeLimit };
};

/** One employee's full per-day history + summary, for the detail page.
 * A "day" is grouped by the session's loginAt calendar date (its shift's
 * start day), so a midnight-crossing shift is never split or double-counted. */
export const getEmployeeHistory = async ({ AttendanceSession, employeeId, from, to }) => {
  const filter = { employee: employeeId };
  const loginAtFilter = dayRangeFilter(from, to);
  if (loginAtFilter) filter.loginAt = loginAtFilter;

  const sessions = await AttendanceSession.find(filter).sort({ loginAt: -1 });

  const byDay = new Map();
  for (const s of sessions) {
    const dayKey = new Date(s.loginAt); dayKey.setHours(0, 0, 0, 0);
    const key = dayKey.toISOString();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(s);
  }

  const days = [...byDay.entries()]
    .sort((a, b) => new Date(b[0]) - new Date(a[0]))
    .map(([dayKey, daySessions]) => {
      const summary = summarizeAttendanceSessions(daySessions);
      return {
        date: dayKey,
        login: summary.firstLogin,
        logout: summary.lastLogout,
        breakSeconds: summary.totalBreakSeconds,
        workingSeconds: summary.totalWorkingSeconds,
      };
    });

  // Only fully-closed days count toward completed-day stats — an in-progress
  // day shouldn't drag down (or inflate) "average working hours".
  const closedDays = days.filter((d) => d.logout);
  const workingDays = closedDays.length;
  const totalWorkingSeconds = closedDays.reduce((sum, d) => sum + d.workingSeconds, 0);
  const totalBreakSeconds = closedDays.reduce((sum, d) => sum + d.breakSeconds, 0);
  // Never show a misleading average off a single data point.
  const averageWorkingSeconds = workingDays >= 2 ? Math.round(totalWorkingSeconds / workingDays) : null;

  return {
    days,
    summary: { workingDays, totalWorkingSeconds, totalBreakSeconds, averageWorkingSeconds },
  };
};

/** Today's summary cards (Total/Online/On Break/Offline/Working Today +
 * total working hours) for the admin dashboard header. */
export const getSummaryCards = async ({ AttendanceSession, User }) => {
  const employees = await User.find({ role: { $in: EMPLOYEE_ROLES_ALL }, status: { $ne: "Inactive" } }).select("_id");
  const { start, end } = todayRange();
  const sessions = await AttendanceSession.find({
    employee: { $in: employees.map((e) => e._id) },
    loginAt: { $gte: start, $lte: end },
  });

  const byEmployee = new Map();
  for (const s of sessions) {
    const key = String(s.employee);
    if (!byEmployee.has(key)) byEmployee.set(key, []);
    byEmployee.get(key).push(s);
  }

  let online = 0, onBreak = 0, offline = 0, workingToday = 0, totalWorkingSeconds = 0;
  for (const emp of employees) {
    const empSessions = byEmployee.get(String(emp._id)) || [];
    if (!empSessions.length) { offline++; continue; }
    const summary = summarizeAttendanceSessions(empSessions);
    totalWorkingSeconds += summary.totalWorkingSeconds;
    workingToday++;
    if (summary.currentStatus === "ONLINE") online++;
    else if (summary.currentStatus === "BREAK") onBreak++;
    else offline++;
  }

  return { totalEmployees: employees.length, online, onBreak, offline, workingToday, totalWorkingSeconds };
};
