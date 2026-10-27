import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireStaff, requireAdmin, requireManagement, requireEmployee, requireInventory, requireInventoryStaff } from "../middleware/rbac.js";
import { requireV3 } from "../services/inventoryV3Operations.js";
import { importUploadSingle } from "../middleware/importUploadMiddleware.js";
import * as workspace from "../controllers/inventoryV3WorkspaceController.js";
import { getCapabilities, getSettings, patchSettings } from "../controllers/inventoryV3Controller.js";

const router = express.Router();
router.use(protect);
router.get("/capabilities", requireInventoryStaff, getCapabilities);
router.get("/settings", requireAdmin, getSettings);
// Available with the kill switch off so an admin can always disable V3.
// Enabling requires both explicit setup and the backend environment switch.
router.patch("/settings", requireAdmin, patchSettings);
router.use(requireV3);
router.get("/mobile", requireInventory, workspace.getMobileWorkspace);
// Workspace includes supplier balances and cost figures; limit the full view to
// managers and admins. Count submission remains available to employees below.
router.get("/workspace", requireManagement, workspace.getWorkspace);
router.post("/items", requireInventory, workspace.saveItem);
router.patch("/items/:id", requireInventory, workspace.saveItem);
router.post("/suppliers", requireInventory, workspace.saveSupplier);
router.patch("/suppliers/:id", requireInventory, workspace.saveSupplier);
router.post("/purchases/preview", requireInventoryStaff, workspace.previewPurchase);
router.post("/purchases", requireInventoryStaff, workspace.savePurchase);
router.post("/stock-adjustments", requireInventory, workspace.adjustStock);
router.post("/purchases/:id/settlements", requireManagement, workspace.settle);
router.post("/financial-entries", requireAdmin, workspace.saveFinancial);
router.post("/financial-entries/:id/reversals", requireAdmin, workspace.reverseEntry);
router.post("/counts", requireInventory, workspace.submitCount);
router.post("/counts/:id/approve", requireInventory, workspace.approveCount);
router.post("/wastage", requireInventoryStaff, workspace.saveWastage);
router.post("/recipes/preview", requireInventory, workspace.previewRecipe);
router.post("/recipes", requireInventory, workspace.saveRecipe);
router.post("/book-confirmations", requireManagement, workspace.confirmNothing);
router.put("/book-expectations/gas", requireAdmin, workspace.setExpectation);
router.patch("/recurring-rules/:id", requireAdmin, workspace.stopRecurring);
router.post("/receipts", requireInventoryStaff, importUploadSingle("file"), workspace.uploadReceipt);
export default router;
