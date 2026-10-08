// test/renderers.test.js — BILL / KOT layout (src/renderers/*). Checks the
// content of each ticket and, for every scenario and paper width, that no
// line ever runs past the printer's character width.
import assert from "node:assert/strict";
import { renderKot } from "../src/renderers/kotRenderer.js";
import { renderBill } from "../src/renderers/billRenderer.js";
import { keyValue, kotItemRows, billItemRows, wrapText, toPrintable, money, dateTime } from "../src/renderers/layout.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}`); console.error(`         ${err.message}`); }
};

const text = (lines) => lines.map((l) => l.text).filter((t) => t !== undefined).join("\n");
const assertFits = (lines, W) => {
  for (const l of lines) if (l.text !== undefined) assert.ok(l.text.length <= W, `line over ${W} chars: "${l.text}" (${l.text.length})`);
};

const HEADER = { name: "AD’s Cafe", address: "12 Station Road, Near Clock Tower", city: "Purba Burdwan", phone: "9999999999" };
const LONG = "Cheese Fried Chicken Momo - 10 PC";
const VERY_LONG = "Supercalifragilisticexpialidocious Paneer Tikka Masala Family Pack";
const billJob = (over = {}) => ({
  orderId: "ORD00042",
  payload: {
    orderId: "ORD00042", orderType: "DINE_IN", tableNo: 5, paymentMethod: "Cash", paymentStatus: "PENDING_VERIFICATION",
    guestName: "Rahul", guestPhone: "9876543210",
    items: [{ name: "Paneer Tikka", price: 220, qty: 1 }, { name: LONG, price: 180, qty: 2 }, { name: VERY_LONG, price: 1250, qty: 12 }],
    subtotal: 15580, tax: 779, serviceCharge: 150, discount: 0, total: 16509,
    ...over,
  },
});
const kotJob = (over = {}) => ({
  orderId: "ORD00042", orderType: "DINE_IN", tableNo: 5, createdAt: "2026-10-01T07:35:00.000Z",
  items: [{ name: "Chicken Biryani", qty: 2, notes: "less spicy" }, { name: LONG, qty: 1 }, { name: VERY_LONG, qty: 10 }],
  ...over,
});

const run = async () => {
  console.log("── Renderers ───────────────────────────────────────────────");

  // ── BILL ──
  await test("bill: header, TAX INVOICE, order details, items and totals", () => {
    const lines = renderBill(billJob(), { header: HEADER, footer: "Powered by Zen OS" });
    const t = text(lines);
    assert.match(t, /AD's Cafe/);                 // typographic ’ made printable
    assert.match(t, /12 Station Road/);
    assert.match(t, /Ph: 9999999999/);
    assert.match(t, /TAX INVOICE/);
    assert.match(t, /Bill No {4}: +ORD00042/);
    assert.match(t, /Type {7}: +Dine In/);
    assert.match(t, /Table {6}: +5/);
    assert.match(t, /Payment {4}: +Cash \(Pending\)/);
    assert.match(t, /Customer {3}: +Rahul/);
    assert.match(t, /Phone {6}: +9876543210/);
    assert.match(t, /Paneer Tikka +1 +Rs220/);
    assert.match(t, /Subtotal {5}: +Rs15580/);
    assert.match(t, /GST {10}: +Rs779/);
    assert.match(t, /Service Chg {2}: +Rs150/);
    assert.match(t, /Thank you! Visit again :\)/);
    assert.match(t, /Powered by Zen OS/);
    const total = lines.find((l) => /^TOTAL/.test(l.text || ""));
    assert.match(total.text, /Rs16509$/);
    assert.equal(total.bold, true);
    assert.equal(lines.find((l) => l.text === "TAX INVOICE").bold, true);
    assert.equal(lines.at(-1).type, "cut");
  });

  await test("bill: all label colons line up", () => {
    const lines = renderBill(billJob(), { header: HEADER });
    const detail = lines.filter((l) => /^(Bill No|Type|Table|Date|Time|Payment|Customer|Phone) /.test(l.text || ""));
    assert.equal(new Set(detail.map((l) => l.text.indexOf(":"))).size, 1);
    const totals = lines.filter((l) => /^(Subtotal|Discount|GST|Service Chg|TOTAL) /.test(l.text || ""));
    assert.equal(new Set(totals.map((l) => l.text.indexOf(":"))).size, 1);
  });

  await test("bill: prints only the pricing rows the order has (no invented values)", () => {
    const t = text(renderBill(billJob({ tax: 0, serviceCharge: 0, discount: 0, subtotal: 100, total: 100, items: [{ name: "Tea", qty: 1, price: 100 }] })));
    assert.doesNotMatch(t, /GST|Service Chg|Discount/);
    assert.match(t, /TOTAL {8}: +Rs100/);
  });

  await test("bill: coupon discount shown with its code", () => {
    assert.match(text(renderBill(billJob({ discount: 50, couponCode: "SPECIAL50" }))), /Discount {5}: +\(SPECIAL50\) -Rs50/);
  });

  await test("bill: missing phone / customer lines are left out, takeaway has no table", () => {
    const t = text(renderBill(billJob({ guestPhone: "", guestName: "", orderType: "TAKEAWAY", tableNo: null })));
    assert.doesNotMatch(t, /Phone {6}:|Customer {3}:|Table {6}:/);
    assert.match(t, /Type {7}: +Takeaway/);
  });

  await test("bill: ONLINE type and Online/Paid payment", () => {
    const t = text(renderBill(billJob({ orderType: "ONLINE", paymentMethod: "Online", paymentStatus: "PAID" })));
    assert.match(t, /Type {7}: +Online/);
    assert.match(t, /Payment {4}: +Online \(Paid\)/);
  });

  await test("bill: a long item name wraps; qty and amount stay in their columns", () => {
    const lines = renderBill(billJob(), { width: 48 });
    const first = lines.find((l) => (l.text || "").startsWith("Supercalifragilistic"));
    assert.match(first.text, / 12 Rs15000$/);
    assert.ok(lines.some((l) => l.text === "Paneer Tikka Masala Family Pack"));
    const amountCol = lines.filter((l) => /Rs\d+$/.test(l.text || "") && /^\S/.test(l.text) && !/:/.test(l.text));
    assert.equal(new Set(amountCol.map((l) => l.text.length)).size, 1); // right edge aligned
  });

  await test("bill: logo first when given; restaurantName on the job wins over the profile", () => {
    const logo = { width: 8, height: 8, data: Buffer.alloc(256, 255) };
    const lines = renderBill(billJob({ restaurantName: "Branch Two" }), { header: HEADER, logo });
    assert.equal(lines[0].type, "image");
    assert.equal(lines[1].text, "Branch Two");
    assert.equal(lines[1].size, "large");
  });

  await test("bill (combined): one bill, items grouped per order, summed totals, due amount", () => {
    const job = { orderId: "2 orders", payload: {
      combined: true, orderId: "2 orders", orderType: "DINE_IN", tableNo: 5, paymentStatus: "PENDING_VERIFICATION",
      orders: [
        { orderId: "ORD00045", total: 450, paymentStatus: "PAID", items: [{ name: "Chicken Biryani", qty: 2, price: 200 }] },
        { orderId: "ORD00048", total: 320, paymentStatus: "PENDING_VERIFICATION", items: [{ name: "Pizza", qty: 1, price: 280 }] },
      ],
      subtotal: 680, discount: 0, tax: 60, serviceCharge: 30, total: 770, dueTotal: 320,
    } };
    const t = text(renderBill(job, { header: HEADER }));
    assert.match(t, /COMBINED BILL - 2 ORDERS/);
    assert.match(t, /Orders {5}: +ORD00045, ORD00048/);
    assert.ok(t.indexOf("Order ORD00045 (paid)") < t.indexOf("Chicken Biryani"));
    assert.ok(t.indexOf("Order ORD00048") < t.indexOf("Pizza"));
    assert.match(t, /TOTAL +: +Rs770/);
    assert.match(t, /DUE NOW +: +Rs320/);
    assert.equal((t.match(/TAX INVOICE/g) || []).length, 1);
    // A normal bill is unchanged: no combined lines.
    assert.doesNotMatch(text(renderBill(billJob(), { header: HEADER })), /COMBINED|DUE NOW|Orders {5}:/);
  });

  // ── KOT ──
  await test("kot: header, title, details, items as xN, total items, [ KOT ] footer", () => {
    const lines = renderKot(kotJob(), { header: HEADER });
    const t = text(lines);
    assert.match(t, /AD's Cafe/);
    assert.match(t, /\*\*\* KITCHEN ORDER TICKET \*\*\*/);
    assert.match(t, /Order ID {3}: +ORD00042/);
    assert.match(t, /Table {6}: +5/);
    assert.match(t, /Chicken Biryani +x2/);
    assert.match(t, /Note: less spicy/);
    assert.match(t, /Total Items: 13/);
    // KH-14: bottom line reads "[ KOT ]"; the heading above is unchanged.
    assert.match(t, /\[ KOT \]/);
    assert.doesNotMatch(t, /KITCHEN COPY/);
    assert.equal((t.match(/\*\*\* KITCHEN ORDER TICKET \*\*\*/g) || []).length, 1);
    assert.equal(lines.find((l) => l.text === "[ KOT ]").bold, true);
    assert.equal(lines.find((l) => l.text === "[ KOT ]").align, "center");
    assert.equal(lines.find((l) => l.text === "ITEMS").bold, true);
    assert.equal(lines.at(-1).type, "cut");
  });

  await test("KH-10: AC Room / Garden print as the order type on KOT and bill; old jobs unchanged", () => {
    assert.match(text(renderKot(kotJob({ orderType: "DINE_IN", diningArea: "AC_ROOM" }))), /Type {7}: +AC Room/);
    assert.match(text(renderKot(kotJob({ orderType: "DINE_IN", diningArea: "GARDEN" }))), /Type {7}: +Garden/);
    assert.match(text(renderKot(kotJob({ orderType: "DINE_IN" }))), /Type {7}: +Dine In/);
    assert.match(text(renderKot(kotJob({ orderType: "TAKEAWAY", diningArea: "AC_ROOM" }))), /Type {7}: +Takeaway/, "area ignored unless dine-in");
    assert.match(text(renderBill(billJob({ orderType: "DINE_IN", diningArea: "AC_ROOM" }))), /Type {7}: +AC Room/);
    assert.match(text(renderBill(billJob({ orderType: "DINE_IN", diningArea: "GARDEN" }))), /Type {7}: +Garden/);
    assert.match(text(renderBill(billJob())), /Type {7}: +Dine In/);
  });

  await test("KH-12: add-ons print under their item on the KOT and the bill; plain items unchanged", () => {
    const k = text(renderKot(kotJob({ items: [{ name: "Biryani", qty: 2, addons: ["1 pc Chicken", "Egg"] }, { name: "Tea", qty: 1 }] })));
    assert.match(k, /Biryani +x2\n  \+ 1 pc Chicken\n  \+ Egg\nTea +x1/);
    const b = text(renderBill(billJob({ items: [
      { name: "Biryani", qty: 2, price: 140, addons: [{ name: "1 pc Chicken", price: 40 }] }, { name: "Tea", qty: 1, price: 20 },
    ], subtotal: 300, tax: 0, serviceCharge: 0, total: 300 })));
    assert.match(b, /Biryani +2 +Rs280\n  \+ 1 pc Chicken \(Rs40\)\nTea +1 +Rs20/);
    assert.doesNotMatch(text(renderKot(kotJob())), /^  \+ /m, "no add-on lines on an order without add-ons");
    for (const W of [32, 42, 48]) {
      assertFits(renderKot(kotJob({ items: [{ name: LONG, qty: 1, addons: ["Extra spicy gravy with double cheese topping"] }] }), { width: W }), W);
      assertFits(renderBill(billJob({ items: [{ name: LONG, qty: 1, price: 999, addons: [{ name: "Extra spicy gravy with double cheese topping", price: 120 }] }] }), { width: W }), W);
    }
  });

  await test("kot: the order's own note is printed after the items, in bold", () => {
    const lines = renderKot(kotJob({ notes: "Birthday table — bring candles" }));
    const t = text(lines);
    assert.match(t, /ORDER NOTE: Birthday table/);
    assert.ok(t.indexOf("ORDER NOTE") > t.indexOf("Chicken Biryani"));
    assert.equal(lines.find((l) => /ORDER NOTE/.test(l.text || "")).bold, true);
    assert.doesNotMatch(text(renderKot(kotJob({ notes: "" }))), /ORDER NOTE/);
  });

  await test("kot: never shows any price or total amount", () => {
    const t = text(renderKot(kotJob({ items: [{ name: "Tea", qty: 1, price: 20 }] })));
    assert.doesNotMatch(t, /Rs|Subtotal|TOTAL|Amt|GST/);
  });

  await test("kot: long name wraps with the quantity on its last line at the right edge", () => {
    const rows = kotItemRows(VERY_LONG, 10, 48);
    assert.ok(rows.length > 1);
    assert.match(rows.at(-1).text, /x10$/);
    assert.equal(rows.at(-1).text.length, 48);
    rows.slice(0, -1).forEach((r) => assert.doesNotMatch(r.text, /x10/));
  });

  await test("kot: customer shown only when the job has one", () => {
    assert.doesNotMatch(text(renderKot(kotJob())), /Customer/);
    assert.match(text(renderKot(kotJob({ customerName: "Rahul" }))), /Customer {3}: +Rahul/);
  });

  // ── Width safety across every scenario and paper size ──
  await test("no line ever exceeds the paper width (32 / 42 / 48 chars)", () => {
    const names = ["Customer With A Really Very Long Full Name For Testing Wrap", ""];
    for (const W of [32, 42, 48]) {
      for (const orderType of ["DINE_IN", "TAKEAWAY", "ONLINE"]) {
        for (const guestName of names) {
          assertFits(renderBill(billJob({ orderType, guestName, discount: 25, couponCode: "WELCOME_OFFER_2026" }), { header: HEADER, width: W, footer: "Powered by Zen OS" }), W);
          assertFits(renderKot(kotJob({ orderType, customerName: guestName }), { header: HEADER, width: W }), W);
        }
      }
    }
  });

  // ── Helpers ──
  await test("helpers: wrap, key/value, printable text, money, date", () => {
    assert.deepEqual(wrapText("one two three", 7), ["one two", "three"]);
    assert.deepEqual(wrapText("abcdefghij", 4), ["abcd", "efgh", "ij"]);
    assert.equal(keyValue("Bill No", "X1", 20)[0].text, "Bill No    :      X1");
    assert.equal(toPrintable("Café ‘Ad’s’ ₹ 50 – ok"), "Cafe 'Ad's' Rs 50 - ok");
    assert.equal(toPrintable("আম"), "আম"); // kept — printed as an image (src/textImage.js)
    assert.equal(money(180), "Rs180");
    assert.equal(money(12.5), "Rs12.50");
    assert.equal(money(-50), "-Rs50");
    assert.match(dateTime("2026-10-01T07:35:00Z").date, /^\d{2}\/\d{2}\/2026$/);
    assert.match(dateTime("2026-10-01T07:35:00Z").time, /^\d{2}:\d{2} (AM|PM)$/);
    assert.equal(billItemRows("Tea", 1, "Rs20", 48)[0].text.length, 48);
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
