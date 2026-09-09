// server.js — Restaurant server (single-restaurant mode — see middleware/authMiddleware.js)
// Every request uses the one database configured in process.env.MONGO_URI.
// No JWT-embedded mongoUri, no x-restaurant-* headers are consulted.

import dns  from "node:dns";
import http from "http";
dns.setServers(["1.1.1.1", "8.8.8.8"]);

import express    from "express";
import cors       from "cors";
import "./config/env.js";
import { connectDB } from "./config/db.js";
import { initSocket } from "./sockets/socket.js";

import authRoutes    from "./routes/authRoutes.js";
import menuRoutes    from "./routes/menuRoutes.js";
import orderRoutes   from "./routes/orderRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import invoiceRoutes from "./routes/invoiceRoutes.js";
import adminRoutes   from "./routes/adminRoutes.js";
import tableRoutes   from "./routes/tableRoutes.js";
import tableSessionRoutes from "./routes/tableSessionRoutes.js";
import supportRoutes from "./routes/supportRoutes.js";
import printerRoutes from "./routes/printerRoutes.js";
import inventoryRoutes from "./routes/inventoryRoutes.js";
import { warmUpOcr } from "./utils/purchaseImportExtract.js";
import chefRoutes    from "./routes/chefRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import kitchenRoutes  from "./routes/kitchenRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import catagoryRoutes from "./routes/catagoryRoutes.js";
import { errorHandler, notFound } from "./middleware/errorMiddleware.js";

const app    = express();
const server = http.createServer(app);

// Tenant-scoped Socket.IO (see sockets/socket.js) — replaces the old global
// io.emit setup, which broadcast every restaurant's events to every
// connected client regardless of tenant.
export const io = initSocket(server);

app.use(cors({
  origin: "*",
  methods: ["GET","POST","PUT","DELETE","OPTIONS","PATCH"],
  allowedHeaders: ["Content-Type","Authorization"],
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

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
app.use("/api/admin/inventory",   inventoryRoutes);
app.use("/api/admin/chefs",       chefRoutes);
// New Employee Management system (Admin → Employees) — supersedes the old
// Chef directory above for anything NEW; chefRoutes/Chef model are left
// mounted and untouched so nothing that already depends on them breaks.
app.use("/api/admin/employees",   employeeRoutes);
app.use("/api/kitchen",           kitchenRoutes);
app.use("/api/admin/restaurant",  profileRoutes);
app.use("/api/admin",             adminRoutes);
app.use("/api/categories",        catagoryRoutes);
app.use("/api/support",           supportRoutes);
app.use("/api/admin/printer",     printerRoutes);

app.get("/api/test-whatsapp/:phone", async (req, res) => {
  const { sendWhatsAppBill } = await import("./utils/sendWhatsAppBill.js");
  await sendWhatsAppBill(req.params.phone, {
    orderId: "TEST001",
    items: [{ name: "Cold Coffee", qty: 1, price: 60 }],
    subtotal: 60, tax: 0, serviceCharge: 0, discount: 0, total: 60,
    paymentMethod: "Cash", paymentStatus: "PAID", tableNo: 3,
  }, "Ad's Cafe");
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
  });
});
