import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireStaff, requireManagement, requireInventory, requireInventoryStaff } from "../middleware/rbac.js";
import { importUploadSingle } from "../middleware/importUploadMiddleware.js";
import {
  getOverview,
  getSuppliers, createSupplier, updateSupplier, deleteSupplier,
  getItems, getItemById, createItem, updateItem, deleteItem, adjustItemStock,
  getPurchases, getPurchaseById, createPurchase,
  uploadPurchaseBillPhoto, getPayables, settlePayable, getCashOut,
  getMovements,
  getLowStock,
  getWastage, createWastage,
  getRecipes, getRecipeForMenuItem, upsertRecipe, deleteRecipe,
} from "../controllers/inventoryController.js";
import { extractPurchaseDocument, confirmPurchaseImport } from "../controllers/purchaseImportController.js";
import { objectIdParam } from "../middleware/validateIds.js";

const router = express.Router();
// Malformed ids → 404, never a CastError 500 (middleware/validateIds.js).
router.param("id", objectIdParam);
router.param("menuItemId", objectIdParam);
router.use(protect);

// Overview
router.get("/overview", requireInventoryStaff, getOverview);

// Stock Items — definitions/config are admin; adjust-stock is a routine
// floor action (physical counts, spoil corrections) so it's staff.
router.get("/items",            requireInventoryStaff, getItems);
router.get("/items/:id",        requireInventoryStaff, getItemById);
router.post("/items",           requireInventory, createItem);
router.put("/items/:id",        requireInventory, updateItem);
router.delete("/items/:id",     requireInventory, deleteItem);
router.patch("/items/:id/adjust", requireInventoryStaff, adjustItemStock);

// Purchases — routine floor/back-of-house receiving, staff-allowed.
router.get("/purchases",        requireInventoryStaff, getPurchases);
router.get("/purchases/:id",    requireInventoryStaff, getPurchaseById);
router.post("/purchases",       requireInventoryStaff, createPurchase);
// INV-05 — photo of the supplier's bill (kept as proof; its number is read to suggest INV-02).
router.post("/purchases/bill-photo", requireInventoryStaff, importUploadSingle("file"), uploadPurchaseBillPhoto);
// INV-06/07 — what's still owed to the owner (Owner's Pocket) and suppliers (Credit).
router.get("/payables",         requireManagement, getPayables);
router.post("/purchases/:id/settle-payable", requireManagement, settlePayable);
router.get("/cash-out",         requireInventoryStaff, getCashOut);

// Purchase import (PDF/image → extracted lines → reviewed → recordPurchase).
// Admin-only: importing can create new InventoryItem definitions, which is
// already an admin-only action (see POST /items above) — the import path
// doesn't get a looser rule just because it's new.
router.post("/import/extract",  requireManagement, importUploadSingle("file"), extractPurchaseDocument);
router.post("/import/confirm",  requireManagement, confirmPurchaseImport);

// Stock Movements (ledger) — read-only audit trail.
router.get("/movements",        requireInventoryStaff, getMovements);

// Low Stock
router.get("/low-stock",        requireInventoryStaff, getLowStock);

// Wastage — routine floor action.
router.get("/wastage",          requireInventoryStaff, getWastage);
router.post("/wastage",         requireInventoryStaff, createWastage);

// Recipes — structural config, admin only to define/change; staff can view
// (useful while taking orders) and check a single menu item's live status.
router.get("/recipes",                     requireInventoryStaff, getRecipes);
router.get("/recipes/menu-item/:menuItemId", requireInventoryStaff, getRecipeForMenuItem);
router.post("/recipes",                    requireInventory, upsertRecipe);
router.delete("/recipes/:id",              requireInventory, deleteRecipe);

// Suppliers — structural config, admin only.
router.get("/suppliers",        requireInventoryStaff, getSuppliers);
// INV-01: a new supplier can be added inline while recording a purchase (staff).
router.post("/suppliers",       requireInventoryStaff, createSupplier);
router.put("/suppliers/:id",    requireInventory, updateSupplier);
router.delete("/suppliers/:id", requireInventory, deleteSupplier);

export default router;
