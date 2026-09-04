import express from "express";
import {
  addEmployee, getEmployees, getEmployeeById, editEmployee,
  toggleEmployeeStatus, getEmployeeStatsById, getPerformanceReport, getMyDashboard,
} from "../controllers/employeeController.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireAdmin, requireEmployee } from "../middleware/rbac.js";

const router = express.Router();
router.use(protect);

// Self-service — any employee, their own data only. Mounted before the
// :id routes so "/me/dashboard" is never swallowed by the :id param matcher.
router.get("/me/dashboard", requireEmployee, getMyDashboard);

// Admin-only — creating/managing OTHER people's accounts and viewing
// performance across staff is structural/sensitive, matches how table and
// menu management are already admin-only in this system.
router.use(requireAdmin);
router.post("/",                addEmployee);
router.get("/",                 getEmployees);
router.get("/performance",      getPerformanceReport);
router.get("/:id",              getEmployeeById);
router.put("/:id",              editEmployee);
router.patch("/:id/status",     toggleEmployeeStatus);
router.get("/:id/stats",        getEmployeeStatsById);

export default router;
