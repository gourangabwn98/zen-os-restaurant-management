// middleware/rbac.js
// ─────────────────────────────────────────────────────────────────────────────
// Role-based access control.
// Must run AFTER `protect` (needs req.user populated with role/isAdmin).
//
// Roles in this system: "admin" | "waiter" | "chef" | "customer"
// `isAdmin: true` on the User doc is always treated as admin regardless of
// the `role` string, to stay compatible with existing admin accounts created
// before `role` existed on some records.
// ─────────────────────────────────────────────────────────────────────────────

const effectiveRole = (user) => {
  if (!user) return null;
  if (user.isAdmin) return "admin";
  return user.role || "customer";
};

/**
 * requireRole("admin") or requireRole("admin", "waiter")
 * Rejects with 401 if not authenticated, 403 if authenticated but wrong role,
 * and 403 if the staff account has been deactivated (status === "Inactive").
 */
export const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Not authorized, no user context" });
  }

  if (req.user.status === "Inactive") {
    return res.status(403).json({ message: "This staff account has been deactivated" });
  }

  const role = effectiveRole(req.user);
  if (!allowedRoles.includes(role)) {
    return res.status(403).json({ message: `Requires one of: ${allowedRoles.join(", ")}` });
  }

  req.effectiveRole = role;
  next();
};

/** Shorthand: admin only */
export const requireAdmin = requireRole("admin");

/** Shorthand: admin or waiter (i.e. "staff") */
export const requireStaff = requireRole("admin", "waiter");

/** Shorthand: admin or chef (kitchen operations) */
export const requireKitchen = requireRole("admin", "chef");

/** Any authenticated, active employee — admin, waiter, or chef. Used for
 * shared self-service endpoints like "my dashboard stats". */
export const requireEmployee = requireRole("admin", "waiter", "chef");

export { effectiveRole };
