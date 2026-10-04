// server.js — Restaurant server (single-restaurant mode — see middleware/authMiddleware.js)
// Every request uses the one database configured in process.env.MONGO_URI.
// No JWT-embedded mongoUri, no x-restaurant-* headers are consulted.

import dns  from "node:dns";
import http from "http";
dns.setServers(["1.1.1.1", "8.8.8.8"]);

import express    from "express";
import cors       from "cors";
import "./config/env.js";
import { runSecurityCheck } from "./config/securityCheck.js";
import { connectDB, getDB } from "./config/db.js";
import { getModels } from "./config/getModels.js";
import { tenantKeyFromUri } from "./utils/tenantKey.js";
import {
  initSocket, emitAttendanceUpdated, emitPayFirstPromoted, emitPayFirstExpired, emitPaymentStatusChanged,
  emitSentToKitchen, emitOrderNeedsAttention,
} from "./sockets/socket.js";
import { sweepStaleAttendanceSessions } from "./services/attendanceService.js";
import { runDueOffers } from "./services/notificationService.js";
import { runPayFirstTick } from "./services/payFirstService.js";
import { autoSendDueOrders } from "./services/orderService.js";
import { ensureSmartCategories } from "./services/smartCategoryService.js";
import { BRAND_NAME } from "./utils/brand.js";

import authRoutes    from "./routes/authRoutes.js";
import menuRoutes    from "./routes/menuRoutes.js";
import orderRoutes   from "./routes/orderRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import invoiceRoutes from "./routes/invoiceRoutes.js";
import adminRoutes   from "./routes/adminRoutes.js";
import tableRoutes   from "./routes/tableRoutes.js";
import tableSessionRoutes from "./routes/tableSessionRoutes.js";
import waitlistRoutes from "./routes/waitlistRoutes.js";
import supportRoutes from "./routes/supportRoutes.js";
import printerRoutes from "./routes/printerRoutes.js";
import inventoryRoutes from "./routes/inventoryRoutes.js";
import { warmUpOcr } from "./utils/purchaseImportExtract.js";
import chefRoutes    from "./routes/chefRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import kitchenRoutes  from "./routes/kitchenRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import catagoryRoutes from "./routes/catagoryRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import waiterCallRoutes from "./routes/waiterCallRoutes.js";
import couponRoutes from "./routes/couponRoutes.js";
import { errorHandler, notFound } from "./middleware/errorMiddleware.js";
import compression from "compression";
import { sanitizeInput } from "./middleware/sanitizeInput.js";

// Deployment settings security depends on (warns; stops only without JWT_SECRET).
runSecurityCheck();

const app    = express();
const server = http.createServer(app);

// Tenant-scoped Socket.IO (see sockets/socket.js) — replaces the old global
// io.emit setup, which broadcast every restaurant's events to every
// connected client regardless of tenant.
export const io = initSocket(server);

app.use(cors({
  origin: "*",
  methods: ["GET","POST","PUT","DELETE","OPTIONS","PATCH"],
  // x-guest-order-token lets a logged-out guest view/cancel their own order
  // (see services/orderService.js assertCanViewOrder) — without it in the
  // allowlist, the browser's CORS preflight blocks the request outright and
  // the customer app's order page fails with "Couldn't load this order".
  allowedHeaders: ["Content-Type","Authorization","x-guest-order-token"],
}));

// gzip every API response — order lists shrink ~85%, which is most of the
// admin's load time on a phone connection.
app.use(compression());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
// Drop "$…" keys from every body — blocks { phone: { $ne: null } } style
// operator injection into Mongo filters (middleware/sanitizeInput.js).
app.use(sanitizeInput);

// ── Health check ──────────────────────────────────────────────────────────────
// Includes the deployed commit SHA (Render sets RENDER_GIT_COMMIT automatically
// on every deploy) so a "did my push actually deploy?" question can be answered
// by curling this instead of guessing from symptoms.
app.get("/api/health", (_, res) =>
  res.json({
    status: "OK",
    time: new Date(),
    mode: "single-restaurant",
    commit: process.env.RENDER_GIT_COMMIT || null,
  })
);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth",              authRoutes);
app.use("/api/menu",              menuRoutes);
app.use("/api/orders",            orderRoutes);
app.use("/api/payments",          paymentRoutes);
app.use("/api/invoices",          invoiceRoutes);
app.use("/api/admin/tables",      tableRoutes);
app.use("/api/admin/table-sessions", tableSessionRoutes);
app.use("/api/admin/waitlist",    waitlistRoutes);
app.use("/api/admin/inventory",   inventoryRoutes);
app.use("/api/admin/chefs",       chefRoutes);
// New Employee Management system (Admin → Employees) — supersedes the old
// Chef directory above for anything NEW; chefRoutes/Chef model are left
// mounted and untouched so nothing that already depends on them breaks.
app.use("/api/admin/employees",   employeeRoutes);
app.use("/api/reviews",           reviewRoutes);
app.use("/api/kitchen",           kitchenRoutes);
app.use("/api/admin/restaurant",  profileRoutes);
app.use("/api/admin",             adminRoutes);
app.use("/api/categories",        catagoryRoutes);
app.use("/api/support",           supportRoutes);
app.use("/api/admin/printer",     printerRoutes);
app.use("/api/notifications",     notificationRoutes);
app.use("/api/waiter-calls",      waiterCallRoutes);
app.use("/api/coupons",           couponRoutes);
app.use("/api/attendance",        attendanceRoutes);

app.get("/api/test-whatsapp/:phone", async (req, res) => {
  const { sendWhatsAppBill } = await import("./utils/sendWhatsAppBill.js");
  await sendWhatsAppBill(req.params.phone, {
    orderId: "TEST001",
    items: [{ name: "Cold Coffee", qty: 1, price: 60 }],
    subtotal: 60, tax: 0, serviceCharge: 0, discount: 0, total: 60,
    paymentMethod: "Cash", paymentStatus: "PAID", tableNo: 3,
  }, BRAND_NAME);
  res.json({ message: "WhatsApp test sent to +91" + req.params.phone });
});

app.use(notFound);
app.use(errorHandler);

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║  Restaurant Server (Single Restaurant)  · Port ${PORT} ║
║  DB: ${(process.env.MONGO_URI || "").split("/").pop().split("?")[0]}
╚══════════════════════════════════════════════════════╝
    `);
    warmUpOcr(); // background — see utils/purchaseImportExtract.js
    // MNU-03/04/05/07 built-in categories (idempotent; never overwrites admin edits).
    getDB(process.env.MONGO_URI)
      .then((conn) => ensureSmartCategories({ models: getModels(conn) }))
      .catch((err) => console.error("smart categories setup failed:", err.message));
    startAttendanceHeartbeatSweep();
    startScheduledOfferTick();
    startPayFirstTick();
    startAutoSendTick();
  });
});

// ── Scheduled offer notifications ─────────────────────────────────────────────
// Pushes offers whose start time has arrived (Admin → Offers with a future
// start). runDueOffers claims each one atomically, so this is safe even with
// several server instances running the same tick — see
// services/notificationService.js. Runs once right away so offers that came
// due while the server was down go out on startup.
const OFFER_TICK_INTERVAL_MS = 30 * 1000;
const startScheduledOfferTick = () => {
  const tick = async () => {
    try {
      const conn = await getDB(process.env.MONGO_URI);
      const r = await runDueOffers({ models: getModels(conn) });
      if (r.sent || r.failed || r.interrupted) console.log("📣 scheduled offers:", r);
    } catch (err) {
      console.error("scheduled offer tick failed:", err.message);
    }
  };
  tick();
  setInterval(tick, OFFER_TICK_INTERVAL_MS);
};

// ── Edit window → kitchen ───────────────────────────────────────────────────
// Sends every order whose edit window has ended to the kitchen (PREPARING +
// stock + KOT in one transaction — orderService.sendToKitchenTx). The write
// is conditional on PENDING_CONFIRMATION, so several instances can't double-
// send. 15s keeps the delay after the window short.
const AUTO_SEND_TICK_MS = 15 * 1000;
const startAutoSendTick = () => {
  const tick = async () => {
    try {
      const mongoUri = process.env.MONGO_URI;
      const conn = await getDB(mongoUri);
      const tenantKey = tenantKeyFromUri(mongoUri);
      const r = await autoSendDueOrders({
        models: getModels(conn), db: conn,
        onSent: (sent) => emitSentToKitchen(tenantKey, sent),
        onFailed: (order) => emitOrderNeedsAttention(tenantKey, order),
      });
      if (r.sent || r.failed) console.log("🍳 auto-sent to kitchen:", r);
    } catch (err) {
      console.error("auto-send tick failed:", err.message);
    }
  };
  tick();
  setInterval(tick, AUTO_SEND_TICK_MS);
};

// ── Pay-first orders (utils/paymentMode.js) ─────────────────────────────────
// Promotes paid AWAITING_PAYMENT orders a crash may have left behind, and
// cancels unpaid ones past their deadline (after a last live PhonePe check).
// Every change is an atomic conditional update — safe on several instances.
const PAY_FIRST_TICK_MS = 60 * 1000;
const startPayFirstTick = () => {
  const tick = async () => {
    try {
      const mongoUri = process.env.MONGO_URI;
      const conn = await getDB(mongoUri);
      const tenantKey = tenantKeyFromUri(mongoUri);
      const r = await runPayFirstTick({
        models: getModels(conn),
        onPromoted: (o) => emitPayFirstPromoted(tenantKey, o),
        onPaymentChanged: (o) => emitPaymentStatusChanged(tenantKey, o),
        onExpired: (o) => emitPayFirstExpired(tenantKey, o),
      });
      if (r.promoted || r.expired) console.log("💳 pay-first orders:", r);
    } catch (err) {
      console.error("pay-first tick failed:", err.message);
    }
  };
  tick();
  setInterval(tick, PAY_FIRST_TICK_MS);
};

// ── Employee attendance heartbeat sweep ─────────────────────────────────────
// Closes any duty session whose heartbeat has gone quiet for longer than the
// grace period built into sweepStaleAttendanceSessions (browser closed
// unexpectedly, device lost connectivity, etc.) — see
// services/attendanceService.js for why this uses lastSeenAt, never "now",
// as the logout time.
const ATTENDANCE_SWEEP_INTERVAL_MS = 2 * 60 * 1000;
const startAttendanceHeartbeatSweep = () => {
  setInterval(async () => {
    try {
      const mongoUri = process.env.MONGO_URI;
      const conn = await getDB(mongoUri);
      const { AttendanceSession } = getModels(conn);
      const closed = await sweepStaleAttendanceSessions({ AttendanceSession });
      const tenantKey = tenantKeyFromUri(mongoUri);
      for (const session of closed) {
        emitAttendanceUpdated(tenantKey, {
          action: "HEARTBEAT_TIMEOUT",
          session,
          employee: { _id: session.employee, name: session.employeeName, role: session.role },
        });
      }
    } catch (err) {
      console.error("attendance heartbeat sweep failed:", err.message);
    }
  }, ATTENDANCE_SWEEP_INTERVAL_MS);
};
