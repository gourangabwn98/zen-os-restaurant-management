import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { inventoryV3Schemas, getInventoryV3Models } from "../config/inventoryV3Models.js";
import { capabilitiesView, settingsView, validateSettingsPatch, updateV3Settings, serverEnabled } from "../services/inventoryV3SettingsService.js";
import { getCapabilities, getSettings, patchSettings } from "../controllers/inventoryV3Controller.js";
import { requireAdmin, requireStaff } from "../middleware/rbac.js";
import { parseSetupArgs, setupStorage } from "../scripts/setup-inventory-v3.js";

const conn = mongoose.createConnection(); // Never opens a socket.
const models = getInventoryV3Models(conn);
const userId = new mongoose.Types.ObjectId();
const actor = { user: userId, name: "Test owner", role: "admin" };
const response = () => ({ code: 200, headers: {}, body: null,
  set(k, v) { this.headers[k] = v; return this; }, status(v) { this.code = v; return this; }, json(v) { this.body = v; return this; } });

test("companion schemas never auto-create collections or indexes", () => {
  for (const schema of Object.values(inventoryV3Schemas)) {
    assert.equal(schema.options.autoCreate, false);
    assert.equal(schema.options.autoIndex, false);
    assert.equal(schema.options.strict, "throw");
  }
  assert.equal(conn.readyState, 0);
  assert.equal(getInventoryV3Models(conn).InventoryV3Settings, models.InventoryV3Settings);
  assert.throws(() => getInventoryV3Models(null));
});
test("missing settings defaults off with no claimed storage readiness", async () => {
  assert.deepEqual(settingsView(null), { enabled: false, foodCostTargetBps: 3500, countIntervalDays: 4, autoOrderMode: "OFF", revision: 0, storageReady: false });
  const doc = new models.InventoryV3Settings();
  assert.equal(doc.enabled, false);
  assert.equal(doc.storageVersion, 0);
  assert.equal(doc.autoOrderMode, "OFF");
  await doc.validate();
});
test("runtime and backend switches plus storage version are all required", () => {
  const record = { storageVersion: 1, enabled: true };
  assert.equal(capabilitiesView({ record, backendEnabled: true }).enabled, true);
  assert.equal(capabilitiesView({ record, backendEnabled: false }).enabled, false);
  assert.equal(capabilitiesView({ record: { ...record, storageVersion: 0 }, backendEnabled: true }).enabled, false);
  assert.equal(capabilitiesView({ record: { ...record, enabled: false }, backendEnabled: true }).enabled, false);
  const manager = capabilitiesView({ record, backendEnabled: true, role: "manager" });
  assert.equal(manager.permissions.viewFinancials, false);
  assert.equal(manager.permissions.manageSettings, false);
  assert.equal(manager.features.stock, true);
  assert.equal(manager.features.financialEntries, false);
  const disabled = capabilitiesView({ record: { ...record, enabled: false }, backendEnabled: true, role: "admin" });
  assert.ok(Object.values(disabled.features).every((v) => v === false));
});
test("backend environment defaults off and only literal true enables it", () => {
  const previous = process.env.INVENTORY_V3_ENABLED;
  try {
    delete process.env.INVENTORY_V3_ENABLED;
    assert.equal(serverEnabled(), false);
    for (const value of ["false", "1", "TRUE", "true "]) { process.env.INVENTORY_V3_ENABLED = value; assert.equal(serverEnabled(), false); }
    process.env.INVENTORY_V3_ENABLED = "true";
    assert.equal(serverEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.INVENTORY_V3_ENABLED; else process.env.INVENTORY_V3_ENABLED = previous;
  }
});
test("settings validation rejects coercion, injected keys and readonly storage state", () => {
  for (const body of [null, [], { revision: 0, enabled: "false" }, { revision: 0, storageVersion: 1 }, { revision: 0, foodCostTargetBps: 0 }, { revision: 0, countIntervalDays: 1.5 }, { revision: 0, autoOrderMode: "SEND_LINK" }, { revision: 0 }, { enabled: true }, { revision: 0, $set: { enabled: true } }]) assert.throws(() => validateSettingsPatch(body));
  assert.deepEqual(validateSettingsPatch({ revision: 2, enabled: false, foodCostTargetBps: 3500 }), { enabled: false, foodCostTargetBps: 3500 });
});
test("settings updates compare revision, never upsert, and permit disabling with backend off", async () => {
  let call;
  const Settings = { findOneAndUpdate: async (...args) => { call = args; return { ...args[1].$set, storageVersion: 1, revision: 3 }; } };
  const result = await updateV3Settings({ Settings, body: { revision: 2, enabled: false }, actor, backendEnabled: false });
  assert.deepEqual(call[0], { _id: "default", storageVersion: 1, revision: 2 });
  assert.equal(call[2].upsert, undefined);
  assert.equal(call[2].runValidators, true);
  assert.equal(result.enabled, false);
  assert.equal(result.revision, 3);
  await assert.rejects(() => updateV3Settings({ Settings, body: { revision: 2, enabled: true }, actor, backendEnabled: false }), { statusCode: 409 });
  await assert.rejects(() => updateV3Settings({ Settings: { findOneAndUpdate: async () => null }, body: { revision: 0, enabled: false }, actor, backendEnabled: true }), { statusCode: 409 });
});
test("capabilities with backend off does not touch the database", async () => {
  const previous = process.env.INVENTORY_V3_ENABLED;
  process.env.INVENTORY_V3_ENABLED = "false";
  try {
    const res = response();
    await getCapabilities({ user: { role: "manager" }, get db() { throw new Error("DB accessed"); } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.enabled, false);
    assert.equal(res.headers["Cache-Control"], "no-store");
  } finally {
    if (previous === undefined) delete process.env.INVENTORY_V3_ENABLED; else process.env.INVENTORY_V3_ENABLED = previous;
  }
});
const fakeConnection = (Settings) => ({ models: { ...models, InventoryV3Settings: Settings } });
test("capabilities fails closed on unavailable settings and does not leak driver details", async () => {
  const previous = process.env.INVENTORY_V3_ENABLED;
  process.env.INVENTORY_V3_ENABLED = "true";
  try {
    const res = response();
    await getCapabilities({ user: { role: "admin" }, db: fakeConnection({ findById: () => ({ lean: async () => { throw new Error("secret URI"); } }) }) }, res);
    assert.equal(res.code, 503);
    assert.equal(res.body.enabled, false);
    assert.doesNotMatch(JSON.stringify(res.body), /secret/);
  } finally {
    if (previous === undefined) delete process.env.INVENTORY_V3_ENABLED; else process.env.INVENTORY_V3_ENABLED = previous;
  }
});
test("settings handler exposes a fixed DTO, not internal model fields", async () => {
  const res = response();
  await getSettings({ db: fakeConnection({ findById: () => ({ lean: async () => ({ enabled: false, storageVersion: 1, unknownPrivateField: "secret" }) }) }) }, res);
  assert.equal(res.body.settings.storageReady, true);
  assert.equal(res.body.settings.unknownPrivateField, undefined);
});
test("settings handler returns stale-write conflict without changing legacy models", async () => {
  const res = response();
  await patchSettings({ db: fakeConnection({ findOneAndUpdate: async () => null }), body: { revision: 0, enabled: false }, user: { _id: userId, role: "admin" } }, res);
  assert.equal(res.code, 409);
});
test("existing RBAC permits staff capabilities and keeps settings admin-only", () => {
  for (const role of ["manager", "waiter", "chef", "customer"]) {
    const res = response(); let next = false;
    requireAdmin({ user: { role, status: "Active" } }, res, () => { next = true; });
    assert.equal(next, false); assert.equal(res.code, 403);
  }
  let allowed = false;
  requireStaff({ user: { role: "manager", status: "Active" } }, response(), () => { allowed = true; });
  assert.equal(allowed, true);
  const inactive = response();
  requireAdmin({ user: { role: "admin", status: "Inactive" } }, inactive, () => assert.fail("inactive access"));
  assert.equal(inactive.code, 403);
});
test("financial entries require safe amounts and valid effective dates", async () => {
  const valid = { requestKey: "test-entry-01", treatment: "OPERATING_EXPENSE", category: "electricity", amountPaise: 420000, effectiveDate: "2026-10-24", occurredAt: new Date(), paymentSource: "CASH_DRAWER", createdBy: actor };
  await new models.InventoryFinancialEntry(valid).validate();
  for (const bad of [{ amountPaise: -1 }, { amountPaise: 1.2 }, { amountPaise: Number.MAX_SAFE_INTEGER + 1 }, { effectiveDate: "2026-02-30" }, { paymentSource: "OTHER" }, { treatment: "FAKE" }]) {
    await assert.rejects(() => new models.InventoryFinancialEntry({ ...valid, ...bad }).validate());
  }
  assert.throws(() => new models.InventoryFinancialEntry({ ...valid, legacyTotalCost: 12 }), /strict/i);
});
test("counts cannot claim approval without submission, actor and time", async () => {
  const line = { inventoryItem: new mongoose.Types.ObjectId(), unit: "kg", countedQty: "9.5", expectedQty: "10", observedAt: new Date() };
  const valid = { requestKey: "count-req-01", countedBy: actor, lines: [line] };
  await new models.InventoryCountSession(valid).validate();
  await assert.rejects(() => new models.InventoryCountSession({ ...valid, status: "APPROVED" }).validate());
  await new models.InventoryCountSession({ ...valid, status: "APPROVED", submittedAt: new Date(), approvedAt: new Date(), approvedBy: actor }).validate();
  await assert.rejects(() => new models.InventoryCountSession({ ...valid, lines: [line, line] }).validate());
  await assert.rejects(() => new models.InventoryCountSession({ ...valid, lines: [{ ...line, countedQty: "-1" }] }).validate());
});
test("cost schedules and recurrence enforce bounded, valid periods", async () => {
  const valid = { financialEntry: new mongoose.Types.ObjectId(), treatment: "DEPRECIATION", basisPaise: 3000000, periods: 60, startsOn: "2026-10-01", createdBy: actor };
  await new models.InventoryCostSchedule(valid).validate();
  await assert.rejects(() => new models.InventoryCostSchedule({ ...valid, periods: undefined }).validate());
  await assert.rejects(() => new models.InventoryCostSchedule({ ...valid, residualPaise: 3000001 }).validate());
  const recurring = { ruleKey: "rent", treatment: "OPERATING_EXPENSE", category: "rent", amountPaise: 1000, effectiveFrom: "2026-10-01", createdBy: actor };
  await new models.InventoryRecurringRule(recurring).validate();
  await assert.rejects(() => new models.InventoryRecurringRule({ ...recurring, effectiveTo: "2026-09-01" }).validate());
});
test("manual setup defaults dry-run and rejects ambiguous/unknown arguments", () => {
  assert.deepEqual(parseSetupArgs(["--database", "inventory_v3_test"]), { database: "inventory_v3_test", apply: false, help: false });
  assert.equal(parseSetupArgs(["--apply", "--database", "inventory_v3_test"]).apply, true);
  assert.throws(() => parseSetupArgs(["--apply", "--dry-run"]));
  assert.throws(() => parseSetupArgs(["--database"]));
  assert.throws(() => parseSetupArgs(["--drop"]));
});

const storageFake = (record = null) => {
  const state = { record, collections: new Set(), indexes: new Set(), writes: 0 };
  const fakeModels = Object.fromEntries(Object.entries(models).map(([name, Model]) => [name, { collection: { collectionName: Model.collection.collectionName }, schema: Model.schema }]));
  fakeModels.InventoryV3Settings.findById = () => ({ lean: async () => state.record });
  fakeModels.InventoryV3Settings.updateOne = async (_query, update) => { state.writes++; state.record = { ...(state.record || {}), ...update.$setOnInsert, ...update.$set }; };
  const db = {
    listCollections: ({ name }) => ({ hasNext: async () => state.collections.has(name) }),
    createCollection: async (name) => { state.writes++; state.collections.add(name); },
    collection: (name) => ({ createIndex: async (_keys, options) => { state.indexes.add(`${name}:${options.name}`); } }),
  };
  return { conn: { models: fakeModels, db }, state };
};
test("setup dry-run performs no writes even with missing collections", async () => {
  const fake = storageFake();
  await setupStorage({ conn: fake.conn, log: () => {} });
  assert.equal(fake.state.writes, 0);
  assert.equal(fake.state.collections.size, 0);
  assert.equal(fake.state.indexes.size, 0);
});
test("manual setup is repeatable and never resets an enabled runtime setting", async () => {
  const fake = storageFake();
  await setupStorage({ conn: fake.conn, apply: true, log: () => {} });
  assert.equal(fake.state.record.enabled, false);
  assert.equal(fake.state.record.storageVersion, 1);
  const writes = fake.state.writes, indexes = fake.state.indexes.size;
  fake.state.record.enabled = true;
  await setupStorage({ conn: fake.conn, apply: true, log: () => {} });
  assert.equal(fake.state.writes, writes);
  assert.equal(fake.state.indexes.size, indexes);
  assert.equal(fake.state.record.enabled, true);
});
test("setup refuses to downgrade a newer storage version", async () => {
  const fake = storageFake({ storageVersion: 2 });
  await assert.rejects(() => setupStorage({ conn: fake.conn, apply: true, log: () => {} }), /newer/);
  assert.equal(fake.state.writes, 0);
});
