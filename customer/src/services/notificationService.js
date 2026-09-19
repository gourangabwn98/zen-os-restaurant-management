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

/** Foreground handler — background messages are shown by the service
 * worker instead (see onBackgroundMessage in public/firebase-messaging-sw.js). */
export const onForegroundMessage = async (cb) => {
  const messaging = await getMessagingIfSupported();
  if (!messaging) return () => {};
  return onMessage(messaging, (payload) => cb(payload.notification || {}));
};
