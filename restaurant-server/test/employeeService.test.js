// test/employeeService.test.js
import assert from "node:assert/strict";
import {
  createEmployee, updateEmployee, setEmployeeStatus, validateEmployeeInput,
} from "../services/employeeService.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.message}`); }
};

const makeFakeUserModel = (seed = []) => {
  const docs = new Map(seed.map((d) => [String(d._id), { ...d }]));
  let seq = docs.size;
  return {
    findOne: async (query) => {
      for (const d of docs.values()) {
        if (query.phone && d.phone !== query.phone) continue;
        if (query.status?.$ne && d.status === query.status.$ne) continue;
        if (query._id && String(query._id) !== String(d._id)) continue;
        if (query.role?.$in && !query.role.$in.includes(d.role)) continue;
        return { ...d, save: async function () { docs.set(String(this._id), { ...this }); } };
      }
      return null;
    },
    findOneAndUpdate: async (query, update) => {
      for (const d of docs.values()) {
        if (String(query._id) !== String(d._id)) continue;
        if (query.role?.$in && !query.role.$in.includes(d.role)) continue;
        Object.assign(d, update.$set);
        return { ...d };
      }
      return null;
    },
    create: async (data) => {
      const _id = String(++seq);
      const doc = { _id, ...data };
      docs.set(_id, doc);
      return doc;
    },
  };
};

const run = async () => {
  console.log("── Employee Management ─────────────────────────────────────");

  await test("rejects an invalid phone number", () => {
    assert.throws(() => validateEmployeeInput({ name: "Rahul", phone: "123", role: "waiter" }), /valid 10-digit/);
  });

  await test("rejects an empty name", () => {
    assert.throws(() => validateEmployeeInput({ name: "  ", phone: "9876543210", role: "waiter" }), /name is required/);
  });

  await test("rejects an unknown category", () => {
    assert.throws(() => validateEmployeeInput({ name: "Rahul", phone: "9876543210", role: "manager" }), /Category must be/);
  });

  await test("accepts a valid WAITER and a valid CHEF", () => {
    validateEmployeeInput({ name: "Rahul", phone: "9876543210", role: "waiter" });
    validateEmployeeInput({ name: "Anuj", phone: "9000000001", role: "chef" });
  });

  await test("creates a waiter employee successfully", async () => {
    const User = makeFakeUserModel();
    const emp = await createEmployee({ User, name: "Rahul", phone: "9876543210", address: "Kolkata", role: "waiter" });
    assert.equal(emp.role, "waiter");
    assert.equal(emp.status, "Active");
    assert.equal(emp.isAdmin, false);
    assert.equal(emp.isVerified, false); // becomes true only on first real OTP login
  });

  await test("two employees can have different phone numbers (multiple waiters/chefs)", async () => {
    const User = makeFakeUserModel();
    await createEmployee({ User, name: "Waiter A", phone: "9876543210", role: "waiter" });
    await createEmployee({ User, name: "Waiter B", phone: "9876543211", role: "waiter" });
    const b = await User.findOne({ phone: "9876543211" });
    assert.equal(b.name, "Waiter B");
  });

  await test("rejects creating a second ACTIVE employee with the same phone", async () => {
    const User = makeFakeUserModel();
    await createEmployee({ User, name: "Chef A", phone: "9000000001", role: "chef" });
    await assert.rejects(
      () => createEmployee({ User, name: "Chef A Duplicate", phone: "9000000001", role: "chef" }),
      /already exists/
    );
  });

  await test("a phone number CAN be reused once the old account is deactivated", async () => {
    const User = makeFakeUserModel([
      { _id: "e1", name: "Old Chef", phone: "9000000002", role: "chef", status: "Inactive" },
    ]);
    const emp = await createEmployee({ User, name: "New Chef", phone: "9000000002", role: "chef" });
    assert.equal(emp.name, "New Chef");
  });

  await test("deactivating an employee sets status Inactive", async () => {
    const User = makeFakeUserModel([{ _id: "e1", name: "Rahul", phone: "9876543210", role: "waiter", status: "Active" }]);
    const emp = await setEmployeeStatus({ User, id: "e1", status: "Inactive" });
    assert.equal(emp.status, "Inactive");
  });

  await test("cannot set an invalid status value", async () => {
    const User = makeFakeUserModel([{ _id: "e1", name: "Rahul", phone: "9876543210", role: "waiter", status: "Active" }]);
    await assert.rejects(() => setEmployeeStatus({ User, id: "e1", status: "OnLeave" }), /Active.*Inactive/);
  });

  await test("editEmployee can change category from waiter to chef (role flexibility)", async () => {
    const User = makeFakeUserModel([{ _id: "e1", name: "Priya", phone: "9876543212", role: "waiter", status: "Active" }]);
    const emp = await updateEmployee({ User, id: "e1", role: "chef" });
    assert.equal(emp.role, "chef");
  });

  await test("editEmployee rejects an unknown target category", async () => {
    const User = makeFakeUserModel([{ _id: "e1", name: "Priya", phone: "9876543212", role: "waiter", status: "Active" }]);
    await assert.rejects(() => updateEmployee({ User, id: "e1", role: "manager" }), /Category must be/);
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
