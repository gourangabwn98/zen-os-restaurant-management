// src/offline/savedData.js
// ─────────────────────────────────────────────────────────────────────────────
// "Last data" for when the backend can't be reached. Every successful GET
// through services/api.js is kept in IndexedDB; if the same GET later gets no
// answer from the backend (offline, unreachable, or a proxy's 502/503/504),
// the saved copy is returned
// instead, marked { fromCache: true, savedAt }, and the banner says so.
//
// Read-only by design: writes (POST/PUT/PATCH/DELETE) are never queued or
// faked — they fail exactly as before, because prices, order status, stock
// and payments are decided by the server.
//
// Privacy: entries are scoped to the current login (a hash of its token, so a
// different login never sees them) and wiped on logout (clearSavedData).
// Every storage error is swallowed — saving must never break the live app.
// ─────────────────────────────────────────────────────────────────────────────
import { reportNetworkFailure, reportSavedDataShown, reportServerReached } from "./connectivity.js";

const DB_NAME = "zen-saved-data";
const STORE = "responses";
const MAX_ENTRIES = 300; // oldest are dropped beyond this

let dbPromise = null;
const openDb = () => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("savedAt", "savedAt");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => { dbPromise = null; throw e; });
  }
  return dbPromise;
};

/** Runs fn(store) in one transaction; resolves with the request's result once committed. */
const tx = async (mode, fn) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
};

const prune = () => tx("readwrite", (store) => {
  const count = store.count();
  count.onsuccess = () => {
    let extra = count.result - MAX_ENTRIES;
    if (extra <= 0) return;
    store.index("savedAt").openCursor().onsuccess = (e) => {
      const cur = e.target.result;
      if (cur && extra-- > 0) { cur.delete(); cur.continue(); }
    };
  };
});

const save = (key, data) =>
  tx("readwrite", (store) => store.put({ key, data, savedAt: Date.now() })).then(prune).catch(() => {});
const read = (key) => tx("readonly", (store) => store.get(key)).catch(() => undefined);

/** Deletes every saved response (call on logout). */
export const clearSavedData = () => tx("readwrite", (store) => store.clear()).catch(() => {});

// FNV-1a — only namespaces entries per login; not a security boundary
// (crypto.subtle is unavailable on plain-http LAN addresses).
const scopeOf = (token) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) { h ^= token.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
};

const isGet = (config) => (config?.method || "get").toLowerCase() === "get";

// Gateway errors: a proxy in front of the backend (Render today, a local
// reverse proxy later) answers these when the backend itself is down.
const GATEWAY_DOWN = [502, 503, 504];
/** No answer from the backend itself: network failure, or a proxy reporting it down. */
const backendUnreachable = (error) =>
  !!error.config && error.code !== "ERR_CANCELED" && (!error.response || GATEWAY_DOWN.includes(error.response.status));

/**
 * Adds saved-data behaviour to an axios instance. `getToken` returns the
 * current login token; nothing is saved or served without one. A request can
 * opt out with { offlineCache: false } in its config.
 */
export const withSavedData = (api, getToken) => {
  const keyFor = (config) => {
    const token = getToken();
    if (!token || config?.offlineCache === false || !isGet(config)) return null;
    return `${scopeOf(token)}|${api.getUri(config)}`;
  };
  api.interceptors.response.use(
    (res) => {
      reportServerReached();
      const key = keyFor(res.config);
      if (key) save(key, res.data);
      return res;
    },
    async (error) => {
      if (!backendUnreachable(error)) { if (error.response) reportServerReached(); throw error; }
      reportNetworkFailure();
      const key = keyFor(error.config);
      const saved = key && await read(key);
      if (!saved) throw error;
      reportSavedDataShown(saved.savedAt);
      return { data: saved.data, status: 200, statusText: "OK (saved)", headers: {}, config: error.config, request: null, fromCache: true, savedAt: saved.savedAt };
    },
  );
};
