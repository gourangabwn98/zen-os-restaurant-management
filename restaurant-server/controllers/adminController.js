// controllers/adminController.js
import mongoose from "mongoose";
import { priceItems, computeTotals } from "../utils/pricing.js";
import { getScheduleContext } from "../services/menuScheduleService.js";
import { transitionOrderStatusTx, buildActor, getRoleFromUser, EDITABLE_STATUSES } from "../services/orderService.js";
import { ORDER_STATUSES, PAYMENT_STATUSES, canSetPaymentStatus } from "../utils/orderStateMachine.js";
import {
  emitOrderStatusChanged, emitOrderCancelled, emitOrderConfirmed,
  emitKotCreated, emitBillPrint, emitPaymentStatusChanged, emitTableCleared,
  emitTableFreed, emitInventoryAlert, emitSentToKitchen,
} from "../sockets/socket.js";
import { computeSalesBreakdown, computeInsightsOverview, revenueOrderMatch } from "../services/insightsService.js";
import { zonedInstant } from "../services/offerStatsService.js";
import { resolveTimezone } from "../utils/menuSchedule.js";

const STATUS_CANCELLED = "CANCELLED";
if (!ORDER_STATUSES.includes(STATUS_CANCELLED)) throw new Error("adminController: CANCELLED is not an order status");

// ── GET /api/admin/dashboard ──────────────────────────────────────────────────
export const getDashboardStats = async (req, res) => {
  try {
    const { User, MenuItem, Order, Invoice, Table, RestaurantProfile } = req.models;

    // "Today" and the 7 days are the restaurant's own calendar days (its
    // timezone), not the server's (UTC on the host) — a 1 AM IST bill used to
    // land on the previous day. Revenue = revenueOrderMatch (PAID and not
    // CANCELLED), the one rule shared with Insights / Invoices / Offers.
    const profile = await RestaurantProfile.findOne().select("timezone").lean();
    const tz = resolveTimezone(profile?.timezone);
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date()).map((x) => [x.type, x.value]));
    const todayStart = zonedInstant(+p.year, +p.month, +p.day, 0, tz);
    const tomorrowStart = zonedInstant(+p.year, +p.month, +p.day + 1, 0, tz);
    const weekStart = zonedInstant(+p.year, +p.month, +p.day - 6, 0, tz);

    // Everything runs in parallel. The old payload also carried
    // `recentOrders`, `topItems` (an $unwind over every order ever placed) and
    // `tableOrders` (8 SEQUENTIAL populated queries) — no app read any of them,
    // and this call gates the admin's first paint, so they were removed.
    const [
      totalUsers, totalItems, totalOrders, totalInvoices,
      revenueAgg, todayOrderCount, todayRevenueAgg, ordersByStatus,
      weeklyRevenue, totalTables,
    ] = await Promise.all([
      User.estimatedDocumentCount(),
      MenuItem.countDocuments({ isAvailable: true }),
      Order.estimatedDocumentCount(),
      Invoice.estimatedDocumentCount(),
      Order.aggregate([
        { $match: revenueOrderMatch() },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]),
      Order.countDocuments({ createdAt: { $gte: todayStart, $lt: tomorrowStart } }),
      Order.aggregate([
        { $match: revenueOrderMatch({ from: todayStart, to: new Date(tomorrowStart.getTime() - 1) }) },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]),
      Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 }, revenue: { $sum: "$total" } } }]),
      Order.aggregate([
        { $match: revenueOrderMatch({ from: weekStart, to: new Date(tomorrowStart.getTime() - 1) }) },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: tz } }, revenue: { $sum: "$total" }, orders: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Table.countDocuments({ status: "Active" }).catch(() => 0),
    ]);

    res.json({
      stats: {
        totalUsers, totalItems, totalOrders, totalInvoices,
        totalRevenue: revenueAgg[0]?.total || 0,
        todayOrders:  todayOrderCount,
        todayRevenue: todayRevenueAgg[0]?.total || 0,
        totalTables,
      },
      ordersByStatus, weeklyRevenue,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Dashboard error" });
  }
};

// ── GET /api/admin/insights/sales?from=ISO&to=ISO ────────────────────────────
// Revenue by item / category + making cost, aggregated server-side (see
// services/insightsService.js for exactly which orders count).
export const getSalesInsights = async (req, res) => {
  try {
    const parse = (v) => {
      if (!v) return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        const err = new Error(`Invalid date: ${v}`);
        err.statusCode = 400;
        throw err;
      }
      return d;
    };
    const data = await computeSalesBreakdown({ models: req.models, from: parse(req.query.from), to: parse(req.query.to) });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── GET /api/admin/insights/overview?from=ISO&to=ISO[&prevFrom=ISO&prevTo=ISO] ─
// One round trip for the whole Insights page (services/insightsService.js →
// computeInsightsOverview). Days/hours are bucketed in the restaurant's own
// timezone (RestaurantProfile.timezone), never the browser's.
const MAX_INSIGHTS_DAYS = 3 * 366;
export const getInsightsOverview = async (req, res) => {
  try {
    const bad = (msg) => { const e = new Error(msg); e.statusCode = 400; throw e; };
    const parse = (v, name, required) => {
      if (!v) { if (required) bad(`${name} is required`); return null; }
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) bad(`Invalid date: ${v}`);
      return d;
    };
    const from = parse(req.query.from, "from", true);
    const to = parse(req.query.to, "to", true);
    const prevFrom = parse(req.query.prevFrom, "prevFrom");
    const prevTo = parse(req.query.prevTo, "prevTo");
    if (to < from) bad("to must be after from");
    if (!prevFrom !== !prevTo) bad("prevFrom and prevTo go together");
    if (prevFrom && prevTo < prevFrom) bad("prevTo must be after prevFrom");
    for (const [a, b] of [[from, to], [prevFrom, prevTo]]) {
      if (a && (b - a) / 86400000 > MAX_INSIGHTS_DAYS) bad("Pick a range of 3 years or less");
    }
    const profile = await req.models.RestaurantProfile.findOne().select("timezone").lean();
    const data = await computeInsightsOverview({
      models: req.models, from, to, prevFrom, prevTo, tz: resolveTimezone(profile?.timezone),
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── GET /api/admin/orders ─────────────────────────────────────────────────────
// Paged order list. Extra, optional filters (all server-side so the admin
// never has to download thousands of orders to filter them in the browser):
//   scope=live&since=<ISO>  every still-active order (any day) + all orders
//                           created since `since` (the client's local midnight)
//   type, paymentStatus     orderType / paymentStatus enum values
//   from, to                createdAt range (ISO)
//   search                  order id, guest name or guest phone
//   summary=1               adds { billedCount, billedAmount } — COMPLETED+PAID
//                           orders matching the date range
// Lean + no gateway debug blob: list views never read `payment.raw`.
const LIVE_STATUSES = ORDER_STATUSES.filter(
  (s) => !["AWAITING_PAYMENT", "COMPLETED", "CANCELLED"].includes(s),
);
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MAX_LIMIT = 10000;

export const getAllOrders = async (req, res) => {
  try {
    const { Order } = req.models;
    const { status, search, scope, since, type, paymentStatus, from, to, summary } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || 20));
    const parseDate = (v) => {
      if (!v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const filter = {};
    if (status && status !== "All") filter.status = status;
    if (type && type !== "All") filter.orderType = type;
    if (paymentStatus && paymentStatus !== "All") filter.paymentStatus = paymentStatus;
    const fromD = parseDate(from), toD = parseDate(to);
    if (fromD || toD) {
      filter.createdAt = {};
      if (fromD) filter.createdAt.$gte = fromD;
      if (toD) filter.createdAt.$lte = toD;
    }
    if (search && String(search).trim()) {
      const rx = { $regex: escapeRegex(String(search).trim()), $options: "i" };
      filter.$or = [{ orderId: rx }, { guestName: rx }, { guestPhone: rx }];
    }
    if (scope === "live") {
      const sinceD = parseDate(since) || new Date(new Date().setHours(0, 0, 0, 0));
      const live = [{ status: { $in: LIVE_STATUSES } }, { createdAt: { $gte: sinceD } }];
      // AND it with any search $or rather than overwriting it.
      if (filter.$or) { filter.$and = [{ $or: filter.$or }, { $or: live }]; delete filter.$or; }
      else filter.$or = live;
    }
    // Unpaid pay-first orders haven't reached the floor yet — waiters never
    // see them (admin does, to follow up). See utils/paymentMode.js.
    if (getRoleFromUser(req.user) !== "admin") {
      filter.status = filter.status === "AWAITING_PAYMENT" ? { $in: [] } : (filter.status || { $ne: "AWAITING_PAYMENT" });
    }

    const wantSummary = summary === "1" || summary === "true";
    const [orders, total, billed] = await Promise.all([
      Order.find(filter, { "payment.raw": 0 }).sort({ createdAt: -1 })
        .skip((page - 1) * limit).limit(limit)
        .populate("user", "name phone")
        .lean(),
      Order.countDocuments(filter),
      wantSummary
        ? Order.aggregate([
            { $match: { ...(filter.createdAt ? { createdAt: filter.createdAt } : {}), status: "COMPLETED", paymentStatus: "PAID" } },
            { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$total" } } },
          ])
        : null,
    ]);
    res.json({
      orders, total, page, pages: Math.ceil(total / limit),
      ...(wantSummary ? { summary: { billedCount: billed[0]?.count || 0, billedAmount: billed[0]?.amount || 0 } } : {}),
    });
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

    const {
      order, kotJob, kotCreated, inventoryAlerts,
      closedTableSession, freedTable, suggestedEntry,
    } = await transitionOrderStatusTx({
      req, orderId: req.params.id, toStatus, note: req.body.note,
    });

    if (toStatus === "CONFIRMED") {
      emitOrderConfirmed(req.tenantKey, order);
    } else if (toStatus === "PREPARING" && kotJob !== undefined) {
      // Went through sendToKitchenTx — KOT printed, stock deducted.
      emitSentToKitchen(req.tenantKey, { order, kotJob, kotCreated, inventoryAlerts });
    } else if (toStatus === "CANCELLED") {
      emitOrderCancelled(req.tenantKey, order, order.cancelReason);
    } else {
      emitOrderStatusChanged(req.tenantKey, order, previousStatus);
    }

    // Order completion just auto-cleared its table — same realtime events
    // the manual "clear table" button used to fire (see
    // tableSessionController.closeSession).
    if (closedTableSession) {
      emitTableCleared(req.tenantKey, closedTableSession);
      if (freedTable) {
        emitTableFreed(req.tenantKey, { tableNo: freedTable.tableNo, seats: freedTable.seats, suggestedEntry });
      }
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
    const { Invoice } = req.models;
    const status = typeof req.body?.status === "string" ? req.body.status.toLowerCase() : "";
    const allowed = ["pending","completed","paid","cancelled","refunded"];
    if (!allowed.includes(status))
      return res.status(400).json({ message: `Invalid status. Allowed: ${allowed.join(",")}` });

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    // The invoice's own label only. This used to Order.updateMany() every
    // order on it to COMPLETED + PAID (or CANCELLED) — skipping the order
    // state machine, the per-order payment rules, the stock deduction / KOT
    // that only sendToKitchenTx may do, and stock reversal on cancel. Orders
    // are paid / moved / cancelled through their own endpoints
    // (PATCH /admin/orders/:id/payment, PUT /admin/orders/:id/status).
    invoice.status = status;
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

    const VALID_PAYMENT_METHOD = ["Cash","Online"];

    const update = {};
    if (paymentStatus !== undefined) {
      if (!PAYMENT_STATUSES.includes(paymentStatus)) {
        return res.status(400).json({ message: `paymentStatus must be one of: ${PAYMENT_STATUSES.join(", ")}` });
      }
      // Role rules live in utils/orderStateMachine.js — e.g. a waiter may
      // mark an order PAID but never FAILED.
      if (!canSetPaymentStatus(paymentStatus, getRoleFromUser(req.user))) {
        return res.status(403).json({ message: `You are not allowed to mark a payment ${paymentStatus}` });
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

    // A cancelled order can't take money: marking it PAID created
    // "cancelled · was paid" bills that no revenue total counts. The guard is
    // in the update filter itself, so it also holds against a cancel racing it.
    // BIL-02: a SETTLED bill's payment can't be undone or re-labelled here —
    // an admin reopens the bill first (POST /admin/orders/:id/reopen-bill).
    const unsettled = { $or: [{ billStatus: { $exists: false }, status: { $ne: "COMPLETED" } }, { billStatus: "OPEN" }] };
    const filter = {
      _id: req.params.id,
      ...(update.paymentStatus === "PAID" && { status: { $ne: STATUS_CANCELLED } }),
      ...((update.paymentStatus === "PENDING_VERIFICATION" || update.paymentMethod) && unsettled),
    };
    const order = await Order.findOneAndUpdate(filter, { $set: update }, { returnDocument: "after", runValidators: true });
    if (!order) {
      const existing = await Order.findById(req.params.id).select("status billStatus").lean();
      if (!existing) return res.status(404).json({ message: "Order not found" });
      return existing.status === STATUS_CANCELLED
        ? res.status(409).json({ message: "This order was cancelled — it can't be marked paid" })
        : res.status(409).json({ message: "This bill is settled — reopen the bill before changing its payment" });
    }

    emitPaymentStatusChanged(req.tenantKey, order);
    res.json({ success: true, order });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
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

    // Orders can only be changed while Placed (before the KOT prints) — see
    // orderService.modifyOrderItemsTx. Extra items later = a new order.
    // ORD-01: held orders only (awaiting acceptance or Placed, KOT not fired).
    if (!EDITABLE_STATUSES.includes(order.status) || order.stockDeducted)
      return res.status(409).json({ message: "Items can only be changed before the order goes to the kitchen — for more food now, place a new order for the table" });

    const scheduleCtx = await getScheduleContext({ models: req.models });
    const newDbItems = await priceItems(items, MenuItem, scheduleCtx);

    newDbItems.forEach(newItem => {
      const existing = order.items.find(ex => String(ex.menuItem) === String(newItem.menuItem));
      if (existing) existing.qty += newItem.qty;
      else order.items.push(newItem);
    });

    const restaurant = await RestaurantProfile.findOne();
    // Re-applies the customer's coupon snapshot, if any (utils/pricing.js).
    const totals = computeTotals(order.items, restaurant, order.coupon);
    order.subtotal      = totals.subtotal;
    order.tax            = totals.tax;
    order.serviceCharge  = totals.serviceCharge;
    order.discount       = totals.discount;
    order.total           = totals.total;

    const actor = buildActor(req.user);

    // Atomic, conditional write (same guard as orderService.modifyOrderItemsTx):
    // only if the order is STILL Placed, stock not yet deducted, and nobody
    // edited it since we read it. A plain save() here could land after the
    // send-to-kitchen timer had already printed the KOT and deducted stock —
    // the added food would then never reach the kitchen or the stock count.
    const updated = await Order.findOneAndUpdate(
      {
        _id: order._id, status: order.status, stockDeducted: { $ne: true },
        // Orders saved before `revision` existed have no field (read as 0).
        revision: order.revision ? order.revision : { $in: [0, null] },
      },
      {
        $set: {
          items: order.items, subtotal: order.subtotal, tax: order.tax,
          serviceCharge: order.serviceCharge, discount: order.discount, total: order.total,
        },
        $push: { statusHistory: { status: order.status, changedBy: actor, changedAt: new Date(), note: `Added ${newDbItems.length} item(s)` } },
        $inc: { revision: 1 },
      },
      { returnDocument: "after", runValidators: true },
    );
    if (!updated)
      return res.status(409).json({ message: "This order just went to the kitchen or was changed by someone else — refresh and place a new order for the extra items" });

    emitOrderStatusChanged(req.tenantKey, updated, updated.status);
    res.json(updated);
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message });
  }
};

// ── GET /api/admin/orders/combined-bill?phone=... OR ?tableNo=... ────────────
export const getCombinedBill = async (req, res) => {
  try {
    const { Order, RestaurantProfile, User } = req.models;
    const { phone, tableNo, orderIds } = req.query;
    const ACTIVE_STATUSES = ["CONFIRMED","PREPARING","READY","DELIVERED"];

    let matchOrders = [];

    if (orderIds) {
      // Picked orders — but never a cancelled or still-unpaid pay-first one:
      // their totals are not owed and must not join the bill.
      const ids = String(orderIds).split(",").map((x) => x.trim()).filter((x) => mongoose.isValidObjectId(x));
      matchOrders = await Order.find({ _id: { $in: ids }, status: { $nin: [STATUS_CANCELLED, "AWAITING_PAYMENT"] } }).populate("user","name phone");
    } else if (phone) {
      // `user` is a reference, so "user.phone" never matched anything — find
      // the logged-in customer's id by phone instead.
      const users = await User.find({ phone: String(phone) }).select("_id").lean();
      matchOrders = await Order.find({
        $or: [{ guestPhone: String(phone) }, ...(users.length ? [{ user: { $in: users.map((u) => u._id) } }] : [])],
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
        else mergedItems.push({ name:item.name, nameBn:item.nameBn || "", price:item.price, qty:item.qty });
      });
    });

    const grandTotal = matchOrders.reduce((s,o) => s + Number(o.total||0), 0);
    const totalTax   = matchOrders.reduce((s,o) => s + (o.tax||0), 0);
    const totalSC    = matchOrders.reduce((s,o) => s + (o.serviceCharge||0), 0);
    const totalDiscount = matchOrders.reduce((s,o) => s + (o.discount||0), 0);
    const subtotal   = mergedItems.reduce((s,i) => s + i.price * i.qty, 0);
    const restaurant = await RestaurantProfile.findOne();

    res.json({
      orders: matchOrders,
      mergedItems,
      subtotal,
      tax: totalTax,
      serviceCharge: totalSC,
      discount: totalDiscount,
      grandTotal,
      restaurantName: restaurant?.restaurantName || "Restaurant",
      paymentQr: restaurant?.paymentQr || "",
      upiId: restaurant?.upiId || "",
      orderCount: matchOrders.length,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── POST /api/admin/orders/:id/print-bill ────────────────────────────────────
export const printBill = async (req, res) => {
  try {
    const { Order, BillPrintJob, RestaurantProfile } = req.models;
    const order = await Order.findById(req.params.id).populate("user","name phone");
    if (!order) return res.status(404).json({ message: "Order not found" });
    const restaurant = await RestaurantProfile.findOne().select("restaurantName logo").lean();
    const byCustomer = !order.source || order.source === "CUSTOMER";

    const payload = {
      // Bill header: name + logo (Admin → Profile). The print service turns
      // the logo URL into receipt art itself (print-service/src/logo.js).
      restaurantName: restaurant?.restaurantName || "",
      logoUrl:        /^https?:\/\//i.test(restaurant?.logo || "") ? restaurant.logo : "",
      orderId:       order.orderId,
      tableNo:       order.tableNo,
      orderType:     order.orderType,
      diningArea:    order.diningArea || "", // KH-10
      items:         order.items,
      subtotal:      order.subtotal || 0,
      tax:           order.tax      || 0,
      serviceCharge: order.serviceCharge || 0,
      discount:      order.discount || 0,
      couponCode:    order.coupon?.code || "",
      total:         order.total,
      paymentMethod: order.paymentMethod || "Cash",
      paymentStatus: order.paymentStatus,
      // The customer — on a staff-placed order `user` is the waiter/admin.
      guestName:     order.guestName  || (byCustomer ? order.user?.name  : "") || "",
      guestPhone:    order.guestPhone || (byCustomer ? order.user?.phone : "") || "",
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
