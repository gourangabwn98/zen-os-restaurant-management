// controllers/employeeController.js
import {
  createEmployee, updateEmployee, setEmployeeStatus, listEmployees,
  getEmployeeTodayStats, getEmployeePerformance, EMPLOYEE_ROLES,
} from "../services/employeeService.js";
import { getRoleFromUser } from "../services/orderService.js";

// ── Admin: manage employees ─────────────────────────────────────────────────
export const addEmployee = async (req, res) => {
  try {
    const { User } = req.models;
    const { name, phone, address, role } = req.body;
    const employee = await createEmployee({ User, name, phone, address, role });
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
    res.json({ employees, categories: EMPLOYEE_ROLES });
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
    const { name, address, role } = req.body;
    const employee = await updateEmployee({ User, id: req.params.id, name, address, role });
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

export const getEmployeeStatsById = async (req, res) => {
  try {
    const { User, Order } = req.models;
    const employee = await User.findOne({ _id: req.params.id, role: { $in: EMPLOYEE_ROLES } });
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    const stats = await getEmployeeTodayStats({ Order, employeeId: employee._id, role: employee.role });
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
    const performance = await getEmployeePerformance({ User, Order, from, to, role });
    res.json({ performance });
  } catch (err) {
    res.status(500).json({ message: err.message });
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
    const stats = role === "admin"
      ? await getEmployeeTodayStats({ Order, employeeId: req.user._id, role: "waiter" }) // admins acting as staff, e.g. taking orders themselves
      : await getEmployeeTodayStats({ Order, employeeId: req.user._id, role });
    res.json({
      employee: { _id: req.user._id, name: req.user.name, phone: req.user.phone, role },
      stats,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
