// scripts/localSandbox.js — an ISOLATED local backend for development and
// end-to-end testing (admin, customer, delivery app on an emulator/phone).
//
//   node scripts/localSandbox.js            (port 5055 by default; SANDBOX_PORT to change)
//
// SAFETY — this can never touch the real restaurant data or real customers:
//   • MongoDB is a throwaway in-memory replica set on 127.0.0.1 (mongodb-memory-server),
//     created here and destroyed when this process exits. MONGO_URI from .env is
//     overridden BEFORE anything loads dotenv (dotenv never overrides a set
//     variable), and the process refuses to start if it isn't local.
//   • SMS: console only (OTP_PROVIDER=console) — the OTP is echoed in the API
//     response (OTP_DEV_ECHO) and printed here. No Twilio/MSG91 messages.
//   • PhonePe, Cloudinary, Twilio, WhatsApp: blanked. Firebase: a dummy project
//     with a throwaway key, so pushes fail locally and reach nobody.
// Seeds: restaurant (Kolkata, 6 km delivery range, delivery ON, COD default),
// an admin, one demo rider, a demo customer (JWT printed — customer login in
// the real app is Firebase phone auth, which this sandbox can't run) and a menu.
import { generateKeyPairSync } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const PORT = Number(process.env.SANDBOX_PORT || 5055);
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
const uri = replSet.getUri("zen_sandbox");
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) { await replSet.stop(); throw new Error(`Refusing non-local sandbox DB: ${uri}`); }

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
Object.assign(process.env, {
  MONGO_URI: uri,
  PORT: String(PORT),
  NODE_ENV: "development",
  OTP_PROVIDER: "console",
  OTP_DEV_ECHO: "true",
  JWT_SECRET: process.env.SANDBOX_JWT_SECRET || "zen-sandbox-only-secret-not-for-production",
  TWILIO_ACCOUNT_SID: "", TWILIO_AUTH_TOKEN: "", TWILIO_PHONE: "", TWILIO_WHATSAPP_FROM: "",
  MSG91_AUTH_KEY: "", PHONEPE_MERCHANT_ID: "", PHONEPE_SALT_KEY: "", PHONEPE_SALT_INDEX: "", PHONEPE_ENV: "",
  CLOUDINARY_CLOUD_NAME: "", CLOUDINARY_API_KEY: "", CLOUDINARY_API_SECRET: "",
  FIREBASE_PROJECT_ID: "zen-sandbox", FIREBASE_CLIENT_EMAIL: "sandbox@zen-sandbox.iam.gserviceaccount.com", FIREBASE_PRIVATE_KEY: privateKey,
  GOOGLE_ROUTES_API_KEY: process.env.SANDBOX_GOOGLE_ROUTES_API_KEY || "",
  CLIENT_URL: process.env.SANDBOX_CLIENT_URL || "http://localhost:5173",
});

// ── seed (before the server starts, through the app's own schemas) ──────────
const mongoose = (await import("mongoose")).default;
const { getModels } = await import("../config/getModels.js");
const jwt = (await import("jsonwebtoken")).default;
const seedConn = await mongoose.createConnection(uri).asPromise();
const M = getModels(seedConn);
await Promise.all(Object.values(M).map((m) => m.init()));
await M.RestaurantProfile.create({
  restaurantName: "Zen Sandbox Cafe", phone: "03300000000", address: "Park Street, Kolkata",
  latitude: 22.5526, longitude: 88.3529, deliveryRange: 6000, dineInRange: 200, gstRate: 5,
  services: { dineIn: true, takeAway: true, delivery: true }, paymentMode: "BOTH", editWindowMinutes: 1,
});
const admin = await M.User.create({ name: "Sandbox Admin", phone: "9000000001", role: "admin", isAdmin: true, status: "Active" });
const rider = await M.User.create({ name: "Ravi Demo", phone: "9000000011", role: "delivery", status: "Active" });
const customer = await M.User.create({ name: "Asha Customer", phone: "9000000099", role: "customer", status: "Active", isVerified: true });
await M.MenuItem.insertMany([
  { name: "Chicken Momo", price: 160, category: "Starters", isAvailable: true, tag: "Non Veg" },
  { name: "Veg Thali", price: 220, category: "Main Course", isAvailable: true, tag: "Veg" },
  { name: "Masala Chai", price: 40, category: "Beverages", isAvailable: true, tag: "Veg" },
]);
await seedConn.close();

const sign = (u) => jwt.sign({ id: u._id, role: u.role }, process.env.JWT_SECRET, { expiresIn: "7d" });

// ── start the real server against the sandbox DB ─────────────────────────────
await import("../server.js");

const shutdown = async () => { try { await replSet.stop(); } finally { process.exit(0); } };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`
──────────────── ZEN OS LOCAL SANDBOX (throwaway data) ────────────────
 API          http://localhost:${PORT}/api      (Android emulator: http://10.0.2.2:${PORT}/api)
 Database     ${uri}  (in-memory, deleted on exit)
 OTP          console only — returned as "otp" by /api/auth/*/send-otp
 Admin        phone 9000000001   (admin app login via OTP)
 Rider        phone 9000000011   (Zen OS Delivery app login via OTP)
 Customer JWT ${sign(customer)}
 Admin JWT    ${sign(admin)}
 Rider id     ${rider._id}
──────────────────────────────────────────────────────────────────────────
`);
