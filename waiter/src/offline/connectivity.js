// src/offline/connectivity.js
// ─────────────────────────────────────────────────────────────────────────────
// One shared answer to "can we reach the backend right now?" for the banner.
// navigator.onLine alone is not enough (Wi-Fi up but no internet, or the
// server is down), so the state also follows real request results
// (savedData.js reports them) and, while not online, probes /api/health.
//   "online"      — the last request reached the server
//   "offline"     — the device itself reports no network
//   "unreachable" — the device has a network but the server can't be reached
// ─────────────────────────────────────────────────────────────────────────────
import { API_URL } from "../config/runtimeConfig.js";

const PROBE_MS = 10_000;
const PROBE_TIMEOUT_MS = 5_000;

let state = {
  status: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online",
  savedAt: null,        // oldest saved-data time shown during this outage (ms), or null
  usedSavedData: false, // any screen fell back to saved data since the last full load
};
const listeners = new Set();
let probeTimer = null;

const set = (patch) => {
  const next = { ...state, ...patch };
  if (next.status === state.status && next.savedAt === state.savedAt && next.usedSavedData === state.usedSavedData) return;
  state = next;
  listeners.forEach((fn) => fn(state));
  if (state.status === "online") stopProbe(); else startProbe();
};

export const getConnectivity = () => state;
export const subscribeConnectivity = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** A request got an HTTP response (any status) — the server is reachable. */
export const reportServerReached = () => { if (state.status !== "online") set({ status: "online", savedAt: null }); };

/** A request got no answer from the backend (network failure or a proxy's 502/503/504). */
export const reportNetworkFailure = () => set({ status: navigator.onLine === false ? "offline" : "unreachable" });

/** A screen is showing data saved at `savedAt` instead of live data. */
export const reportSavedDataShown = (savedAt) =>
  set({ usedSavedData: true, savedAt: state.savedAt == null ? savedAt : Math.min(state.savedAt, savedAt) });

// Any status below 500 means the backend itself answered. A 5xx here is
// usually a proxy in front of it reporting it down, so it doesn't count.
const probe = async () => {
  if (navigator.onLine === false) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/health`, { cache: "no-store", signal: ctrl.signal });
    if (res.status < 500) reportServerReached();
  } catch { /* still unreachable — try again on the next tick */ }
  finally { clearTimeout(timer); }
};
function startProbe() { if (!probeTimer) probeTimer = setInterval(probe, PROBE_MS); }
function stopProbe() { clearInterval(probeTimer); probeTimer = null; }

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => set({ status: "offline" }));
  window.addEventListener("online", () => { if (state.status === "offline") set({ status: "unreachable" }); probe(); });
  if (state.status !== "online") startProbe();
}
