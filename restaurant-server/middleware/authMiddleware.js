// middleware/authMiddleware.js
// ─────────────────────────────────────────────────────────────────────────────
// SINGLE-RESTAURANT MODE. This app now always talks to exactly one database:
// process.env.MONGO_URI. No JWT-embedded mongoUri, no x-restaurant-* headers,
// no DAB/slug lookup are consulted anymore — every one of those was a
// separate path that could resolve to a DIFFERENT database, which is exactly
// what was causing admin/customer/waiter to silently read and write
// different databases. If you ever need multi-restaurant support again,
// reintroduce that logic deliberately — don't restore this by accident.
// ─────────────────────────────────────────────────────────────────────────────
import jwt   from "jsonwebtoken";
import { getDB }     from "../config/db.js";
import { getModels } from "../config/getModels.js";
import { tenantKeyFromUri } from "../utils/tenantKey.js";

const getConfiguredMongoUri = () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI is not set in the backend .env — the app has no database to use");
  }
  return mongoUri;
};

const attachDb = async (req) => {
  const mongoUri = getConfiguredMongoUri();
  const conn   = await getDB(mongoUri);
  req.db       = conn;
  req.models   = getModels(conn);
  req.mongoUri = mongoUri;
  req.tenantKey = tenantKeyFromUri(mongoUri);
  return conn;
};

// ── protect — JWT required, but the DB is always MONGO_URI ───────────────────
export const protect = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer "))
    return res.status(401).json({ message: "Not authorized, no token" });

  try {
    const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
    await attachDb(req);
    req.user = await req.models.User
      .findById(decoded.id).select("-otp -otpExpiry -password");
    if (!req.user) return res.status(401).json({ message: "User not found" });
    if (req.user.status === "Inactive")
      return res.status(403).json({ message: "This account has been deactivated" });
    next();
  } catch (e) {
    res.status(401).json({ message: "Not authorized, invalid token" });
  }
};

// ── optionalProtect — JWT optional; DB is always MONGO_URI either way ────────
export const optionalProtect = async (req, res, next) => {
  try {
    await attachDb(req);
  } catch (e) {
    console.error("optionalProtect DB error:", e.message);
    req.user   = null;
    req.models = null;
    return next();
  }

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
    req.user = await req.models.User
      .findById(decoded.id).select("-otp -otpExpiry -password");
    if (req.user?.status === "Inactive") req.user = null;
  } catch {
    req.user = null;
  }
  next();
};

// ── dbFromHeader — public routes; DB is always MONGO_URI ─────────────────────
export const dbFromHeader = async (req, res, next) => {
  try {
    await attachDb(req);
    next();
  } catch (err) {
    res.status(503).json({ message: "Cannot connect to restaurant database" });
  }
};