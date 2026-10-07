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
  DUTY_ACTIONS, DUTY_CHANGE_SOURCES, BREAK_REASON_MAX,
} from "../utils/attendanceStateMachine.js";

// ── Duty history (ON/OFF audit) ─────────────────────────────────────────────
// Written right after the session's own atomic open/close succeeded, so a
// record exists only for a transition that really happened — an
// "already on duty" resume or a refused end writes nothing. Retry-safe: the
// unique {session, action} index turns a repeat into a no-op. A failed write
// never undoes the duty change itself (that already committed); it is logged.
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

// `at` / `reason` are for BREAK (the break's startedAt, the admin's reason).
export const recordDutyChange = async ({ DutyHistory, session, action, actor, employeeName, at, reason }) => {
  if (!DutyHistory || !session) return null;
  const doc = {
    employee: session.employee,
    employeeName: employeeName || session.employeeName || "",
    employeeRole: session.role,
    action,
    source: sameId(actor?.id, session.employee) ? "SELF" : "ADMIN",
    changedBy: { id: actor?.id || null, role: actor?.role || null, name: actor?.name || "" },
    session: session._id,
    at: at || (action === "ON_DUTY" ? session.loginAt : session.logoutAt),
    reason: reason || "",
  };
  try {
    return await DutyHistory.create(doc);
  } catch (err) {
    if (err?.code === 11000) return null; // already recorded
    console.error("duty history write failed:", err.message);
    return null;
  }
};

/** Duty history for [start, end] (the caller resolves the restaurant's
 * calendar days), newest first, filtered and paginated in the database.
 * `summary` counts the whole filtered set, not just the current page. */
export const listDutyHistory = async ({ DutyHistory, start, end, employeeId, action, source, page = 1, limit = 100 }) => {
  const filter = { at: { $gte: start, $lte: end } };
  if (employeeId) filter.employee = employeeId;
  if (DUTY_ACTIONS.includes(action)) filter.action = action;
  if (DUTY_CHANGE_SOURCES.includes(source)) filter.source = source;

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));

  // A count that contradicts the active filter is 0 without asking the DB.
  const countWhere = (field, value) =>
    filter[field] && filter[field] !== value ? 0 : DutyHistory.countDocuments({ ...filter, [field]: value });

  const [records, total, onDuty, offDuty, onBreak, bySelf, byAdmin] = await Promise.all([
    DutyHistory.find(filter).sort({ at: -1, _id: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    DutyHistory.countDocuments(filter),
    countWhere("action", "ON_DUTY"),
    countWhere("action", "OFF_DUTY"),
    countWhere("action", "BREAK"),
    countWhere("source", "SELF"),
    countWhere("source", "ADMIN"),
  ]);
  return { records, total, page: safePage, limit: safeLimit, summary: { total, onDuty, offDuty, onBreak, bySelf, byAdmin } };
};

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

// `DutyHistory` + `actor` (optional, buildActor shape) record the ON_DUTY
// audit entry; a resumed (already open) session records nothing.
export const startDuty = async ({ AttendanceSession, DutyHistory, actor, employeeId, role, employeeName }) => {
  const now = new Date();
  try {
    const created = await AttendanceSession.create({
      employee: employeeId, role, employeeName: employeeName || "",
      status: "OPEN", presenceStatus: "ONLINE",
      loginAt: now, lastSeenAt: now,
    });
    await recordDutyChange({ DutyHistory, session: created, action: "ON_DUTY", actor, employeeName });
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
    { returnDocument: "after" }
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
    { returnDocument: "after" }
  );
  if (!updated) {
    const err = new Error("Could not resume duty — status changed, please retry");
    err.statusCode = 409;
    throw err;
  }
  return updated;
};

export const endDuty = async ({ AttendanceSession, DutyHistory, actor, employeeId }) => {
  const session = await AttendanceSession.findOne({ employee: employeeId, status: "OPEN" });
  assertCanEndDuty(session);

  const at = new Date();
  const fields = closeSessionFields(session, { at, autoClosed: false });
  const updated = await AttendanceSession.findOneAndUpdate(
    { _id: session._id, status: "OPEN" },
    { $set: fields },
    { returnDocument: "after" }
  );
  if (!updated) {
    const err = new Error("Duty session was already ended");
    err.statusCode = 409;
    throw err;
  }
  await recordDutyChange({ DutyHistory, session: updated, action: "OFF_DUTY", actor });
  return updated;
};

// ── EMP-01: the manager sets someone's shift state ─────────────────────────
export const SHIFT_STATES = ["ON_SHIFT", "ON_BREAK", "OFF_SHIFT"];

/** Pure: the session's state in the manager's words. */
export const shiftStateOf = (session) =>
  !session || session.status !== "OPEN" ? "OFF_SHIFT" : session.presenceStatus === "BREAK" ? "ON_BREAK" : "ON_SHIFT";

/**
 * On Shift / On Break / Off Shift for an employee who forgot to (or can't)
 * update it themselves. Reuses the self-service transitions, so the session
 * rules (one open session, break bookkeeping, working time) stay identical;
 * the session is marked `managed` so the heartbeat sweep never auto-closes it.
 * ON_BREAK needs a non-blank `reason`, only works on someone who is on duty
 * right now (not off, not already on break), and writes a BREAK history
 * record with that reason. The session stays OPEN — a break is not off duty.
 * Returns { session, state, changed }.
 */
export const setEmployeeShift = async ({ AttendanceSession, DutyHistory, employee, state, actor, reason }) => {
  if (!SHIFT_STATES.includes(state)) {
    const err = new Error("state must be ON_SHIFT, ON_BREAK or OFF_SHIFT"); err.statusCode = 400; throw err;
  }
  const breakReason = typeof reason === "string" ? reason.trim() : "";
  if (state === "ON_BREAK") {
    if (!breakReason) { const err = new Error("A reason is required to put someone on break"); err.statusCode = 400; throw err; }
    if (breakReason.length > BREAK_REASON_MAX) {
      const err = new Error(`Break reason must be ${BREAK_REASON_MAX} characters or fewer`); err.statusCode = 400; throw err;
    }
  }
  const employeeId = employee._id;
  let open = await AttendanceSession.findOne({ employee: employeeId, status: "OPEN" });
  const before = shiftStateOf(open);
  if (state === "ON_BREAK" && before === "OFF_SHIFT") {
    const err = new Error("Only an employee who is on duty can be put on break"); err.statusCode = 409; throw err;
  }
  if (state === "ON_BREAK" && before === "ON_BREAK") {
    const err = new Error("This employee is already on break"); err.statusCode = 409; throw err;
  }
  if (before === state) return { session: open, state, changed: false };

  if (state === "OFF_SHIFT") {
    const closed = await endDuty({ AttendanceSession, DutyHistory, actor, employeeId });
    await AttendanceSession.updateOne({ _id: closed._id }, { $set: { changedBy: actor } });
    return { session: closed, state, changed: true };
  }
  if (!open) {
    const role = employee.isAdmin ? "admin" : employee.role;
    open = (await startDuty({ AttendanceSession, DutyHistory, actor, employeeId, role, employeeName: employee.name })).session;
  }
  await AttendanceSession.updateOne({ _id: open._id }, { $set: { managed: true, changedBy: actor } });
  if (state === "ON_BREAK") {
    // startBreak is the atomic ONLINE → BREAK guard: a concurrent second
    // break request gets a 409 there and never reaches the history write.
    open = await startBreak({ AttendanceSession, employeeId });
    const started = (open.breaks || [])[open.breaks.length - 1];
    await recordDutyChange({
      DutyHistory, session: open, action: "BREAK", actor, employeeName: employee.name,
      at: started?.startedAt, reason: breakReason,
    });
  }
  if (state === "ON_SHIFT" && shiftStateOf(open) === "ON_BREAK") open = await endBreak({ AttendanceSession, employeeId });
  const fresh = await AttendanceSession.findOne({ employee: employeeId, status: "OPEN" });
  return { session: fresh || open, state, changed: true };
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

/** NOT SCHEDULED ANY MORE (see server.js) — duty now ends only on an
 * explicit action: the employee's "End duty" or an admin's "Off shift".
 * Running this on a timer turned staff OFF whenever a phone slept, the app
 * was backgrounded or the network dropped (heartbeats stop in all three),
 * and it writes no DutyHistory record. Kept for reference/tests only —
 * don't re-schedule it without both of those addressed.
 *
 * Closes OPEN sessions whose heartbeat has gone quiet for longer than the
 * grace period. Uses each session's own last known `lastSeenAt` as the
 * logout time — never "now" — so no session ever gets a fabricated logout
 * time. Race-safe against a heartbeat/manual-end arriving concurrently: the
 * closing update is guarded by the exact `lastSeenAt` read, so if either
 * one lands first this sweep simply skips that document instead of
 * double-closing or overwriting fresher data. */
export const sweepStaleAttendanceSessions = async ({ AttendanceSession, graceMs = DEFAULT_HEARTBEAT_GRACE_MS, now = new Date() }) => {
  const staleThreshold = new Date(now.getTime() - graceMs);
  // A manager-set shift (EMP-01) has no app sending heartbeats — leave it open.
  const candidates = await AttendanceSession.find({ status: "OPEN", managed: { $ne: true }, lastSeenAt: { $lt: staleThreshold } });

  const closed = [];
  for (const doc of candidates) {
    const at = doc.lastSeenAt;
    const fields = closeSessionFields(doc, { at, autoClosed: true });
    const updated = await AttendanceSession.findOneAndUpdate(
      { _id: doc._id, status: "OPEN", lastSeenAt: doc.lastSeenAt },
      { $set: fields },
      { returnDocument: "after" }
    );
    if (updated) closed.push(updated);
  }
  return closed;
};

/** Gate for order-taking actions (place/confirm/reject/cancel/advance
 * status/add items/mark payment/clear table): a waiter must have an OPEN,
 * ONLINE attendance session — clocked in and not on break — before touching
 * an order. Exact wording/status code is a hard requirement (see
 * middleware/dutyMiddleware.js, the primary caller) — don't reword this. */
export const assertOnDuty = async ({ AttendanceSession, employeeId }) => {
  const session = await AttendanceSession.findOne({ employee: employeeId, status: "OPEN" });
  if (!session || session.presenceStatus !== "ONLINE") {
    const err = new Error("You must be ON DUTY to perform this action.");
    err.statusCode = 403;
    throw err;
  }
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

/** Same self-service summary as getMyToday, but for an arbitrary date range
 * (defaults to today) — backs the Activity tab's "online timing" / "break
 * timing" cards. Deliberately reuses summarizeAttendanceSessions rather
 * than getEmployeeHistory's closedDays-only totals: a still-OPEN session
 * for "today" should count its live elapsed time immediately, not wait
 * until the waiter ends duty. */
export const getMySummaryForRange = async ({ AttendanceSession, employeeId, from, to }) => {
  const range = dayRangeFilter(from, to);
  const filter = { employee: employeeId };
  if (range) filter.loginAt = range;
  else { const { start, end } = todayRange(); filter.loginAt = { $gte: start, $lte: end }; }

  const sessions = await AttendanceSession.find(filter).sort({ loginAt: 1 });
  return summarizeAttendanceSessions(sessions);
};

// ── Admin reads ──────────────────────────────────────────────────────────────

const EMPLOYEE_ROLES_ALL = ["admin", "waiter", "chef", "staff"];

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
