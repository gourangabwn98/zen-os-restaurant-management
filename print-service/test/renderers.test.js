import assert from "node:assert/strict";
import { renderKot } from "../src/renderers/kotRenderer.js";
import { renderBill } from "../src/renderers/billRenderer.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}`); console.error(`         ${err.message}`); }
};

const run = async () => {
  console.log("── Renderers ───────────────────────────────────────────────");

  await test("renderKot includes order id, table, and every item with qty", () => {
    const lines = renderKot({
      orderId: "ORD00042", tableNo: 5, orderType: "DINE_IN",
      items: [{ name: "Chicken Biryani", qty: 2, notes: "less spicy" }, { name: "Cold Coffee", qty: 1 }],
    });
    const text = lines.map((l) => l.text).filter(Boolean).join("\n");
    assert.match(text, /ORD00042/);
    assert.match(text, /Table: 5/);
    assert.match(text, /2 x Chicken Biryani/);
    assert.match(text, /less spicy/);
    assert.match(text, /1 x Cold Coffee/);
    assert.ok(lines.some((l) => l.type === "cut"), "must end with a cut command");
  });

  await test("renderBill includes totals and payment status", () => {
    const lines = renderBill({
      orderId: "ORD00042",
      payload: {
        orderId: "ORD00042", items: [{ name: "Paneer Tikka", price: 220, qty: 1 }],
        subtotal: 220, tax: 11, serviceCharge: 10, total: 241,
        paymentMethod: "Online", paymentStatus: "PENDING_VERIFICATION",
      },
    });
    const text = lines.map((l) => l.text).filter(Boolean).join("\n");
    assert.match(text, /Paneer Tikka/);
    assert.match(text, /TOTAL: Rs\.241\.00/);
    assert.match(text, /PENDING_VERIFICATION/);
    assert.ok(lines.some((l) => l.type === "cut"));
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
