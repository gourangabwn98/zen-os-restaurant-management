// src/services/notificationService.js
// Opt-in offer push notifications, built on Firebase Cloud Messaging.
// Delivery while the app is closed relies on the service worker at
// public/firebase-messaging-sw.js — this file only handles the foreground
// (app open) path plus the subscribe/unsubscribe handshake with the backend.
import { getToken, deleteToken, onMessage } from "firebase/messaging";
import { getMessagingIfSupported } from "../firebase.js";
import { STORAGE } from "../theme.js";
import api from "./api.js";

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

const postToken = (path, token) => api.post(`/notifications/${path}`, { token });

/** Registers the service worker, asks the browser for notification
 * permission, and gets an FCM token for this device — POSTing it to the
 * backend so it's subscribed to the "offers" topic. Returns false (and
 * leaves everything untouched) if the browser doesn't support push, or the
 * customer declines the permission prompt. */
export const enablePushNotifications = async () => {
  const messaging = await getMessagingIfSupported();
  if (!messaging || !("serviceWorker" in navigator) || !VAPID_KEY) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) return false;

  await postToken("subscribe", token);
  localStorage.setItem(STORAGE.pushOptIn, "1");
  return true;
};

/** Deletes this device's token and tells the backend to unsubscribe it. */
export const disablePushNotifications = async () => {
  localStorage.removeItem(STORAGE.pushOptIn);
  const messaging = await getMessagingIfSupported();
  if (!messaging) return;

  const registration = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js");
  if (!registration) return;

  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration }).catch(() => null);
  if (token) {
    await postToken("unsubscribe", token).catch(() => {});
    await deleteToken(messaging).catch(() => {});
  }
};

/** True once the customer has opted in AND the browser permission is still
 * granted — the source of truth for the toggle's on/off display. */
export const isPushEnabled = () =>
  localStorage.getItem(STORAGE.pushOptIn) === "1" &&
  typeof Notification !== "undefined" && Notification.permission === "granted";

/** iOS Safari only supports web push for a site running standalone (added
 * to the Home Screen), never a regular Safari tab — no VAPID key or config
 * fix changes this, it's an Apple platform restriction. Lets the UI show
 * the real fix instead of a generic "check your browser settings" message
 * that doesn't apply here. */
export const needsIosHomeScreenInstall = () => {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true
    || window.matchMedia("(display-mode: standalone)").matches;
  return isIos && !isStandalone;
};

/** Foreground handler — background messages are shown by the service
 * worker instead (see onBackgroundMessage in public/firebase-messaging-sw.js).
 * Offers are data-only messages ({ id, title, body, couponCode, url }); the
 * `notification` fallback covers anything sent by an older server build. */
export const onForegroundMessage = async (cb) => {
  const messaging = await getMessagingIfSupported();
  if (!messaging) return () => {};
  return onMessage(messaging, (payload) => {
    cb(payload.data || payload.notification || {});
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
  });
};

// ── Notification history (Profile → Notifications) ──────────────────────────
/** Fired when a new offer arrives in the foreground or the list is read, so
 * any unread badge on screen refreshes without a reload. */
export const NOTIFICATIONS_CHANGED = "notifications:changed";

// GET /api/notifications → { notifications: [{ _id, title, body, couponCode, createdAt }], unreadCount, seenAt }
export const getMyNotifications = () => api.get("/notifications");

// POST /api/notifications/seen — everything up to now counts as read.
export const markNotificationsSeen = () =>
  api.post("/notifications/seen").then((r) => { window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED)); return r; });
