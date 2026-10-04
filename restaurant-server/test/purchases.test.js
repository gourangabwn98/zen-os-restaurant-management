// test/purchases.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Hotel KHOAI inventory: INV-01..14 (Record Purchase, Wastage, Suppliers).
// No DB — fakes. Run:  node test/purchases.test.js
// ─────────────────────────────────────────────────────────────────────────────
import assert from "node:assert/strict";
import {
  resolveBillNumber, systemBillNumber, validateBillDateTime, normalizePurchaseLines, paymentPlan, cashOutBySource,
} from "../utils/purchaseBill.js";
import { cleanSupplierInput, defaultPaymentTypeFor } from "../utils/supplierInput.js";
import { recordPurchase, recordWastage, settlePurchasePayable } from "../services/inventoryService.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.stack || err.message}`); }
};
const NOW = new Date("2026-10-04T10:00:00Z");
const utcInstant = (y, m, d, h, mi) => new Date(Date.UTC(y, m - 1, d, h, mi));

// ── pure rules ──────────────────────────────────────────────────────────────
await test("INV-02: the supplier's typed number is kept as-is (source SUPPLIER by default)", () => {
  assert.deepEqual(resolveBillNumber({ billNumber: "  INV/778  " }), { number: "INV/778", source: "SUPPLIER" });
  assert.deepEqual(resolveBillNumber({ billNumber: "A-12", billNumberSource: "PHOTO" }), { number: "A-12", source: "PHOTO" });
  assert.deepEqual(resolveBillNumber({ billNumber: "3", billNumberSource: "MANUAL" }), { number: "3", source: "MANUAL" }, "even a short number like 3");
});

await test("INV-02: nothing provided → system must make one; a typed AUTO- number can't pose as one", () => {
  assert.equal(resolveBillNumber({ billNumber: "" }), null);
  assert.equal(resolveBillNumber({}), null);
  assert.throws(() => resolveBillNumber({ billNumber: "auto-20261004-001" }), (e) => e.statusCode === 400);
  assert.equal(resolveBillNumber({ billNumber: "X9", billNumberSource: "SYSTEM" }).source, "SUPPLIER", "a client can't label its number SYSTEM");
  assert.equal(systemBillNumber("2026-10-04", 7), "AUTO-20261004-007");
});

await test("INV-03: bill date AND time required, real date, not in the future", () => {
  const at = validateBillDateTime({ billDate: "2026-10-03", billTime: "19:45" }, { now: NOW, toInstant: utcInstant });
  assert.equal(at.toISOString(), "2026-10-03T19:45:00.000Z");
  for (const bad of [{ billDate: "2026-10-03" }, { billTime: "10:00" }, { billDate: "2026-02-30", billTime: "10:00" }, { billDate: "2026-10-03", billTime: "25:00" }, { billDate: "2026-10-05", billTime: "10:00" }]) {
    assert.throws(() => validateBillDateTime(bad, { now: NOW, toInstant: utcInstant }), (e) => e.statusCode === 400, JSON.stringify(bad));
  }
});

await test("INV-04: a hand-typed line needs a name; amount = qty × rate server-side", () => {
  const [line] = normalizePurchaseLines([{ name: " Mustard  oil ", quantity: 2, rate: 180, unit: "l", amount: 9999 }]);
  assert.deepEqual([line.manual, line.name, line.amount, line.costPrice], [true, "Mustard oil", 360, 180]);
  assert.throws(() => normalizePurchaseLines([{ quantity: 1, rate: 5 }]), (e) => e.statusCode === 400);
  assert.throws(() => normalizePurchaseLines([{ name: "x", quantity: 0, rate: 5 }]), (e) => e.statusCode === 400);
  assert.throws(() => normalizePurchaseLines([{ name: "x", quantity: 1, rate: 5, unit: "bucket" }]), (e) => e.statusCode === 400);
});

await test("INV-06/07: Paid needs a source; Owner's Pocket owes the OWNER; Credit owes the SUPPLIER; drawer/bank owe nobody", () => {
  assert.deepEqual(paymentPlan({ paymentType: "PAID", paymentSource: "CASH_DRAWER" }, 500).payable, null);
  assert.deepEqual(paymentPlan({ paymentType: "PAID", paymentSource: "OWNER_POCKET" }, 500).payable, { to: "OWNER", amount: 500 });
  assert.deepEqual(paymentPlan({ paymentType: "CREDIT" }, 500).payable, { to: "SUPPLIER", amount: 500 });
  assert.throws(() => paymentPlan({ paymentType: "PAID" }, 500), (e) => e.statusCode === 400);
  assert.throws(() => paymentPlan({}, 500, { required: true }), (e) => e.statusCode === 400);
});

await test("INV-07: Owner's Pocket never reduces the cash drawer — only its pay-back does", () => {
  const purchases = [
    { totalCost: 300, purchaseDate: "2026-10-04T05:00:00Z", paymentType: "PAID", paymentSource: "CASH_DRAWER" },
    { totalCost: 800, purchaseDate: "2026-10-04T06:00:00Z", paymentType: "PAID", paymentSource: "OWNER_POCKET",
      payable: { to: "OWNER", amount: 800, settledAt: null } },
    { totalCost: 200, purchaseDate: "2026-10-04T07:00:00Z", paymentType: "PAID", paymentSource: "BANK_UPI" },
    { totalCost: 450, purchaseDate: "2026-10-04T07:30:00Z", paymentType: "CREDIT", payable: { to: "SUPPLIER", amount: 450, settledAt: null } },
  ];
  const day = { from: new Date("2026-10-04T00:00:00Z"), to: new Date("2026-10-04T23:59:59Z") };
  const out = cashOutBySource(purchases, day);
  assert.equal(out.CASH_DRAWER, 300);
  assert.equal(out.BANK_UPI, 200);
  assert.equal(out.ownerFunded, 800);
  assert.equal(out.onCredit, 450);
  purchases[1].payable = { to: "OWNER", amount: 800, settledAt: "2026-10-04T20:00:00Z", settledSource: "CASH_DRAWER" };
  const later = cashOutBySource(purchases, day);
  assert.equal(later.CASH_DRAWER, 1100, "repaying the owner from the drawer is drawer money out");
  assert.equal(later.ownerRepaid, 800);
});

await test("INV-11..14: supplier fields validated; supplied items deduped; preferences enumerated", () => {
  const s = cleanSupplierInput({
    name: " Maa Tara Traders ", phone: "98765 43210", email: "Tara@Example.com", gstNumber: "19abcde1234f1z5",
    suppliedItems: [{ inventoryItem: "a".repeat(24) }, { inventoryItem: "a".repeat(24) }, { name: "Banana leaf" }, { name: "" }],
    autoOrderPreference: "SEND_LINK", creditPreference: "GIVES_CREDIT", creditTerms: "15 days",
    keyHash: "nope", // anything else is dropped
  });
  assert.equal(s.name, "Maa Tara Traders");
  assert.equal(s.phone, "9876543210");
  assert.equal(s.email, "tara@example.com");
  assert.equal(s.gstNumber, "19ABCDE1234F1Z5");
  assert.equal(s.suppliedItems.length, 2);
  assert.equal(s.keyHash, undefined);
  assert.equal(defaultPaymentTypeFor(s), "CREDIT");
  assert.equal(defaultPaymentTypeFor({ creditPreference: "UPFRONT" }), "PAID");
  assert.throws(() => cleanSupplierInput({ name: "x", gstNumber: "123" }), (e) => e.statusCode === 400);
  assert.throws(() => cleanSupplierInput({ name: "x", autoOrderPreference: "NEVER" }), (e) => e.statusCode === 400);
  assert.throws(() => cleanSupplierInput({ phone: "1" }), (e) => /name is required/.test(e.message));
  assert.deepEqual(cleanSupplierInput({ creditTerms: "7 days" }, { partial: true }), { creditTerms: "7 days" });
});

// ── recordPurchase / recordWastage with fakes ───────────────────────────────
const world = ({ items = [], counters = {} } = {}) => {
  const state = { items: items.map((i) => ({ currentStock: 0, ...i })), purchases: [], ledger: [], wastage: [], counters: { ...counters } };
  const q = (v) => ({ session: async () => v, then: (r, j) => Promise.resolve(v).then(r, j) });
  const InventoryItem = {
    findOne: (f) => {
      const rx = f.name?.$regex ? new RegExp(f.name.$regex, f.name.$options) : null;
      return q(state.items.find((i) => (rx ? rx.test(i.name) : i.name === f.name)) || null);
    },
    findById: (id) => q(state.items.find((i) => String(i._id) === String(id)) || null),
    create: async ([doc]) => { const row = { _id: `inv${state.items.length + 1}`, currentStock: 0, ...doc }; state.items.push(row); return [row]; },
    findByIdAndUpdate: async (id, u) => {
      const it = state.items.find((i) => String(i._id) === String(id));
      if (!it) return null;
      it.currentStock += u.$inc.currentStock; Object.assign(it, u.$set || {});
      return { ...it };
    },
    findOneAndUpdate: async (f, u) => {
      const it = state.items.find((i) => String(i._id) === String(f._id));
      if (!it || it.currentStock < f.currentStock.$gte) return null;
      it.currentStock += u.$inc.currentStock;
      return { ...it };
    },
  };
  const models = {
    InventoryItem,
    StockPurchase: {
      create: async ([doc]) => { const row = { _id: `p${state.purchases.length + 1}`, ...doc }; state.purchases.push(row); return [row]; },
      findOneAndUpdate: async (f, u) => {
        const p = state.purchases.find((x) => x._id === f._id && x.payable && f["payable.to"].$in.includes(x.payable.to) && x.payable.settledAt === null);
        if (!p) return null;
        for (const [k, v] of Object.entries(u.$set)) p.payable[k.split(".")[1]] = v;
        return p;
      },
      findById: (id) => ({ select: () => ({ lean: async () => state.purchases.find((x) => x._id === id) || null }) }),
    },
    StockLedger: { create: async ([doc]) => { state.ledger.push(doc); return [doc]; } },
    InventoryBatch: { create: async () => [{}] },
    WastageLog: { create: async ([doc]) => { const row = { _id: `w${state.wastage.length + 1}`, ...doc }; state.wastage.push(row); return [row]; } },
    Counter: {
      findOneAndUpdate: async (f) => { state.counters[f._id] = (state.counters[f._id] || 0) + 1; return { seq: state.counters[f._id] }; },
    },
    RestaurantProfile: { findOne: () => ({ select: () => ({ lean: async () => ({ timezone: "Asia/Kolkata" }) }) }) },
    Supplier: { exists: async () => true },
  };
  return { state, models };
};
const ACTOR = { id: "a1", role: "ADMIN", name: "Owner" };
const base = { billDate: "2026-10-03", billTime: "18:30", paymentType: "PAID", paymentSource: "CASH_DRAWER" };

await test("Record Purchase (strict): bill date + time and Paid/Credit are required", async () => {
  const { models } = world({ items: [{ _id: "rice", name: "Rice", unit: "kg" }] });
  const body = { items: [{ inventoryItem: "rice", quantity: 1, costPrice: 60 }] };
  await assert.rejects(recordPurchase({ models, body, actor: ACTOR, strict: true, now: NOW }), (e) => e.statusCode === 400 && /date/.test(e.message));
  await assert.rejects(recordPurchase({ models, body: { ...body, billDate: "2026-10-03", billTime: "18:30" }, actor: ACTOR, strict: true, now: NOW }), (e) => /Paid or Credit/.test(e.message));
});

await test("INV-02: no number anywhere → AUTO-<bill day>-NNN, marked SYSTEM; a typed one is kept", async () => {
  const { models, state } = world({ items: [{ _id: "rice", name: "Rice", unit: "kg" }] });
  const line = [{ inventoryItem: "rice", quantity: 2, costPrice: 60 }];
  const p1 = await recordPurchase({ models, body: { ...base, items: line }, actor: ACTOR, strict: true, now: NOW });
  const p2 = await recordPurchase({ models, body: { ...base, items: line }, actor: ACTOR, strict: true, now: NOW });
  assert.equal(p1.invoiceNumber, "AUTO-20261003-001");
  assert.equal(p2.invoiceNumber, "AUTO-20261003-002");
  assert.equal(p1.billNumberSource, "SYSTEM");
  const p3 = await recordPurchase({ models, body: { ...base, billNumber: "SR/1189", items: line }, actor: ACTOR, strict: true, now: NOW });
  assert.equal(p3.invoiceNumber, "SR/1189");
  assert.equal(p3.billNumberSource, "SUPPLIER");
  assert.equal(state.items[0].currentStock, 6);
  assert.equal(p3.billDate, "2026-10-03");
  assert.equal(p3.billTime, "18:30");
  assert.equal(new Date(p3.purchaseDate).toISOString(), "2026-10-03T13:00:00.000Z", "18:30 IST");
});

await test("INV-04: a typed item that isn't stocked is created once (unit kept) and stocked; same name reuses it", async () => {
  const { models, state } = world();
  const body = { ...base, items: [{ name: "Banana leaf", unit: "pcs", quantity: 50, rate: 1 }] };
  await recordPurchase({ models, body, actor: ACTOR, strict: true, now: NOW });
  await recordPurchase({ models, body: { ...body, items: [{ name: "banana LEAF", unit: "pcs", quantity: 20, rate: 1.2 }] }, actor: ACTOR, strict: true, now: NOW });
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].currentStock, 70);
  assert.equal(state.items[0].unit, "pcs");
  assert.equal(state.purchases[0].items[0].manual, true);
  assert.equal(state.purchases[0].items[0].amount, 50);
});

await test("a line in another compatible unit converts into the stock unit (2 kg → 2000 g), cost per stock unit", async () => {
  const { models, state } = world({ items: [{ _id: "sugar", name: "Sugar", unit: "g" }] });
  await recordPurchase({ models, body: { ...base, items: [{ inventoryItem: "sugar", unit: "kg", quantity: 2, costPrice: 50 }] }, actor: ACTOR, strict: true, now: NOW });
  assert.equal(state.items[0].currentStock, 2000);
  assert.equal(state.items[0].costPrice, 0.05);
});

await test("INV-07: Owner's Pocket purchase → payable to owner; settled once from the drawer", async () => {
  const { models, state } = world({ items: [{ _id: "fish", name: "Rohu", unit: "kg" }] });
  const p = await recordPurchase({ models, body: { ...base, paymentSource: "OWNER_POCKET", items: [{ inventoryItem: "fish", quantity: 4, costPrice: 220 }] }, actor: ACTOR, strict: true, now: NOW });
  assert.deepEqual(p.payable, { to: "OWNER", amount: 880 });
  state.purchases[0].payable.settledAt = null;
  await settlePurchasePayable({ models, purchaseId: p._id, source: "CASH_DRAWER", actor: ACTOR, now: NOW });
  assert.equal(state.purchases[0].payable.settledSource, "CASH_DRAWER");
  await assert.rejects(settlePurchasePayable({ models, purchaseId: p._id, source: "CASH_DRAWER", actor: ACTOR }), (e) => e.statusCode === 409);
  await assert.rejects(settlePurchasePayable({ models, purchaseId: p._id, source: "OWNER_POCKET", actor: ACTOR }), (e) => e.statusCode === 400);
});

await test("INV-08/09/10: waste of a non-stock item by name + unit; Others needs its reason text", async () => {
  const { models, state } = world();
  await assert.rejects(recordWastage({ models, body: { itemName: "Leftover rice", quantity: 2, unit: "kg", reason: "Other" }, actor: ACTOR }), (e) => /reason/.test(e.message));
  const log = await recordWastage({ models, body: { itemName: "Leftover rice", quantity: 2, unit: "kg", reason: "Other", reasonText: "Wedding order cancelled", cost: 120 }, actor: ACTOR });
  assert.equal(log.inventoryItem, null);
  assert.equal(log.unit, "kg");
  assert.equal(log.costImpact, 120);
  assert.equal(state.ledger.length, 0, "nothing stocked, nothing deducted");
});

await test("INV-09: stock waste weighed in g on an item stocked in kg is converted before deducting", async () => {
  const { models, state } = world({ items: [{ _id: "flour", name: "Atta", unit: "kg", currentStock: 5, costPrice: 40 }] });
  const log = await recordWastage({ models, body: { inventoryItem: "flour", quantity: 500, unit: "g", reason: "Spoilage" }, actor: ACTOR });
  assert.equal(state.items[0].currentStock, 4.5);
  assert.equal(log.costImpact, 20);
  assert.equal(state.ledger[0].quantity, -0.5);
  await assert.rejects(recordWastage({ models, body: { inventoryItem: "flour", quantity: 1, unit: "l", reason: "Spoilage" }, actor: ACTOR }), (e) => e.statusCode === 400);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
