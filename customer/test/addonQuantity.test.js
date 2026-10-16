// Plain Node assertions, mocked React hooks/services, JSX compiled in memory.
// Never loads the app, environment files, database, socket, or printer drivers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as display from "../src/utils/menuDisplay.js";
import { priceItems, computeTotals } from "../../restaurant-server/utils/pricing.js";

const { transformSync } = createRequire(new URL("../../print-service/package.json", import.meta.url))("esbuild");
const item = { _id: "rice", name: "Rice", price: 100, isAvailable: true, addons: [
  { _id: "egg", name: "Boiled Egg", price: 25 }, { _id: "butter", name: "Butter", price: 10 },
  { _id: "disabled", name: "Unavailable extra", price: 5, isAvailable: false },
] };
const store = new Map();
const storage = { getItem: (key) => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
let slots = [], cursor = 0, effects = [];
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useState: (initial) => {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
    return [slots[i], (value) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }];
  },
  useRef: (initial) => { const i = cursor++; return slots[i] ||= { current: initial }; },
  useCallback: (fn) => fn, useEffect: (fn) => effects.push(fn),
};
const reset = () => { slots = []; cursor = 0; effects = []; };
const render = (fn) => { cursor = 0; effects = []; const result = fn(); effects.forEach((fn) => fn()); return result; };
const QtyStepper = () => {};
const Button = () => {};
const Sheet = () => {};
const stub = () => {};
let cart, editing, captured;
const imports = (id) => {
  if (id === "react") return react;
  if (id.endsWith("menuDisplay.js")) return display;
  if (id.endsWith("useCart.js")) return cartModule;
  if (id.endsWith("AppState.jsx")) return { useAppState: () => ({ cart, orderEdit: editing, favorites: { isFavorite: () => false, toggle: stub } }) };
  if (id.endsWith("useMenu.js")) return { isOutOfStock: () => false };
  if (id.endsWith("menuService.js")) return { getMenu: async () => ({ data: [item] }) };
  if (id.endsWith("QtyStepper.jsx")) return { default: QtyStepper, __esModule: true };
  if (id.endsWith("Button.jsx")) return { default: Button, __esModule: true };
  if (id.endsWith("Sheet.jsx")) return { default: Sheet, __esModule: true };
  if (id.endsWith("ItemCard.jsx")) return { VegDot: stub, Stars: stub, HeartButton: stub };
  if (id.endsWith("CartLine.jsx")) return lineModule;
  if (id === "react-router-dom") return { Link: stub, useNavigate: () => stub };
  if (id === "react-hot-toast") return { default: { success: stub, error: (message) => { throw new Error(message); } }, __esModule: true };
  if (id.endsWith("orderService.js")) return { modifyOrder: async (id, items, revision) => { captured = { id, items, revision }; } };
  if (id.endsWith("Icon.jsx")) return { default: stub, __esModule: true };
  throw new Error(`Unexpected import: ${id}`);
};
const load = (path) => {
  const module = { exports: {} };
  const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), { loader: "jsx", format: "cjs" }).code;
  runInNewContext(code, { module, exports: module.exports, require: imports, React: react, localStorage: storage, sessionStorage: storage });
  return module.exports;
};
const cartModule = load("../src/hooks/useCart.js");
const lineModule = load("../src/components/CartLine.jsx");
const sheetModule = load("../src/components/ItemDetailSheet.jsx");
const editModule = load("../src/hooks/useOrderEdit.js");
const reviewModule = load("../src/components/OrderEditReview.jsx");
const nodes = (root) => Array.isArray(root) ? root.flatMap(nodes) : root && typeof root === "object"
  ? [root, ...nodes(root.props?.children)] : [];
const rerenderCart = () => { cart = render(() => cartModule.useCart({ storage })); };

// Item-sheet controls generate repeated IDs and a price multiplied by both
// the number of extras and the parent quantity, including batched clicks.
reset();
const sheetProps = { item, onClose: stub, onAdd: (...args) => { captured = args; } };
let tree = render(() => sheetModule.default(sheetProps));
let extraControl = nodes(tree).find((n) => n.type === QtyStepper && n.props.label === "Boiled Egg quantity");
for (let i = 0; i < 15; i++) extraControl.props.onInc();
tree = render(() => sheetModule.default(sheetProps));
extraControl = nodes(tree).find((n) => n.type === QtyStepper && n.props.label === "Boiled Egg quantity");
assert.equal(extraControl.props.qty, 10);
for (let i = 0; i < 7; i++) extraControl.props.onDec();
tree = render(() => sheetModule.default(sheetProps));
tree.props.footer.props.onClick();
assert.deepEqual(Array.from(captured[3]), ["egg", "egg", "egg"]);
assert.equal(nodes(tree).some((n) => n.props.label === "Unavailable extra quantity"), false);

// Shopping-cart controls update state, price, API IDs and storage together.
reset(); rerenderCart();
cart.addItem(item, 2, "less spicy", ["egg"]);
cart.addItem(item, 1, "no salt", ["egg"]);
rerenderCart();
assert.equal(cart.cart.length, 2);
const key = display.keyOf(cart.cart[0]);
for (const quantity of [2, 3, 2, 1, 0]) {
  tree = lineModule.default({ line: cart.cart[0], cart });
  const control = nodes(tree).find((n) => n.type === QtyStepper && n.props.label === "Boiled Egg quantity");
  (quantity > control.props.qty ? control.props.onInc : control.props.onDec)();
  rerenderCart();
  assert.equal(cart.cart[0].addonIds.length, quantity);
  assert.equal(display.keyOf(cart.cart[0]), key, "changing extras keeps row identity");
  assert.equal(cart.cart[0].qty, 2);
  assert.equal(cart.cart[1].notes, "no salt");
  assert.equal(cart.cart[1].addons[0].qty, 1);
  assert.equal(cart.subtotal, (100 + 25 * quantity) * 2 + 125);
  const payload = cart.cart.map(lineModule.toOrderLine);
  const saved = await priceItems(payload, { findById: async () => item });
  assert.equal(computeTotals(saved, {}).total, cart.subtotal, "actual server repricing agrees");
  assert.equal(saved[0].addons?.[0]?.qty || (saved[0].addons?.length ? 1 : 0), quantity);
}
const persisted = JSON.stringify(cart.cart);
reset(); rerenderCart();
assert.equal(JSON.stringify(cart.cart), persisted, "reload retains extra removal and prices");
cart.addItem(item, 1, "no salt", ["egg"]); rerenderCart();
assert.equal(cart.cart.length, 2, "same variant and note adds quantity without duplicates");
assert.equal(cart.cart[1].qty, 2);
cart.addItem(item, 1, "less spicy", ["egg", "egg", "butter"]); rerenderCart();
assert.equal(cart.cart[2].addons.length, 2);
assert.equal(cart.cart[2].unitPrice, 160);

// Existing cart versions stored duplicate snapshots for repeated IDs.
const legacy = { item, qty: 1, notes: "", key: "legacy", addonIds: ["egg", "egg"], unitPrice: 150,
  addons: [{ addonId: "egg", name: "Boiled Egg", price: 25 }, { addonId: "egg", name: "Boiled Egg", price: 25 }] };
storage.setItem("sohoj_cart_v1", JSON.stringify([legacy]));
reset(); rerenderCart();
assert.equal(cart.cart[0].addons.length, 1);
assert.equal(cart.cart[0].addons[0].qty, 2);
cart.changeAddonQty("legacy", "egg", -1); rerenderCart();
assert.equal(cart.subtotal, 125, "legacy snapshot normalization preserves base price");
cart.removeItem("legacy"); rerenderCart();
assert.equal(cart.cart.length, 0, "normal parent removal still works");

// Hydrate an existing editable order, retain raw names/quantities, and send
// changed repeated IDs plus each original note and the original revision.
reset();
editing = render(() => editModule.useOrderEdit());
await editing.start({ _id: "o1", orderId: "ORD1", revision: 7, items: ["less spicy", "no salt"].map((notes) => ({
  menuItem: "rice", name: "Rice", qty: 1, price: 175, basePrice: 100, notes,
  addons: [{ addonId: "egg", name: "Boiled Egg", price: 25, qty: 3 }],
})) });
editing = render(() => editModule.useOrderEdit()); cart = editing.draft;
assert.notEqual(display.keyOf(cart.cart[0]), display.keyOf(cart.cart[1]));
assert.equal(cart.cart[0].addons[0].name, "Boiled Egg");
cart.changeAddonQty(display.keyOf(cart.cart[0]), "egg", -1);
editing = render(() => editModule.useOrderEdit()); cart = editing.draft;
assert.equal(cart.cart[0].addons[0].qty, 2);
assert.equal(cart.cart[1].addons[0].qty, 3);
assert.equal(cart.subtotal, 325);
// The review component has its own hook state in a real component instance.
reset(); tree = render(() => reviewModule.default());
await nodes(tree).find((n) => n.type === Button).props.onClick();
assert.equal(captured.id, "o1");
assert.equal(captured.revision, 7);
assert.deepEqual(Array.from(captured.items[0].addonIds), ["egg", "egg"]);
assert.deepEqual(Array.from(captured.items[1].addonIds), ["egg", "egg", "egg"]);
assert.equal(captured.items[0].notes, "less spicy");
assert.equal(captured.items[1].notes, "no salt");
console.log("addonQuantity.test.js: item sheet, cart, cap, removal, totals, reload, notes, edit hydration and save payload passed");
