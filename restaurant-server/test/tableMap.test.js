// test/tableMap.test.js — Table Management → Admin + Waiter Table Map.
// Runs the REAL table controller (create / update / delete / list) against an
// in-memory Table collection, then groups the result with the REAL frontend
// helper both maps use (admin/src/pages/admin/shared/diningArea.js; the
// waiter's copy is checked to be identical). No DB, no network.
// Table numbers are PER AREA (Indoor 1–10, Indoor-AC 1–6, Garden 1–5,
// Gazebo 1–3); each table keeps its own unique internal tableNo.
//   node test/tableMap.test.js
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

process.env.CUSTOMER_FRONTEND_URL = process.env.CUSTOMER_FRONTEND_URL || "https://order.example.com";
const { createTable, updateTable, deleteTable, getTables } = await import("../controllers/tableController.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_HELPER = path.join(here, "../../admin/src/pages/admin/shared/diningArea.js");
const WAITER_HELPER = path.join(here, "../../waiter/src/utils/diningArea.js");
const { groupTablesByArea } = await import(pathToFileURL(ADMIN_HELPER).href);

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};

// ── in-memory models ────────────────────────────────────────────────────────
const world = () => {
  const tables = [], sessions = [], orders = [];
  const lean = (v) => ({ lean: async () => v, select: () => ({ lean: async () => v }) });
  const Table = {
    rows: tables,
    find: (q = {}) => {
      const match = (t) => !q.diningArea || (q.diningArea.$in ? q.diningArea.$in.includes(t.diningArea ?? null) : t.diningArea === q.diningArea);
      const rows = () => tables.filter(match).map((t) => ({ ...t }));
      return { sort: () => ({ lean: async () => rows() }), select: () => ({ lean: async () => rows() }) };
    },
    findOne: (q) => {
      const t = q ? tables.find((x) => Number(x.tableNo) === Number(q.tableNo)) || null
        : [...tables].sort((a, b) => b.tableNo - a.tableNo)[0] || null; // findOne().sort({ tableNo: -1 })
      const p = Promise.resolve(t);
      p.select = () => lean(t);
      p.sort = () => ({ select: () => lean(t) });
      return p;
    },
    create: async (doc) => {
      if (tables.some((x) => x.tableNo === doc.tableNo)) { const e = new Error("dup"); e.code = 11000; throw e; }
      const t = { _id: `t${doc.tableNo}`, status: "Active", occupancyStatus: "AVAILABLE", ...doc };
      tables.push(t);
      return t;
    },
    findOneAndUpdate: async (q, u) => {
      const t = tables.find((x) => Number(x.tableNo) === Number(q.tableNo));
      if (!t) return null;
      Object.assign(t, u.$set || u);
      return { ...t };
    },
    findOneAndDelete: async (q) => {
      const i = tables.findIndex((x) => Number(x.tableNo) === Number(q.tableNo));
      return i < 0 ? null : tables.splice(i, 1)[0];
    },
  };
  const TableSession = { findOne: (q) => lean(sessions.find((s) => s.tableNo === q.tableNo && s.status === q.status) || null) };
  const Order = { findOne: (q) => lean(orders.find((o) => o.tableNo === q.tableNo && q.status.$in.includes(o.status)) || null) };
  return { models: { Table, TableSession, Order }, sessions, orders };
};
const call = async (fn, models, { body = {}, params = {}, user = { isAdmin: true } } = {}) => {
  let status = 200, json;
  await fn({ models, body, params, user }, { status(c) { status = c; return this; }, json(j) { json = j; return this; } });
  return { status, json };
};
const list = async (models, user) => (await call(getTables, models, { user })).json.tables;
// Exactly what each map renders: active tables, grouped as the server ordered them.
const ADMIN_MAP = (tables) => groupTablesByArea(tables.filter((t) => (t.status || "Active") === "Active"));
const WAITER_MAP = (tables) => groupTablesByArea(tables.filter((t) => t.status !== "Inactive"));
const view = (groups) => groups.map((g) => `${g.area || "Indoor"}: ${g.tables.map((t) => t.displayNo).join(" ")}`);
const ADMIN = { isAdmin: true }, WAITER = { role: "waiter" };
const byName = async (name) => (await list(w.models, ADMIN)).find((t) => t.tableName === name);

await test("admin + waiter use the same grouping code (identical helper)", () => {
  const fnSrc = (f) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n").match(/export const groupTablesByArea[\s\S]*?\n};/)[0];
  assert.equal(fnSrc(ADMIN_HELPER), fnSrc(WAITER_HELPER));
});

const w = world();
const add = (area, no) => call(createTable, w.models, { body: { diningArea: area, displayNo: no, seats: 4 } });

await test("YOUR SETUP: Indoor 1-10, Indoor-AC 1-6, Garden 1-5, Gazebo 1-3 (same numbers in different areas)", async () => {
  for (let n = 1; n <= 10; n++) assert.equal((await add("", n)).status, 201, `Indoor ${n}`);
  for (let n = 1; n <= 6; n++) assert.equal((await add("AC_ROOM", n)).status, 201, `Indoor-AC ${n}`);
  for (let n = 1; n <= 5; n++) assert.equal((await add("GARDEN", n)).status, 201, `Garden ${n}`);
  for (let n = 1; n <= 3; n++) assert.equal((await add("GAZEBO", n)).status, 201, `Gazebo ${n}`);
  const expect = ["Indoor: 1 2 3 4 5 6 7 8 9 10", "AC_ROOM: 1 2 3 4 5 6", "GARDEN: 1 2 3 4 5", "GAZEBO: 1 2 3"];
  assert.deepEqual(view(ADMIN_MAP(await list(w.models, ADMIN))), expect);
  assert.deepEqual(view(WAITER_MAP(await list(w.models, WAITER))), expect);
});

await test("names people see: Indoor 3, Indoor-AC 1, Garden 5, Gazebo 2", async () => {
  const names = (await list(w.models, WAITER)).map((t) => t.tableName);
  for (const n of ["Indoor 3", "Indoor-AC 1", "Garden 5", "Gazebo 2"]) assert.ok(names.includes(n), n);
});

await test("every table still has its own unique internal number (orders / QR / sessions key)", async () => {
  const all = await list(w.models, ADMIN);
  assert.equal(all.length, 24);
  assert.equal(new Set(all.map((t) => t.tableNo)).size, 24);
  assert.equal((await byName("Indoor 4")).tableNo, 4, "Indoor keeps 'number = internal number' where it can");
});

await test("a duplicate number in the SAME area is refused; another area is fine", async () => {
  const dup = await add("AC_ROOM", 1);
  assert.equal(dup.status, 400);
  assert.match(dup.json.message, /Indoor-AC 1 already exists/);
  assert.equal((await add("AC_ROOM", 7)).status, 201, "Indoor-AC 7 is new");
  assert.equal((await add("Rooftop", 1)).status, 400, "unknown area refused");
});

await test("admin adds Garden 6 -> it shows at the end of Garden on both maps", async () => {
  await add("GARDEN", 6);
  assert.equal(view(WAITER_MAP(await list(w.models, WAITER)))[2], "GARDEN: 1 2 3 4 5 6");
  assert.equal(view(ADMIN_MAP(await list(w.models, ADMIN)))[2], "GARDEN: 1 2 3 4 5 6");
});

await test("move Garden 6 -> Gazebo 4 works (internal number kept); onto a taken number is refused", async () => {
  const g6 = await byName("Garden 6");
  assert.equal((await call(updateTable, w.models, { params: { tableNo: String(g6.tableNo) }, body: { diningArea: "GAZEBO", displayNo: 4 } })).status, 200);
  const moved = (await list(w.models, ADMIN)).find((t) => t.tableNo === g6.tableNo);
  assert.equal(moved.tableName, "Gazebo 4");
  const taken = await call(updateTable, w.models, { params: { tableNo: String(g6.tableNo) }, body: { displayNo: 1 } });
  assert.equal(taken.status, 400);
  assert.match(taken.json.message, /Gazebo 1 already exists/);
});

await test("disable Indoor 3 -> gone from both active maps; enable -> back", async () => {
  const i3 = await byName("Indoor 3");
  await call(updateTable, w.models, { params: { tableNo: String(i3.tableNo) }, body: { status: "Inactive" } });
  assert.equal(view(WAITER_MAP(await list(w.models, WAITER)))[0], "Indoor: 1 2 4 5 6 7 8 9 10");
  assert.equal(view(ADMIN_MAP(await list(w.models, ADMIN)))[0], "Indoor: 1 2 4 5 6 7 8 9 10");
  await call(updateTable, w.models, { params: { tableNo: String(i3.tableNo) }, body: { status: "Active" } });
  assert.equal(view(WAITER_MAP(await list(w.models, WAITER)))[0], "Indoor: 1 2 3 4 5 6 7 8 9 10");
});

await test("order on Indoor-AC 1 -> occupied on both maps; can't be disabled/deleted; clear -> free", async () => {
  const ac1 = await byName("Indoor-AC 1");
  w.sessions.push({ tableNo: ac1.tableNo, status: "OPEN" });
  w.orders.push({ tableNo: ac1.tableNo, status: "PREPARING" });
  w.models.Table.rows.find((t) => t.tableNo === ac1.tableNo).occupancyStatus = "OCCUPIED";
  assert.deepEqual((await list(w.models, WAITER)).filter((t) => t.occupancyStatus === "OCCUPIED").map((t) => t.tableName), ["Indoor-AC 1"]);
  assert.deepEqual((await list(w.models, ADMIN)).filter((t) => t.occupancyStatus === "OCCUPIED").map((t) => t.tableName), ["Indoor-AC 1"]);
  assert.equal((await call(updateTable, w.models, { params: { tableNo: String(ac1.tableNo) }, body: { status: "Inactive" } })).status, 409);
  assert.equal((await call(deleteTable, w.models, { params: { tableNo: String(ac1.tableNo) } })).status, 409);
  w.sessions.length = 0;
  w.orders[0].status = "COMPLETED";
  w.models.Table.rows.find((t) => t.tableNo === ac1.tableNo).occupancyStatus = "AVAILABLE";
  assert.deepEqual((await list(w.models, ADMIN)).filter((t) => t.occupancyStatus === "OCCUPIED"), []);
});

await test("older tables (no per-area number) keep their number: internal 15 = Indoor 15", async () => {
  w.models.Table.rows.push({ _id: "old", tableNo: 15, status: "Active", occupancyStatus: "AVAILABLE" }); // pre-existing doc
  const old = (await list(w.models, ADMIN)).find((t) => t.tableNo === 15);
  assert.equal(old.tableName, "Indoor 15");
  assert.equal((await add("", 15)).status, 400, "Indoor 15 already exists");
});

await test("reload: admin and waiter get identical maps every time", async () => {
  const a = view(ADMIN_MAP(await list(w.models, ADMIN)));
  assert.deepEqual(a, view(WAITER_MAP(await list(w.models, WAITER))));
  assert.deepEqual(a, view(ADMIN_MAP(await list(w.models, ADMIN))));
});

await test("customers / guests get names but never the QR token", async () => {
  const pub = await list(w.models, null);
  assert.ok(pub.every((t) => !("qrToken" in t) && "tableName" in t));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
