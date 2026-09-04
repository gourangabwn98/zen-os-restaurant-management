// // controllers/authController.js
// import jwt      from "jsonwebtoken";
// import bcrypt   from "bcryptjs";
// import admin    from "firebase-admin";
// import { getDB }     from "../config/db.js";
// import { getModels } from "../config/getModels.js";

// // ── Firebase Admin init ───────────────────────────────────────────────────────
// if (!admin.apps.length) {
//   admin.initializeApp({
//     credential: admin.credential.cert({
//       projectId:   process.env.FIREBASE_PROJECT_ID,
//       clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
//       privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
//     }),
//   });
// }

// // ── Token generator — embeds mongoUri so every request knows which DB to use ──
// const generateToken = (id, mongoUri) =>
//   jwt.sign({ id, mongoUri }, process.env.JWT_SECRET, { expiresIn: "30d" });

// // ── POST /api/auth/firebase-verify ────────────────────────────────────────────
// // Used by both customer app (QR) and admin panel (Firebase phone login)
// export const firebaseVerify = async (req, res) => {
//   try {
//     const { firebaseToken, name, mongoUri: clientUri } = req.body;
//     if (!firebaseToken)
//       return res.status(400).json({ message: "Token required" });

//     // Verify Firebase token
//     const decoded = await admin.auth().verifyIdToken(firebaseToken);
//     const phone   = decoded.phone_number?.replace("+91", "");
//     if (!phone)
//       return res.status(400).json({ message: "Phone not found in token" });

//     // ── Determine which DB to connect to ─────────────────────────────────────
//     // Admin login: client sends the mongoUri from their env
//     // Customer login: use default MONGO_URI (or header)
//     const mongoUri = clientUri || process.env.MONGO_URI;
//     if (!mongoUri)
//       return res.status(400).json({ message: "Restaurant database URI required" });

//     const conn    = await getDB(mongoUri);
//     const { User }= getModels(conn);

//     const isAdminLogin = name === "Admin";

//     if (isAdminLogin) {
//       // Admin panel gate — user must exist and have isAdmin: true
//       const user = await User.findOne({ phone });
//       if (!user || !user.isAdmin)
//         return res.status(403).json({ message: "Not authorized to access admin panel" });

//       user.isVerified = true;
//       await user.save();

//       return res.json({
//         _id:     user._id,
//         name:    user.name,
//         phone:   user.phone,
//         isAdmin: user.isAdmin,
//         token:   generateToken(user._id, mongoUri),
//         mongoUri,
//       });
//     }

//     // ── Regular customer login ────────────────────────────────────────────────
//     let user = await User.findOne({ phone });
//     if (!user) user = new User({ phone });
//     user.isVerified = true;
//     if (name) user.name = name;
//     await user.save();

//     res.json({
//       _id:     user._id,
//       name:    user.name,
//       phone:   user.phone,
//       token:   generateToken(user._id, mongoUri),
//       mongoUri,
//     });
//   } catch (err) {
//     console.error("Firebase Verify Error:", err.message);
//     res.status(401).json({ message: "Invalid or expired Firebase token" });
//   }
// };

// // ── POST /api/auth/admin-login — email+password login for DAB-provisioned admins
// export const adminLogin = async (req, res) => {
//   try {
//     const { email, password, mongoUri: clientUri } = req.body;
//     if (!email || !password)
//       return res.status(400).json({ message: "Email and password required" });

//     const mongoUri = clientUri || process.env.MONGO_URI;
//     if (!mongoUri)
//       return res.status(400).json({ message: "Restaurant DB URI required" });

//     const conn    = await getDB(mongoUri);
//     const { User }= getModels(conn);

//     const user = await User.findOne({ email }).select("+password");
//     if (!user || !user.isAdmin)
//       return res.status(403).json({ message: "Not authorized as admin" });

//     const match = await bcrypt.compare(password, user.password);
//     if (!match)
//       return res.status(401).json({ message: "Invalid credentials" });

//     res.json({
//       _id:     user._id,
//       name:    user.name,
//       email:   user.email,
//       isAdmin: user.isAdmin,
//       token:   generateToken(user._id, mongoUri),
//       mongoUri,
//     });
//   } catch (err) {
//     console.error("Admin Login Error:", err.message);
//     res.status(500).json({ message: "Server error" });
//   }
// };

// // ── POST /api/auth/waiter-login — waiter login (phone+password) ───────────────
// export const waiterLogin = async (req, res) => {
//   try {
//     const { phone, password, mongoUri: clientUri } = req.body;
//     if (!phone || !password)
//       return res.status(400).json({ message: "Phone and password required" });

//     const mongoUri = clientUri || process.env.MONGO_URI;
//     const conn     = await getDB(mongoUri);
//     const { User } = getModels(conn);

//     const user = await User.findOne({ phone }).select("+password");
//     if (!user || user.role !== "waiter")
//       return res.status(403).json({ message: "Not authorized as waiter" });

//     const match = await bcrypt.compare(password, user.password);
//     if (!match)
//       return res.status(401).json({ message: "Invalid credentials" });

//     res.json({
//       _id:        user._id,
//       name:       user.name,
//       waiterName: user.waiterName || user.name,
//       phone:      user.phone,
//       role:       user.role,
//       token:      generateToken(user._id, mongoUri),
//       mongoUri,
//     });
//   } catch (err) {
//     console.error("Waiter Login Error:", err.message);
//     res.status(500).json({ message: "Server error" });
//   }
// };

// // ── POST /api/auth/check-admin-phone ─────────────────────────────────────────
// export const checkAdminPhone = async (req, res) => {
//   try {
//     const { phone, mongoUri: clientUri } = req.body;
//     if (!phone) return res.status(400).json({ message: "Phone required" });

//     const mongoUri = clientUri || process.env.MONGO_URI;
//     const conn     = await getDB(mongoUri);
//     const { User } = getModels(conn);

//     const user = await User.findOne({ phone, isAdmin: true });
//     if (!user)
//       return res.status(403).json({ message: "Not authorized as admin" });

//     res.json({ isAdmin: true });
//   } catch (err) {
//     res.status(500).json({ message: "Server error" });
//   }
// };

// // ── GET /api/auth/profile ─────────────────────────────────────────────────────
// export const getProfile = async (req, res) => {
//   try {
//     const user = await req.models.User.findById(req.user._id).select("-otp -otpExpiry -password");
//     if (!user) return res.status(404).json({ message: "User not found" });
//     res.json(user);
//   } catch (err) {
//     res.status(500).json({ message: "Server error" });
//   }
// };

// // ── PUT /api/auth/profile ─────────────────────────────────────────────────────
// export const updateProfile = async (req, res) => {
//   try {
//     const user = await req.models.User.findById(req.user._id);
//     if (!user) return res.status(404).json({ message: "User not found" });
//     user.name     = req.body.name     || user.name;
//     user.vegMode  = req.body.vegMode  ?? user.vegMode;
//     user.language = req.body.language || user.language;
//     const updated = await user.save();
//     res.json({ _id: updated._id, name: updated.name, phone: updated.phone, vegMode: updated.vegMode, language: updated.language });
//   } catch (err) {
//     res.status(500).json({ message: "Server error" });
//   }
// };

// // ── PATCH /api/auth/veg-mode ──────────────────────────────────────────────────
// export const updateVegMode = async (req, res) => {
//   try {
//     const { vegMode } = req.body;
//     if (typeof vegMode !== "boolean")
//       return res.status(400).json({ message: "vegMode must be boolean" });
//     const user = await req.models.User.findByIdAndUpdate(
//       req.user._id, { vegMode }, { new: true }
//     );
//     res.json({ message: "Veg mode updated", vegMode: user.vegMode });
//   } catch (err) {
//     res.status(500).json({ message: "Server error" });
//   }
// };

// // ── PATCH /api/auth/language ──────────────────────────────────────────────────
// export const updateLanguage = async (req, res) => {
//   try {
//     const { language } = req.body;
//     const user = await req.models.User.findByIdAndUpdate(
//       req.user._id, { language }, { new: true }
//     );
//     res.json({ message: "Language updated", language: user.language });
//   } catch (err) {
//     res.status(500).json({ message: "Server error" });
//   }
// };
// controllers/authController.js
import jwt      from "jsonwebtoken";
import bcrypt   from "bcryptjs";
import admin    from "firebase-admin";
import sendOTP, { isConsoleProvider } from "../utils/sendOTP.js";
import { getDB }     from "../config/db.js";
import { getModels } from "../config/getModels.js";
const waiterCache = new Map();
// ── Firebase Admin init ───────────────────────────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Single-restaurant mode: the JWT identifies the user only. The server always
// connects to its own process.env.MONGO_URI — no per-token DB resolution.
const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });

const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// ── Restaurant DB resolution — SINGLE-RESTAURANT MODE ─────────────────────────
// This app now always uses process.env.MONGO_URI as the one and only
// database. Previously this looked up a per-phone mongoUri via the external
// DAB service (DAB_API_URL) — that's what was causing admin/waiter logins to
// land in a different database than the one customer orders were written to
// (and, when DAB was unreachable, silently falling back to whatever
// MONGO_URI happened to point at). Both are now removed on purpose.
const findRestaurantByPhone = async (_phone) => process.env.MONGO_URI || null;

// ────────────────────────────────────────────────────────────────────────────
// POST /api/auth/admin/send-otp
// Step 1 of admin login — sends OTP to admin phone
// ────────────────────────────────────────────────────────────────────────────
export const adminSendOTP = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Phone number required" });

    // 1 — Find which restaurant this phone belongs to
    const mongoUri = await findRestaurantByPhone(phone);
    if (!mongoUri)
      return res.status(404).json({
        message: "No restaurant found for this phone number. Contact DAB support.",
      });

    // 2 — Connect to that restaurant's DB
    const conn    = await getDB(mongoUri);
    const { User }= getModels(conn);

    // 3 — Verify user exists and is admin in THEIR DB
  const user = await User.findOne({
  $or: [{ phone }, { email: { $regex: new RegExp(`^${phone}$`, "i") } }],
  isAdmin: true,
});
if (!user)
  return res.status(403).json({
    message: "This number is not registered as an admin.",
  });

    // 4 — Generate and save OTP (expires in 5 min)
    const otp       = generateOTP();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);
    user.otp        = otp;
    user.otpExpiry  = otpExpiry;
    await user.save();

    // 5 — Send OTP
    await sendOTP(phone, otp);

    console.log(`✅ Admin OTP sent to ${phone} [${mongoUri.split("/").pop()}]`);

    res.json({
      message: "OTP sent successfully",
      phone,
      // In dev mode show OTP in response for testing
      ...(process.env.NODE_ENV === "development" && { otp }),
    });
  } catch (err) {
    console.error("adminSendOTP error:", err.message);
    res.status(500).json({ message: "Failed to send OTP" });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// POST /api/auth/admin/verify-otp
// Step 2 of admin login — verifies OTP, returns JWT with mongoUri
// ────────────────────────────────────────────────────────────────────────────
export const adminVerifyOTP = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp)
      return res.status(400).json({ message: "Phone and OTP required" });

    // 1 — Find restaurant for this phone
    const mongoUri = await findRestaurantByPhone(phone);
    if (!mongoUri)
      return res.status(404).json({ message: "Restaurant not found for this phone" });

    // 2 — Connect to their DB
    const conn    = await getDB(mongoUri);
    const { User }= getModels(conn);

    // 3 — Find admin user
    const user = await User.findOne({ phone, isAdmin: true });
    if (!user)
      return res.status(403).json({ message: "Admin not found" });
    if (user.status === "Inactive")
      return res.status(403).json({ message: "This admin account has been deactivated" });

    // 4 — Verify OTP
    if (!user.otp || user.otp !== otp)
      return res.status(400).json({ message: "Invalid OTP" });

    if (!user.otpExpiry || new Date() > user.otpExpiry)
      return res.status(400).json({ message: "OTP expired. Request a new one." });

    // 5 — Clear OTP and mark verified
    user.otp        = undefined;
    user.otpExpiry  = undefined;
    user.isVerified = true;
    await user.save();

    // 6 — Return JWT
    res.json({
      _id:      user._id,
      name:     user.name,
      phone:    user.phone,
      isAdmin:  user.isAdmin,
      role:     user.role || "admin",
      token:    generateToken(user._id),
      dbName:   mongoUri.split("/").pop(), // for display only
    });
  } catch (err) {
    console.error("adminVerifyOTP error:", err.message);
    res.status(500).json({ message: "OTP verification failed" });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// POST /api/auth/waiter/send-otp
// Step 1 of waiter login
// Body: { phone } — single-restaurant mode: the DB is always MONGO_URI, the
// client is never asked for (and should never see) a raw connection string.
// ────────────────────────────────────────────────────────────────────────────
export const waiterSendOTP = async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ message: "Phone required" });
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) return res.status(500).json({ message: "Server not configured" });

  try {
    // Connect to that restaurant's DB
    // const db     = await getConnection(mongoUri);
    const db = await getDB(mongoUri);
    const models = getModels(db);
    const { User } = models;

    // Find this phone in users — must be staff and not deactivated
    const staffUser = await User.findOne({
      phone,
      status: { $ne: "Inactive" },
      $or: [
        { role: { $in: ["waiter","chef","admin","manager"] } },
        { isAdmin: true },
      ],
    });

    if (!staffUser)
      return res.status(403).json({ message: "Phone not registered in this restaurant, or account is deactivated." });

    // Send OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    waiterCache.set(phone, { otp, mongoUri, expires: Date.now() + 5 * 60 * 1000,
      staffName: staffUser.name });
    await sendOTP(phone, otp);

    res.json({
      message: "OTP sent",
      staffName: staffUser.name,
      // Only present when no real SMS provider is configured (nothing was
      // actually texted anywhere) — lets you test the employee login flow
      // end-to-end without Twilio/MSG91 set up yet.
      ...(isConsoleProvider() && { otp }),
    });
  } catch (err) {
    console.error("waiterSendOTP:", err.message);
    res.status(500).json({ message: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// POST /api/auth/waiter/verify-otp
// Step 2 of waiter login
// ────────────────────────────────────────────────────────────────────────────
export const waiterVerifyOTP = async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ message: "Phone and OTP required" });

  const cached = waiterCache.get(phone);
  if (!cached)            return res.status(400).json({ message: "OTP expired. Please resend." });
  if (Date.now() > cached.expires) { waiterCache.delete(phone); return res.status(400).json({ message: "OTP expired." }); }
  if (cached.otp !== otp) return res.status(401).json({ message: "Wrong OTP." });

  try {
    const { mongoUri, staffName, restaurantName } = cached;
    waiterCache.delete(phone);

    const db     = await getDB(mongoUri);       // ← was calling undefined getConnection()
    const models = getModels(db);
    const { User } = models;

    const staffUser = await User.findOne({
      phone,
      role: { $in: ["waiter","chef","admin","manager"] },
    });

    if (!staffUser)
      return res.status(403).json({ message: "Staff not found." });

    if (staffUser.status === "Inactive")
      return res.status(403).json({ message: "This staff account has been deactivated." });

    const token = jwt.sign(
      { id: staffUser._id, role: staffUser.role, restaurantName },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      restaurantName,
      name:  staffUser.name,
      phone: staffUser.phone,
      role:  staffUser.role,
    });
  } catch (err) {
    console.error("waiterVerifyOTP:", err.message);
    res.status(500).json({ message: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// POST /api/auth/firebase-verify  (customer QR login — unchanged)
// ────────────────────────────────────────────────────────────────────────────
export const firebaseVerify = async (req, res) => {
  try {
    const { firebaseToken, name } = req.body;
    if (!firebaseToken)
      return res.status(400).json({ message: "Token required" });

    const decoded = await admin.auth().verifyIdToken(firebaseToken);
    const phone   = decoded.phone_number?.replace("+91", "");
    if (!phone)
      return res.status(400).json({ message: "Phone not found in token" });

    // Customer always uses default MONGO_URI
    // (customers log in to whichever restaurant app they're using)
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri)
      return res.status(500).json({ message: "Server not configured" });

    const conn    = await getDB(mongoUri);
    const { User }= getModels(conn);

    let user = await User.findOne({ phone });
    if (!user) user = new User({ phone });
    user.isVerified = true;
    if (name) user.name = name;
    await user.save();

    res.json({
      _id:   user._id,
      name:  user.name,
      phone: user.phone,
      token: generateToken(user._id),
    });
  } catch (err) {
    console.error("Firebase Verify Error:", err.message);
    res.status(401).json({ message: "Invalid or expired Firebase token" });
  }
};

// ── Profile routes (unchanged) ────────────────────────────────────────────────
export const getProfile = async (req, res) => {
  try {
    const user = await req.models.User
      .findById(req.user._id).select("-otp -otpExpiry -password");
    if (!user) return res.status(404).json({ message: "Not found" });
    res.json(user);
  } catch (err) { res.status(500).json({ message: "Server error" }); }
};

export const updateProfile = async (req, res) => {
  try {
    const user = await req.models.User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "Not found" });
    user.name     = req.body.name     || user.name;
    user.vegMode  = req.body.vegMode  ?? user.vegMode;
    user.language = req.body.language || user.language;
    await user.save();
    res.json({ _id: user._id, name: user.name, phone: user.phone });
  } catch (err) { res.status(500).json({ message: "Server error" }); }
};

export const updateVegMode = async (req, res) => {
  try {
    const { vegMode } = req.body;
    if (typeof vegMode !== "boolean")
      return res.status(400).json({ message: "vegMode must be boolean" });
    const user = await req.models.User
      .findByIdAndUpdate(req.user._id, { vegMode }, { new: true });
    res.json({ vegMode: user.vegMode });
  } catch (err) { res.status(500).json({ message: "Server error" }); }
};

export const updateLanguage = async (req, res) => {
  try {
    const { language } = req.body;
    const user = await req.models.User
      .findByIdAndUpdate(req.user._id, { language }, { new: true });
    res.json({ language: user.language });
  } catch (err) { res.status(500).json({ message: "Server error" }); }
};
// ── (removed) DAB slug lookup — unused, single-restaurant mode now uses
// process.env.MONGO_URI everywhere. Kept as a no-op stub only in case
// something still imports the name; it is not called anywhere.
const getMongoUriBySlug = async (_slug) => process.env.MONGO_URI || null;
// POST /api/auth/admin/firebase-login
// Firebase already verified the OTP — we just issue our JWT
// POST /api/auth/admin/firebase-login
// export const firebaseLogin = async (req, res) => {
//   try {
//     const { User } = req.models;
//     const { phone } = req.body;

//     const user = await User.findOne({
//       phone,
//       $or: [
//         { role: { $in: ["admin","manager","owner"] } },
//         { status: "Active" },
//       ],
//     });

//     if (!user)
//       return res.status(403).json({ message: "Phone not registered as admin" });

//     const token = jwt.sign(
//       { id: user._id, role: user.role },
//       process.env.JWT_SECRET,
//       { expiresIn: "7d" }
//     );

//     res.json({ token, name: user.name, phone: user.phone, role: user.role });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };
// export const firebaseLogin = async (req, res) => {
//   try {
//     const { phone } = req.body;
//     if (!phone) return res.status(400).json({ message: "Phone required" });

//     // Connect directly to master DB to find the restaurant by slug
//     const Restaurant = mongoose.model("Restaurant");  // from DAB master DB
//     // OR if you store users in a known DB, use getConnection directly:

//     // Find user across the restaurant DB
//     // Use the mongoUri from env or from the request
//     const mongoUri = process.env.MONGO_URI; // your restaurant's own DB
//     const db     = await getConnection(mongoUri);
//     const models = getModels(db);
//     const { User } = models;

//     const user = await User.findOne({
//       phone,
//       $or: [
//         { role: { $in: ["admin","manager","owner"] } },
//         { status: "Active" },
//       ],
//     });

//     if (!user)
//       return res.status(403).json({ message: "Phone not registered as admin" });

//     const token = jwt.sign(
//       { id: user._id, role: user.role, mongoUri },
//       process.env.JWT_SECRET,
//       { expiresIn: "7d" }
//     );

//     res.json({ token, name: user.name, phone: user.phone, role: user.role });
//   } catch (err) {
//     console.error("firebaseLogin error:", err.message);
//     res.status(500).json({ message: err.message });
//   }
// };
// FIND and REPLACE the entire firebaseLogin function:

export const firebaseLogin = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Phone required" });

    // Use findRestaurantByPhone — already defined in this file
    const mongoUri = await findRestaurantByPhone(phone);
    if (!mongoUri)
      return res.status(404).json({ message: "Restaurant not found for this phone" });

    // Use getDB — already imported in this file
    const conn    = await getDB(mongoUri);
    const { User } = getModels(conn);

    const user = await User.findOne({
      phone,
      $or: [
        { isAdmin: true },
        { role: { $in: ["admin","manager","owner"] } },
      ],
    });

    if (!user)
      return res.status(403).json({ message: "Phone not registered as admin" });

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      name:    user.name,
      phone:   user.phone,
      role:    user.role || "admin",
      isAdmin: user.isAdmin,
    });
  } catch (err) {
    console.error("firebaseLogin error:", err.message);
    res.status(500).json({ message: err.message });
  }
};