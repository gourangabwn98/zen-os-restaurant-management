// public/firebase-messaging-sw.js
// ─────────────────────────────────────────────────────────────────────────────
// Handles push notifications while the customer app's tab/PWA is in the
// background or fully closed — this is a plain static script served
// verbatim by Vite from public/, NOT processed at build time, so it can't
// read import.meta.env like the rest of the app does. The values below are
// Firebase's public web-config identifiers (not secrets — see Firebase's
// own docs), duplicated from customer/.env's VITE_FIREBASE_* values.
//
// IMPORTANT: if the Firebase project ever changes, update BOTH this file
// and customer/.env — they must always match.
// ─────────────────────────────────────────────────────────────────────────────
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            "AIzaSyD3H-ipeKV_otklwHZ1tHHymCJ93IksvGE",
  authDomain:        "adda-cafe-dd9a3.firebaseapp.com",
  projectId:         "adda-cafe-dd9a3",
  appId:             "1:935219120157:web:a0a8a999e1be94bffedef4",
  messagingSenderId: "935219120157",
});

const messaging = firebase.messaging();

// Fires only when the app isn't in the foreground (foreground messages are
// handled instead by onForegroundMessage in src/services/notificationService.js,
// via the Firebase SDK's own foreground/background routing).
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  // No app icon asset exists yet (customer/public has none) — omitting
  // `icon` lets the browser fall back to its own default rather than
  // pointing at a 404. Add one here once a real icon file exists.
  self.registration.showNotification(title || "New offer", { body: body || "" });
});
