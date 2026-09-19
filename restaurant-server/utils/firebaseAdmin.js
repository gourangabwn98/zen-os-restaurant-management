// utils/firebaseAdmin.js
// ─────────────────────────────────────────────────────────────────────────────
// Single shared Firebase Admin SDK instance for the whole backend. Started
// out inlined in controllers/authController.js (phone-OTP token
// verification only); the same service-account credential also sends
// Cloud Messaging push notifications (services/notificationService.js), so
// the init moved here to guarantee it only ever runs once regardless of
// which module imports it first.
// ─────────────────────────────────────────────────────────────────────────────
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export default admin;
