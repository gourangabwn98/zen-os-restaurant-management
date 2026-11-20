// test/localBoot.test.js — Offline Edition O1: boot the REAL server.js as a
// child process and check it over HTTP, the way a phone on the Wi-Fi would.
// Run: node test/localBoot.test.js   (uses the cached mongod binary)
//
// SAFETY — this can never touch real data or real services:
//   • MongoDB = throwaway in-memory replica sets on 127.0.0.1 (refuses anything else).
//   • The server child runs with cwd = a fresh temp folder, so dotenv finds
//     no .env, and with a hand-built environment (no inherited secrets:
//     no Firebase, Twilio, PhonePe, Cloudinary, Atlas URI).
//   • Web apps = tiny fake builds in a temp folder.
//
// Memory: each test mongod is capped at a 0.25 GB WiredTiger cache (the
// default grows to ~half the RAM). Without the cap, on a PC that is already
// low on commit memory, mongod fails allocations (fassert / exit code 14)
// and the server child dies with "heap out of memory" — investigated in
// docs/offline-edition/18-o2-auth-device-report.md §2.1.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { requireLan, requireLoopback } from "../local/lanOnly.js";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server.js");
const JWT = "localboot-" + "Zx9#qW4$eR7tY2uI8oP1aS5dF3gH6jK0lL".repeat(2);
const RS = "rs0";
const MONGOD_ARGS = ["--wiredTigerCacheSizeGB", "0.25"];
// A mongod that already crashed makes stop() throw "Cannot cleanup…" — report, don't mask results.
const safeStop = async (rs) => { try { await rs.stop(); } catch (err) { console.error(`  (mongod cleanup: ${err.message})`); } };
const { privateKey: DUMMY_KEY } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.unref(); s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const assertLocalUri = (uri) => { if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) throw new Error(`Refusing non-local test database: ${uri}`); };

// ── fake app builds (kitchen deliberately missing → "not built") ─────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zen-localboot-"));
const appsDir = path.join(tmp, "apps");
for (const app of ["customer", "admin", "waiter"]) {
  const d = path.join(appsDir, app);
  fs.mkdirSync(path.join(d, "assets"), { recursive: true });
  fs.writeFileSync(path.join(d, "index.html"), `<!doctype html><title>${app}</title><script src="/config.js"></script><div id="${app}-root"></div>`);
  fs.writeFileSync(path.join(d, "config.js"), `window.__ZEN_CONFIG__ = Object.assign({ googleMapsKey: "${app}-key" }, window.__ZEN_CONFIG__);`);
  fs.writeFileSync(path.join(d, "assets", "app-123.js"), `console.log("${app}");`);
  fs.writeFileSync(path.join(d, "sw.js"), "// sw");
}
const cwd = path.join(tmp, "cwd"); fs.mkdirSync(cwd); // no .env here

// Minimal environment: only what Node/Windows needs to run, plus our settings.
const baseEnv = () => {
  const keep = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "ComSpec", "PATHEXT", "WINDIR"];
  const env = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  // utils/firebaseAdmin.js parses a service account at import (no network
  // call) and crashes without one — so a dummy project with a throwaway key,
  // as scripts/localSandbox.js does. Nothing can reach a real Firebase project.
  return { ...env, NODE_ENV: "development", JWT_SECRET: JWT, TZ: "Asia/Kolkata",
    LOCAL_PIN_PEPPER: "localboot-pepper-" + "q".repeat(48), LOCAL_SITE_ID: "localboot-site",
    FIREBASE_PROJECT_ID: "zen-localboot-dummy", FIREBASE_CLIENT_EMAIL: "dummy@zen-localboot-dummy.iam.gserviceaccount.com", FIREBASE_PRIVATE_KEY: DUMMY_KEY };
};

/** Starts server.js; resolves with { child, out(), exited } once spawned. */
const startServer = (env) => {
  const child = spawn(process.execPath, [SERVER], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const exited = new Promise((r) => child.on("exit", (code) => r(code)));
  return { child, out: () => log, exited };
};
const stopServer = async (s) => { if (s && s.child.exitCode === null) { s.child.kill(); await s.exited; } };

const get = async (url, headers = {}) => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  return { status: res.status, headers: res.headers, text: await res.text() };
};
const send = async (method, url, body, headers = {}) => {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json };
};
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
/** Socket.IO v4 handshake over long-polling with an auth payload; returns the server's answer packet. */
const socketConnect = async (api, auth) => {
  const open = await get(`${api}/socket.io/?EIO=4&transport=polling`);
  const sid = JSON.parse(open.text.slice(1)).sid;
  const url = `${api}/socket.io/?EIO=4&transport=polling&sid=${sid}`;
  await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: `40${JSON.stringify(auth)}`, signal: AbortSignal.timeout(8000) });
  return (await get(url)).text; // "40{...sid}" = connected, "44{...message}" = refused
};
const waitFor = async (fn, ms, what, srv) => {
  const until = Date.now() + ms; let last;
  while (Date.now() < until) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    if (srv && srv.child.exitCode !== null) throw new Error(`server exited (${srv.child.exitCode}) while waiting for ${what}\n${srv.out()}`);
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${what}${last ? ` (${last.message})` : ""}${srv ? `\n--- server log ---\n${srv.out()}` : ""}`);
};

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, name: RS, storageEngine: "wiredTiger" }, instanceOpts: [{ args: MONGOD_ARGS }] });
const uri = replSet.getUri("zen_local");
assertLocalUri(uri);
assert.match(uri, /replicaSet=rs0/);

let srv;
try {
  // ── 1. LOCAL boot ─────────────────────────────────────────────────────────
  const apiPort = await freePort();
  const ports = { customer: await freePort(), admin: await freePort(), waiter: await freePort(), kitchen: await freePort() };
  srv = startServer({
    ...baseEnv(), DEPLOYMENT_MODE: "LOCAL", MONGO_URI: uri, PORT: String(apiPort), LOCAL_APPS_DIR: appsDir,
    LOCAL_PORT_CUSTOMER: String(ports.customer), LOCAL_PORT_ADMIN: String(ports.admin),
    LOCAL_PORT_WAITER: String(ports.waiter), LOCAL_PORT_KITCHEN: String(ports.kitchen),
  });
  const api = `http://127.0.0.1:${apiPort}`;
  const health = await waitFor(async () => {
    const r = await get(`${api}/local/health`);
    const h = JSON.parse(r.text);
    return h.apps.find((a) => a.name === "admin")?.state === "serving" && h.database.connected ? { r, h } : null;
  }, 45000, "local server to boot", srv);

  await test("LOCAL mode boots and logs the replica set + Offline Edition banner", async () => {
    await waitFor(() => /Local MongoDB replica set "rs0" \(primary\)/.test(srv.out()), 10000, "replica set log line", srv);
    assert.match(srv.out(), /DEPLOYMENT_MODE=LOCAL_PRIMARY/);
    assert.doesNotMatch(srv.out(), /SECURITY CONFIG: JWT_SECRET is not set/);
  });

  await test("/local/health: DB is the replica-set primary; kitchen not built → degraded (HTTP 200)", async () => {
    const { r, h } = health;
    assert.equal(r.status, 200);
    assert.equal(h.mode, "LOCAL_PRIMARY");
    assert.equal(h.database.replicaSet, RS);
    assert.equal(h.database.isPrimary, true);
    assert.equal(h.database.name, "zen_local");
    assert.equal(h.status, "degraded");
    assert.deepEqual(h.apps.map((a) => [a.name, a.state]), [["customer", "serving"], ["admin", "serving"], ["waiter", "serving"], ["kitchen", "not built"]]);
    assert.equal(h.backgroundJobs, true);
    assert.ok(!r.text.includes("mongodb://"), "health must not leak the MONGO_URI");
    assert.equal(r.headers.get("cache-control"), "no-store");
  });

  await test("/api/health (cloud's health route) is unchanged", async () => {
    const r = await get(`${api}/api/health`);
    assert.equal(r.status, 200);
    const h = JSON.parse(r.text);
    assert.equal(h.status, "OK"); assert.equal(h.mode, "single-restaurant");
  });

  await test("the real API answers over the network (public menu read hits the local DB)", async () => {
    const r = await get(`${api}/api/menu`);
    assert.equal(r.status, 200, r.text.slice(0, 200));
  });

  await test("Socket.IO handshake works on the API port (realtime for KOT/orders)", async () => {
    const r = await get(`${api}/socket.io/?EIO=4&transport=polling`);
    assert.equal(r.status, 200);
    assert.match(r.text, /^0\{"sid":/);
  });

  for (const app of ["customer", "admin", "waiter"]) {
    await test(`${app} app served on its own port; config.js points at this PC's API`, async () => {
      const base = `http://127.0.0.1:${ports[app]}`;
      const page = await get(`${base}/`, { Accept: "text/html" });
      assert.equal(page.status, 200); assert.match(page.text, new RegExp(`${app}-root`));
      assert.equal(page.headers.get("cache-control"), "no-cache");

      const cfg = await get(`${base}/config.js`);
      assert.equal(cfg.status, 200);
      assert.match(cfg.headers.get("content-type"), /javascript/);
      const window = { location: { protocol: "http:", hostname: "192.168.1.20" } };
      new Function("window", cfg.text)(window);
      assert.equal(window.__ZEN_CONFIG__.apiUrl, `http://192.168.1.20:${apiPort}/api`);
      assert.equal(window.__ZEN_CONFIG__.googleMapsKey, `${app}-key`);
    });
  }

  await test("SPA deep links get index.html; missing files stay 404; caching is right", async () => {
    const base = `http://127.0.0.1:${ports.waiter}`;
    const deep = await get(`${base}/tables/7`, { Accept: "text/html" });
    assert.equal(deep.status, 200); assert.match(deep.text, /waiter-root/);
    assert.equal((await get(`${base}/assets/missing-999.js`)).status, 404);
    assert.equal((await get(`${base}/tables/7`, { Accept: "application/json" })).status, 404);
    const asset = await get(`${base}/assets/app-123.js`);
    assert.equal(asset.status, 200); assert.match(asset.headers.get("cache-control"), /immutable/);
    assert.equal((await get(`${base}/sw.js`)).headers.get("cache-control"), "no-cache");
    assert.equal((await get(`${base}/..%2f..%2fserver.js`)).status, 404); // no path traversal
  });

  await test("an unbuilt app's port is not opened", async () => {
    await assert.rejects(get(`http://127.0.0.1:${ports.kitchen}/`));
  });

  await test("the local URI supports multi-document transactions", async () => {
    const conn = await mongoose.createConnection(uri).asPromise();
    try {
      const Probe = conn.model("O1Probe", new mongoose.Schema({ n: Number }));
      await Probe.createCollection();
      await conn.transaction(async (session) => { await Probe.create([{ n: 1 }, { n: 2 }], { session, ordered: true }); });
      assert.equal(await Probe.countDocuments(), 2);
      await Probe.collection.drop();
    } finally { await conn.close(); }
  });

  // ── 1b. O2: staff PIN login over real HTTP (fresh DB → first admin) ────────
  const L = `${api}/api/local`;
  let adminTok, setupCode;
  await test("O2: empty DB prints a one-time setup code on the server console only", async () => {
    const m = await waitFor(() => /Setup code:\s+([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})/.exec(srv.out()), 15000, "setup code banner", srv);
    setupCode = m[1];
    const st = await send("GET", `${L}/setup/status`);
    assert.equal(st.status, 200); assert.deepEqual(st.json, { needsBootstrap: true });
    assert.ok(!st.text.includes(setupCode.replace(/-/g, "")));
  });
  await test("O2: bootstrap with the console code creates admin + trusted device + session; a repeat gets 409", async () => {
    const body = { setupCode, siteId: "localboot-site", restaurant: { name: "Boot Cafe" }, admin: { name: "Boot Admin", phone: "9811111111", pin: "640192" }, device: { label: "This PC" } };
    const bad = await send("POST", `${L}/setup/bootstrap`, { ...body, setupCode: "AAAA-BBBB-CCCC" });
    assert.equal(bad.status, 401); assert.equal(bad.json.code, "INVALID_SETUP_CODE");
    const r = await send("POST", `${L}/setup/bootstrap`, body);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.session.role, "admin");
    assert.match(r.json.device.deviceSecret, /^[0-9a-f]{64}$/);
    adminTok = r.json.session.token;
    const again = await send("POST", `${L}/setup/bootstrap`, body);
    assert.equal(again.status, 409);
    assert.doesNotMatch(srv.out(), /640192/, "PIN never logged");
  });
  await test("O2: PIN session works on protected routes; an OTP-style token for the same admin is refused", async () => {
    const ok = await get(`${api}/api/auth/profile`, bearer(adminTok));
    assert.equal(ok.status, 200, ok.text);
    const sess = await send("GET", `${L}/auth/session`, undefined, bearer(adminTok));
    assert.equal(sess.status, 200); assert.equal(sess.json.role, "admin"); assert.ok(sess.json.local.sessionExpiresAt);
    const { default: jwt } = await import("jsonwebtoken");
    const adminId = JSON.parse(Buffer.from(adminTok.split(".")[1], "base64url")).id;
    const otpStyle = jwt.sign({ id: adminId, role: "admin" }, JWT, { expiresIn: "1h" });
    const r = await get(`${api}/api/auth/profile`, bearer(otpStyle));
    assert.equal(r.status, 401); assert.equal(JSON.parse(r.text).reason, "DEVICE_LOGIN_REQUIRED");
    assert.match(await socketConnect(api, { token: otpStyle }), /^44/, "socket refuses it too");
    assert.match(await socketConnect(api, { token: adminTok }), /^40\{"sid"/, "PIN session socket connects");
  });
  await test("O2: SMS-OTP / Firebase staff login routes answer USE_PIN_LOGIN in LOCAL mode", async () => {
    for (const path of ["/api/auth/admin/send-otp", "/api/auth/admin/verify-otp", "/api/auth/admin/firebase-login"]) {
      const r = await send("POST", `${api}${path}`, { phone: "9811111111" });
      assert.equal(r.status, 403, path); assert.equal(r.json.code, "USE_PIN_LOGIN");
    }
    const emp = await send("POST", `${api}/api/auth/employee/send-otp`, { phone: "9811111111" });
    assert.equal(emp.status, 403); assert.equal(emp.json.code, "USE_PIN_LOGIN");
  });
  await test("O2: register → approve (pairing code) → waiter PIN login → revoke cuts REST and socket at once", async () => {
    const reg = await send("POST", `${L}/devices/register`, { label: "Waiter phone", platform: "test" });
    assert.equal(reg.status, 201, reg.text);
    const { deviceId, deviceSecret, pairingCode } = reg.json;
    const pending = await send("POST", `${L}/auth/login`, { phone: "9811111111", pin: "640192", deviceId, deviceSecret });
    assert.equal(pending.status, 403); assert.equal(pending.json.code, "DEVICE_PENDING");

    const list = await send("GET", `${L}/devices`, undefined, bearer(adminTok));
    const dev = list.json.find((d) => d.deviceId === deviceId);
    assert.equal(dev.pairingCode, pairingCode);
    assert.equal(list.json.some((d) => "secretHash" in d), false, "no secret hash in the list");
    const wrong = await send("POST", `${L}/devices/${dev._id}/approve`, { allowedRoles: ["admin"], pairingCode: "ZZZZZZ" }, bearer(adminTok));
    assert.equal(wrong.status, 400);
    const ok = await send("POST", `${L}/devices/${dev._id}/approve`, { allowedRoles: ["admin"], pairingCode }, bearer(adminTok));
    assert.equal(ok.status, 200, ok.text);

    const st = await send("POST", `${L}/devices/status`, { deviceId, deviceSecret });
    assert.equal(st.json.status, "APPROVED");
    const login = await send("POST", `${L}/auth/login`, { phone: "9811111111", pin: "640192", deviceId, deviceSecret });
    assert.equal(login.status, 200, login.text);
    const tok = login.json.token;
    assert.equal((await get(`${api}/api/auth/profile`, bearer(tok))).status, 200);
    assert.match(await socketConnect(api, { token: tok }), /^40/);

    const rev = await send("POST", `${L}/devices/${dev._id}/revoke`, { reason: "test" }, bearer(adminTok));
    assert.equal(rev.status, 200, rev.text);
    const after = await get(`${api}/api/auth/profile`, bearer(tok));
    assert.equal(after.status, 401); assert.equal(JSON.parse(after.text).reason, "DEVICE_REVOKED");
    assert.match(await socketConnect(api, { token: tok }), /^44/);
    assert.equal((await get(`${api}/api/auth/profile`, bearer(adminTok))).status, 200, "the admin's own device is unaffected");
  });
  await test("O2: wrong PIN gives the generic message; audit log is admin-only and has no PINs", async () => {
    const bad = await send("POST", `${L}/auth/login`, { phone: "9811111111", pin: "999999", deviceId: "0".repeat(32), deviceSecret: "0".repeat(64) });
    assert.equal(bad.status, 401);
    const ev = await send("GET", `${L}/auth/events`, undefined, bearer(adminTok));
    assert.equal(ev.status, 200);
    assert.ok(ev.json.some((e) => e.type === "BOOTSTRAP") && ev.json.some((e) => e.type === "DEVICE_REVOKED"));
    assert.ok(!ev.text.includes("640192"));
    assert.equal((await send("GET", `${L}/auth/events`)).status, 401);
  });
  await stopServer(srv); srv = null;

  // ── 2. LAN-only guard on the real middleware ───────────────────────────────
  await test("requireLan: private peer passes, public peer gets 403 (headers ignored)", async () => {
    const call = (remoteAddress, headers = {}) => {
      let nextCalled = false, status = null;
      const res = { status(c) { status = c; return this; }, json() { return this; } };
      requireLan({ socket: { remoteAddress }, headers }, res, () => { nextCalled = true; });
      return { nextCalled, status };
    };
    assert.deepEqual(call("::ffff:192.168.1.40"), { nextCalled: true, status: null });
    assert.deepEqual(call("203.0.113.9", { "x-forwarded-for": "192.168.1.5" }), { nextCalled: false, status: 403 });
  });
  await test("requireLoopback (first-time setup): only this PC; a LAN phone gets 403", async () => {
    const call = (remoteAddress) => {
      let nextCalled = false, status = null;
      const res = { status(c) { status = c; return this; }, json() { return this; } };
      requireLoopback({ socket: { remoteAddress }, headers: { "x-forwarded-for": "127.0.0.1" } }, res, () => { nextCalled = true; });
      return { nextCalled, status };
    };
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(call(ip).nextCalled, true, ip);
    for (const ip of ["192.168.1.40", "::ffff:10.0.0.2", "fe80::1"]) assert.deepEqual(call(ip), { nextCalled: false, status: 403 }, ip);
  });

  // Scenarios 3–5 each own their server and always stop it, pass or fail,
  // so one failure can't leave a stray server running into the next test.
  const scenario = (name, fn) => test(name, async () => {
    const own = { srv: null };
    try { await fn(own); } finally { await stopServer(own.srv); }
  });

  // ── 3. CLOUD mode (DEPLOYMENT_MODE unset) — nothing new is switched on ─────
  await scenario("cloud mode: /local/health is just an unknown route, no app ports are opened", async (own) => {
    const p = await freePort(), appPort = await freePort();
    own.srv = startServer({ ...baseEnv(), MONGO_URI: uri, PORT: String(p), LOCAL_APPS_DIR: appsDir, LOCAL_PORT_ADMIN: String(appPort) });
    await waitFor(async () => (await get(`http://127.0.0.1:${p}/api/health`)).status === 200, 45000, "cloud server", own.srv);
    // Today's cloud answers ANY unknown route via notFound → errorHandler
    // (status 500, "Not Found — <url>"). /local/health must look exactly like that.
    const unknown = await get(`http://127.0.0.1:${p}/no-such-route-o1`);
    const local = await get(`http://127.0.0.1:${p}/local/health`);
    assert.equal(local.status, unknown.status);
    assert.match(JSON.parse(local.text).message, /^Not Found — \/local\/health/);
    // O2 routes don't exist in the cloud either, and OTP login is not gated.
    const pin = await send("POST", `http://127.0.0.1:${p}/api/local/auth/login`, {});
    assert.equal(pin.status, unknown.status);
    const otp = await send("POST", `http://127.0.0.1:${p}/api/auth/admin/send-otp`, { phone: "9811111111" });
    assert.notEqual(otp.json?.code, "USE_PIN_LOGIN");
    assert.doesNotMatch(own.srv.out(), /FIRST-TIME SETUP/);
    await sleep(500);
    await assert.rejects(get(`http://127.0.0.1:${appPort}/`));
    assert.doesNotMatch(own.srv.out(), /LOCAL MODE|Offline Edition/);
  });

  // ── 4. refuses unsafe configurations before touching any database ─────────
  await scenario("LOCAL with an Atlas (+srv) URI refuses to start (exit 1), no credentials printed", async (own) => {
    own.srv = startServer({ ...baseEnv(), DEPLOYMENT_MODE: "LOCAL", MONGO_URI: "mongodb+srv://u:p@cluster0.example.mongodb.net/zen", PORT: String(await freePort()) });
    const code = await Promise.race([own.srv.exited, sleep(20000).then(() => "timeout")]);
    assert.equal(code, 1, own.srv.out());
    assert.match(own.srv.out(), /\+srv/);
    assert.doesNotMatch(own.srv.out(), /u:p@/);
  });
  await scenario("an unknown DEPLOYMENT_MODE refuses to start (exit 1)", async (own) => {
    own.srv = startServer({ ...baseEnv(), DEPLOYMENT_MODE: "LOKAL", MONGO_URI: uri, PORT: String(await freePort()) });
    const code = await Promise.race([own.srv.exited, sleep(20000).then(() => "timeout")]);
    assert.equal(code, 1, own.srv.out());
    assert.match(own.srv.out(), /not recognised/);
  });

  // ── 5. recovery: MongoDB starts AFTER the server (PC boot order) ───────────
  await scenario("DB down at boot → server stays up (503), recovers by itself when MongoDB starts", async (own) => {
    const dbPort = await freePort(), p = await freePort(), adminPort = await freePort();
    const lateUri = `mongodb://127.0.0.1:${dbPort}/zen_late?replicaSet=${RS}`;
    assertLocalUri(lateUri);
    own.srv = startServer({ ...baseEnv(), DEPLOYMENT_MODE: "LOCAL", MONGO_URI: lateUri, PORT: String(p), LOCAL_APPS_DIR: appsDir,
      LOCAL_PORT_ADMIN: String(adminPort), LOCAL_PORT_CUSTOMER: String(await freePort()), LOCAL_PORT_WAITER: String(await freePort()), LOCAL_PORT_KITCHEN: String(await freePort()) });
    const down = await waitFor(async () => { const r = await get(`http://127.0.0.1:${p}/local/health`); return r.status === 503 ? r : null; }, 60000, "503 while DB is down", own.srv);
    const h = JSON.parse(down.text);
    assert.equal(h.status, "error"); assert.equal(h.database.connected, false);
    assert.equal((await get(`http://127.0.0.1:${adminPort}/`, { Accept: "text/html" })).status, 200, "apps are still served while the DB is down");

    const late = await MongoMemoryReplSet.create({ replSet: { count: 1, name: RS, storageEngine: "wiredTiger" }, instanceOpts: [{ port: dbPort, args: MONGOD_ARGS }] });
    try {
      const up = await waitFor(async () => {
        const r = await get(`http://127.0.0.1:${p}/local/health`);
        const j = JSON.parse(r.text);
        return r.status === 200 && j.database.isPrimary ? j : null;
      }, 60000, "health to recover after MongoDB started", own.srv);
      assert.equal(up.database.replicaSet, RS);
    } finally { await stopServer(own.srv); own.srv = null; await safeStop(late); }
  });
} finally {
  await stopServer(srv);
  await safeStop(replSet);
  // Windows releases a dead child's cwd handle a moment later.
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
