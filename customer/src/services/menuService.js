import api from "./api.js";

// GET /api/menu?category=&search=&vegOnly=true — always excludes unavailable
// and scheduled-out (outside their time window) categories/items
// server-side; each item also carries stockAvailable/stockTracked
// (Phase 2 inventory linkage) so we can show "Out of stock" without hiding it.
export const getMenu = (params) => api.get("/menu", { params });

// GET /api/menu/categories — only categories that currently have items.
export const getMenuCategories = () => api.get("/menu/categories");

// GET /api/menu/best-sellers — the items sold most in the last 30 days (paid,
// not cancelled orders) that can be ordered right now. [] when no sales yet.
export const getBestSellers = () => api.get("/menu/best-sellers");
