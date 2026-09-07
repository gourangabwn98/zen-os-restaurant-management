// controllers/adminController.js
import { priceItems, computeTotals } from "../utils/pricing.js";
import { transitionOrderStatusTx, buildActor } from "../services/orderService.js";
import {
  emitOrderStatusChanged, emitOrderCancelled, emitOrderConfirmed,
  emitKotCreated, emitBillPrint, emitPaymentStatusChanged, emitTableCleared,
  emitInventoryAlert,
} from "../sockets/socket.js";

// ── GET /api/admin/dashboard ──────────────────────────────────────────────────
export const getDashboardStats = async (req, res) => {
  try {
    const { User, MenuItem, Order, Invoice, RestaurantProfile, Table } = req.models;

    const [
      totalUsers, totalItems, totalOrders, totalInvoices,
      revenueAgg, todayOrdersAgg, ordersByStatus,
      recentOrders, topItems, weeklyRevenue, totalTables,
    ] = await Promise.all([
      User.countDocuments(),
      MenuItem.countDocuments({ isAvailable: true }),
      Order.countDocuments(),
      Invoice.countDocuments(),
      Order.aggregate([
        { $match: { paymentStatus: "PAID" } },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: new Date(new Date().setHours(0,0,0,0)), $lte: new Date(new Date().setHours(23,59,59,999)) } } },
        { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: "$total" } } },
      ]),
      Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 }, revenue: { $sum: "$total" } } }]),
      Order.find().sort({ createdAt: -1 }).limit(10).populate("user", "name phone").lean(),
      Order.aggregate([
        { $unwind: "$items" },
        { $group: { _id: "$items.name", totalQty: { $sum: "$items.qty" }, revenue: { $sum: { $multiply: ["$items.price","$items.qty"] } } } },
        { $sort: { totalQty: -1 } },
        { $limit: 5 },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: new Date(Date.now() - 7*24*60*60*1000) }, paymentStatus: "PAID" } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, revenue: { $sum: "$total" }, orders: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Table.countDocuments({ status: "Active" }).catch(() => 0),
    ]);

    // Canonical order-lifecycle buckets (Phase 1 status machine).
    const TABLE_STATUSES = [
      "PENDING_CONFIRMATION","CONFIRMED","PREPARING","READY","DELIVERED","COMPLETED","CANCELLED","All",
    ];
    const tableOrders = {};
    for (const s of TABLE_STATUSES) {
      tableOrders[s] = await Order.find(s === "All" ? {} : { status: s })
        .sort({ createdAt: -1 }).limit(20).populate("user","name phone").lean();
    }

    res.json({
      stats: {
        totalUsers, totalItems, totalOrders, totalInvoices,
        totalRevenue: revenueAgg[0]?.total || 0,
        todayOrders:  todayOrdersAgg[0]?.count || 0,
        todayRevenue: todayOrdersAgg[0]?.revenue || 0,
        totalTables,
      },
      ordersByStatus, recentOrders, topItems, weeklyRevenue, tableOrders,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Dashboard error" });
  }
};

// ── GET /api/admin/orders ─────────────────────────────────────────────────────
export const getAllOrders = async (req, res) => {
  try {
    const { Order } = req.models;
    const { page = 1, limit = 20, status, search } = req.query;
    const filter = {};
    if (status && status !== "All") filter.status = status;
    if (search) filter.orderId = { $regex: search, $options: "i" };

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 })
        .skip((page-1)*limit).limit(Number(limit))
        .populate("user","name phone"),
      Order.countDocuments(filter),
    ]);
    res.json({ orders, total, page: Number(page), pages: Math.ceil(total/limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── PUT /api/admin/orders/:id/status ─────────────────────────────────────────
// Generic status change (e.g. admin dashboard dropdown). Goes through the
// same shared state machine as every other order mutation — invalid
// transitions and role violations are rejected here exactly like everywhere
// else, and moving into CONFIRMED still creates the (single, idempotent)
// KOT job via the shared service.
export const updateOrderStatus = async (req, res) => {
  try {
    const toStatus = req.body.status;
    const previousStatus = (await req.models.Order.findById(req.params.id).select("status"))?.status;

    const { order, kotJob, kotCreated, inventoryAlerts } = await transitionOrderStatusTx({
      req, orderId: req.params.id, toStatus, note: req.body.note,
    });

    if (toStatus === "CONFIRMED") {
      emitOrderConfirmed(req.tenantKey, order);
      if (kotCreated) emitKotCreated(req.tenantKey, kotJob);
      for (const a of inventoryAlerts || []) emitInventoryAlert(req.tenantKey, a);
    } else if (toStatus === "CANCELLED") {
      emitOrderCancelled(req.tenantKey, order, order.cancelReason);
    } else {
      emitOrderStatusChanged(req.tenantKey, order, previousStatus);
    }

    res.json(order);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── GET /api/admin/users ──────────────────────────────────────────────────────
// This is the customer directory (Admin → Users) — admin/waiter/chef accounts
// are managed separately under Admin → Employees, so only role: "customer"
// belongs here.
export const getAllUsers = async (req, res) => {
  try {
    const { User } = req.models;
    const { page = 1, limit = 20 } = req.query;
    const filter = { role: "customer" };
    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip((page-1)*limit).limit(Number(limit)).select("-otp -otpExpiry -password"),
      User.countDocuments(filter),
    ]);
    res.json({ users, total });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── DELETE /api/admin/users/:id ───────────────────────────────────────────────
export const deleteUser = async (req, res) => {
  try {
    const { User } = req.models;
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── GET /api/admin/invoices/all ───────────────────────────────────────────────
export const getAllInvoices = async (req, res) => {
  try {
    const { Invoice } = req.models;
    const invoices = await Invoice.find().sort({ createdAt: -1 }).populate("user","name phone email").lean();
    res.json({ success: true, count: invoices.length, invoices });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch invoices" });
  }
};

// ── PATCH /api/admin/invoices/:id/status ─────────────────────────────────────
export const updateInvoiceStatus = async (req, res) => {
  try {
    const { Invoice, Order } = req.models;
    const { status } = req.body;
    const allowed = ["pending","completed","paid","cancelled","refunded"];
    if (!allowed.includes(status?.toLowerCase()))
      return res.status(400).json({ message: `Invalid status. Allowed: ${allowed.join(",")}` });

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    invoice.status = status.toLowerCase();

    // Bulk-finalizing a bill deliberately bypasses the per-order transition
    // machine (paying/refunding closes out every order on the bill at once,
    // regardless of exactly which lifecycle step each one was on).
    if (["completed","paid"].includes(status.toLowerCase()) && invoice.orders?.length) {
      await Order.updateMany(
        { _id: { $in: invoice.orders } },
        { $set: { status: "COMPLETED", paymentStatus: "PAID" } }
      );
    }
    if (["cancelled","refunded"].includes(status.toLowerCase()) && invoice.orders?.length) {
      await Order.updateMany(
        { _id: { $in: invoice.orders } },
        { $set: { status: "CANCELLED" } }
      );
    }

    await invoice.save();
    res.json({ success: true, message: `Invoice → ${status}`, data: invoice });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update invoice" });
  }
};

// ── PATCH /api/admin/orders/:id/payment ───────────────────────────────────────
export const updateOrderPayment = async (req, res) => {
  try {
    const { Order } = req.models;
    const { paymentStatus, paymentMethod } = req.body;

    const VALID_PAYMENT_STATUS = ["PENDING_VERIFICATION","PAID","FAILED"];
    const VALID_PAYMENT_METHOD = ["Cash","Online"];

    const update = {};
    if (paymentStatus !== undefined) {
      if (!VALID_PAYMENT_STATUS.includes(paymentStatus)) {
        return res.status(400).json({ message: `paymentStatus must be one of: ${VALID_PAYMENT_STATUS.join(", ")}` });
      }
      update.paymentStatus = paymentStatus;
    }
    if (paymentMethod !== undefined) {
      if (!VALID_PAYMENT_METHOD.includes(paymentMethod)) {
        return res.status(400).json({ message: `paymentMethod must be one of: ${VALID_PAYMENT_METHOD.join(", ")}` });
      }
      update.paymentMethod = paymentMethod;
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: true }
    );
    if (!order) return res.status(404).json({ message: "Order not found" });

    emitPaymentStatusChanged(req.tenantKey, order);
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── POST /api/admin/orders/:id/add-items ──────────────────────────────────────
// Recompute uses the exact same server-side pricing rules as placing a fresh
// order (utils/pricing.js) — a client can never influence price here either.
export const addItemsToOrder = async (req, res) => {
  try {
    const { Order, MenuItem, RestaurantProfile } = req.models;
    const { items } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (!["CONFIRMED","PREPARING","READY"].includes(order.status))
      return res.status(400).json({ message: `Cannot add items to a ${order.status} order` });

    const newDbItems = await priceItems(items, MenuItem);

    newDbItems.forEach(newItem => {
      const existing = order.items.find(ex => String(ex.menuItem) === String(newItem.menuItem));
      if (existing) existing.qty += newItem.qty;
      else order.items.push(newItem);
    });

    const restaurant = await RestaurantProfile.findOne();
    const totals = computeTotals(order.items, restaurant);
    order.subtotal      = totals.subtotal;
    order.tax            = totals.tax;
    order.serviceCharge  = totals.serviceCharge;
    order.total           = totals.total;

    const actor = buildActor(req.user);
    order.statusHistory.push({
      status: order.status, changedBy: actor, changedAt: new Date(),
      note: `Added ${newDbItems.length} item(s)`,
    });

    await order.save();

    emitOrderStatusChanged(req.tenantKey, order, order.status);
    res.json(order);
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message });
  }
};

// ── GET /api/admin/orders/combined-bill?phone=... OR ?tableNo=... ────────────
export const getCombinedBill = async (req, res) => {
  try {
    const { Order, RestaurantProfile } = req.models;
    const { phone, tableNo, orderIds } = req.query;
    const ACTIVE_STATUSES = ["CONFIRMED","PREPARING","READY","DELIVERED"];

    let matchOrders = [];

    if (orderIds) {
      const ids = orderIds.split(",");
      matchOrders = await Order.find({ _id: { $in: ids } }).populate("user","name phone");
    } else if (phone) {
      matchOrders = await Order.find({
        $or: [{ guestPhone: phone }, { "user.phone": phone }],
        status: { $in: ACTIVE_STATUSES },
      }).populate("user","name phone");
    } else if (tableNo) {
      matchOrders = await Order.find({
        tableNo: Number(tableNo),
        status: { $in: ACTIVE_STATUSES },
      }).populate("user","name phone");
    } else {
      return res.status(400).json({ message: "Provide phone, tableNo, or orderIds" });
    }

    if (!matchOrders.length)
      return res.status(404).json({ message: "No active orders found" });

    const mergedItems = [];
    matchOrders.forEach(o => {
      (o.items||[]).forEach(item => {
        const ex = mergedItems.find(x => x.name === item.name && x.price === item.price);
        if (ex) ex.qty += item.qty;
        else mergedItems.push({ name:item.name, price:item.price, qty:item.qty });
      });
    });

    const grandTotal = matchOrders.reduce((s,o) => s + Number(o.total||0), 0);
    const totalTax   = matchOrders.reduce((s,o) => s + (o.tax||0), 0);
    const totalSC    = matchOrders.reduce((s,o) => s + (o.serviceCharge||0), 0);
    const subtotal   = mergedItems.reduce((s,i) => s + i.price * i.qty, 0);
    const restaurant = await RestaurantProfile.findOne();

    res.json({
      orders: matchOrders,
      mergedItems,
      subtotal,
      tax: totalTax,
      serviceCharge: totalSC,
      grandTotal,
      restaurantName: restaurant?.restaurantName || "Restaurant",
      orderCount: matchOrders.length,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── POST /api/admin/orders/:id/print-bill ────────────────────────────────────
export const printBill = async (req, res) => {
  try {
    const { Order, BillPrintJob } = req.models;
    const order = await Order.findById(req.params.id).populate("user","name phone");
    if (!order) return res.status(404).json({ message: "Order not found" });

    const payload = {
      orderId:       order.orderId,
      tableNo:       order.tableNo,
      orderType:     order.orderType,
      items:         order.items,
      subtotal:      order.subtotal || 0,
      tax:           order.tax      || 0,
      serviceCharge: order.serviceCharge || 0,
      total:         order.total,
      paymentMethod: order.paymentMethod || "Cash",
      paymentStatus: order.paymentStatus,
      guestName:     order.guestName  || order.user?.name  || "",
      guestPhone:    order.guestPhone || order.user?.phone || "",
    };

    // Persisted job — this is what gives the bill print a job ID, a status
    // (PENDING → PRINTING → PRINTED/FAILED), and retry/duplicate-protection
    // on the print-service side. A bare socket emit with no DB record (the
    // old behaviour) could never be recovered if the print-service was
    // offline at the moment it fired.
    const job = await BillPrintJob.create({
      order: order._id,
      orderId: order.orderId,
      tableNo: order.tableNo,
      orderType: order.orderType,
      payload,
      createdBy: buildActor(req.user),
    });

    emitBillPrint(req.tenantKey, { jobId: String(job._id), ...payload });

    res.json({ success: true, message: "Bill sent to printer", jobId: job._id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
