// local/healthRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
// Offline Edition: GET /local/health — mounted ONLY in LOCAL_PRIMARY
// (server.js), reachable ONLY from the restaurant network (lanOnly.js).
//
// Answers "is this restaurant PC able to take orders right now?":
//   • database connected, a replica set, and this node is the writable primary
//     (without that, every order/stock/KOT transaction fails)
//   • which web apps are being served, on which ports
// HTTP 200 for ok/degraded, 503 for error, so a monitor or installer can poll it.
// Never returns the MONGO_URI, credentials, or any customer/order data.
// The cloud's /api/health is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import { getDB } from "../config/db.js";
import { requireLan } from "./lanOnly.js";
import { DEPLOYMENT_MODES } from "../config/deploymentMode.js";

const DB_CHECK_TIMEOUT_MS = 3000;

const withTimeout = (promise, ms, label) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
};

/** Asks MongoDB about itself: connected? replica set? primary? */
export const probeDatabase = async ({ connect, timeoutMs = DB_CHECK_TIMEOUT_MS }) => {
  const started = Date.now();
  try {
    const conn = await withTimeout(connect(), timeoutMs, "database connect");
    const hello = await withTimeout(conn.db.admin().command({ hello: 1 }), timeoutMs, "database hello");
    return {
      connected: true,
      name: conn.name || null,
      replicaSet: hello.setName || null,
      isPrimary: hello.isWritablePrimary === true,
      latencyMs: Date.now() - started,
      error: null,
    };
  } catch (err) {
    return { connected: false, name: null, replicaSet: null, isPrimary: false, latencyMs: null, error: err.message };
  }
};

/** Pure: probe results → health document. */
export const summarizeHealth = ({ database, apps, startedAt, now = new Date(), backgroundJobs }) => {
  const problems = [];
  let status = "ok";
  if (!database.connected) { status = "error"; problems.push("Database is not reachable."); }
  else if (!database.replicaSet) { status = "error"; problems.push("Database is not a replica set — orders cannot be saved (transactions need one)."); }
  else if (!database.isPrimary) { status = "error"; problems.push("Database is not the writable primary."); }

  const appList = Object.entries(apps || {}).map(([name, a]) => ({ name, ...a }));
  for (const a of appList) {
    if (a.state !== "serving") {
      if (status === "ok") status = "degraded";
      problems.push(`${name(a)} app is ${a.state}${a.reason ? ` (${a.reason})` : ""}.`);
    }
  }
  if (!backgroundJobs) {
    if (status === "ok") status = "degraded";
    problems.push("Background jobs are disabled (auto-send to kitchen will not run).");
  }

  return {
    status,
    mode: DEPLOYMENT_MODES.LOCAL_PRIMARY,
    time: now.toISOString(),
    uptimeSeconds: Math.round((now.getTime() - startedAt.getTime()) / 1000),
    database,
    apps: appList,
    backgroundJobs,
    problems,
  };
};
const name = (a) => a.name.charAt(0).toUpperCase() + a.name.slice(1);

/**
 * @param {{ getApps: () => object, startedAt: Date }} opts
 *   getApps — current state of the static app servers (local/staticApps.js).
 */
export const createLocalHealthRouter = ({ getApps, startedAt }) => {
  const router = Router();
  router.get("/health", requireLan, async (_req, res) => {
    const database = await probeDatabase({ connect: () => getDB(process.env.MONGO_URI) });
    const body = summarizeHealth({
      database,
      apps: getApps(),
      startedAt,
      backgroundJobs: process.env.DISABLE_BACKGROUND_JOBS !== "true",
    });
    res.set("Cache-Control", "no-store");
    res.status(body.status === "error" ? 503 : 200).json(body);
  });
  return router;
};
