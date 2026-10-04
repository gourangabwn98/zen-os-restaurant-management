// src/brand.js — GLB-01 / GLB-02. The ONE place the Admin/POS app's branding
// lives. Components import from here; nothing else hard-codes a name, logo
// or app title. Assets sit under a versioned folder (public/brand/khoai-v2/)
// so no browser can keep serving an old cached logo at the same URL.
//
// The restaurant profile (Admin → Profile → name / logo) still wins once it
// has loaded; these are what shows before that — first paint, loading,
// offline — so they must always be this restaurant's, never a placeholder
// name from an earlier client.
const asset = (f) => `/brand/khoai-v2/${f}`;

export const BRAND = {
  name: "Hotel KHOAI",
  nameBn: "হোটেল খোয়াই",
  app: "Admin",
  version: "v2.0",
  mark: asset("hk-mark-192.png"),
  markLarge: asset("hk-mark-512.png"),
  wordmark: asset("khoai-wordmark.png"),
};

/** Restaurant name to show: the profile's once loaded, else the brand's. */
export const displayName = (profile) => (profile?.restaurantName || "").trim() || BRAND.name;
/** Logo to show: the profile's uploaded logo once loaded, else the HK mark. */
export const displayLogo = (profile) => (profile?.logo || "").trim() || BRAND.mark;
