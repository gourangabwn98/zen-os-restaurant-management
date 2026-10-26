// utils/roles.js
// ─────────────────────────────────────────────────────────────────────────────
// Who counts as what. One place, so "is this person staff?" can't drift
// between rbac.js, orderService, the socket rooms and the controllers.
//
//   admin    — the owner: everything.
//   manager  — created by an admin (Admin → Employees). Uses the admin app,
//              limited to Orders, Invoices, Tables, Inventory, Employees,
//              Menu and Help & Support. Server-side that means: staff for
//              orders/billing (like a waiter), plus the admin-only write
//              routes of those areas (requireManagement). Never Insights,
//              Users, Offers, Notifications, Profile/settings or printers.
//              Order-wise a manager follows TRANSITION_ROLES (no admin
//              any-status override) and is recorded as source/actor ADMIN.
//   waiter / chef / customer — unchanged.
// ─────────────────────────────────────────────────────────────────────────────

export const ADMIN = "admin";
export const MANAGER = "manager";
export const WAITER = "waiter";
export const CHEF = "chef";
export const INVENTORY_MANAGER = "inventory_manager";

/** Floor/office staff: full order data, the `staff` socket room. */
export const STAFF_ROLES = [ADMIN, MANAGER, WAITER];
/** Admin, or the manager acting for them in their allowed areas. */
export const MANAGEMENT_ROLES = [ADMIN, MANAGER];
/** Inventory employees may use inventory-only routes, never the admin shell's other modules. */
export const INVENTORY_ROLES = [ADMIN, MANAGER, INVENTORY_MANAGER];

export const isStaffRole = (role) => STAFF_ROLES.includes(role);
export const isManagementRole = (role) => MANAGEMENT_ROLES.includes(role);
export const isInventoryRole = (role) => INVENTORY_ROLES.includes(role);
