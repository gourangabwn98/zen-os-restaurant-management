// src/brand.js — GLB-01 / GLB-02. The one place the Waiter app's branding
// lives (each app is built separately, so each has its own copy of this
// small file + public/brand/khoai-v2/ — same assets as the other apps).
// The restaurant name from the server (login response) still wins once known.
const asset = (f) => `/brand/khoai-v2/${f}`;

export const BRAND = {
  name: "Hotel KHOAI",
  app: "Waiter",
  mark: asset("hk-mark-192.png"),
  wordmark: asset("khoai-wordmark.png"),
};
