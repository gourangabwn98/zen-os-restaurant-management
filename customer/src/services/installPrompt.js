// services/installPrompt.js
// ─────────────────────────────────────────────────────────────────────────────
// "Install the app" — the browser's REAL install flow only.
//   Chrome / Edge / Samsung (Android, desktop): the `beforeinstallprompt`
//   event, captured here at startup (it can fire before React mounts) and
//   replayed by components/InstallPrompt.jsx when the customer taps Install.
//   iPhone / iPad Safari: no such event exists — installing is Share →
//   "Add to Home Screen", so we only show that hint.
// Nothing is shown when the browser offers no install (already installed,
// unsupported browser, in-app browsers…): never a button that does nothing.
// ─────────────────────────────────────────────────────────────────────────────
const DISMISS_KEY = "sohoj_install_dismissed";
const QR_KEY = "sohoj_qr_entry";

let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export const initInstallPrompt = () => {
  // Arrived from a table / takeaway QR code (useTableSession reads the same params).
  try {
    const q = new URLSearchParams(window.location.search);
    if ((q.get("table") && q.get("t")) || q.get("mode") === "takeaway") sessionStorage.setItem(QR_KEY, "1");
  } catch { /* storage off */ }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own, dismissible card instead of the mini-infobar
    deferred = e;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    try { localStorage.setItem(DISMISS_KEY, "installed"); } catch { /* storage off */ }
    notify();
  });
};

export const subscribeInstall = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);

const flag = (store, key) => { try { return store.getItem(key); } catch { return null; } };

/** What can be offered right now: "prompt" (real install), "ios" (Add to
 * Home Screen hint) or null. Only on a first QR visit, never after dismiss. */
export const installOffer = () => {
  if (isStandalone() || flag(localStorage, DISMISS_KEY) || !flag(sessionStorage, QR_KEY)) return null;
  if (deferred) return "prompt";
  if (isIos()) return "ios";
  return null;
};

/** Opens the browser's own install dialog. → "accepted" | "dismissed" | null */
export const runInstall = async () => {
  if (!deferred) return null;
  const e = deferred;
  deferred = null;
  e.prompt();
  const { outcome } = await e.userChoice;
  try { localStorage.setItem(DISMISS_KEY, outcome); } catch { /* storage off */ }
  notify();
  return outcome;
};

export const dismissInstall = () => {
  try { localStorage.setItem(DISMISS_KEY, "dismissed"); } catch { /* storage off */ }
  notify();
};
