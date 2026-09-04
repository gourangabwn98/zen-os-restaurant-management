import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireStaff, requireAdmin } from "../middleware/rbac.js";
import {
  getDashboardStats, getAllOrders, updateOrderPayment, updateOrderStatus,
  getAllUsers, deleteUser, getAllInvoices, updateInvoiceStatus,
  addItemsToOrder, getCombinedBill, printBill,
} from "../controllers/adminController.js";

const router = express.Router();
router.use(protect);

// Staff (admin + waiter) — day-to-day floor operations
router.get("/dashboard",             requireStaff, getDashboardStats);
router.get("/orders",                requireStaff, getAllOrders);
router.get("/orders/combined-bill",  requireStaff, getCombinedBill);
router.get("/invoices/all",          requireStaff, getAllInvoices);
router.patch("/invoices/:id/status", requireStaff, updateInvoiceStatus);
router.put("/orders/:id/status",     requireStaff, updateOrderStatus);
router.patch("/orders/:id/payment",  requireStaff, updateOrderPayment);
router.post("/orders/:id/add-items", requireStaff, addItemsToOrder);
router.post("/orders/:id/print-bill",requireStaff, printBill);

// Admin only — account/user management
router.get("/users",         requireAdmin, getAllUsers);
router.delete("/users/:id",  requireAdmin, deleteUser);

export default router;
