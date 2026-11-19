// src/config/runtimeConfig.js
// ─────────────────────────────────────────────────────────────────────────────
// Where the backend lives — resolved once at page load, in this order:
//   1. window.__ZEN_CONFIG__.apiUrl — set in /config.js (public/config.js).
//      That file is NOT bundled, so a deployment (cloud, or later a local
//      restaurant server) can point the app elsewhere without a rebuild.
//   2. VITE_API_URL — the build-time value (.env), as before.
//   3. "/api" — same origin as the page.
//
// Every API call and the Socket.IO connection must use these exports — never
// read import.meta.env.VITE_API_URL anywhere else, or that call ignores
// config.js.
// ─────────────────────────────────────────────────────────────────────────────

const runtime = (typeof window !== "undefined" && window.__ZEN_CONFIG__) || {};

/** REST base, no trailing slash. Absolute ("https://host/api") or relative ("/api"). */
export const API_URL = String(runtime.apiUrl || import.meta.env.VITE_API_URL || "/api").trim().replace(/\/+$/, "");

const isAbsolute = /^https?:\/\//i.test(API_URL);

// Socket.IO listens at the server root, not under /api.
const serverRoot = API_URL.replace(/\/api$/i, "");

/**
 * First argument for io(). Absolute API → that server's root.
 * Relative API → undefined, which makes socket.io-client use the page's own
 * origin. NOT "" — socket.io-client turns "" into "https://:443" (empty host)
 * and never connects (checked against socket.io-client 4.8.3 url.js).
 */
export const SOCKET_URL = isAbsolute ? serverRoot : undefined;

/**
 * Socket.IO path. Default for an absolute URL; for a relative API under a
 * sub-path ("/zen/api") the socket lives at "/zen/socket.io" on the same origin.
 */
export const SOCKET_PATH = isAbsolute ? undefined : `${serverRoot}/socket.io`;

/** The backend's root as a full URL (for display, e.g. the print-service setup card). */
export const SERVER_ORIGIN = isAbsolute
  ? serverRoot
  : (typeof window !== "undefined" ? window.location.origin + serverRoot : serverRoot);

/**
 * Google Maps JavaScript API key for the Delivery live map — config.js
 * (`googleMapsKey`) or VITE_GOOGLE_MAPS_KEY. A BROWSER key: restrict it to
 * this site's address in Google Cloud. Empty → the map shows a schematic
 * (to-scale positions, no street tiles) and says so.
 */
export const GOOGLE_MAPS_KEY = String(runtime.googleMapsKey || import.meta.env.VITE_GOOGLE_MAPS_KEY || "").trim();
