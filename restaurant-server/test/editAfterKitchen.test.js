// test/editAfterKitchen.test.js — an admin / manager edits an order the
// kitchen already has (PREPARING / READY, until served): stock re-counted,
// one change slip with only the differences. No DB — a fake whose
// transaction rolls back on error.
//   node test/editAfterKitchen.test.js
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.PHONEPE_MERCHANT_ID;

const { modifyOrderItemsTx, isOnlinePaymentInProgress } = await import("../services/orderService.js");
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

const makeWorld = ({ status = "PREPARING", items = [line("biryani", 2), line("tea", 2)], stock = { rice: 10, milk: 10 }, paid = false, orderType = "DINE_IN", extra = {} } = {}) => {
  let state = {
    orders: [{
      _id: "o1", orderId: "ORD1", status, tableNo: orderType === "DINE_IN" ? 4 : null, orderType, items, revision: 3,
      subtotal: 0, total: items.reduce((s, i) => s + i.price * i.qty, 0), paymentStatus: paid ? "PAID" : "PENDING_VERIFICATION",
      stockDeducted: true, stockReversed: false,
      stockDeductions: [{ inventoryItem: "rice", qty: 2 }, { inventoryItem: "milk", qty: 2 }],
      statusHistory: [],
      ...extra,
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

await test("extra quantities edit and reload on the same order; only one change slip per revision", async () => {
  const menu = MENU[0];
  menu.addons = [{ _id: "egg-extra", name: "Extra Egg", price: 25 }];
  try {
    const initial = { ...line("biryani", 1), basePrice: 200, price: 225, addons: [{ addonId: "egg-extra", name: "Extra Egg", price: 25 }] };
    const w = makeWorld({ items: [initial] });
    const { order } = await w.edit(ADMIN, [{ menuItemId: "biryani", qty: 1, addonIds: Array(3).fill("egg-extra") }]);
    assert.equal(order.total, 275);
    assert.equal(w.order().items[0].addons[0].qty, 3, "reloaded saved state retains three extras");
    assert.equal(w.state.slips.length, 1);
    assert.deepEqual(w.state.slips[0].items[0].addons, ["3 x Extra Egg"]);
    await assert.rejects(w.edit(ADMIN, [{ menuItemId: "biryani", qty: 1, addonIds: ["egg-extra"] }]), (e) => e.statusCode === 409);
    const reduced = await w.edit(ADMIN, [{ menuItemId: "biryani", qty: 1, addonIds: ["egg-extra"] }], 4);
    assert.equal(reduced.order.total, 225);
    const removed = await w.edit(ADMIN, [{ menuItemId: "biryani", qty: 1, addonIds: [] }], 5);
    assert.equal(removed.order.total, 200);
    assert.equal(removed.order.items[0].addons, undefined);
    assert.equal(w.state.slips.length, 3);
  } finally { delete menu.addons; }
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

await test("a manager can do it too (READY); so can a waiter (same order, change slip); a chef can't", async () => {
  const w = makeWorld({ status: "READY" });
  await w.edit(MANAGER, items(["biryani", 2]));
  assert.deepEqual(w.state.stock, { rice: 10, milk: 12 }, "tea's milk given back");
  const w2 = makeWorld();
  const { order } = await w2.edit(WAITER, items(["biryani", 1], ["tea", 2]));
  assert.equal(order.orderId, "ORD1");
  assert.equal(order.total, 240);
  assert.equal(w2.state.slips.length, 1);
  assert.equal(w2.state.slips[0].notes.includes("Sam"), true, "slip says which waiter changed it");
  const w3 = makeWorld();
  await assert.rejects(w3.edit({ _id: "c1", name: "Cook", role: "chef" }, items(["biryani", 1])), (e) => e.statusCode === 403);
  assert.equal(w3.state.slips.length, 0);
});

await test("takeaway: an admin/manager edit while cooking or ready keeps the same order, re-priced, only the new items on the slip, no double-add", async () => {
  for (const [user, status] of [[ADMIN, "PREPARING"], [MANAGER, "READY"]]) {
    const w = makeWorld({ status, orderType: "TAKEAWAY", paid: true });
    // What the admin app sends: the order's lines with the new ones merged in.
    const merged = items(["biryani", 2], ["tea", 3], ["raita", 1]);
    const { order, kotChange } = await w.edit(user, merged);
    assert.equal(w.state.orders.length, 1, "no new order");
    assert.equal(order._id, "o1");
    assert.equal(order.orderId, "ORD1", "same order number");
    assert.equal(order.orderType, "TAKEAWAY");
    assert.equal(order.total, 490, "2×200 + 3×20 + 1×30");
    assert.equal(order.status, "PREPARING", "cooking (again, if it was Ready) — the new items need making");
    assert.equal(order.paymentStatus, "PAID", "payment untouched");
    assert.match(w.order().statusHistory.at(-1).note, /after payment — paid ₹440, new total ₹490/, "a paid order notes the new total");
    assert.deepEqual(order.items.map((l) => [l.name, l.qty]), [["Biryani", 2], ["Tea", 3], ["Raita", 1]]);
    assert.equal(kotChange.created, true);
    assert.deepEqual(w.state.slips[0].items.map((l) => [l.name, l.qty]), [["Tea", 1], ["Raita", 1]], "kitchen sees only what was added");
    // A double click / retry sends the same revision again → refused, nothing added twice.
    await assert.rejects(w.edit(user, merged), (e) => e.statusCode === 409);
    assert.equal(w.order().total, 490);
    assert.equal(w.state.slips.length, 1);
    assert.equal(w.state.orders.length, 1);
  }
});

await test("adding to a cooking order in every area: same order, only the new items on the slip, with type/area/table/customer", async () => {
  const cases = [
    { orderType: "DINE_IN", extra: { diningArea: "", tableName: "Indoor 2", tableDisplayNo: 2, tableNo: 20 } },
    { orderType: "DINE_IN", extra: { diningArea: "AC_ROOM", tableName: "Indoor-AC 2", tableDisplayNo: 2, tableNo: 23, guests: 4, acServiceCharge: 80 } },
    { orderType: "DINE_IN", extra: { diningArea: "GARDEN", tableName: "Garden 1", tableDisplayNo: 1, tableNo: 30 } },
    { orderType: "DINE_IN", extra: { diningArea: "GAZEBO", tableName: "Gazebo 3", tableDisplayNo: 3, tableNo: 33 } },
    { orderType: "TAKEAWAY", extra: {} },
    { orderType: "ONLINE", extra: {} },
  ];
  for (const c of cases) {
    const label = `${c.orderType} ${c.extra.diningArea ?? ""}`;
    const w = makeWorld({ orderType: c.orderType, extra: { ...c.extra, guestName: "Rahul", guestPhone: "9876543210", createdAt: "2026-10-11T10:00:00Z" } });
    const { order, kotChange } = await w.edit(MANAGER, items(["biryani", 2], ["tea", 2], ["raita", 2]));
    assert.equal(w.state.orders.length, 1, label);
    assert.equal(order.orderId, "ORD1", label);
    assert.equal(order.status, "PREPARING", `${label}: not reset`);
    assert.equal(order.paymentStatus, "PENDING_VERIFICATION", `${label}: still unpaid`);
    assert.equal(order.createdAt, "2026-10-11T10:00:00Z", label);
    assert.equal(order.guestPhone, "9876543210", label);
    const ac = c.extra.acServiceCharge || 0;
    assert.equal(order.total, 440 + 60 + ac, `${label}: items + AC charge kept`);
    const slip = w.state.slips[0];
    assert.equal(kotChange.created, true, label);
    assert.deepEqual(slip.items.map((l) => [l.name, l.qty]), [["Raita", 2]], `${label}: only the new items`);
    assert.equal(slip.orderId, "ORD1");
    assert.equal(slip.orderType, c.orderType);
    assert.equal(slip.diningArea, c.extra.diningArea || "");
    assert.equal(slip.tableDisplayNo, c.extra.tableDisplayNo ?? null);
    const paper = kotChangePrintPayload(slip);
    assert.equal(paper.customerName, "Rahul", label);
    assert.equal(paper.customerPhone, "9876543210", label);
    assert.equal(paper.changed, true);
    assert.equal(paper.jobType, "KOT", "existing print contract — a KOT job");
  }
});

await test("two add-item saves at once (same revision): one wins, the other is refused — nothing lost or doubled", async () => {
  const w = makeWorld();
  const results = await Promise.allSettled([
    w.edit(ADMIN, items(["biryani", 2], ["tea", 2], ["raita", 1])),
    w.edit(MANAGER, items(["biryani", 3], ["tea", 2])),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected" && r.reason.statusCode === 409).length, 1);
  assert.equal(w.order().revision, 4);
  assert.equal(w.state.slips.length, 1, "one slip");
  assert.equal(w.state.orders.length, 1);
});

await test("online payment in progress → no item change; an abandoned attempt stops blocking", async () => {
  const fresh = { provider: "PHONEPE", merchantTransactionId: "T1", state: "PENDING", lastCheckedAt: new Date().toISOString() };
  const w = makeWorld({ extra: { payment: fresh } });
  await assert.rejects(w.edit(ADMIN, items(["biryani", 2], ["tea", 2], ["raita", 1])), (e) => e.statusCode === 409 && /payment .* in progress/.test(e.message));
  assert.equal(w.order().revision, 3);
  assert.equal(w.state.slips.length, 0);
  const old = { ...fresh, lastCheckedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
  const w2 = makeWorld({ extra: { payment: old } });
  await w2.edit(ADMIN, items(["biryani", 2], ["tea", 2], ["raita", 1]));
  assert.equal(w2.order().revision, 4);
  assert.equal(isOnlinePaymentInProgress({ paymentStatus: "PAID", payment: fresh }), false, "paid → not in progress");
  assert.equal(isOnlinePaymentInProgress({ payment: { ...fresh, state: "FAILED" } }), false);
  assert.equal(isOnlinePaymentInProgress({ payment: { provider: "NONE", state: "CREATED" } }), false, "default record → not in progress");
});

await test("completed / cancelled orders can't be edited by anyone", async () => {
  for (const status of ["COMPLETED", "CANCELLED"]) {
    const w = makeWorld({ status });
    await assert.rejects(w.edit(ADMIN, items(["biryani", 1])), (e) => e.statusCode === 409, status);
  }
});

await test("Edit items on a served order (admin/manager): reduce / remove → stays Served, stock back, CANCEL slip; add → back to Cooking", async () => {
  const w = makeWorld({ status: "DELIVERED" });
  const { order } = await w.edit(MANAGER, items(["biryani", 1]));
  assert.equal(order.orderId, "ORD1");
  assert.equal(order.status, "DELIVERED", "nothing new to cook → stays Served");
  assert.equal(order.total, 200);
  assert.deepEqual(w.state.stock, { rice: 11, milk: 12 }, "1 biryani + 2 tea given back");
  assert.deepEqual(w.state.slips[0].items.map((l) => [l.name, l.qty]), [[`${CANCEL_PREFIX}Biryani`, 1], [`${CANCEL_PREFIX}Tea`, 2]]);
  const w2 = makeWorld({ status: "DELIVERED" });
  const r2 = await w2.edit(ADMIN, items(["biryani", 1], ["raita", 2]));
  assert.equal(r2.order.status, "PREPARING", "something added → cooking again");
  assert.deepEqual(w2.state.slips[0].items.map((l) => [l.name, l.qty]), [["Raita", 2], [`${CANCEL_PREFIX}Biryani`, 1], [`${CANCEL_PREFIX}Tea`, 2]]);
});

await test("Placed / Cooking / Ready / Served: adding items always keeps the same order number", async () => {
  // Placed (not yet in the kitchen): the ordinary edit — no slip, the KOT prints later with everything.
  const placed = makeWorld({ status: "CONFIRMED", extra: { stockDeducted: false, stockDeductions: [] } });
  const p = await placed.edit(WAITER, items(["biryani", 2], ["tea", 2], ["raita", 1]));
  assert.equal(p.order.orderId, "ORD1");
  assert.equal(p.order.status, "CONFIRMED", "Placed stays Placed");
  assert.equal(placed.state.slips.length, 0);

  for (const [status, after] of [["PREPARING", "PREPARING"], ["READY", "PREPARING"], ["DELIVERED", "PREPARING"]]) {
    const w = makeWorld({ status, extra: { preparingAt: "2026-10-11T10:00:00Z" } });
    const { order } = await w.edit(ADMIN, items(["biryani", 2], ["tea", 2], ["raita", 1]));
    assert.equal(w.state.orders.length, 1, status);
    assert.equal(order.orderId, "ORD1", status);
    assert.equal(order.status, after, `${status} → ${after}`);
    assert.equal(order.total, 470, status);
    assert.equal(order.paymentStatus, "PENDING_VERIFICATION", `${status}: still unpaid`);
    assert.deepEqual(w.state.slips[0].items.map((l) => [l.name, l.qty]), [["Raita", 1]], `${status}: slip has only the new item`);
    const last = w.order().statusHistory.at(-1);
    assert.equal(last.status, after);
    if (status !== "PREPARING") {
      assert.match(last.note, /back to Cooking for the added items/, status);
      assert.notEqual(order.preparingAt, "2026-10-11T10:00:00Z", "kitchen timer restarts for the new items");
    } else {
      assert.equal(order.preparingAt, "2026-10-11T10:00:00Z", "already cooking — timer untouched");
    }
  }
});

await test("Ready order edited without adding anything stays Ready; a settled bill can't be changed; a waiter adds to a served order → same order, back to Cooking", async () => {
  const w = makeWorld({ status: "READY" });
  const { order } = await w.edit(MANAGER, items(["biryani", 2]));
  assert.equal(order.status, "READY", "only removed → nothing new to cook");
  const settled = makeWorld({ status: "DELIVERED", extra: { billStatus: "SETTLED" } });
  await assert.rejects(settled.edit(ADMIN, items(["biryani", 2], ["tea", 2], ["raita", 1])), (e) => e.statusCode === 409 && /settled/.test(e.message));
  const served = makeWorld({ status: "DELIVERED" });
  const r = await served.edit(WAITER, items(["biryani", 2], ["tea", 2], ["raita", 1]));
  assert.equal(r.order.orderId, "ORD1");
  assert.equal(r.order.status, "PREPARING");
  assert.deepEqual(served.state.slips[0].items.map((l) => [l.name, l.qty]), [["Raita", 1]]);
  const settledW = makeWorld({ status: "READY", extra: { billStatus: "SETTLED" } });
  await assert.rejects(settledW.edit(WAITER, items(["biryani", 2], ["tea", 2], ["raita", 1])), (e) => e.statusCode === 409 && /settled/.test(e.message));
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

await test("waiter draft extras persist and render cancel-old / replace-new revisions, with noted rows isolated", async () => {
  const { editLinesOf, stepLineAddon, replaceLineAddons, orderItemsPayload, mergeOrderAdditions, draftSubtotal } = await import("../../waiter/src/utils/orderDraft.js");
  // These imports are pure text layout, never the print processor or drivers.
  const { renderKot } = await import("../../print-service/src/renderers/kotRenderer.js");
  const menu = MENU[0];
  menu.addons = [{ _id: "egg", name: "Boiled Egg", price: 25 }, { _id: "sauce", name: "Sauce", price: 5 }];
  try {
    const initial = ["less spicy", "no salt"].map((notes) => ({ ...line("biryani", 2), notes, basePrice: 200, price: 225,
      addons: [{ addonId: "egg", name: "Boiled Egg", price: 25 }] }));
    const w = makeWorld({ items: initial });
    // Increase 1 -> 2 -> 3, reduce 3 -> 2 -> 1 -> 0, then add new extras.
    for (const [index, quantity] of [2, 3, 2, 1, 0].entries()) {
      const draft = editLinesOf(clone(w.order().items));
      const next = stepLineAddon(draft, draft[0].key, "egg", quantity > draft[0].addonIds.length ? 1 : -1);
      const previous = draft[0].addons[0]?.qty || (draft[0].addons.length ? 1 : 0);
      const result = await w.edit(WAITER, orderItemsPayload(next), 3 + index);
      assert.equal(result.order.total, draftSubtotal(next));
      assert.equal(w.order().items[0].addons?.[0]?.qty || (w.order().items[0].addons?.length ? 1 : 0), quantity);
      assert.deepEqual(w.order().items[1], initial[1], "other kitchen note stays intact");
      assert.equal(result.order._id, "o1");
      assert.equal(result.order.orderId, "ORD1");
      const payload = kotChangePrintPayload(result.kotChange.job);
      assert.equal(payload.changed, true);
      assert.equal(payload.jobType, "KOT");
      assert.deepEqual(payload.items.map((i) => [i.name, i.qty, i.notes]), [["Biryani", 2, "less spicy"], ["CANCEL - Biryani", 2, "less spicy"]]);
      assert.deepEqual(payload.items[0].addons || [], quantity ? [quantity > 1 ? `${quantity} x Boiled Egg` : "Boiled Egg"] : []);
      assert.deepEqual(payload.items[1].addons, [previous > 1 ? `${previous} x Boiled Egg` : "Boiled Egg"]);
      for (const width of [32, 48]) {
        const rows = renderKot(payload, { width });
        const paper = rows.map((r) => r.text || "").join("\n");
        assert.match(paper, /ORDER CHANGED/);
        assert.match(paper, /CANCEL - Biryani/);
        assert.match(paper, /Note: less spicy/);
        assert.doesNotMatch(paper, /no salt/);
        if (quantity > 1) assert.ok(paper.includes(`+ ${quantity} x Boiled Egg`));
        for (const row of rows) if (row.text) assert.ok(row.text.length <= width);
      }
    }
    const draft = editLinesOf(clone(w.order().items));
    const next = replaceLineAddons(draft, draft[0].key, ["egg", "egg", "sauce"], menu);
    const result = await w.edit(WAITER, orderItemsPayload(next), 8);
    assert.equal(result.order.total, 960);
    assert.deepEqual(result.kotChange.job.items[0].addons, ["2 x Boiled Egg", "Sauce"]);
    assert.equal(result.kotChange.job.items[1].addons, undefined, "cancel previous plain parent");
    const added = mergeOrderAdditions(w.order().items, [{ menuItemId: "biryani", qty: 1, addonIds: ["egg"] }]);
    const appended = await w.edit(WAITER, added, 9);
    assert.equal(appended.order.items.length, 3, "add-items preserves both noted rows");
    assert.deepEqual(appended.kotChange.job.items.map((i) => [i.name, i.qty, i.notes, i.addons]), [["Biryani", 1, "", ["Boiled Egg"]]]);
    assert.equal(w.state.orders.length, 1);
    const slipCount = w.state.slips.length;
    menu.addons[0].isAvailable = false;
    await assert.rejects(w.edit(WAITER, added, 10), (e) => e.statusCode === 400 && /removed or disabled/.test(e.message));
    assert.equal(w.state.slips.length, slipCount, "unavailable extra creates no job");
    delete menu.addons[0].isAvailable;
    await assert.rejects(w.edit(WAITER, added, 9), (e) => e.statusCode === 409);
    const discounted = makeWorld({ items: initial, extra: {
      coupon: { discountType: "PERCENT", discountValue: 10 }, acServiceCharge: 30,
    } });
    const discountDraft = editLinesOf(initial);
    const discountedResult = await discounted.edit(WAITER,
      orderItemsPayload(stepLineAddon(discountDraft, discountDraft[0].key, "egg", 1)));
    assert.equal(discountedResult.order.subtotal, 980, "950 of items plus preserved AC charge");
    assert.equal(discountedResult.order.discount, 95, "coupon repriced on changed items only");
    assert.equal(discountedResult.order.total, 885);
  } finally { delete menu.addons; }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
