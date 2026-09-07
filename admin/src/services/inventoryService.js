// src/services/inventoryService.js
import api from "./api.js";

// ── Overview ───────────────────────────────────────────────────────────────
export const getInventoryOverview = (expiringWithinDays) =>
  api.get("/admin/inventory/overview", { params: expiringWithinDays ? { expiringWithinDays } : {} });

// ── Stock Items ────────────────────────────────────────────────────────────
export const getInventoryItems  = (params) => api.get("/admin/inventory/items", { params });
export const getInventoryItem   = (id)     => api.get(`/admin/inventory/items/${id}`);
export const createInventoryItem = (data)  => api.post("/admin/inventory/items", data);
export const updateInventoryItem = (id, data) => api.put(`/admin/inventory/items/${id}`, data);
export const deleteInventoryItem = (id)    => api.delete(`/admin/inventory/items/${id}`);
export const adjustInventoryItem = (id, data) => api.patch(`/admin/inventory/items/${id}/adjust`, data);

// ── Purchases ──────────────────────────────────────────────────────────────
export const getPurchases      = () => api.get("/admin/inventory/purchases");
export const getPurchaseById   = (id) => api.get(`/admin/inventory/purchases/${id}`);
export const createPurchase    = (data) => api.post("/admin/inventory/purchases", data);

// ── Stock Movements (ledger) ──────────────────────────────────────────────
export const getStockMovements = (params) => api.get("/admin/inventory/movements", { params });

// ── Low Stock ──────────────────────────────────────────────────────────────
export const getLowStock = () => api.get("/admin/inventory/low-stock");

// ── Wastage ────────────────────────────────────────────────────────────────
export const getWastage    = (params) => api.get("/admin/inventory/wastage", { params });
export const createWastage = (data)   => api.post("/admin/inventory/wastage", data);

// ── Recipes ────────────────────────────────────────────────────────────────
export const getRecipes           = () => api.get("/admin/inventory/recipes");
export const getRecipeForMenuItem = (menuItemId) => api.get(`/admin/inventory/recipes/menu-item/${menuItemId}`);
export const saveRecipe           = (data) => api.post("/admin/inventory/recipes", data);
export const deleteRecipe         = (id) => api.delete(`/admin/inventory/recipes/${id}`);

// ── Purchase import (PDF/image → extracted lines → confirm) ──────────────
export const extractPurchaseImport = (formData) =>
  api.post("/admin/inventory/import/extract", formData);
export const confirmPurchaseImport = (data) =>
  api.post("/admin/inventory/import/confirm", data);

// ── Suppliers ──────────────────────────────────────────────────────────────
export const getSuppliers      = () => api.get("/admin/inventory/suppliers");
export const createSupplier    = (data) => api.post("/admin/inventory/suppliers", data);
export const updateSupplier    = (id, data) => api.put(`/admin/inventory/suppliers/${id}`, data);
export const deleteSupplier    = (id) => api.delete(`/admin/inventory/suppliers/${id}`);
