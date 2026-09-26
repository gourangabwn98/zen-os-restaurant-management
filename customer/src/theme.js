// src/theme.js — colours, radii and shadows live as CSS custom properties in
// index.css (the "Warm Crisp" design system); this file only keeps the
// localStorage keys the hooks/services share, plus the light/dark switch.

export const STORAGE = {
  cartOrderType: "sohoj_orderType",
  customerToken: "customerToken",
  customerUser:  "customerUser",
  tableCtx:      "sohoj_table_ctx", // { tableNo, tableToken, label }
  favorites:     "sohoj_favorites_v1",
  // "1" once the customer has opted into offer push notifications — lets
  // App.jsx silently refresh a rotated FCM token on future visits without
  // asking them to retoggle it (see services/notificationService.js).
  pushOptIn:     "sohoj_push_opt_in",
  // "light" | "dark" — read before first paint by the inline script in index.html.
  theme:         "sohoj_theme",
};

export const getTheme = () => {
  try { return localStorage.getItem(STORAGE.theme) === "dark" ? "dark" : "light"; }
  catch { return "light"; }
};

export const setTheme = (t) => {
  try { localStorage.setItem(STORAGE.theme, t); } catch { /* private mode — theme just won't persist */ }
  if (t === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
};
