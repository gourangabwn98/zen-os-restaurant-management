// middleware/dutyMiddleware.js
// ─────────────────────────────────────────────────────────────────────────────
// Gate order-taking actions behind "this waiter must be ON_DUTY" — reuses the
// EXISTING attendance system (models/AttendanceSession via
// services/attendanceService.js), no separate duty-tracking model or system.
// A waiter's ON_DUTY/OFF_DUTY status maps onto the attendance session that
// already exists:
//   ON_DUTY  = an OPEN AttendanceSession with presenceStatus "ONLINE"
//   OFF_DUTY = no OPEN session at all, or presenceStatus "BREAK"/"OFFLINE"
//     (a waiter on a break is not able to act on orders either — same as
//     being fully off duty, from an order-taking point of view)
//
// Must run AFTER `protect`/`optionalProtect` (needs req.user + req.models).
// Only ever gates role === "waiter" — admin, chef, and customer/guest
// requests (including the shared POST /api/orders and DELETE /api/orders/:id
// routes, which customers/guests also hit) pass straight through untouched.
// ─────────────────────────────────────────────────────────────────────────────
import { getRoleFromUser } from "../services/orderService.js";
import { assertOnDuty } from "../services/attendanceService.js";

export const requireWaiterOnDuty = async (req, res, next) => {
  if (getRoleFromUser(req.user) !== "waiter") return next();

  try {
    await assertOnDuty({ AttendanceSession: req.models.AttendanceSession, employeeId: req.user._id });
    next();
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};
