// src/local/localAuth.js — Offline Edition (restaurant PC) staff sign-in.
// ─────────────────────────────────────────────────────────────────────────────
// Only active when this app was served by the restaurant PC: its generated
// /config.js sets window.__ZEN_CONFIG__.localServer = true
// (restaurant-server/local/staticApps.js). In the cloud LOCAL_SERVER is false
// and nothing here is ever called — the normal OTP/Firebase login is used.
//
// This browser's device credentials (deviceId + deviceSecret) are kept in
// localStorage. They are NOT the staff login: an admin approves the device
// once, then each person signs in on it with phone + PIN. Signing out keeps
// the device registered. Same file in admin/, waiter/ and kitchen/.
// Server side: restaurant-server/routes/localAuthRoutes.js.
// ─────────────────────────────────────────────────────────────────────────────
import api from "../services/api.js";

const runtime = (typeof window !== "undefined" && window.__ZEN_CONFIG__) || {};
export const LOCAL_SERVER = runtime.localServer === true;

const KEY = "zenLocalDevice";
const HEX32 = /^[0-9a-f]{32}$/, HEX64 = /^[0-9a-f]{64}$/;

export const loadDevice = () => {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    return d && HEX32.test(d.deviceId) && HEX64.test(d.deviceSecret) ? d : null;
  } catch { return null; }
};
export const saveDevice = (d) => {
  try { localStorage.setItem(KEY, JSON.stringify({ deviceId: d.deviceId, deviceSecret: d.deviceSecret, label: d.label || "" })); } catch { /* storage off */ }
};
export const forgetDevice = () => { try { localStorage.removeItem(KEY); } catch { /* storage off */ } };

const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const creds = (d) => ({ deviceId: d.deviceId, deviceSecret: d.deviceSecret });

export const registerDevice = (label) =>
  api.post("/local/devices/register", { label, platform: String(navigator.userAgent || "").slice(0, 200) });
export const getDeviceStatus = (d) => api.post("/local/devices/status", creds(d));
export const pinLogin = (d, phone, pin) => api.post("/local/auth/login", { phone, pin, ...creds(d) });
export const changeOwnPin = (token, currentPin, newPin) => api.post("/local/auth/change-pin", { currentPin, newPin }, bearer(token));

/**
 * Best-effort server sign-out of this PIN session. Pass the token BEFORE it
 * is removed from storage; never throws, never blocks the local sign-out.
 */
export const localLogout = (token) => {
  if (!LOCAL_SERVER || !token) return;
  api.post("/local/auth/logout", null, bearer(token)).catch(() => {});
};
