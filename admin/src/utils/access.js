// src/utils/access.js — which admin-app pages a signed-in person may open.
// A "manager" (created by an admin in Employees) gets only the pages below.
// This only shapes the UI — the backend enforces the same limits itself
// (restaurant-server/utils/roles.js, middleware/rbac.js requireManagement).

export const isManager = (user) => !!user && !user.isAdmin && user.role === "manager";
export const isInventoryManager = (user) => !!user && !user.isAdmin && user.role === "inventory_manager";

// "delivery": a manager runs riders day to day (Board, Partners, Live map,
// Cash, Reports) — delivery Settings stay admin-only (server: requireAdmin).
export const MANAGER_PAGES = ["orders", "tables", "invoices", "inventory", "employees", "menu", "delivery", "help"];
export const INVENTORY_MANAGER_PAGES = ["inventory"];

export const canOpenPage = (user, page) => isInventoryManager(user)
  ? INVENTORY_MANAGER_PAGES.includes(page)
  : !isManager(user) || MANAGER_PAGES.includes(page);
