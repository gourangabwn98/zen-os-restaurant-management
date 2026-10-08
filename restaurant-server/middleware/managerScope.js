// middleware/managerScope.js
// ─────────────────────────────────────────────────────────────────────────────
// A manager runs the Employees page for the admin, but only over the people
// they manage: waiters, chefs and "Other" staff. Another manager's (or their
// own) record — pay, leave, reviews, status, role — stays with the admin, or
// a manager could raise their own salary or lock the admin's other managers
// out. Admins pass straight through.
//
// Used as router.param handlers on routes/employeeRoutes.js, so every
// /:id, /leave/:leaveId and /reviews/:reviewId route is covered at once.
// ─────────────────────────────────────────────────────────────────────────────
import { effectiveRole } from "./rbac.js";
import { MANAGER } from "../utils/roles.js";

const OUT_OF_SCOPE = "Only the admin can change a manager's record";

/** Manager → may this employee doc be acted on? (admin/manager targets: no) */
const inManagerScope = (employee) => !!employee && !employee.isAdmin && !["admin", MANAGER].includes(employee.role);

const guard = (load) => async (req, res, next, id) => {
  // /me/* is the caller's own self-service (e.g. cancel my leave) — not managing anyone.
  if (effectiveRole(req.user) !== MANAGER || req.path.startsWith("/me/")) return next();
  try {
    const employeeId = await load(req.models, id);
    // Unknown id → let the route answer its own 404.
    if (!employeeId) return next();
    const employee = await req.models.User.findById(employeeId).select("role isAdmin").lean();
    if (employee && !inManagerScope(employee)) return res.status(403).json({ message: OUT_OF_SCOPE });
    next();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const guardManagerTarget = guard(async (_models, id) => id);
export const guardManagerLeave = guard(async (models, id) => (await models.StaffLeave.findById(id).select("employee").lean())?.employee);
export const guardManagerReview = guard(async (models, id) => (await models.StaffReview.findById(id).select("employee").lean())?.employee);
