// test/editAfterKitchen.test.js — an admin / manager edits an order the
// kitchen already has (PREPARING / READY, until served): stock re-counted,
// one change slip with only the differences. No DB — a fake whose
// transaction rolls back on error.
//   node test/editAfterKitchen.test.js
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.PHONEPE_MERCHANT_ID;

const { modifyOrderItemsTx } = await import("../services/orderService.js");
const { diffOrderLines, createKotChangeJob, CANCEL_PREFIX } = await import("../services/kotService.js");
const { kotChangePrintPayload } = await import("../sockets/socket.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.stack || err.message}`); }
};

const ADMIN = { _id: "a1", name: "Owner", role: "admin", isAdmin: true };
const MANAGER = { _id: "m9", name: "Rina", role: "manager" };
const WAITER = { _id: "w1", name: "Sam", role: "waiter" };

// Biryani needs 1 rice; Tea needs 1 milk. Raita has no recipe.
const MENU = [
  { _id: "biryani", name: "Biryani", price: 200, isAvailable: true, category: "Mains" },
  { _id: "tea", name: "Tea", price: 20, isAvailable: true, category: "Drinks" },
  { _id: "raita", name: "Raita", price: 30, isAvailable: true, category: "Sides" },
];
const RECIPES = [
  { menuItem: "biryani", status: "Active", ingredients: [{ inventoryItem: "rice", quantity: 1, unit: "pcs" }] },
  { menuItem: "tea", status: "Active", ingredients: [{ inventoryItem: "milk", quantity: 1, unit: "pcs" }] },
];
const line = (id, qty) => {
  const m = MENU.find((x) => x._id === id);
  return { menuItem: id, name: m.name, nameBn: "", price: m.price, qty, notes: "" };
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const matches = (doc, f) => Object.entries(f).every(([k, c]) => {
  const v = doc[k];
  if (c && typeof c === "object") {
    return Object.entries(c).every(([op, x]) =>
      op === "$ne" ? v !== x : op === "$in" ? x.includes(v ?? null) : op === "$gte" ? v >= x : (() => { throw new Error(`fake ${op}`); })());
  }
  return String(v) === String(c);
});

const makeWorld = ({ status = "PREPARING", items = [line("biryani", 2), line("tea", 2)], stock = { rice: 10, milk: 10 }, paid = false } = {}) => {
  let state = {
    orders: [{
      _id: "o1", orderId: "ORD1", status, tableNo: 4, orderType: "DINE_IN", items, revision: 3,
      subtotal: 0, total: items.reduce((s, i) => s + i.price * i.qty, 0), paymentStatus: paid ? "PAID" : "PENDING_VERIFICATION",
      stockDeducted: true, stockReversed: false,
      stockDeductions: [{ inventoryItem: "rice", qty: 2 }, { inventoryItem: "milk", qty: 2 }],
      statusHistory: [],
    }],
    stock: { ...stock },
    ledger: [],
    slips: [],
  };
  const doc = (o) => o && ({ ...clone(o), toObject() { return clone(o); } });
  const order = () => state.orders[0];
  const apply = (o, u) => {
    Object.assign(o, clone(u.$set || {}));
    for (const [k, v] of Object.entries(u.$inc || {})) o[k] = (o[k] || 0) + v;
    if (u.$push?.statusHistory) o.statusHistory.push(u.$push.statusHistory);
  };
  const stockRow = (id) => ({ _id: id, name: id, unit: "pcs", status: "Active", currentStock: state.stock[id], reorderLevel: 0, criticalLevel: 0 });
  const chain = (v) => { const p = Promise.resolve(v); p.select = () => chain(v); p.session = () => chain(v); p.lean = () => chain(v); return p; };

  const models = {
    MenuItem: { findById: async (id) => MENU.find((m) => m._id === id) || null },
    RestaurantProfile: { findOne: async () => ({ gstRate: 0, serviceCharge: 0 }) },
    Category: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
    Recipe: { find: async (f) => RECIPES.filter((r) => f.menuItem.$in.includes(r.menuItem)) },
    InventoryItem: {
      find: (f) => chain(f._id.$in.filter((id) => id in state.stock).map(stockRow)),
      findOneAndUpdate: async (f, u) => {
        if (!(state.stock[f._id] >= f.currentStock.$gte)) return null;
        state.stock[f._id] += u.$inc.currentStock;
        return stockRow(f._id);
      },
      findByIdAndUpdate: async (id, u) => {
        if (!(id in state.stock)) return null;
        if (u.$inc) state.stock[id] += u.$inc.currentStock;
        if (u.$set) state.stock[id] = u.$set.currentStock;
        return stockRow(id);
      },
    },
    StockLedger: { create: async ([row]) => { state.ledger.push(row); return [row]; } },
    InventoryBatch: { find: () => ({ sort: () => ({ session: async () => [] }) }) },
    KOTChangeJob: {
      create: async ([d]) => {
        if (state.slips.some((s) => s.order === d.order && s.revision === d.revision)) throw Object.assign(new Error("dup"), { code: 11000 });
        const job = { _id: `chg${state.slips.length + 1}`, ...clone(d), createdAt: new Date().toISOString() };
        state.slips.push(job);
        return [job];
      },
      findOne: (f) => chain(state.slips.find((s) => s.order === f.order && s.revision === f.revision) || null),
    },
    Order: {
      findById: (id) => chain(doc(state.orders.find((o) => o._id === id))),
      findOneAndUpdate: async (f, u) => {
        const o = state.orders.find((x) => matches(x, f));
        if (!o) return null;
        apply(o, u);
        return doc(o);
      },
      findByIdAndUpdate: async (id, u) => { const o = state.orders.find((x) => x._id === id); apply(o, u); return doc(o); },
      updateOne: async (f, u) => { const o = state.orders.find((x) => x._id === f._id); apply(o, u); return {}; },
    },
  };
  const db = {
    startSession: async () => ({
      withTransaction: async (fn) => {
        const snapshot = clone(state);
        try { await fn(); } catch (err) { state = snapshot; throw err; }
      },
      endSession: () => {},
    }),
  };
  const edit = (user, items, revision = 3) => modifyOrderItemsTx({ req: { models, db, user, headers: {} }, orderId: "o1", items, revision });
  return { edit, get state() { return state; }, order };
};

const items = (...pairs) => pairs.map(([menuItemId, qty]) => ({ menuItemId, qty }));

await test("diff: only what changed — extra to make, and CANCEL lines", () => {
  const { added, removed } = diffOrderLines([line("biryani", 2), line("tea", 2)], [line("biryani", 3), line("raita", 1)]);
  assert.deepEqual(added.map((l) => [l.name, l.qty]), [["Biryani", 1], ["Raita", 1]]);
  assert.deepEqual(removed.map((l) => [l.name, l.qty]), [[`${CANCEL_PREFIX}Tea`, 2]]);
  const same = diffOrderLines([line("tea", 1)], [line("tea", 1)]);
  assert.deepEqual(same, { added: [], removed: [] });
});

await test("admin edits a cooking order: new totals, stock follows the final order, one change slip", async () => {
  const w = makeWorld();
  const { order, kotChange } = await w.edit(ADMIN, items(["biryani", 3], ["raita", 1]));
  assert.equal(order.total, 630);
  assert.equal(order.status, "PREPARING", "status untouched");
  assert.equal(order.revision, 4);
  // Stock on hand already excludes the 2 rice + 2 milk taken at KOT time:
  // rice 10 + 2 back − 3 now = 9; tea removed → milk 10 + 2 back = 12.
  assert.deepEqual(w.state.stock, { rice: 9, milk: 12 });
  assert.deepEqual(w.order().stockDeductions.map((d) => [d.inventoryItem, d.qty]), [["rice", 3]]);
  assert.equal(w.state.slips.length, 1);
  assert.equal(kotChange.created, true);
  assert.deepEqual(w.state.slips[0].items.map((l) => [l.name, l.qty]), [["Biryani", 1], ["Raita", 1], [`${CANCEL_PREFIX}Tea`, 2]]);
  assert.match(w.state.slips[0].notes, /ORDER CHANGED/);
  assert.match(w.order().statusHistory.at(-1).note, /change slip sent/);
});

await test("a manager can do it too (READY); a waiter still can't once the kitchen has it", async () => {
  const w = makeWorld({ status: "READY" });
  await w.edit(MANAGER, items(["biryani", 2]));
  assert.deepEqual(w.state.stock, { rice: 10, milk: 12 }, "tea's milk given back");
  const w2 = makeWorld();
  await assert.rejects(w2.edit(WAITER, items(["biryani", 1])), (e) => e.statusCode === 409);
  assert.equal(w2.state.slips.length, 0);
});

await test("served / completed orders can't be edited by anyone", async () => {
  for (const status of ["DELIVERED", "COMPLETED", "CANCELLED"]) {
    const w = makeWorld({ status });
    await assert.rejects(w.edit(ADMIN, items(["biryani", 1])), (e) => e.statusCode === 409, status);
  }
});

await test("not enough stock for an added item → nothing changes (rolled back)", async () => {
  const w = makeWorld({ stock: { rice: 1, milk: 10 } });
  // has 2 biryani (2 rice already taken, 1 left on the shelf): 4 needs 2 more
  await assert.rejects(w.edit(ADMIN, items(["biryani", 4], ["tea", 2])), (e) => e.statusCode === 409 && /Insufficient stock/.test(e.message));
  assert.deepEqual(w.state.stock, { rice: 1, milk: 10 });
  assert.equal(w.order().revision, 3);
  assert.equal(w.state.slips.length, 0);
});

await test("stale revision (someone else edited) → 409, nothing applied", async () => {
  const w = makeWorld();
  await assert.rejects(w.edit(ADMIN, items(["biryani", 1]), 2), (e) => e.statusCode === 409 && /Someone else/.test(e.message));
  assert.deepEqual(w.state.stock, { rice: 10, milk: 10 });
});

await test("an item already on the order is kept even if sold out now; adding more of it is refused", async () => {
  MENU[0].isAvailable = false;
  try {
    const w = makeWorld();
    const { order } = await w.edit(ADMIN, items(["biryani", 2]));
    assert.equal(order.total, 400);
    await assert.rejects(makeWorld().edit(ADMIN, items(["biryani", 3])), (e) => e.statusCode === 400);
  } finally { MENU[0].isAvailable = true; }
});

await test("re-saving the same items makes no slip", async () => {
  const w = makeWorld();
  const { kotChange } = await w.edit(ADMIN, items(["biryani", 2], ["tea", 2]));
  assert.equal(kotChange.job, null);
  assert.equal(w.state.slips.length, 0);
  assert.deepEqual(w.state.stock, { rice: 10, milk: 10 }, "given back and taken again — same balance");
});

await test("change slip is idempotent per order revision; prints as a KOT job", async () => {
  const KOTChangeJob = (() => {
    const rows = [];
    return {
      create: async ([d]) => { if (rows.some((r) => r.revision === d.revision)) throw Object.assign(new Error("dup"), { code: 11000 }); const j = { _id: "c1", ...d }; rows.push(j); return [j]; },
      findOne: (f) => { const p = Promise.resolve(rows.find((r) => r.revision === f.revision)); p.session = () => p; return p; },
      rows,
    };
  })();
  const before = { items: [line("tea", 1)] };
  const after = { _id: "o1", orderId: "ORD1", revision: 5, items: [line("tea", 2)] };
  const first = await createKotChangeJob({ KOTChangeJob, before, after, actor: ADMIN });
  const again = await createKotChangeJob({ KOTChangeJob, before, after, actor: ADMIN });
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(KOTChangeJob.rows.length, 1);
  const p = kotChangePrintPayload(first.job);
  assert.equal(p.jobType, "KOT");
  assert.equal(p.changed, true);
  assert.equal(p.customerName, "");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
