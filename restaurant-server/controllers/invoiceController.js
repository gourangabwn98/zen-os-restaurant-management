// controllers/invoiceController.js
// ─────────────────────────────────────────────────────────────────────────────
// Legacy `Invoice` documents (a bill grouping one or more orders). The admin
// Invoices page does NOT use these — an invoice there is the order itself.
// Kept working, but locked down:
//   • generate is staff-only and every amount comes from the stored orders
//     (it used to be open to anyone and priced from client-sent items/prices,
//     breaking "the backend is authoritative for price");
//   • reading one requires its owner or staff (it used to be any login).
// ─────────────────────────────────────────────────────────────────────────────
import mongoose from "mongoose";
import { effectiveRole } from "../middleware/rbac.js";
import { ORDER_STATUSES } from "../utils/orderStateMachine.js";

const CANCELLED = "CANCELLED";
if (!ORDER_STATUSES.includes(CANCELLED)) throw new Error("invoiceController: CANCELLED is not an order status");

const isStaff = (user) => ["admin", "waiter"].includes(effectiveRole(user));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// POST /api/invoices/generate   Body: { orders: [orderId, …] }   (staff)
export const generateInvoice = async (req, res) => {
  try {
    const { Invoice, Order } = req.models;
    const ids = (Array.isArray(req.body?.orders) ? req.body.orders : [])
      .map(String).filter((id) => mongoose.isValidObjectId(id));
    if (!ids.length) return res.status(400).json({ message: "Pick at least one order to bill" });

    const orders = await Order.find({ _id: { $in: ids }, status: { $ne: CANCELLED } }).lean();
    if (!orders.length) return res.status(404).json({ message: "No billable orders found" });

    const sum = (f) => r2(orders.reduce((s, o) => s + (Number(o[f]) || 0), 0));
    const first = orders[0];
    const invoice = await Invoice.create({
      orders: orders.map((o) => o._id),
      user: first.user || null,
      isGuest: !first.user,
      orderType: first.orderType,
      tableNo: first.tableNo ?? null,
      // Stored figures only — the same numbers the orders were charged.
      items: orders.flatMap((o) => (o.items || []).map((i) => ({ name: i.name, price: i.price, qty: i.qty }))),
      subtotal: sum("subtotal"),
      tax: sum("tax"),
      serviceCharge: sum("serviceCharge"),
      total: sum("total"),
    });

    res.status(201).json(invoice);
  } catch (err) {
    console.error("Invoice error:", err);
    res.status(500).json({ message: "Failed to generate invoice" });
  }
};

export const getMyInvoices = async (req, res) => {
  try {
    const { Invoice } = req.models;
    const invoices = await Invoice.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json(invoices);
  } catch (err) { res.status(500).json({ message: "Failed to fetch invoices" }); }
};

export const getInvoiceById = async (req, res) => {
  try {
    const { Invoice } = req.models;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Invoice not found" });
    const invoice = await Invoice.findById(req.params.id);
    // Someone else's bill reads as "not found", not "forbidden".
    if (!invoice || (!isStaff(req.user) && String(invoice.user) !== String(req.user._id)))
      return res.status(404).json({ message: "Invoice not found" });
    res.json(invoice);
  } catch (err) { res.status(500).json({ message: "Failed to fetch invoice" }); }
};
