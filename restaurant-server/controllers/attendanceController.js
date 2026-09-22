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
} from "../services/attendanceService.js";
import { getRoleFromUser } from "../services/orderService.js";
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
    const session = await endDuty({ AttendanceSession, employeeId: req.user._id });
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
    const employee = await User.findOne({ _id: req.params.id, role: { $in: ["admin","waiter","chef"] } })
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
