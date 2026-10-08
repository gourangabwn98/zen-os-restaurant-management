// test/managerRole.test.js — the "manager" role: admin app limited to Orders,
// Invoices, Tables, Inventory, Employees, Menu, Help. No DB — fakes.
//   node test/managerRole.test.js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const { requireAdmin, requireStaff, requireManagement, requireEmployee, requireKitchen } = await import("../middleware/rbac.js");
const { guardManagerTarget, guardManagerLeave } = await import("../middleware/managerScope.js");
const { validateTransition, canSetPaymentStatus } = await import("../utils/orderStateMachine.js");
const { getSourceFromUser, buildActor } = await import("../services/orderService.js");
const { employeeRolesFor, createEmployee, EMPLOYEE_ROLES } = await import("../services/employeeService.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.stack || err.message}`); }
};

const MANAGER = { _id: "m1", name: "Rina", role: "manager", status: "Active" };
const ADMIN = { _id: "a1", name: "Owner", role: "admin", isAdmin: true, status: "Active" };
const WAITER = { _id: "w1", name: "Sam", role: "waiter", status: "Active" };

/** Runs one middleware → "next" | the HTTP status it answered with. */
const run = async (mw, req, ...extra) => {
  let out = null;
  const res = { status: (c) => { out = c; return res; }, json: () => res };
  await mw(req, res, () => { out = "next"; }, ...extra);
  return out;
};

await test("RBAC: manager is staff + management, never admin-only or kitchen", async () => {
  assert.equal(await run(requireStaff, { user: MANAGER }), "next");
  assert.equal(await run(requireManagement, { user: MANAGER }), "next");
  assert.equal(await run(requireEmployee, { user: MANAGER }), "next");
  assert.equal(await run(requireAdmin, { user: MANAGER }), 403);
  assert.equal(await run(requireKitchen, { user: MANAGER }), 403);
  assert.equal(await run(requireManagement, { user: WAITER }), 403);
  assert.equal(await run(requireManagement, { user: ADMIN }), "next");
  assert.equal(await run(requireManagement, { user: { ...MANAGER, status: "Inactive" } }), 403);
});

await test("routes: the manager's areas use requireManagement; settings/insights/users/offers stay admin-only", () => {
  const src = (f) => readFileSync(new URL(`../routes/${f}`, import.meta.url), "utf8");
  for (const f of ["tableRoutes.js", "inventoryRoutes.js", "menuRoutes.js", "catagoryRoutes.js"]) {
    assert.doesNotMatch(src(f).replace(/^import.*$/gm, ""), /requireAdmin/, `${f} still has an admin-only route`);
  }
  const admin = src("adminRoutes.js");
  for (const r of ["/insights/sales", "/insights/overview", "/users"]) assert.match(admin, new RegExp(`"${r}",\\s*requireAdmin`));
  assert.match(admin, /"\/attendance\/today",\s*requireManagement/);
  assert.match(src("employeeRoutes.js"), /"\/hr\/policy",\s*requireAdmin/);
  assert.doesNotMatch(src("couponRoutes.js"), /requireManagement/);
  assert.doesNotMatch(src("profileRoutes.js"), /requireManagement/);
  assert.doesNotMatch(src("notificationRoutes.js"), /requireManagement/);
  assert.doesNotMatch(src("printerRoutes.js"), /requireManagement/);
});

await test("orders: manager confirms / voids / completes like admin, but has no any-status override", () => {
  assert.equal(validateTransition("PENDING_CONFIRMATION", "CONFIRMED", "manager").ok, true);
  assert.equal(validateTransition("PREPARING", "CANCELLED", "manager").ok, true);
  assert.equal(validateTransition("DELIVERED", "COMPLETED", "manager").ok, true);
  assert.equal(validateTransition("CANCELLED", "CONFIRMED", "manager").ok, false, "admin-only override");
  assert.equal(validateTransition("CANCELLED", "CONFIRMED", "admin").ok, true);
  assert.equal(canSetPaymentStatus("PAID", "manager"), true);
  assert.equal(canSetPaymentStatus("PENDING_VERIFICATION", "manager"), false, "undoing Paid stays admin-only");
});

await test("orders: a manager's order is a staff order (source ADMIN) and the actor keeps their name", () => {
  assert.equal(getSourceFromUser(MANAGER), "ADMIN");
  assert.deepEqual(buildActor(MANAGER), { id: "m1", role: "ADMIN", name: "Rina" });
});

await test("employees: admin can create a manager; a manager can't", async () => {
  assert.ok(EMPLOYEE_ROLES.includes("manager"));
  assert.ok(employeeRolesFor(ADMIN).includes("manager"));
  assert.deepEqual(employeeRolesFor(MANAGER), ["waiter", "chef", "staff"]);
  const User = { findOne: async () => null, create: async (d) => d };
  const made = await createEmployee({ User, name: "Rina", phone: "9876543210", role: "manager", roles: employeeRolesFor(ADMIN) });
  assert.equal(made.role, "manager");
  assert.equal(made.isAdmin, false);
  await assert.rejects(createEmployee({ User, name: "X", phone: "9876543211", role: "manager", roles: employeeRolesFor(MANAGER) }), (e) => e.statusCode === 400);
});

await test("employees: a manager may act on waiters/chefs, never on a manager or the admin", async () => {
  const people = { w1: { role: "waiter" }, m2: { role: "manager" }, m1: { role: "manager" }, a1: { role: "admin", isAdmin: true } };
  const models = {
    User: { findById: (id) => ({ select: () => ({ lean: async () => people[id] || null }) }) },
    StaffLeave: { findById: (id) => ({ select: () => ({ lean: async () => ({ l1: { employee: "w1" }, l2: { employee: "m2" } })[id] || null }) }) },
  };
  const req = (user, path = "/x") => ({ user, models, path });
  assert.equal(await run(guardManagerTarget, req(MANAGER), "w1"), "next");
  assert.equal(await run(guardManagerTarget, req(MANAGER), "m2"), 403);
  assert.equal(await run(guardManagerTarget, req(MANAGER), "m1"), 403, "not even their own pay/role");
  assert.equal(await run(guardManagerTarget, req(MANAGER), "a1"), 403);
  assert.equal(await run(guardManagerTarget, req(MANAGER), "nope"), "next", "unknown id → the route's own 404");
  assert.equal(await run(guardManagerTarget, req(ADMIN), "m2"), "next");
  assert.equal(await run(guardManagerLeave, req(MANAGER), "l1"), "next");
  assert.equal(await run(guardManagerLeave, req(MANAGER), "l2"), 403);
  assert.equal(await run(guardManagerLeave, req(MANAGER, "/me/leave/l2/cancel"), "l2"), "next", "own self-service");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
