// config/db.js
// ─────────────────────────────────────────────────────────────────────────────
// DB connection manager. The app runs in single-restaurant mode (one
// MONGO_URI, see middleware/authMiddleware.js) but connections are still
// cached by URI here in case that ever changes.
// Each restaurant has its own MongoDB database.
// When a user/admin makes a request, we connect to THEIR database
// based on the dbName stored in their JWT token.
// ─────────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";

// ── Connection cache — one connection per restaurant DB ───────────────────────
const connectionCache = new Map();

// ── Get or create a connection for a specific restaurant DB ───────────────────
export const getDB = async (mongoUri) => {
  if (!mongoUri) {
    throw new Error("No mongoUri provided — cannot connect to restaurant DB");
  }

  if (connectionCache.has(mongoUri)) {
    const cached = connectionCache.get(mongoUri);
    if (cached.readyState === 1) return cached; // already connected
    connectionCache.delete(mongoUri); // stale — reconnect
  }

  try {
    const conn = await mongoose.createConnection(mongoUri, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    }).asPromise();

    connectionCache.set(mongoUri, conn);
    console.log(`✅ Connected to restaurant DB: ${mongoUri.split("/").pop()}`);
    return conn;
  } catch (err) {
    console.error(`❌ DB connection failed: ${err.message}`);
    throw new Error(`Cannot connect to restaurant database. Check your MONGO_URI.`);
  }
};

// ── Default connection (used for startup health check only) ───────────────────
export const connectDB = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.warn("⚠️  MONGO_URI not set — server will connect per-request");
    return;
  }
  try {
    await getDB(uri);
    console.log("✅ Default DB connected");
  } catch (err) {
    console.error("❌ Default DB connection failed:", err.message);
  }
};

export default connectDB;
