import express from "express";
import { generateInvoice, getMyInvoices, getInvoiceById } from "../controllers/invoiceController.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireStaff } from "../middleware/rbac.js";
import { objectIdParam } from "../middleware/validateIds.js";
const router = express.Router();
// Malformed ids → 404, never a CastError 500 (middleware/validateIds.js).
router.param("id", objectIdParam);
// Staff only; amounts come from the stored orders (controllers/invoiceController.js).
router.post("/generate", protect, requireStaff, generateInvoice);
router.get("/my",        protect,         getMyInvoices);
router.get("/:id",       protect,         getInvoiceById);
export default router;
