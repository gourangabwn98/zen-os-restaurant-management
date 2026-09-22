// routes/attendanceRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
// Self-service only — any active admin/waiter/chef, own attendance data and
// own duty actions only (identity always from req.user, see
// controllers/attendanceController.js). Admin's cross-employee attendance
// endpoints live in adminRoutes.js instead (mirrors how employeeRoutes.js
// keeps its own self-service "/me/dashboard" separate from its admin-only
// employee-directory routes).
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import {
  getMyAttendance, getMyAttendanceToday,
  postStartDuty, postStartBreak, postEndBreak, postEndDuty,
} from "../controllers/attendanceController.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireEmployee } from "../middleware/rbac.js";

const router = express.Router();
router.use(protect, requireEmployee);

router.get("/me",           getMyAttendance);
router.get("/me/today",     getMyAttendanceToday);
router.post("/start",       postStartDuty);
router.post("/break/start", postStartBreak);
router.post("/break/end",   postEndBreak);
router.post("/end",         postEndDuty);

export default router;
