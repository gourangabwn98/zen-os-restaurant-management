// test/deploymentMode.test.js — Offline Edition O1 pure logic.
// run: node test/deploymentMode.test.js
import assert from "node:assert/strict";
import path from "node:path";
import { resolveDeploymentMode, isLocalPrimary, checkLocalMongoUri, DEPLOYMENT_MODES } from "../config/deploymentMode.js";
import { checkLocalModeConfig } from "../config/localModeCheck.js";
import { isPrivateAddress } from "../local/lanOnly.js";
import { summarizeHealth } from "../local/healthRoutes.js";
import { resolveAppPlan, buildRuntimeConfigJs } from "../local/staticApps.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok - ${name}`); };
const { CLOUD_PRIMARY, LOCAL_PRIMARY } = DEPLOYMENT_MODES;

// ── mode ──────────────────────────────────────────────────────────────────
test("unset / blank DEPLOYMENT_MODE is cloud (production unchanged)", () => {
  for (const env of [{}, { DEPLOYMENT_MODE: "" }, { DEPLOYMENT_MODE: "   " }]) {
    assert.deepEqual(resolveDeploymentMode(env), { valid: true, mode: CLOUD_PRIMARY, reason: null });
    assert.equal(isLocalPrimary(env), false);
  }
});
test("LOCAL and LOCAL_PRIMARY (any case) are local; CLOUD aliases cloud", () => {
  for (const v of ["LOCAL", "local", " Local_Primary ", "LOCAL_PRIMARY"]) assert.equal(resolveDeploymentMode({ DEPLOYMENT_MODE: v }).mode, LOCAL_PRIMARY);
  for (const v of ["CLOUD", "cloud_primary"]) assert.equal(resolveDeploymentMode({ DEPLOYMENT_MODE: v }).mode, CLOUD_PRIMARY);
});
test("an unknown value is invalid, never guessed as cloud or local", () => {
  for (const v of ["LOCLA", "offline", "1", "true"]) {
    const r = resolveDeploymentMode({ DEPLOYMENT_MODE: v });
    assert.equal(r.valid, false); assert.equal(r.mode, null); assert.match(r.reason, /not recognised/);
    assert.equal(isLocalPrimary({ DEPLOYMENT_MODE: v }), false);
  }
});

// ── local MongoDB URI ─────────────────────────────────────────────────────
test("accepts loopback replica-set URIs", () => {
  for (const u of [
    "mongodb://127.0.0.1:27017/zen_local?replicaSet=rs0",
    "mongodb://localhost/zen_local?replicaSet=rs0&retryWrites=true",
    "mongodb://[::1]:27017/zen_local?replicaSet=rs0",
    "mongodb://zen:p%40ss@127.0.0.1:27017/zen_local?authSource=admin&replicaSet=rs0",
  ]) assert.deepEqual(checkLocalMongoUri(u), { ok: true, problems: [] }, u);
});
test("rejects Atlas, remote hosts, missing replicaSet, missing db name", () => {
  const bad = (u, re) => { const r = checkLocalMongoUri(u); assert.equal(r.ok, false, u); assert.ok(r.problems.some((p) => re.test(p)), `${u} → ${r.problems}`); };
  bad("mongodb+srv://u:p@cluster0.abc.mongodb.net/zen", /\+srv/);
  bad("mongodb://192.168.1.50:27017/zen?replicaSet=rs0", /another machine/);
  bad("mongodb://127.0.0.1:27017,db2.example.com:27017/zen?replicaSet=rs0", /db2\.example\.com/);
  bad("mongodb://127.0.0.1:27017/zen_local", /replicaSet/);
  bad("mongodb://127.0.0.1:27017/?replicaSet=rs0", /database name/);
  bad("", /not set/);
  bad("postgres://127.0.0.1/zen", /not a valid/);
});
test("never echoes credentials from the URI", () => {
  const r = checkLocalMongoUri("mongodb://admin:SuperSecret123@10.0.0.9:27017/zen");
  assert.ok(!r.problems.join(" ").includes("SuperSecret123"));
});

// ── startup check ─────────────────────────────────────────────────────────
const goodLocal = { DEPLOYMENT_MODE: "LOCAL", MONGO_URI: "mongodb://127.0.0.1:27017/zen_local?replicaSet=rs0", JWT_SECRET: "x".repeat(64), LOCAL_PIN_PEPPER: "p".repeat(64), LOCAL_SITE_ID: "adds-cafe" };
test("cloud mode: no findings at all (cloud startup unchanged)", () => {
  const r = checkLocalModeConfig({ MONGO_URI: "mongodb+srv://u:p@c.mongodb.net/zen", OTP_DEV_ECHO: "true", DISABLE_BACKGROUND_JOBS: "true" });
  assert.deepEqual(r, { mode: CLOUD_PRIMARY, fatal: [], warnings: [] });
});
test("invalid mode is fatal", () => {
  assert.equal(checkLocalModeConfig({ DEPLOYMENT_MODE: "LOKAL" }).fatal.length, 1);
});
test("good local config: no fatal, no warnings", () => {
  const r = checkLocalModeConfig(goodLocal);
  assert.equal(r.mode, LOCAL_PRIMARY);
  assert.deepEqual(r.fatal, []);
  assert.deepEqual(r.warnings, []);
});
test("local O2: PIN pepper missing/short/equal to JWT secret and bad site id are fatal; values never printed", () => {
  const { LOCAL_PIN_PEPPER: _p, ...noPepper } = goodLocal;
  assert.ok(checkLocalModeConfig(noPepper).fatal.some((f) => /LOCAL_PIN_PEPPER/.test(f)));
  assert.ok(checkLocalModeConfig({ ...goodLocal, LOCAL_PIN_PEPPER: "short" }).fatal.some((f) => /LOCAL_PIN_PEPPER/.test(f)));
  const same = checkLocalModeConfig({ ...goodLocal, LOCAL_PIN_PEPPER: "x".repeat(64) });
  assert.ok(same.fatal.some((f) => /different from JWT_SECRET/.test(f)));
  assert.ok(!same.fatal.join(" ").includes("x".repeat(32)));
  for (const bad of [undefined, "", "ab", "Bad Site!", "-lead"]) {
    assert.ok(checkLocalModeConfig({ ...goodLocal, LOCAL_SITE_ID: bad }).fatal.some((f) => /LOCAL_SITE_ID/.test(f)), String(bad));
  }
  assert.ok(checkLocalModeConfig({ ...goodLocal, LOCAL_SESSION_HOURS: "48" }).warnings.some((w) => /LOCAL_SESSION_HOURS/.test(w)));
});
test("local: Atlas URI, sandbox secret and OTP echo are each fatal", () => {
  assert.ok(checkLocalModeConfig({ ...goodLocal, MONGO_URI: "mongodb+srv://u:p@c.mongodb.net/zen" }).fatal.some((f) => /\+srv/.test(f)));
  assert.ok(checkLocalModeConfig({ ...goodLocal, JWT_SECRET: "zen-sandbox-only-secret-not-for-production" }).fatal.some((f) => /sandbox/.test(f)));
  assert.ok(checkLocalModeConfig({ ...goodLocal, OTP_DEV_ECHO: "true" }).fatal.some((f) => /OTP_DEV_ECHO/.test(f)));
});
test("local: DISABLE_BACKGROUND_JOBS warns", () => {
  assert.ok(checkLocalModeConfig({ ...goodLocal, DISABLE_BACKGROUND_JOBS: "true" }).warnings.some((w) => /auto-send/.test(w)));
});

// ── LAN guard ─────────────────────────────────────────────────────────────
test("private / loopback addresses are LAN", () => {
  for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.254", "192.168.1.20", "::ffff:192.168.0.7", "169.254.1.1", "fd12:3456::1", "fe80::1"])
    assert.equal(isPrivateAddress(ip), true, ip);
});
test("public / malformed addresses are not LAN", () => {
  for (const ip of ["8.8.8.8", "172.15.0.1", "172.32.0.1", "192.169.0.1", "100.64.0.1", "2001:4860::8888", "::ffff:8.8.8.8", "999.1.1.1", "", null, undefined, "localhost"])
    assert.equal(isPrivateAddress(ip), false, String(ip));
});

// ── health summary ────────────────────────────────────────────────────────
const startedAt = new Date("2026-11-20T10:00:00Z"), now = new Date("2026-11-20T10:01:30Z");
const dbOk = { connected: true, name: "zen_local", replicaSet: "rs0", isPrimary: true, latencyMs: 2, error: null };
const serving = { admin: { port: 8081, state: "serving", reason: null } };
test("health ok: replica-set primary, apps serving, jobs on", () => {
  const h = summarizeHealth({ database: dbOk, apps: serving, startedAt, now, backgroundJobs: true });
  assert.equal(h.status, "ok"); assert.equal(h.mode, LOCAL_PRIMARY); assert.equal(h.uptimeSeconds, 90); assert.deepEqual(h.problems, []);
});
test("health error: db down / not a replica set / not primary", () => {
  assert.equal(summarizeHealth({ database: { ...dbOk, connected: false }, apps: serving, startedAt, now, backgroundJobs: true }).status, "error");
  const notRs = summarizeHealth({ database: { ...dbOk, replicaSet: null }, apps: serving, startedAt, now, backgroundJobs: true });
  assert.equal(notRs.status, "error"); assert.match(notRs.problems[0], /replica set/);
  assert.equal(summarizeHealth({ database: { ...dbOk, isPrimary: false }, apps: serving, startedAt, now, backgroundJobs: true }).status, "error");
});
test("health degraded: an app not built, or jobs off — error still wins", () => {
  const apps = { ...serving, kitchen: { port: 8083, state: "not built", reason: "no index.html" } };
  const h = summarizeHealth({ database: dbOk, apps, startedAt, now, backgroundJobs: true });
  assert.equal(h.status, "degraded"); assert.match(h.problems[0], /Kitchen app is not built/);
  assert.equal(summarizeHealth({ database: dbOk, apps: serving, startedAt, now, backgroundJobs: false }).status, "degraded");
  assert.equal(summarizeHealth({ database: { ...dbOk, connected: false }, apps, startedAt, now, backgroundJobs: false }).status, "error");
});
test("health never contains the MONGO_URI", () => {
  const h = JSON.stringify(summarizeHealth({ database: dbOk, apps: serving, startedAt, now, backgroundJobs: true }));
  assert.ok(!/mongodb:\/\//.test(h));
});

// ── app hosting plan + generated config.js ────────────────────────────────
test("default ports and repo dist folders", () => {
  const plan = resolveAppPlan({});
  assert.deepEqual(plan.map((p) => [p.name, p.port]), [["customer", 8080], ["admin", 8081], ["waiter", 8082], ["kitchen", 8083]]);
  for (const p of plan) assert.ok(p.dir.endsWith(path.join(p.name, "dist")), p.dir);
});
test("LOCAL_APPS_DIR and LOCAL_PORT_* override; a bad port becomes null", () => {
  const plan = resolveAppPlan({ LOCAL_APPS_DIR: "C:\\ZenOS\\apps", LOCAL_PORT_ADMIN: "9001", LOCAL_PORT_WAITER: "abc", LOCAL_PORT_KITCHEN: "70000" });
  const by = Object.fromEntries(plan.map((p) => [p.name, p]));
  assert.equal(by.admin.port, 9001); assert.equal(by.waiter.port, null); assert.equal(by.kitchen.port, null);
  assert.equal(by.customer.dir, path.join(path.resolve("C:\\ZenOS\\apps"), "customer"));
});
test("generated config.js points at the API port on the page's own host, build config kept", () => {
  const buildConfigJs = 'window.__ZEN_CONFIG__ = Object.assign({ apiUrl: "https://cloud.example.com/api", googleMapsKey: "K" }, window.__ZEN_CONFIG__);';
  const js = buildRuntimeConfigJs({ apiPort: 5000, appName: "waiter", buildConfigJs });
  // Run it the way index.html does: our block, then the build's file.
  const window = { location: { protocol: "http:", hostname: "192.168.1.20" } };
  new Function("window", js)(window);
  assert.equal(window.__ZEN_CONFIG__.apiUrl, "http://192.168.1.20:5000/api"); // ours wins over the build's cloud URL
  assert.equal(window.__ZEN_CONFIG__.googleMapsKey, "K");                       // other keys survive
  assert.equal(window.__ZEN_CONFIG__.localServer, true);
});

console.log(`\n${passed} passed`);
