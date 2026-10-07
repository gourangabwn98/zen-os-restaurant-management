// controllers/employeeController.js
import {
  createEmployee, updateEmployee, setEmployeeStatus, listEmployees,
  getEmployeeTodayStats, getEmployeePerformance, getWaiterOrderActivity, EMPLOYEE_ROLES, listCustomRoles,
} from "../services/employeeService.js";
import { getMySummaryForRange, setEmployeeShift, shiftStateOf } from "../services/attendanceService.js";
import { buildActor } from "../services/orderService.js";
import { emitAttendanceUpdated } from "../sockets/socket.js";
import { getRoleFromUser } from "../services/orderService.js";
import { resolveTimezone } from "../utils/menuSchedule.js";

// Employee figures use the restaurant's calendar day, not the server's.
const restaurantTz = async (models) =>
  resolveTimezone((await models.RestaurantProfile.findOne().select("timezone").lean())?.timezone);

// ── Admin: manage employees ─────────────────────────────────────────────────
export const addEmployee = async (req, res) => {
  try {
    const { User } = req.models;
    const { name, phone, address, role, jobTitle } = req.body;
    const employee = await createEmployee({ User, name, phone, address, role, jobTitle });
    res.status(201).json({ employee });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

export const getEmployees = async (req, res) => {
  try {
    const { User } = req.models;
    const { role, search, status } = req.query;
    const employees = await listEmployees({ User, role, search, status });
    // EMP-01: each person's current shift state (from their open session, if any).
    const open = await req.models.AttendanceSession.find({ employee: { $in: employees.map((e) => e._id) }, status: "OPEN" })
      .select("employee status presenceStatus managed").lean();
    const byEmp = new Map(open.map((s) => [String(s.employee), s]));
    res.json({
      employees: employees.map((e) => ({ ...e.toObject(), shiftState: shiftStateOf(byEmp.get(String(e._id))) })),
      categories: EMPLOYEE_ROLES,
      customRoles: await listCustomRoles({ User }), // EMP-03
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getEmployeeById = async (req, res) => {
  try {
    const { User } = req.models;
    const employee = await User.findOne({ _id: req.params.id, role: { $in: EMPLOYEE_ROLES } })
      .select("-otp -otpExpiry -password");
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    res.json({ employee });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const editEmployee = async (req, res) => {
  try {
    const { User } = req.models;
    const { name, address, role, jobTitle, hr } = req.body;
    const employee = await updateEmployee({ User, id: req.params.id, name, address, role, jobTitle, hr });
    res.json({ employee });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

export const toggleEmployeeStatus = async (req, res) => {
  try {
    const { User } = req.models;
    const employee = await setEmployeeStatus({ User, id: req.params.id, status: req.body.status });
    res.json({ employee });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// GET /api/admin/employees/:id/stats?from=YYYY-MM-DD&to=YYYY-MM-DD
export const getEmployeeStatsById = async (req, res) => {
  try {
    const { User, Order } = req.models;
    const { from, to } = req.query;
    const employee = await User.findOne({ _id: req.params.id, role: { $in: EMPLOYEE_ROLES } });
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    const stats = await getEmployeeTodayStats({ Order, employeeId: employee._id, role: employee.role, from, to, tz: await restaurantTz(req.models) });
    res.json({ employee: { _id: employee._id, name: employee.name, role: employee.role }, stats });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/admin/employees/performance?from=&to=&role=
export const getPerformanceReport = async (req, res) => {
  try {
    const { User, Order } = req.models;
    const { from, to, role } = req.query;
    const performance = await getEmployeePerformance({ User, Order, from, to, role, tz: await restaurantTz(req.models) });
    res.json({ performance });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/employees/me/activity?from=&to= — waiter's own Activity tab.
// Own data only: employeeId is always req.user._id, never taken from the
// query string, same rule as getMyDashboard below.
export const getMyActivity = async (req, res) => {
  try {
    const { Order, AttendanceSession } = req.models;
    const { from, to } = req.query;
    const employeeId = req.user._id;

    const [orders, duty] = await Promise.all([
      getWaiterOrderActivity({ Order, employeeId, from, to, tz: await restaurantTz(req.models) }),
      getMySummaryForRange({ AttendanceSession, employeeId, from, to }),
    ]);

    res.json({
      orders,
      duty: { workingSeconds: duty.totalWorkingSeconds, breakSeconds: duty.totalBreakSeconds },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── Self-service: "my dashboard" — any logged-in employee, own data only ───
export const getMyDashboard = async (req, res) => {
  try {
    const { Order } = req.models;
    const role = getRoleFromUser(req.user);
    if (!["waiter","chef","admin"].includes(role)) {
      return res.status(403).json({ message: "Not an employee account" });
    }
    const tz = await restaurantTz(req.models);
    const stats = role === "admin"
      ? await getEmployeeTodayStats({ Order, employeeId: req.user._id, role: "waiter", tz }) // admins acting as staff, e.g. taking orders themselves
      : await getEmployeeTodayStats({ Order, employeeId: req.user._id, role, tz });
    res.json({
      employee: { _id: req.user._id, name: req.user.name, phone: req.user.phone, role },
      stats,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── PATCH /api/admin/employees/:id/shift  { state } — EMP-01 ─────────────────
// The manager sets On Shift / On Break / Off Shift for someone (fallback for
// staff who forget, or have no app). Same session rules as self-service.
export const setShift = async (req, res) => {
  try {
    const { User, AttendanceSession, DutyHistory } = req.models;
    const employee = await User.findOne({ _id: req.params.id, role: { $in: EMPLOYEE_ROLES }, status: { $ne: "Inactive" } });
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    const r = await setEmployeeShift({
      AttendanceSession, DutyHistory, employee, state: req.body?.state, reason: req.body?.reason, actor: buildActor(req.user),
    });
    if (r.changed) {
      emitAttendanceUpdated(req.tenantKey, {
        action: `MANAGER_${r.state}`, session: r.session,
        employee: { _id: employee._id, name: employee.name, role: employee.role },
      });
    }
    res.json({ state: r.state, changed: r.changed, session: r.session });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};
