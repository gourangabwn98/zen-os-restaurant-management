// test/localAuth.test.js — Offline Edition O2: staff PIN login, device
// registration/approval/revocation, lockout, audit, first-admin bootstrap.
// Run: node test/localAuth.test.js   (uses the cached mongod binary)
//
// SAFETY: a throwaway in-memory replica set on 127.0.0.1 only (refuses any
// other URI). Env is hand-built per call — nothing reads the real .env.
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { getModels } from "../config/getModels.js";
import { getLocalAuthModels, DEVICE_STATUSES } from "../config/localAuthModels.js";
import * as svc from "../services/localAuthService.js";
import { pinProblem, hashPin, verifyPin, isPinShaped } from "../utils/localPin.js";

const ENV = { JWT_SECRET: "localauth-test-" + "k".repeat(48), LOCAL_PIN_PEPPER: "pepper-" + "z".repeat(48), LOCAL_SITE_ID: "test-site", LOCAL_SESSION_HOURS: "12" };

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};
const rejects = async (p, code, status) => {
  try { await p; } catch (err) {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    if (status) assert.equal(err.statusCode, status);
    return err;
  }
  assert.fail(`expected rejection ${code}`);
};

// ── pure: PIN rules + hashing ──────────────────────────────────────────────
console.log("PIN rules / hashing");
await test("PIN shape and weak-PIN rules", () => {
  assert.equal(isPinShaped("12345"), false);
  assert.equal(isPinShaped("123456789"), false);
  assert.equal(isPinShaped("12a456"), false);
  assert.match(pinProblem("111111"), /repeated/);
  assert.match(pinProblem("123456"), /straight run/);
  assert.match(pinProblem("876543"), /straight run/);
  assert.match(pinProblem("592731", { phone: "9876592731" }), /phone/);
  assert.match(pinProblem("987654", { phone: "9876543210" }), /straight run|phone/);
  assert.equal(pinProblem("482915", { phone: "9876543210" }), null);
});
await test("hash: salted, peppered, never contains the PIN; wrong pepper fails", async () => {
  const h1 = await hashPin("482915", ENV), h2 = await hashPin("482915", ENV);
  assert.notEqual(h1, h2);
  assert.ok(!h1.includes("482915"));
  assert.equal(await verifyPin("482915", h1, ENV), true);
  assert.equal(await verifyPin("482916", h1, ENV), false);
  assert.equal(await verifyPin("482915", h1, { LOCAL_PIN_PEPPER: "other-" + "y".repeat(48) }), false);
  assert.equal(await verifyPin("482915", "garbage", ENV), false);
  await assert.rejects(hashPin("482915", { LOCAL_PIN_PEPPER: "short" }), /LOCAL_PIN_PEPPER/);
});

// ── database scenarios ────────────────────────────────────────────────────
const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, name: "rs0", storageEngine: "wiredTiger" }, instanceOpts: [{ args: ["--wiredTigerCacheSizeGB", "0.25"] }] });
const uri = rs.getUri("zen_localauth");
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) throw new Error(`Refusing non-local test database: ${uri}`);
const conn = await mongoose.createConnection(uri).asPromise();
const app = getModels(conn);
const models = getLocalAuthModels(conn);
await Promise.all(Object.values(models).map((m) => m.init()));
await app.User.init();

const IP = "192.168.1.50";
const mkUser = (o) => app.User.create({ status: "Active", ...o });
const admin   = await mkUser({ name: "Asha Admin", phone: "9000000001", role: "admin", isAdmin: true });
const manager = await mkUser({ name: "Mona Manager", phone: "9000000002", role: "manager" });
const waiter  = await mkUser({ name: "Wasim Waiter", phone: "9000000003", role: "waiter" });
const chef    = await mkUser({ name: "Chetan Chef", phone: "9000000004", role: "chef" });
const customer = await mkUser({ name: "Cust", phone: "9000000005", role: "customer" });
const inactive = await mkUser({ name: "Gone", phone: "9000000006", role: "waiter", status: "Inactive" });
await app.RestaurantProfile.create({ restaurantName: "Test Cafe" });

// Admin's own PIN is seeded directly (bootstrap is tested separately on a fresh DB).
const seedPin = async (user, pin, mustChange = false) => models.StaffPin.findOneAndUpdate(
  { user: user._id },
  { $set: { pinHash: await hashPin(pin, ENV), mustChange, setBy: { kind: "SYSTEM" }, setAt: new Date(), failedCount: 0, lockoutCount: 0, lockedUntil: null } },
  { upsert: true },
);
await seedPin(admin, "482915");
await seedPin(manager, "730264");

let regIp = 100; // each registration from its own address, so the per-IP limit only bites where tested
const register = (label = "Tab", ip = `192.168.2.${regIp++}`) => svc.registerDevice({ models, label, platform: "test", ip });
const approve = (actor, dev, roles) => models.StaffDevice.findOne({ deviceId: dev.deviceId }).then((d) =>
  svc.approveDevice({ models, actor, id: d._id, allowedRoles: roles, pairingCode: dev.pairingCode, ip: IP }));
const login = (user, pin, dev, ip = IP) => svc.pinLogin({ models, appModels: app, phone: user.phone, pin, deviceId: dev.deviceId, deviceSecret: dev.deviceSecret, ip, env: ENV });
const check = async (token, user, { localMode = true, path = "/api/orders", now } = {}) => {
  const decoded = jwt.verify(token, ENV.JWT_SECRET);
  const fresh = await app.User.findById(user._id);
  return svc.checkLocalToken({ models: localMode ? models : null, decoded, user: fresh, localMode, path, now });
};
const events = (type) => models.LocalAuthEvent.find(type ? { type } : {}).lean();

console.log("devices");
let counterDev, kitchenDev;
await test("register: secret returned once, only its hash stored; status PENDING; audited", async () => {
  counterDev = await register("Counter tablet");
  assert.match(counterDev.deviceId, /^[0-9a-f]{32}$/);
  assert.match(counterDev.deviceSecret, /^[0-9a-f]{64}$/);
  assert.match(counterDev.pairingCode, /^[A-Z2-9]{6}$/);
  const stored = await models.StaffDevice.findOne({ deviceId: counterDev.deviceId }).select("+secretHash").lean();
  assert.equal(stored.status, DEVICE_STATUSES.PENDING);
  assert.notEqual(stored.secretHash, counterDev.deviceSecret);
  assert.ok(stored.pendingExpiresAt > new Date());
  assert.equal((await events("DEVICE_REGISTERED")).length, 1);
  const st = await svc.deviceStatus({ models, deviceId: counterDev.deviceId, deviceSecret: counterDev.deviceSecret });
  assert.equal(st.status, "PENDING");
  await rejects(svc.deviceStatus({ models, deviceId: counterDev.deviceId, deviceSecret: "0".repeat(64) }), "DEVICE_NOT_REGISTERED", 404);
});
await test("pending device cannot log in", async () => {
  await rejects(login(admin, "482915", counterDev), "DEVICE_PENDING", 403);
});
await test("approve needs the matching pairing code and valid roles", async () => {
  const d = await models.StaffDevice.findOne({ deviceId: counterDev.deviceId });
  await rejects(svc.approveDevice({ models, actor: admin, id: d._id, allowedRoles: ["admin"], pairingCode: "WRONG1", ip: IP }), "PAIRING_CODE_MISMATCH", 400);
  await rejects(svc.approveDevice({ models, actor: admin, id: d._id, allowedRoles: ["customer"], pairingCode: counterDev.pairingCode, ip: IP }), "INVALID_ROLES", 400);
  await rejects(svc.approveDevice({ models, actor: admin, id: d._id, allowedRoles: [], pairingCode: counterDev.pairingCode, ip: IP }), "INVALID_ROLES", 400);
});
await test("manager may approve waiter/chef devices only", async () => {
  const d = await models.StaffDevice.findOne({ deviceId: counterDev.deviceId });
  await rejects(svc.approveDevice({ models, actor: manager, id: d._id, allowedRoles: ["admin", "waiter"], pairingCode: counterDev.pairingCode, ip: IP }), "FORBIDDEN", 403);
  kitchenDev = await register("Kitchen screen");
  const out = await approve(manager, kitchenDev, ["chef"]);
  assert.equal(out.status, "APPROVED");
  assert.deepEqual(out.allowedRoles, ["chef"]);
  assert.equal(out.pairingCode, undefined, "pairing code not exposed after approval");
});
await test("admin approves; a second approval is a conflict (atomic)", async () => {
  const out = await approve(admin, counterDev, ["admin", "manager", "waiter"]);
  assert.equal(out.status, "APPROVED");
  const d = await models.StaffDevice.findOne({ deviceId: counterDev.deviceId }).lean();
  assert.equal(d.pendingExpiresAt, null);
  await rejects(approve(admin, counterDev, ["waiter"]), "NOT_PENDING", 409);
});
await test("reject is final; a rejected device can't log in", async () => {
  const dev = await register("Unknown phone");
  const d = await models.StaffDevice.findOne({ deviceId: dev.deviceId });
  await rejects(svc.rejectDevice({ models, actor: waiter, id: d._id, ip: IP }), "FORBIDDEN", 403);
  const out = await svc.rejectDevice({ models, actor: manager, id: d._id, ip: IP });
  assert.equal(out.status, "REJECTED");
  await rejects(login(admin, "482915", dev), "DEVICE_REVOKED", 403);
});
await test("registration is rate-limited per IP", async () => {
  const ip = "192.168.1.99";
  for (let i = 0; i < svc.POLICY.REGISTER_LIMIT; i++) await register(`r${i}`, ip);
  await rejects(register("one too many", ip), "RATE_LIMITED", 429);
});

console.log("login");
let adminSession;
await test("admin logs in on an approved device; role comes from the User record", async () => {
  adminSession = await login(admin, "482915", counterDev);
  assert.equal(adminSession.role, "admin");
  assert.equal(adminSession.name, "Asha Admin");
  assert.equal(adminSession.restaurantName, "Test Cafe");
  assert.equal(adminSession.local.mustChangePin, false);
  const decoded = jwt.verify(adminSession.token, ENV.JWT_SECRET);
  assert.equal(decoded.typ, "local");
  assert.equal(decoded.did, counterDev.deviceId);
  const r = await check(adminSession.token, admin);
  assert.equal(r.ok, true);
  assert.ok(r.session.sid);
});
await test("unknown phone, wrong PIN, bad format, customer, inactive: all the same generic 401", async () => {
  const msgs = new Set();
  for (const [phone, pin] of [["9111111111", "482915"], [admin.phone, "999999"], ["12", "482915"], [customer.phone, "482915"], [inactive.phone, "482915"], [admin.phone, "abc"]]) {
    const err = await rejects(svc.pinLogin({ models, appModels: app, phone, pin, deviceId: counterDev.deviceId, deviceSecret: counterDev.deviceSecret, ip: "192.168.1.60", env: ENV }), "INVALID_CREDENTIALS", 401);
    msgs.add(err.message);
  }
  assert.equal(msgs.size, 1);
  await models.StaffPin.updateOne({ user: admin._id }, { $set: { failedCount: 0 } }); // two wrong admin PINs above
  await models.LocalRateLimit.deleteMany({ _id: /login-fail:device/ });
});
await test("role not allowed on the device → 403, no session", async () => {
  await seedPin(chef, "628401");
  await rejects(login(chef, "628401", counterDev), "ROLE_NOT_ALLOWED_ON_DEVICE", 403);
  const s = await login(chef, "628401", kitchenDev);
  assert.equal(s.role, "chef");
});
await test("wrong device secret → not registered", async () => {
  await rejects(svc.pinLogin({ models, appModels: app, phone: admin.phone, pin: "482915", deviceId: counterDev.deviceId, deviceSecret: "f".repeat(64), ip: IP, env: ENV }), "DEVICE_NOT_REGISTERED", 401);
});
await test("audit log never contains a PIN", async () => {
  const all = JSON.stringify(await events());
  for (const pin of ["482915", "999999", "628401", "730264"]) assert.ok(!all.includes(pin), `PIN ${pin} found in audit log`);
  assert.ok((await events("LOGIN_SUCCESS")).length >= 2);
  assert.ok((await events("LOGIN_FAILED")).length >= 6);
});
await test("audit log is append-only", async () => {
  await assert.rejects(models.LocalAuthEvent.updateMany({}, { $set: { reason: "x" } }), /append-only/);
  await assert.rejects(models.LocalAuthEvent.deleteMany({}), /append-only/);
});

console.log("lockout");
await test("5 wrong PINs lock the account (5 → 15 → 60 min); correct PIN refused while locked; success resets", async () => {
  await seedPin(waiter, "305817");
  const waiterDev = await register("Waiter phone");
  await approve(admin, waiterDev, ["waiter"]);
  const t0 = new Date();
  const wrong = (now) => svc.pinLogin({ models, appModels: app, phone: waiter.phone, pin: "000001", deviceId: waiterDev.deviceId, deviceSecret: waiterDev.deviceSecret, ip: IP, now, env: ENV });
  const right = (now) => svc.pinLogin({ models, appModels: app, phone: waiter.phone, pin: "305817", deviceId: waiterDev.deviceId, deviceSecret: waiterDev.deviceSecret, ip: IP, now, env: ENV });
  for (let i = 0; i < 5; i++) await rejects(wrong(t0), "INVALID_CREDENTIALS");
  let p = await models.StaffPin.findOne({ user: waiter._id }).lean();
  assert.equal(p.lockoutCount, 1);
  assert.equal(Math.round((p.lockedUntil - t0) / 60e3), 5);
  await rejects(right(new Date(t0.getTime() + 60e3)), "ACCOUNT_LOCKED", 429);
  // device throttle is a separate counter — clear it to isolate the account rule
  await models.LocalRateLimit.deleteMany({ _id: /login-fail:device/ });
  const t1 = new Date(t0.getTime() + 6 * 60e3);
  for (let i = 0; i < 5; i++) await rejects(wrong(t1), "INVALID_CREDENTIALS");
  p = await models.StaffPin.findOne({ user: waiter._id }).lean();
  assert.equal(Math.round((p.lockedUntil - t1) / 60e3), 15);
  await models.LocalRateLimit.deleteMany({ _id: /login-fail:device/ });
  const t2 = new Date(t1.getTime() + 16 * 60e3);
  for (let i = 0; i < 5; i++) await rejects(wrong(t2), "INVALID_CREDENTIALS");
  p = await models.StaffPin.findOne({ user: waiter._id }).lean();
  assert.equal(Math.round((p.lockedUntil - t2) / 60e3), 60);
  assert.equal((await events("LOCKOUT")).length, 3);
  await models.LocalRateLimit.deleteMany({ _id: /login-fail:device/ });
  const s = await right(new Date(t2.getTime() + 61 * 60e3));
  assert.equal(s.role, "waiter");
  p = await models.StaffPin.findOne({ user: waiter._id }).lean();
  assert.equal(p.failedCount, 0); assert.equal(p.lockoutCount, 0); assert.equal(p.lockedUntil, null);
});
await test("device throttle: 10 wrong logins on one device (any phones) blocks that device", async () => {
  const dev = await register("Shared tab");
  await approve(admin, dev, ["waiter"]);
  for (let i = 0; i < 10; i++) {
    await rejects(svc.pinLogin({ models, appModels: app, phone: `91234567${String(i).padStart(2, "0")}`, pin: "135790", deviceId: dev.deviceId, deviceSecret: dev.deviceSecret, ip: "192.168.1.70", env: ENV }), "INVALID_CREDENTIALS");
  }
  await rejects(svc.pinLogin({ models, appModels: app, phone: waiter.phone, pin: "305817", deviceId: dev.deviceId, deviceSecret: dev.deviceSecret, ip: "192.168.1.70", env: ENV }), "DEVICE_THROTTLED", 429);
});

console.log("sessions / revocation");
await test("token is refused once expired", async () => {
  const later = new Date(Date.now() + 13 * 3600e3);
  const r = await check(adminSession.token, admin, { now: later });
  assert.equal(r.ok, false); assert.equal(r.body.reason, "SESSION_EXPIRED");
});
await test("new login on the same device replaces the old session", async () => {
  const s2 = await login(admin, "482915", counterDev);
  const old = await check(adminSession.token, admin);
  assert.equal(old.ok, false); assert.equal(old.body.reason, "SESSION_REVOKED");
  adminSession = s2;
  assert.equal((await check(s2.token, admin)).ok, true);
});
await test("non-local token for a PIN role is refused in LOCAL mode; customer token still fine", async () => {
  const otpToken = jwt.sign({ id: String(admin._id), role: "admin" }, ENV.JWT_SECRET);
  const r = await svc.checkLocalToken({ models, decoded: jwt.decode(otpToken), user: admin, localMode: true, path: "/api/orders" });
  assert.equal(r.ok, false); assert.equal(r.body.reason, "DEVICE_LOGIN_REQUIRED");
  const c = await svc.checkLocalToken({ models, decoded: { id: String(customer._id) }, user: customer, localMode: true });
  assert.deepEqual(c, { ok: true, session: null });
});
await test("CLOUD mode: local tokens refused, normal tokens untouched (no DB access)", async () => {
  const r = await svc.checkLocalToken({ models: null, decoded: jwt.decode(adminSession.token), user: admin, localMode: false });
  assert.equal(r.ok, false); assert.equal(r.body.reason, "LOCAL_TOKEN_IN_CLOUD");
  const ok = await svc.checkLocalToken({ models: null, decoded: { id: String(admin._id), role: "admin" }, user: admin, localMode: false });
  assert.deepEqual(ok, { ok: true, session: null });
});
await test("role removed from the device → existing session refused on the next request", async () => {
  await models.StaffDevice.updateOne({ deviceId: counterDev.deviceId }, { $set: { allowedRoles: ["waiter"] } });
  const r = await check(adminSession.token, admin);
  assert.equal(r.ok, false); assert.equal(r.body.reason, "ROLE_NOT_ALLOWED_ON_DEVICE");
  await models.StaffDevice.updateOne({ deviceId: counterDev.deviceId }, { $set: { allowedRoles: ["admin", "manager", "waiter"] } });
});
await test("revoke device: immediate, ends all its sessions, returns sids; can't revoke own device; manager limits", async () => {
  const dev = await register("Lost tablet");
  await approve(admin, dev, ["admin", "waiter"]);
  const s = await login(admin, "482915", dev);
  const d = await models.StaffDevice.findOne({ deviceId: dev.deviceId });
  await rejects(svc.revokeDevice({ models, actor: manager, id: d._id, reason: "lost", ip: IP }), "FORBIDDEN", 403);
  await rejects(svc.revokeDevice({ models, actor: admin, id: d._id, reason: "lost", currentDevice: d._id, ip: IP }), "OWN_DEVICE", 400);
  const out = await svc.revokeDevice({ models, actor: admin, id: d._id, reason: "lost on floor", ip: IP });
  assert.equal(out.device.status, "REVOKED");
  assert.equal(out.revokedSids.length, 1);
  const r = await check(s.token, admin);
  assert.equal(r.ok, false); assert.equal(r.body.reason, "DEVICE_REVOKED");
  await rejects(login(admin, "482915", dev), "DEVICE_REVOKED", 403);
  await rejects(svc.revokeDevice({ models, actor: admin, id: d._id, ip: IP }), "ALREADY_FINAL", 409);
  const ev = (await events("DEVICE_REVOKED")).at(-1);
  assert.equal(ev.reason, "lost on floor"); assert.equal(String(ev.actor.user), String(admin._id));
});
await test("manager can revoke a chef-only device", async () => {
  const d = await models.StaffDevice.findOne({ deviceId: kitchenDev.deviceId });
  const out = await svc.revokeDevice({ models, actor: manager, id: d._id, reason: "replaced", ip: IP });
  assert.equal(out.device.status, "REVOKED");
});
await test("logout ends only that session", async () => {
  const r = await check(adminSession.token, admin);
  const out = await svc.logout({ models, user: admin, localSession: r.session, ip: IP });
  assert.deepEqual(out.revokedSids, [r.session.sid]);
  const after = await check(adminSession.token, admin);
  assert.equal(after.ok, false); assert.equal(after.body.reason, "SESSION_REVOKED");
});

console.log("PIN set / change");
let tempSession;
await test("set temporary PIN: permission rules, weak PIN refused, ends that person's sessions", async () => {
  const waiterDev = await register("Waiter 2");
  await approve(admin, waiterDev, ["waiter", "manager"]);
  const before = await login(waiter, "305817", waiterDev);
  await rejects(svc.setStaffPin({ models, appModels: app, actor: manager, userId: manager._id, pin: "620481", env: ENV }), "OWN_PIN", 400);
  await rejects(svc.setStaffPin({ models, appModels: app, actor: manager, userId: admin._id, pin: "620481", env: ENV }), "FORBIDDEN", 403);
  await rejects(svc.setStaffPin({ models, appModels: app, actor: admin, userId: customer._id, pin: "620481", env: ENV }), "NOT_FOUND", 404);
  await rejects(svc.setStaffPin({ models, appModels: app, actor: manager, userId: waiter._id, pin: "123456", env: ENV }), "WEAK_PIN", 400);
  const out = await svc.setStaffPin({ models, appModels: app, actor: manager, userId: waiter._id, pin: "620481", ip: IP, env: ENV });
  assert.equal(out.mustChange, true);
  assert.ok(out.revokedSids.includes(jwt.decode(before.token).sid), "every session of that person ends");
  assert.equal(await models.LocalSession.countDocuments({ user: waiter._id, revokedAt: null }), 0);
  assert.equal((await check(before.token, waiter)).ok, false);
  tempSession = { dev: waiterDev, s: await login(waiter, "620481", waiterDev) };
  assert.equal(tempSession.s.local.mustChangePin, true);
});
await test("mustChange session: blocked everywhere except change-pin/session/logout", async () => {
  const blocked = await check(tempSession.s.token, waiter, { path: "/api/orders" });
  assert.equal(blocked.ok, false); assert.equal(blocked.status, 403); assert.equal(blocked.body.code, "PIN_CHANGE_REQUIRED");
  const sock = await check(tempSession.s.token, waiter, { path: null });
  assert.equal(sock.ok, false, "socket handshake also blocked");
  assert.equal((await check(tempSession.s.token, waiter, { path: "/api/local/auth/change-pin" })).ok, true);
  assert.equal((await check(tempSession.s.token, waiter, { path: "/api/local/auth/session?x=1" })).ok, true);
});
await test("change own PIN: wrong current / weak / same refused; success clears mustChange, signs out other devices", async () => {
  const other = await login(waiter, "620481", counterDev);
  const sess = (await check(tempSession.s.token, waiter, { path: "/api/local/auth/change-pin" })).session;
  await rejects(svc.changeOwnPin({ models, user: waiter, localSession: sess, currentPin: "999999", newPin: "720593", env: ENV }), "INVALID_CREDENTIALS", 401);
  await rejects(svc.changeOwnPin({ models, user: waiter, localSession: sess, currentPin: "620481", newPin: "222222", env: ENV }), "WEAK_PIN", 400);
  await rejects(svc.changeOwnPin({ models, user: waiter, localSession: sess, currentPin: "620481", newPin: "620481", env: ENV }), "SAME_PIN", 400);
  await rejects(svc.changeOwnPin({ models, user: waiter, localSession: null, currentPin: "620481", newPin: "720593", env: ENV }), "LOCAL_SESSION_REQUIRED", 403);
  const out = await svc.changeOwnPin({ models, user: waiter, localSession: sess, currentPin: "620481", newPin: "720593", ip: IP, env: ENV });
  assert.equal(out.revokedSids.length, 1);
  assert.equal((await check(tempSession.s.token, waiter)).ok, true, "this session now unblocked");
  assert.equal((await check(other.token, waiter)).ok, false, "other device signed out");
  const p = await models.StaffPin.findOne({ user: waiter._id }).lean();
  assert.equal(p.mustChange, false);
  await rejects(login(waiter, "620481", tempSession.dev), "INVALID_CREDENTIALS");
});
await test("5 wrong current PINs during change-pin locks the account and ends all its sessions", async () => {
  await models.StaffPin.updateOne({ user: waiter._id }, { $set: { failedCount: 0, lockoutCount: 0, lockedUntil: null } });
  const sess = (await check(tempSession.s.token, waiter)).session;
  for (let i = 0; i < 5; i++) await rejects(svc.changeOwnPin({ models, user: waiter, localSession: sess, currentPin: "000002", newPin: "720594", env: ENV }), "INVALID_CREDENTIALS");
  const p = await models.StaffPin.findOne({ user: waiter._id }).lean();
  assert.ok(p.lockedUntil > new Date());
  assert.equal((await check(tempSession.s.token, waiter)).ok, false);
});

// ── bootstrap on a fresh database ──────────────────────────────────────────
console.log("first-admin bootstrap");
const conn2 = await mongoose.createConnection(rs.getUri("zen_localauth_fresh")).asPromise();
const app2 = getModels(conn2), models2 = getLocalAuthModels(conn2);
await Promise.all([...Object.values(models2), app2.User, app2.RestaurantProfile].map((m) => m.init()));
const body = (code, over = {}) => ({
  setupCode: code, siteId: "test-site",
  restaurant: { name: "Fresh Cafe", phone: "9800000000", address: "MG Road" },
  admin: { name: "First Admin", phone: "9800000001", pin: "571938" },
  device: { label: "Counter PC", platform: "test" }, ...over,
});
const boot = (b) => svc.bootstrapFirstAdmin({ models: models2, appModels: app2, db: conn2, body: b, ip: "127.0.0.1", env: ENV });
let setup;
await test("no admin → a setup code is minted (only its hash stored)", async () => {
  assert.deepEqual(await svc.bootstrapStatus({ models: models2, appModels: app2 }), { needsBootstrap: true });
  setup = await svc.prepareBootstrap({ models: models2, appModels: app2 });
  assert.equal(setup.needed, true);
  assert.match(setup.code, /^[A-Z2-9]{12}$/);
  const st = await models2.LocalSetupState.findById("bootstrap").select("+codeHash").lean();
  assert.notEqual(st.codeHash, setup.code);
});
await test("wrong code, wrong site id, weak PIN are refused; nothing created", async () => {
  await rejects(boot(body("AAAAAAAAAAAA")), "INVALID_SETUP_CODE", 401);
  await rejects(boot(body(setup.code, { siteId: "other-site" })), "INVALID_SETUP", 400);
  await rejects(boot(body(setup.code, { admin: { name: "First Admin", phone: "9800000001", pin: "111111" } })), "INVALID_SETUP", 400);
  await rejects(svc.bootstrapFirstAdmin({ models: models2, appModels: app2, db: conn2, body: body(setup.code), ip: "127.0.0.1", env: { ...ENV, LOCAL_SITE_ID: "" } }), "SITE_NOT_CONFIGURED", 503);
  assert.equal(await app2.User.countDocuments(), 0);
});
await test("valid setup: profile + admin + PIN + approved device + session in one go; dashed code accepted", async () => {
  const dashed = setup.code.match(/.{1,4}/g).join("-").toLowerCase();
  const out = await boot(body(dashed));
  assert.equal(out.device.status, "APPROVED");
  assert.match(out.device.deviceSecret, /^[0-9a-f]{64}$/);
  assert.equal(out.session.role, "admin");
  const adminDoc = await app2.User.findOne({ phone: "9800000001" }).lean();
  assert.equal(adminDoc.isAdmin, true);
  assert.equal((await app2.RestaurantProfile.findOne().lean()).restaurantName, "Fresh Cafe");
  const r = await svc.checkLocalToken({ models: models2, decoded: jwt.verify(out.session.token, ENV.JWT_SECRET), user: adminDoc, localMode: true, path: "/api/orders" });
  assert.equal(r.ok, true);
  const relog = await svc.pinLogin({ models: models2, appModels: app2, phone: "9800000001", pin: "571938", deviceId: out.device.deviceId, deviceSecret: out.device.deviceSecret, ip: "127.0.0.1", env: ENV });
  assert.equal(relog.role, "admin");
  assert.equal((await models2.LocalAuthEvent.find({ type: "BOOTSTRAP" })).length, 1);
});
await test("second bootstrap is refused; setup stays closed after restart", async () => {
  await rejects(boot(body(setup.code)), "ALREADY_BOOTSTRAPPED", 409);
  assert.deepEqual(await svc.prepareBootstrap({ models: models2, appModels: app2 }), { needed: false });
  assert.deepEqual(await svc.bootstrapStatus({ models: models2, appModels: app2 }), { needsBootstrap: false });
  assert.equal(await app2.User.countDocuments({ isAdmin: true }), 1);
});
await test("concurrent bootstraps on a fresh DB: exactly one wins", async () => {
  const conn3 = await mongoose.createConnection(rs.getUri("zen_localauth_race")).asPromise();
  const app3 = getModels(conn3), models3 = getLocalAuthModels(conn3);
  await Promise.all([...Object.values(models3), app3.User, app3.RestaurantProfile].map((m) => m.init()));
  const s = await svc.prepareBootstrap({ models: models3, appModels: app3 });
  const results = await Promise.allSettled([0, 1, 2].map((i) => svc.bootstrapFirstAdmin({
    models: models3, appModels: app3, db: conn3, ip: "127.0.0.1", env: ENV,
    body: body(s.code, { admin: { name: `Admin ${i}`, phone: `980000001${i}`, pin: "571938" } }),
  })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, JSON.stringify(results.map((r) => r.reason?.code || "ok")));
  assert.equal(await app3.User.countDocuments({ isAdmin: true }), 1);
  await conn3.close();
});
await test("bootstrap code expires", async () => {
  const conn4 = await mongoose.createConnection(rs.getUri("zen_localauth_exp")).asPromise();
  const app4 = getModels(conn4), models4 = getLocalAuthModels(conn4);
  await Promise.all([...Object.values(models4), app4.User, app4.RestaurantProfile].map((m) => m.init()));
  const s = await svc.prepareBootstrap({ models: models4, appModels: app4, now: new Date(Date.now() - 3 * 3600e3) });
  await rejects(svc.bootstrapFirstAdmin({ models: models4, appModels: app4, db: conn4, body: body(s.code), ip: "127.0.0.1", env: ENV }), "SETUP_CODE_EXPIRED", 410);
  await conn4.close();
});

await conn.close(); await conn2.close();
try { await rs.stop(); } catch (err) { console.error(`  (mongod cleanup: ${err.message})`); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
