import express from "express";
import { generateInvoice, getMyInvoices, getInvoiceById } from "../controllers/invoiceController.js";
import { protect, optionalProtect } from "../middleware/authMiddleware.js";
const router = express.Router();
router.post("/generate", optionalProtect, generateInvoice);
router.get("/my",        protect,         getMyInvoices);
router.get("/:id",       protect,         getInvoiceById);
export default router;
