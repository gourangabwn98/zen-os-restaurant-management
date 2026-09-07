import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireStaff, requireAdmin } from "../middleware/rbac.js";
import { importUploadSingle } from "../middleware/importUploadMiddleware.js";
import {
  getOverview,
  getSuppliers, createSupplier, updateSupplier, deleteSupplier,
  getItems, getItemById, createItem, updateItem, deleteItem, adjustItemStock,
  getPurchases, getPurchaseById, createPurchase,
  getMovements,
  getLowStock,
  getWastage, createWastage,
  getRecipes, getRecipeForMenuItem, upsertRecipe, deleteRecipe,
} from "../controllers/inventoryController.js";
import { extractPurchaseDocument, confirmPurchaseImport } from "../controllers/purchaseImportController.js";

const router = express.Router();
router.use(protect);

// Overview
router.get("/overview", requireStaff, getOverview);

// Stock Items — definitions/config are admin; adjust-stock is a routine
// floor action (physical counts, spoil corrections) so it's staff.
router.get("/items",            requireStaff, getItems);
router.get("/items/:id",        requireStaff, getItemById);
router.post("/items",           requireAdmin, createItem);
router.put("/items/:id",        requireAdmin, updateItem);
router.delete("/items/:id",     requireAdmin, deleteItem);
router.patch("/items/:id/adjust", requireStaff, adjustItemStock);

// Purchases — routine floor/back-of-house receiving, staff-allowed.
router.get("/purchases",        requireStaff, getPurchases);
router.get("/purchases/:id",    requireStaff, getPurchaseById);
router.post("/purchases",       requireStaff, createPurchase);

// Purchase import (PDF/image → extracted lines → reviewed → recordPurchase).
// Admin-only: importing can create new InventoryItem definitions, which is
// already an admin-only action (see POST /items above) — the import path
// doesn't get a looser rule just because it's new.
router.post("/import/extract",  requireAdmin, importUploadSingle("file"), extractPurchaseDocument);
router.post("/import/confirm",  requireAdmin, confirmPurchaseImport);

// Stock Movements (ledger) — read-only audit trail.
router.get("/movements",        requireStaff, getMovements);

// Low Stock
router.get("/low-stock",        requireStaff, getLowStock);

// Wastage — routine floor action.
router.get("/wastage",          requireStaff, getWastage);
router.post("/wastage",         requireStaff, createWastage);

// Recipes — structural config, admin only to define/change; staff can view
// (useful while taking orders) and check a single menu item's live status.
router.get("/recipes",                     requireStaff, getRecipes);
router.get("/recipes/menu-item/:menuItemId", requireStaff, getRecipeForMenuItem);
router.post("/recipes",                    requireAdmin, upsertRecipe);
router.delete("/recipes/:id",              requireAdmin, deleteRecipe);

// Suppliers — structural config, admin only.
router.get("/suppliers",        requireStaff, getSuppliers);
router.post("/suppliers",       requireAdmin, createSupplier);
router.put("/suppliers/:id",    requireAdmin, updateSupplier);
router.delete("/suppliers/:id", requireAdmin, deleteSupplier);

export default router;
