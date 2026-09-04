// sockets/socket.js
// ─────────────────────────────────────────────────────────────────────────────
// Central Socket.IO setup.
//
// PROBLEM THIS FIXES: previously every controller called the global `io.emit`,
// which broadcasts to *every* socket connected to the process — across every
// restaurant. With one process serving many tenants that leaks restaurant A's
// orders to restaurant B's screens. Everything here is room-scoped instead.
//
// Handshake auth (`socket.handshake.auth`):
//   { token }        — JWT (admin/waiter/logged-in customer). Server resolves
//                       the tenant DB + role from it and joins the right
//                       rooms automatically.
//   { printerKey }    — a local print-service (Phase 5). Verified against
//                       PrinterDevice.keyHash — NOT a staff JWT, deliberately
//                       narrower-scoped and long-lived. Auto-joins the
//                       printers room; nothing else.
//   { dbName }         — guest customer with no JWT. Joins nothing by default.
//
// Client-emitted events:
//   join-order  { orderId, guestOrderToken? }
//       Subscribes to one order's updates (owner / valid guest token / staff).
//   register-printer
//       Explicit opt-in to the printers room for staff-authenticated sockets
//       (e.g. an in-browser diagnostic view). Printer-key sockets join
//       automatically and don't need this.
//   report-job-status  { jobId, jobType: "KOT"|"BILL", status, error? }
//       Printer-key sockets only. Updates the persisted job's status —
//       PENDING → PRINTING → PRINTED/FAILED — and the device's last-seen
//       heartbeat. This is the single place print outcomes are recorded.
//
// Server-emitted events (see emitters at the bottom):
//   order:new / order:confirmed / order:status_changed / order:cancelled
//   order:payment_changed / table:cleared / inventory:alert
//   kot:created  { jobId, jobType:"KOT", order:{...}, items }   → staff + printers room
//   bill:print   { jobId, jobType:"BILL", order:{...}, ... }    → staff + printers room
// ─────────────────────────────────────────────────────────────────────────────

import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { getDB } from "../config/db.js";
import { getModels } from "../config/getModels.js";
import { tenantKeyFromUri, rooms } from "../utils/tenantKey.js";
import { verifyGuestOrderToken } from "../utils/guestOrderToken.js";
import { verifyPrinterKey, markPrinterSeen } from "../services/printerDeviceService.js";

let ioInstance = null;

export const initSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  io.use(async (socket, next) => {
    try {
      const { token, printerKey, dbName } = socket.handshake.auth || {};
      const mongoUri = process.env.MONGO_URI; // single-restaurant mode

      if (printerKey) {
        if (!mongoUri) return next(new Error("Server not configured"));
        const conn   = await getDB(mongoUri);
        const { PrinterDevice } = getModels(conn);
        const device = await verifyPrinterKey({ PrinterDevice, plainKey: printerKey });
        if (!device) return next(new Error("Invalid or revoked printer key"));

        socket.tenantKey       = tenantKeyFromUri(mongoUri);
        socket.userId           = null;
        socket.role              = "printer";
        socket.isStaff            = false;
        socket.isChef               = false;
        socket.isPrinterDevice     = true;
        socket.printerDeviceId      = String(device._id);
        return next();
      }

      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!mongoUri) return next(new Error("Server not configured"));

        const conn   = await getDB(mongoUri);
        const models = getModels(conn);
        const user   = await models.User.findById(decoded.id).select("-otp -otpExpiry -password");
        if (!user) return next(new Error("User not found"));

        socket.tenantKey = tenantKeyFromUri(mongoUri);
        socket.userId    = String(user._id);
        socket.role       = user.isAdmin ? "admin" : (user.role || "customer");
        socket.isStaff     = socket.role === "admin" || socket.role === "waiter";
        // A chef joins the kitchen room (KOT + status events only), never
        // the staff room — that room carries payment status and guest
        // name/phone, which a chef must never receive.
        socket.isChef       = socket.role === "chef";
        return next();
      }

      // Guest — no JWT. Single-restaurant mode: there is only ever one
      // tenant (process.env.MONGO_URI), so an explicit dbName isn't required
      // anymore — it's accepted for backward compatibility but ignored.
      void dbName;
      socket.tenantKey = tenantKeyFromUri(mongoUri);
      socket.userId    = null;
      socket.role       = "guest";
      socket.isStaff     = false;
      socket.isChef       = false;
      return next();
    } catch (err) {
      return next(new Error("Socket auth failed: " + err.message));
    }
  });

  io.on("connection", (socket) => {
    const tenantKey = socket.tenantKey;

    // Everyone connected to a tenant gets the general tenant room.
    socket.join(rooms.tenant(tenantKey));
    if (socket.isStaff) socket.join(rooms.staff(tenantKey));
    if (socket.isChef)  socket.join(rooms.kitchen(tenantKey));

    if (socket.isPrinterDevice) {
      socket.join(rooms.printers(tenantKey));
      console.log(`Printer device connected: ${socket.id} [device=${socket.printerDeviceId}]`);
      markPrinterDeviceSeen(socket.printerDeviceId, "online").catch(() => {});
    } else {
      console.log(`Socket connected: ${socket.id} [tenant=${tenantKey} role=${socket.role}]`);
    }

    // Let a caller subscribe to a single order's updates — used by guests
    // (no account) and by logged-in customers tracking their own order.
    socket.on("join-order", async ({ orderId, guestOrderToken } = {}) => {
      if (!orderId) return;

      if (socket.isStaff) {
        socket.join(rooms.order(tenantKey, orderId));
        return;
      }

      if (verifyGuestOrderToken(guestOrderToken, orderId)) {
        socket.join(rooms.order(tenantKey, orderId));
        return;
      }

      if (socket.userId) {
        // Logged-in customer — verify they actually own this order before
        // letting them subscribe to it. Single-restaurant mode: always the
        // server's own MONGO_URI, never anything derived from the client.
        try {
          const conn   = await getDB(process.env.MONGO_URI);
          const { Order } = getModels(conn);
          const order   = await Order.findById(orderId).select("user");
          if (order && String(order.user) === socket.userId) {
            socket.join(rooms.order(tenantKey, orderId));
          }
        } catch {
          /* ignore — silently refuse the subscription */
        }
      }
    });

    // A staff browser (diagnostic view) can opt into the printers room too.
    // Printer-key sockets already joined automatically above.
    socket.on("register-printer", () => {
      if (!socket.isStaff) return;
      socket.join(rooms.printers(tenantKey));
      console.log(`Printer room joined by staff socket: ${socket.id} [tenant=${tenantKey}]`);
    });

    // ── Print-service pulls the current queue ───────────────────────────────
    // Called on every connect/reconnect (before processing anything live) so
    // a job created — or a status change missed — while this print-service
    // was offline is never lost. Uses the same printer-key auth boundary as
    // the rest of this socket, rather than requiring a second (REST) auth
    // path just for this one call. Acknowledgement-style: the print-service
    // passes a callback and gets the queue back directly, no separate event
    // round-trip needed.
    socket.on("get-queue", async (_payload, callback) => {
      if (typeof callback !== "function") return;
      if (!socket.isPrinterDevice) return callback({ error: "Not authorized" });
      try {
        const conn = await getDB(process.env.MONGO_URI);
        const { KOTJob, BillPrintJob } = getModels(conn);
        const NOT_DONE = { $in: ["PENDING","PRINTING","FAILED"] };

        const [kot, bill] = await Promise.all([
          KOTJob.find({ status: NOT_DONE }).sort({ createdAt: 1 }).lean(),
          BillPrintJob.find({ status: NOT_DONE }).sort({ createdAt: 1 }).lean(),
        ]);

        const jobs = [
          ...kot.map((j) => ({ jobId: String(j._id), jobType: "KOT", status: j.status, attempts: j.attempts,
            orderId: j.orderId, tableNo: j.tableNo, orderType: j.orderType, items: j.items, createdAt: j.createdAt })),
          ...bill.map((j) => ({ jobId: String(j._id), jobType: "BILL", status: j.status, attempts: j.attempts,
            orderId: j.orderId, tableNo: j.tableNo, orderType: j.orderType, payload: j.payload, createdAt: j.createdAt })),
        ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        callback({ jobs });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    // ── Print-service reports a job outcome ─────────────────────────────────
    // This is the ONLY path that flips PENDING/PRINTING → PRINTED/FAILED for
    // real print attempts (the REST PATCH in printerController.js is for a
    // human override). Printer-key sockets only — a customer or even staff
    // socket cannot forge a "printed" result for someone else's print queue.
    socket.on("report-job-status", async ({ jobId, jobType, status, error } = {}) => {
      if (!socket.isPrinterDevice) return;
      if (!jobId || !["KOT","BILL"].includes(jobType)) return;
      if (!["PENDING","PRINTING","PRINTED","FAILED"].includes(status)) return;

      try {
        const conn = await getDB(process.env.MONGO_URI);
        const { KOTJob, BillPrintJob, PrinterDevice } = getModels(conn);
        const Model = jobType === "KOT" ? KOTJob : BillPrintJob;

        const setFields = {
          status,
          printerId: socket.printerDeviceId,
          lastError: error || "",
          ...(status === "PRINTED" ? { printedAt: new Date() } : {}),
        };
        const incFields = (status === "FAILED" || status === "PRINTING") ? { attempts: 1 } : null;

        const job = await Model.findByIdAndUpdate(
          jobId,
          { $set: setFields, ...(incFields ? { $inc: incFields } : {}) },
          { new: true }
        );

        if (job) {
          const roomEvent = jobType === "KOT" ? "kot:status_changed" : "bill:status_changed";
          emit(rooms.staff(tenantKey), roomEvent, { jobId, jobType, status, job });
        }

        await markPrinterSeen({ PrinterDevice, deviceId: socket.printerDeviceId, status: status === "FAILED" ? "error" : "online", error });
      } catch (err) {
        console.error("report-job-status failed:", err.message);
      }
    });

    socket.on("disconnect", () => {
      if (socket.isPrinterDevice) {
        console.log(`Printer device disconnected: ${socket.id}`);
        markPrinterDeviceSeen(socket.printerDeviceId, "offline").catch(() => {});
      } else {
        console.log(`Socket disconnected: ${socket.id}`);
      }
    });
  });

  ioInstance = io;
  return io;
};

const markPrinterDeviceSeen = async (deviceId, status) => {
  if (!deviceId) return;
  const conn = await getDB(process.env.MONGO_URI);
  const { PrinterDevice } = getModels(conn);
  await markPrinterSeen({ PrinterDevice, deviceId, status });
};

export const getIO = () => {
  if (!ioInstance) throw new Error("Socket.IO not initialized — call initSocket() first");
  return ioInstance;
};

/** Number of sockets currently joined to a room — used for "is a printer
 * service currently connected?" style monitoring. Never throws (returns 0
 * if Socket.IO isn't up yet, e.g. during tests). */
export const getRoomConnectionCount = async (roomName) => {
  try {
    const sockets = await getIO().in(roomName).fetchSockets();
    return sockets.length;
  } catch {
    return 0;
  }
};

// ── Typed emit helpers ────────────────────────────────────────────────────
// All controllers should use these instead of calling io.emit directly, so
// tenant scoping can never be forgotten in a future edit.

const emit = (roomName, event, payload) => {
  try {
    getIO().to(roomName).emit(event, payload);
  } catch (err) {
    // Socket layer must never crash a request — an order still succeeds
    // even if realtime notification fails for some reason.
    console.error(`Socket emit failed [${event}]:`, err.message);
  }
};

export const emitNewOrderPendingConfirmation = (tenantKey, order) => {
  emit(rooms.staff(tenantKey), "order:new", { order, playSound: true });
  // legacy event name kept for any older listener
  emit(rooms.staff(tenantKey), "order-approval-request", order);
};

export const emitOrderConfirmed = (tenantKey, order) => {
  emit(rooms.staff(tenantKey), "order:confirmed", { order });
  emit(rooms.order(tenantKey, order._id), "order:confirmed", { order });
  emit(rooms.tenant(tenantKey), "new-order", order); // legacy
};

// Reduced, chef-safe view of an order — mirrors kitchenController.js's
// toKitchenTicket() so the kitchen room's live events carry the same
// guarantee as its REST endpoint: no customer PII, no payment/price data.
const toKitchenSafeOrder = (order) => ({
  _id: order._id, orderId: order.orderId, tableNo: order.tableNo,
  orderType: order.orderType, status: order.status, priority: order.priority,
  waiterName: order.waiterName || "",
  items: (order.items || []).map((i) => ({ name: i.name, qty: i.qty, notes: i.notes || "" })),
  notes: order.notes || "",
});

export const emitOrderStatusChanged = (tenantKey, order, previousStatus) => {
  const payload = { order, previousStatus };
  emit(rooms.staff(tenantKey), "order:status_changed", payload);
  emit(rooms.order(tenantKey, order._id), "order:status_changed", payload);
  emit(rooms.kitchen(tenantKey), "order:status_changed", { order: toKitchenSafeOrder(order), previousStatus });
  emit(rooms.tenant(tenantKey), "order-status-updated", order); // legacy
};

export const emitOrderCancelled = (tenantKey, order, reason) => {
  const payload = { order, reason };
  emit(rooms.staff(tenantKey), "order:cancelled", payload);
  emit(rooms.order(tenantKey, order._id), "order:cancelled", payload);
  emit(rooms.kitchen(tenantKey), "order:cancelled", { order: toKitchenSafeOrder(order), reason });
  emit(rooms.tenant(tenantKey), "order-rejected", { order, reason }); // legacy
};

// Customer must NOT be able to trigger physical printing — these two
// emitters are only ever called from staff-gated controllers
// (confirmOrderTx → server-side only; printBill → requireStaff route).
export const emitKotCreated = (tenantKey, kotJob) => {
  const payload = {
    jobId: String(kotJob._id), jobType: "KOT",
    orderId: kotJob.orderId, tableNo: kotJob.tableNo, orderType: kotJob.orderType,
    items: kotJob.items, attempts: kotJob.attempts || 0, priority: kotJob.priority || "NORMAL",
  };
  emit(rooms.staff(tenantKey), "kot:created", { kotJob });
  // The Kitchen app's realtime feed — a chef never joins the staff room, so
  // without this, kot:created would never reach them and the whole KDS
  // "new order" alert/sound would silently never fire.
  emit(rooms.kitchen(tenantKey), "kot:created", { kotJob });
  emit(rooms.printers(tenantKey), "kot:created", payload);
  emit(rooms.staff(tenantKey), "kot-print", kotJob); // legacy shape/name
};

export const emitBillPrint = (tenantKey, payload) => {
  const printerPayload = {
    jobId: payload.jobId, jobType: "BILL",
    orderId: payload.orderId, tableNo: payload.tableNo, orderType: payload.orderType,
    payload,
  };
  emit(rooms.staff(tenantKey), "bill:print", payload);
  emit(rooms.printers(tenantKey), "bill:print", printerPayload);
  emit(rooms.staff(tenantKey), "bill-print", payload); // legacy
};

export const emitPaymentStatusChanged = (tenantKey, order) => {
  emit(rooms.staff(tenantKey), "order:payment_changed", { order });
  emit(rooms.order(tenantKey, order._id), "order:payment_changed", { order });
};

export const emitTableCleared = (tenantKey, session) => {
  emit(rooms.staff(tenantKey), "table:cleared", { session });
};

// ── Inventory alerts (Phase 2) ────────────────────────────────────────────
export const emitInventoryAlert = (tenantKey, { item, level }) => {
  emit(rooms.staff(tenantKey), "inventory:alert", { item, level });
};
