import express from "express";
import {
  addEmployee, getEmployees, getEmployeeById, editEmployee,
  toggleEmployeeStatus, getEmployeeStatsById, getPerformanceReport, getMyDashboard, getMyActivity, setShift,
} from "../controllers/employeeController.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireAdmin, requireManagement, requireEmployee } from "../middleware/rbac.js";
import { guardManagerTarget, guardManagerLeave, guardManagerReview } from "../middleware/managerScope.js";
import { upload } from "../middleware/uploadMiddleware.js";
import {
  hrSummary, updatePolicy, getReviews, reviewLookedInto, getPay, addAdvance, paySalary,
  getLeave, addLeave, decide, uploadPhoto, myLeave, myLeaveRequest, myLeaveCancel,
} from "../controllers/staffHrController.js";
import { objectIdParam } from "../middleware/validateIds.js";

const router = express.Router();
// Malformed ids → 404, never a CastError 500 (middleware/validateIds.js).
router.param("id", objectIdParam);
router.param("leaveId", objectIdParam);
router.param("reviewId", objectIdParam);
router.use(protect);

// Self-service — any employee, their own data only. Mounted before the
// :id routes so "/me/dashboard" is never swallowed by the :id param matcher.
router.get("/me/dashboard", requireEmployee, getMyDashboard);
router.get("/me/activity",  requireEmployee, getMyActivity);
// Leave requests from the Waiter / Kitchen apps — own records only.
router.get("/me/leave",              requireEmployee, myLeave);
router.post("/me/leave",             requireEmployee, myLeaveRequest);
router.patch("/me/leave/:leaveId/cancel", requireEmployee, myLeaveCancel);

// Admin-only — creating/managing OTHER people's accounts and viewing
// performance across staff is structural/sensitive, matches how table and
// menu management are already admin-only in this system.
// Admin, or a manager (who may only touch waiter / chef / other-staff records —
// middleware/managerScope.js). The leave/pay policy is restaurant-wide: admin only.
router.use(requireManagement);
router.param("id", guardManagerTarget);
router.param("leaveId", guardManagerLeave);
router.param("reviewId", guardManagerReview);
router.post("/",                addEmployee);
router.get("/",                 getEmployees);
router.get("/performance",      getPerformanceReport);
// HR (Employees page tabs). Literal paths are mounted before "/:id".
router.get("/hr/summary",       hrSummary);
router.patch("/hr/policy",      requireAdmin, updatePolicy);
router.patch("/reviews/:reviewId/looked-into", reviewLookedInto);
router.patch("/leave/:leaveId", decide);
router.get("/:id",              getEmployeeById);
router.put("/:id",              editEmployee);
router.patch("/:id/status",     toggleEmployeeStatus);
router.patch("/:id/shift",      setShift); // EMP-01 — manager sets On Shift / On Break / Off Shift
router.get("/:id/stats",        getEmployeeStatsById);
router.get("/:id/reviews",      getReviews);
router.get("/:id/pay",          getPay);
router.post("/:id/pay/advances", addAdvance);
router.post("/:id/pay/salary",  paySalary);
router.get("/:id/leave",        getLeave);
router.post("/:id/leave",       addLeave);
router.post("/:id/photo",       upload.single("photo"), uploadPhoto);

export default router;
