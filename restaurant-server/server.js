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
  initSocket, emitPayFirstPromoted, emitPayFirstExpired, emitPaymentStatusChanged,
  emitSentToKitchen, emitOrderNeedsAttention,
} from "./sockets/socket.js";
import { runDueOffers } from "./services/notificationService.js";
import { runPayFirstTick } from "./services/payFirstService.js";
import { autoSendDueOrders } from "./services/orderService.js";
import { ensureSmartCategories } from "./services/smartCategoryService.js";
import { ensureMenuSections } from "./services/categoryService.js";
import { categoryResetDay, isAfterCategoryResetBoundary, resetCategoryOrdering } from "./services/categoryOrderingService.js";
import { resolveTimezone } from "./utils/menuSchedule.js";
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
import inventoryV3Routes from "./routes/inventoryV3Routes.js";
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
import deliveryRoutes from "./routes/deliveryRoutes.js";
import { runDeliveryTick } from "./services/deliveryService.js";
import { publishDeliveryEffects } from "./services/deliveryRealtime.js";
import { errorHandler, notFound } from "./middleware/errorMiddleware.js";
import compression from "compression";
import { sanitizeInput } from "./middleware/sanitizeInput.js";

// Deployment settings security depends on (warns; stops only without JWT_SECRET).
runSecurityCheck();
//test
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
app.use("/api/admin/inventory/v3", inventoryV3Routes);
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
app.use("/api/delivery",          deliveryRoutes);

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
      .then(async (conn) => {
        const models = getModels(conn);
        await ensureSmartCategories({ models });
        const { created, renamed } = await ensureMenuSections({ models });
        if (created.length) console.log(`menu sections added as categories: ${created.join(", ")}`);
        for (const [from, to] of renamed) console.log(`category "${from}" renamed to section "${to}"`);
      })
      .catch((err) => console.error("menu categories setup failed:", err.message));
    // DISABLE_BACKGROUND_JOBS=true — for a second, local copy of the server
    // pointed at the live database: it must not race production on real
    // orders (auto-send → KOT announced where no printer listens), offer
    // pushes or pay-first cancels. Unset (production) = unchanged.
    if (process.env.DISABLE_BACKGROUND_JOBS === "true") {
      console.log("⏸  Background jobs disabled (DISABLE_BACKGROUND_JOBS=true) — offers, pay-first and auto-send ticks NOT started");
    } else {
      startScheduledOfferTick();
      startPayFirstTick();
      startAutoSendTick();
      startDeliveryTick();
      startCategoryOrderingResetTick();
    }
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

// ── Home delivery ───────────────────────────────────────────────────────────
// Creates jobs for confirmed delivery orders, expires offers, re-broadcasts or
// escalates, takes idle riders offline and repairs capacity drift
// (services/deliveryService.js runDeliveryTick). Every step is an atomic
// conditional write — safe on several instances. 5s keeps offer expiry tight.
const DELIVERY_TICK_MS = 5 * 1000;
const startDeliveryTick = () => {
  let running = false;
  const tick = async () => {
    if (running) return; // a slow tick never overlaps itself
    running = true;
    try {
      const mongoUri = process.env.MONGO_URI;
      const conn = await getDB(mongoUri);
      const models = getModels(conn);
      const { stats, effects } = await runDeliveryTick({ models, db: conn });
      publishDeliveryEffects(tenantKeyFromUri(mongoUri), effects, { models });
      if (stats.created || stats.cancelled || stats.rebroadcast || stats.escalated || stats.wentOffline || stats.repaired) {
        console.log("🛵 delivery tick:", stats);
      }
    } catch (err) {
      console.error("delivery tick failed:", err.message);
    } finally {
      running = false;
    }
  };
  tick();
  setInterval(tick, DELIVERY_TICK_MS);
};

const CATEGORY_ORDERING_TICK_MS = 60 * 1000;
let categoryOrderingResetDay = null;
const startCategoryOrderingResetTick = () => {
  const tick = async () => {
    try {
      const mongoUri = process.env.MONGO_URI;
      const conn = await getDB(mongoUri);
      const models = getModels(conn);
      const profile = await models.RestaurantProfile.findOne().select("timezone").lean();
      const timezone = resolveTimezone(profile?.timezone);
      if (!isAfterCategoryResetBoundary(new Date(), timezone)) return;
      const day = categoryResetDay(new Date(), timezone);
      if (day === categoryOrderingResetDay) return;
      const changed = await resetCategoryOrdering({ models, db: conn });
      categoryOrderingResetDay = day;
      if (changed) console.log(`category ordering reset: ${changed} categor${changed === 1 ? "y" : "ies"}`);
    } catch (err) {
      console.error("category ordering reset tick failed:", err.message);
    }
  };
  tick();
  setInterval(tick, CATEGORY_ORDERING_TICK_MS);
};

// ── Employee duty: no automatic OFF ─────────────────────────────────────────
// There is deliberately no attendance heartbeat sweep any more. It used to
// close a duty session after ~5 minutes without a heartbeat — which is
// exactly what a sleeping phone, a backgrounded app or a dropped network
// produce — so staff kept getting turned OFF duty on their own. Duty now
// ends only on an explicit action (services/attendanceService.js endDuty /
// setEmployeeShift), and every real ON/OFF writes a DutyHistory record.
