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
// GLB-02 — bump on every branding change. A changed worker file is what makes
// browsers install the new version; on activate it deletes every Cache
// Storage entry this origin holds (none are used for the app shell, but an
// older build or a browser extension may have left some) and takes control
// at once, so no old Eddie's/AD's/Zen OS asset can be served from a cache.
const SW_VERSION = "hotel-khoai-2026-10-04";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
void SW_VERSION;

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
// handled instead by onForegroundMessage in src/services/notificationService.js).
//
// Offers arrive as DATA-ONLY messages (restaurant-server/services/
// notificationService.js → sendOfferBroadcast), so this worker is the one
// place the OS notification is built: icon, coupon line, and what a tap opens.
// A message that still carries a `notification` block (sent by an older
// server build) is shown by the Firebase SDK itself — showing it here too
// would produce a duplicate, so it's skipped.
messaging.onBackgroundMessage((payload) => {
  if (payload.notification) return;
  const d = payload.data || {};
  const title = d.title || "New offer";
  const lines = [d.body || ""];
  if (d.couponCode) lines.push(`Use code: ${d.couponCode}`);
  if (d.expiresAt) {
    const exp = new Date(d.expiresAt);
    // A push delayed past the offer's end (phone was off) isn't worth showing.
    if (exp.getTime() <= Date.now()) return;
    lines.push(`Valid till ${exp.toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`);
  }
  const body = lines.join("\n");
  return self.registration.showNotification(title, {
    body,
    icon: d.icon || "/brand/khoai-v2/icon-192.png",
    badge: "/brand/khoai-v2/hk-badge-96.png",
    tag: d.id ? `offer-${d.id}` : undefined, // a re-delivered push replaces, never duplicates
    data: { url: d.url || "/notifications" },
  });
});

// Tapping the notification: focus an open app window (and route it to the
// notification history), or open the app there if it isn't running.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/notifications", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      if ("navigate" in existing) return existing.navigate(target).catch(() => {});
      return;
    }
    return clients.openWindow(target);
  })());
});
