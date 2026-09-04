import api from "./api.js";

// GET /api/menu?category=&search=&vegOnly=true — always excludes unavailable
// items server-side; each item also carries stockAvailable/stockTracked
// (Phase 2 inventory linkage) so we can show "Out of stock" without hiding it.
export const getMenu = (params) => api.get("/menu", { params });

// GET /api/menu/categories — only categories that currently have items.
export const getMenuCategories = () => api.get("/menu/categories");
