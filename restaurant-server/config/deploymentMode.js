// config/deploymentMode.js
// ─────────────────────────────────────────────────────────────────────────────
// Offline Edition — the ONE place that decides how this server is deployed.
// Design: docs/offline-edition/02-offline-architecture.md.
//
//   CLOUD_PRIMARY (default, DEPLOYMENT_MODE unset) — today's production.
//     Nothing about it changes; every Offline Edition code path stays off.
//   LOCAL_PRIMARY (DEPLOYMENT_MODE=LOCAL or LOCAL_PRIMARY) — the restaurant
//     PC is the only writer, against a MongoDB replica set on the same PC.
//     It must keep working with no internet at all.
//
// Read the mode only through this file — never compare DEPLOYMENT_MODE
// strings anywhere else (CLAUDE.md: never hardcode a mode/status string).
// An unknown value is an error, never guessed: silently treating a typo as
// CLOUD would point a restaurant at the wrong database model.
// ─────────────────────────────────────────────────────────────────────────────

export const DEPLOYMENT_MODES = Object.freeze({
  CLOUD_PRIMARY: "CLOUD_PRIMARY",
  LOCAL_PRIMARY: "LOCAL_PRIMARY",
});

// Accepted spellings (case-insensitive). Short forms are aliases for the
// canonical value; the canonical value is what everything else reads.
const ALIASES = Object.freeze({
  CLOUD: DEPLOYMENT_MODES.CLOUD_PRIMARY,
  CLOUD_PRIMARY: DEPLOYMENT_MODES.CLOUD_PRIMARY,
  LOCAL: DEPLOYMENT_MODES.LOCAL_PRIMARY,
  LOCAL_PRIMARY: DEPLOYMENT_MODES.LOCAL_PRIMARY,
});

/** Pure: env → { valid, mode, reason }. Unset/blank → CLOUD_PRIMARY. */
export const resolveDeploymentMode = (env = process.env) => {
  const raw = typeof env.DEPLOYMENT_MODE === "string" ? env.DEPLOYMENT_MODE.trim() : "";
  if (!raw) return { valid: true, mode: DEPLOYMENT_MODES.CLOUD_PRIMARY, reason: null };
  const mode = ALIASES[raw.toUpperCase()];
  if (mode) return { valid: true, mode, reason: null };
  return {
    valid: false,
    mode: null,
    reason: `DEPLOYMENT_MODE="${raw}" is not recognised — use LOCAL (Offline Edition) or leave it unset (cloud).`,
  };
};

/** True only for a valid LOCAL/LOCAL_PRIMARY value. */
export const isLocalPrimary = (env = process.env) =>
  resolveDeploymentMode(env).mode === DEPLOYMENT_MODES.LOCAL_PRIMARY;

// ── Local MongoDB rules ─────────────────────────────────────────────────────
// LOCAL_PRIMARY needs a replica set (every order/stock/KOT write is a
// transaction) on THIS PC: a mongodb+srv:// or remote host means the
// "local" server would really be writing to the cloud — exactly the
// "different apps silently write different databases" bug CLAUDE.md rule 1
// describes. So: mongodb:// only, loopback hosts only, replicaSet required.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Pure: MONGO_URI → { ok, problems[] } for LOCAL_PRIMARY. Never echoes credentials. */
export const checkLocalMongoUri = (uri) => {
  const problems = [];
  const value = typeof uri === "string" ? uri.trim() : "";
  if (!value) return { ok: false, problems: ["MONGO_URI is not set."] };
  if (/^mongodb\+srv:\/\//i.test(value)) {
    return { ok: false, problems: ["MONGO_URI is a mongodb+srv:// (cloud/Atlas) address — the Offline Edition must use the MongoDB on this PC (mongodb://127.0.0.1:27017/...)."] };
  }
  const m = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)(\/[^?]*)?(?:\?(.*))?$/i.exec(value);
  if (!m) return { ok: false, problems: ["MONGO_URI is not a valid mongodb:// address."] };

  // Host list "h1:p1,h2:p2" — handles [::1]:27017 too.
  const hosts = m[1].split(",").map((h) => {
    const s = h.trim();
    const v6 = /^(\[[^\]]+\])(?::\d+)?$/.exec(s);
    return (v6 ? v6[1] : s.replace(/:\d+$/, "")).toLowerCase();
  });
  const remote = hosts.filter((h) => !LOOPBACK_HOSTS.has(h));
  if (remote.length) problems.push(`MONGO_URI points at another machine (${remote.join(", ")}) — the Offline Edition database must run on this PC (127.0.0.1).`);

  const dbName = (m[2] || "").replace(/^\//, "");
  if (!dbName) problems.push("MONGO_URI has no database name (…/zen_local?replicaSet=rs0).");

  const params = new URLSearchParams(m[3] || "");
  if (!params.get("replicaSet")) problems.push("MONGO_URI has no replicaSet=… parameter — transactions (orders, stock, KOT) need a replica set. See docs/offline-edition/09-installation-and-deployment-guide.md.");

  return { ok: problems.length === 0, problems };
};
