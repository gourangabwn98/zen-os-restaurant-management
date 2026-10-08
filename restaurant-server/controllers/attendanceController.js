// controllers/attendanceController.js
// ─────────────────────────────────────────────────────────────────────────────
// Thin HTTP layer over services/attendanceService.js. Employee identity
// (id/role/name) always comes from req.user (populated by
// middleware/authMiddleware.js's protect from the verified JWT) — never
// from req.body, so a client can never start/end duty as someone else or
// report a fabricated working/break duration.
// ─────────────────────────────────────────────────────────────────────────────

import {
  startDuty, startBreak, endBreak, endDuty,
  getMySession, getMyToday,
  listTodayForAdmin, listHistory, getEmployeeHistory, getSummaryCards,
  listDutyHistory,
} from "../services/attendanceService.js";
import { getRoleFromUser, buildActor } from "../services/orderService.js";
import { resolveRange } from "../services/employeeService.js";
import { resolveTimezone } from "../utils/menuSchedule.js";
import { emitAttendanceUpdated } from "../sockets/socket.js";

const employeeSnapshot = (session, req) => ({
  _id: req.user._id, name: req.user.name, phone: req.user.phone, role: getRoleFromUser(req.user),
});

const emitUpdate = (req, action, session) => {
  emitAttendanceUpdated(req.tenantKey, { action, session, employee: employeeSnapshot(session, req) });
};

// ── Self-service ─────────────────────────────────────────────────────────────

export const getMyAttendance = async (req, res) => {
  try {
    const { AttendanceSession } = req.models;
    const session = await getMySession({ AttendanceSession, employeeId: req.user._id });
    res.json({ session });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

export const getMyAttendanceToday = async (req, res) => {
  try {
    const { AttendanceSession } = req.models;
    const today = await getMyToday({ AttendanceSession, employeeId: req.user._id });
    res.json(today);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

export const postStartDuty = async (req, res) => {
  try {
    const { AttendanceSession } = req.models;
    const { session, resumed } = await startDuty({
      AttendanceSession,
      DutyHistory: req.models.DutyHistory,
      actor: buildActor(req.user),
      employeeId: req.user._id,
      role: getRoleFromUser(req.user),
      employeeName: req.user.name || req.user.waiterName || "",
    });
    if (!resumed) emitUpdate(req, "START", session);
    res.status(resumed ? 200 : 201).json({ session, resumed });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

export const postStartBreak = async (req, res) => {
  try {
    const { AttendanceSession } = req.models;
    const session = await startBreak({ AttendanceSession, employeeId: req.user._id });
    emitUpdate(req, "BREAK_START", session);
    res.json({ session });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

export const postEndBreak = async (req, res) => {
  try {
    const { AttendanceSession } = req.models;
    const session = await endBreak({ AttendanceSession, employeeId: req.user._id });
    emitUpdate(req, "BREAK_END", session);
    res.json({ session });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

export const postEndDuty = async (req, res) => {
  try {
    const { AttendanceSession } = req.models;
    const session = await endDuty({
      AttendanceSession, DutyHistory: req.models.DutyHistory, actor: buildActor(req.user), employeeId: req.user._id,
    });
    emitUpdate(req, "END", session);
    res.json({ session });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── Admin ──────────────────────────────────────────────────────────────────

export const getAdminAttendanceToday = async (req, res) => {
  try {
    const { AttendanceSession, User } = req.models;
    const rows = await listTodayForAdmin({ AttendanceSession, User, role: req.query.role });
    res.json({ employees: rows });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

export const getAdminAttendanceHistory = async (req, res) => {
  try {
    const { AttendanceSession } = req.models;
    const { from, to, employeeId, role, status, page, limit } = req.query;
    const result = await listHistory({ AttendanceSession, from, to, employeeId, role, status, page, limit });
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

export const getAdminAttendanceEmployee = async (req, res) => {
  try {
    const { AttendanceSession, User } = req.models;
    const employee = await User.findOne({ _id: req.params.id, role: { $in: ["admin","manager","waiter","chef"] } })
      .select("name phone role");
    if (!employee) return res.status(404).json({ message: "Employee not found" });

    const history = await getEmployeeHistory({
      AttendanceSession, employeeId: employee._id, from: req.query.from, to: req.query.to,
    });
    res.json({ employee, ...history });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

export const getAdminAttendanceSummary = async (req, res) => {
  try {
    const { AttendanceSession, User } = req.models;
    const summary = await getSummaryCards({ AttendanceSession, User });
    res.json(summary);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── Duty history (ON/OFF audit) ─────────────────────────────────────────────
// ?date=YYYY-MM-DD (or ?from=&to=) is the RESTAURANT's calendar day
// (RestaurantProfile.timezone, Asia/Kolkata by default) — never the server's
// UTC day. No date = today. Filtering and paging happen in the database.
const dutyHistoryQuery = async (req) => {
  const { date, from, to, action, source, page, limit } = req.query;
  const tz = resolveTimezone((await req.models.RestaurantProfile.findOne().select("timezone").lean())?.timezone);
  const { start, end } = resolveRange(date || from, date || to, tz);
  return { DutyHistory: req.models.DutyHistory, start, end, action, source, page, limit };
};

// GET /api/attendance/me/duty-history — own records only (id from the JWT).
export const getMyDutyHistory = async (req, res) => {
  try {
    const result = await listDutyHistory({ ...(await dutyHistoryQuery(req)), employeeId: req.user._id });
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// GET /api/admin/attendance/duty-history — every employee, ?employeeId= optional.
export const getAdminDutyHistory = async (req, res) => {
  try {
    const { employeeId } = req.query;
    if (employeeId && !/^[a-f0-9]{24}$/i.test(String(employeeId))) {
      return res.status(400).json({ message: "Invalid employeeId" });
    }
    const result = await listDutyHistory({ ...(await dutyHistoryQuery(req)), employeeId: employeeId || undefined });
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};
