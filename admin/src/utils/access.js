// src/utils/access.js — which admin-app pages a signed-in person may open.
// A "manager" (created by an admin in Employees) gets only the pages below.
// This only shapes the UI — the backend enforces the same limits itself
// (restaurant-server/utils/roles.js, middleware/rbac.js requireManagement).

export const isManager = (user) => !!user && !user.isAdmin && user.role === "manager";
export const isInventoryManager = (user) => !!user && !user.isAdmin && user.role === "inventory_manager";

// "delivery": a manager runs riders day to day (Board, Partners, Live map,
// Cash, Reports) — delivery Settings stay admin-only (server: requireAdmin).
// "devices": Offline Edition only (Devices & PINs) — a manager approves and
// revokes waiter/chef devices and sets their PINs (server limits the rest).
export const MANAGER_PAGES = ["orders", "tables", "invoices", "inventory", "employees", "menu", "delivery", "devices", "help"];
export const INVENTORY_MANAGER_PAGES = ["inventory"];

// Offline Edition pages exist only when the restaurant PC served this app
// (src/local/localAuth.js LOCAL_SERVER — read directly here to keep this file light).
const LOCAL_ONLY_PAGES = ["devices"];
const LOCAL_SERVER = typeof window !== "undefined" && window.__ZEN_CONFIG__?.localServer === true;

export const canOpenPage = (user, page) => (LOCAL_ONLY_PAGES.includes(page) && !LOCAL_SERVER) ? false : isInventoryManager(user)
  ? INVENTORY_MANAGER_PAGES.includes(page)
  : !isManager(user) || MANAGER_PAGES.includes(page);
