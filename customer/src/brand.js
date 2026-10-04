// src/brand.js — GLB-01 / GLB-02 / CUS-01
// ─────────────────────────────────────────────────────────────────────────────
// The ONE place the customer app's branding lives. Components import from
// here; nothing else hard-codes a name or a logo path.
//
// Assets sit under a versioned folder (public/brand/khoai-v2/) so a phone can
// never keep showing an old cached icon at the same URL — a new brand is a new
// folder (bump BRAND_ASSET_VERSION + manifest + firebase-messaging-sw.js).
// The restaurant's own profile (Admin → Profile) still wins for the name once
// it has loaded; these values are what shows before that (first paint,
// loading, offline) — so they must always be this restaurant's.
// ─────────────────────────────────────────────────────────────────────────────
export const BRAND_ASSET_VERSION = "khoai-v2";
const asset = (f) => `/brand/${BRAND_ASSET_VERSION}/${f}`;

export const BRAND = {
  name: "Hotel KHOAI",
  nameBn: "হোটেল খোয়াই",
  tagline: "Order from your table",
  mark: asset("hk-mark-192.png"),        // round HK monogram, transparent
  markLarge: asset("hk-mark-512.png"),
  wordmark: asset("khoai-wordmark.png"), // gold hand-lettered খোয়াই
  appIcon: asset("icon-192.png"),         // opaque square (install card)
};

/** Name to show: the profile's when it is set, else the brand's. */
export const displayName = (profile) => (profile?.restaurantName || "").trim() || BRAND.name;
