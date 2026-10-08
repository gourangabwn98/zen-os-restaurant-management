import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireStaff, requireAdmin } from "../middleware/rbac.js";
import { requireWaiterOnDuty } from "../middleware/dutyMiddleware.js";
import {
  getDashboardStats, getAllOrders, updateOrderPayment, updateOrderStatus,
  getAllUsers, deleteUser, getAllInvoices, updateInvoiceStatus,
  addItemsToOrder, getCombinedBill, printBill, getSalesInsights, getInsightsOverview,
} from "../controllers/adminController.js";
import {
  getAdminAttendanceToday, getAdminAttendanceHistory,
  getAdminAttendanceEmployee, getAdminAttendanceSummary, getAdminDutyHistory,
} from "../controllers/attendanceController.js";
import { objectIdParam } from "../middleware/validateIds.js";
import { previewCombined, printCombined, paySelected, completeSelectedOrders, getOrderGroup } from "../controllers/combinedBillController.js";
import { settleOrders, reopenOrderBill } from "../controllers/billingController.js";

const router = express.Router();
// Malformed ids → 404, never a CastError 500 (middleware/validateIds.js).
router.param("id", objectIdParam);
router.use(protect);

// Staff (admin + waiter) — day-to-day floor operations
router.get("/dashboard",             requireStaff, getDashboardStats);
router.get("/orders",                requireStaff, getAllOrders);
router.get("/orders/combined-bill",  requireStaff, getCombinedBill);
// Combine Bill for a table, or an order + its follow-ups (KH-07) — staff pick
// SOME running orders (services/combinedBillService.js). KH-03: on-duty
// waiters too (same as their single-order print / pay / settle). The service
// only ever accepts running orders and re-checks every id server-side.
router.post("/combined-bill/preview",  requireStaff, previewCombined);
router.post("/combined-bill/print",    requireStaff, requireWaiterOnDuty, printCombined);
router.post("/combined-bill/pay",      requireStaff, requireWaiterOnDuty, paySelected);
router.post("/combined-bill/complete", requireStaff, requireWaiterOnDuty, completeSelectedOrders);
router.get("/orders/:id/group",        requireStaff, getOrderGroup); // KH-07 — order + follow-ups
router.get("/invoices/all",          requireStaff, getAllInvoices);
router.patch("/invoices/:id/status", requireAdmin, updateInvoiceStatus);
router.put("/orders/:id/status",     requireStaff, requireWaiterOnDuty, updateOrderStatus);
router.patch("/orders/:id/payment",  requireStaff, requireWaiterOnDuty, updateOrderPayment);
router.post("/orders/:id/add-items", requireStaff, requireWaiterOnDuty, addItemsToOrder);
router.post("/orders/:id/print-bill",requireStaff, printBill);
// BIL-01/BIL-02 — billing workflow: settle bills (records payment if needed,
// completes served orders) and admin-only reopen of a mistaken settlement.
router.post("/orders/settle",        requireStaff, requireWaiterOnDuty, settleOrders);
router.post("/orders/:id/reopen-bill", requireAdmin, reopenOrderBill);

// Admin only — account/user management
// Admin → Insights: revenue by item/category, making cost, gross profit.
router.get("/insights/sales", requireAdmin, getSalesInsights);
router.get("/insights/overview", requireAdmin, getInsightsOverview);
router.get("/users",         requireAdmin, getAllUsers);
router.delete("/users/:id",  requireAdmin, deleteUser);

// Admin only — employee attendance monitoring (Admin → Employees → Attendance)
router.get("/attendance/today",         requireAdmin, getAdminAttendanceToday);
router.get("/attendance/summary",       requireAdmin, getAdminAttendanceSummary);
router.get("/attendance/duty-history",  requireAdmin, getAdminDutyHistory); // ON/OFF audit log
router.get("/attendance/employee/:id",  requireAdmin, getAdminAttendanceEmployee);
router.get("/attendance",               requireAdmin, getAdminAttendanceHistory);

export default router;
