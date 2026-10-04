// src/brand.js — GLB-01 / GLB-02. The one place the Kitchen app's branding
// lives (each app is built separately; same assets under public/brand/khoai-v2/).
const asset = (f) => `/brand/khoai-v2/${f}`;

export const BRAND = {
  name: "Hotel KHOAI",
  app: "Kitchen",
  mark: asset("hk-mark-192.png"),
  wordmark: asset("khoai-wordmark.png"),
};
