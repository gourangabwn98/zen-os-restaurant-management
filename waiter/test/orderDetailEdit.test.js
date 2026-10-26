// Compile JSX in memory and exercise the page's real handlers with stubbed
// hooks/services. No browser, files generated, network, backend, or printers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as addons from "../src/utils/addons.js";
import * as draft from "../src/utils/orderDraft.js";

const requireTools = createRequire(new URL("../../print-service/package.json", import.meta.url));
const { transformSync } = requireTools("esbuild");
const hooks = [];
let cursor = 0;
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useState: (initial) => {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
    return [hooks[index], (value) => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }];
  },
  useEffect: () => {}, useCallback: (fn) => fn, useMemo: (fn) => fn(),
};
const initial = { _id: "o1", orderId: "ORD1", revision: 3, status: "PREPARING", stockDeducted: true,
  orderType: "DINE_IN", paymentStatus: "PENDING_VERIFICATION", total: 450,
  items: ["less spicy", "no salt"].map((notes) => ({ menuItem: "rice", name: "Rice", qty: 1,
    price: 225, basePrice: 200, notes, addons: [{ addonId: "egg", name: "Boiled Egg", price: 25 }] })) };
let captured;
const errors = [];
const menu = [{ _id: "rice", name: "Rice", price: 200, addons: [{ _id: "egg", name: "Boiled Egg", price: 25 }, { _id: "sauce", name: "Sauce", price: 5 }] }];
const services = {
  newIdempotencyKey: () => "test-key", getOrder: async () => ({ data: initial }),
  getCombinedBill: async () => ({ data: { orders: [] } }),
  modifyOrderItems: async (id, items, revision) => {
    captured = { id, items, revision };
    return { data: { ...initial, revision: revision + 1, items: items.map((i) => ({ ...i, menuItem: i.menuItemId, name: "Rice", price: 200 + i.addonIds.length * 25 })) } };
  },
};
const QtyStepper = () => {};
const AddonPicker = () => {};
const stub = () => {};
const imports = (id) => {
  if (id === "react") return react;
  if (id === "react-router-dom") return { useParams: () => ({ id: "o1" }), useLocation: () => ({ state: { order: initial } }) };
  if (id === "react-hot-toast") return { default: { success: () => {}, error: (message) => errors.push(message) }, __esModule: true };
  if (id.endsWith("orderService.js")) return services;
  if (id.endsWith("orderDataCache.js")) return { peekOrderData: () => null, fetchOrderData: async () => menu };
  if (id.endsWith("utils/addons.js")) return addons;
  if (id.endsWith("orderDraft.js")) return draft;
  if (id.endsWith("i18n/index.jsx")) return { t: (s) => s, N_: (s) => s, tn: (n, s) => s, localName: (o) => o.name };
  if (id.endsWith("QtyStepper.jsx")) return { default: QtyStepper, AddButton: stub, __esModule: true };
  if (id.endsWith("AddonPicker.jsx")) return { default: AddonPicker, AddonHint: stub, __esModule: true };
  if (id.endsWith("StatusBadge.jsx")) return { default: stub, statusColor: () => "blue", STATUS_LABEL: {}, __esModule: true };
  if (id.endsWith("diningArea.js")) return { tableLabel: () => "Indoor 1" };
  return new Proxy({ default: stub, __esModule: true }, { get: (o, key) => key in o ? o[key] : stub });
};
const module = { exports: {} };
runInNewContext(transformSync(readFileSync(new URL("../src/pages/OrderDetailPage.jsx", import.meta.url), "utf8"),
  { loader: "jsx", format: "cjs" }).code, { module, exports: module.exports, require: imports, React: react });
const render = () => { cursor = 0; return module.exports.default(); };
const nodes = (root) => {
  if (Array.isArray(root)) return root.flatMap(nodes);
  return root && typeof root === "object" ? [root, ...nodes(root.props?.children)] : [];
};
const text = (node) => Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props.children) : String(node ?? "");
const button = (tree, label) => nodes(tree).find((n) => (n.type === "button" || n.type === stub) && n.props.onClick && text(n).includes(label));
let tree = render();
button(tree, "Edit items").props.onClick();
tree = render();
const addonControls = () => nodes(tree).filter((n) => n.type === QtyStepper && n.props.size === "xs");
for (const quantity of [2, 3, 2, 1, 0]) {
  const controls = addonControls();
  const oldQuantity = controls[0].props.qty;
  (quantity > oldQuantity ? controls[0].props.onInc : controls[0].props.onDec)();
  tree = render();
  assert.ok(text(tree).includes(`₹${200 + quantity * 25 + 225}`), "live subtotal updates");
}
assert.equal(addonControls().length, 1, "first extra removed at zero; second noted row remains");
await button(tree, "Extras").props.onClick();
tree = render();
const picker = nodes(tree).find((n) => n.type === AddonPicker);
assert.deepEqual(Array.from(picker.props.initialIds), []);
picker.props.onConfirm(["egg", "egg", "sauce"]);
tree = render();
// Simulate polling changing the displayed order while the draft is open.
hooks[0] = { ...hooks[0], revision: 99 };
tree = render();
await button(tree, "Save changes").props.onClick();
assert.equal(captured.id, "o1");
assert.equal(captured.revision, 3, "save must retain the draft's original revision");
assert.deepEqual(Array.from(captured.items[0].addonIds), ["egg", "egg", "sauce"]);
assert.equal(captured.items[0].notes, "less spicy");
assert.deepEqual(Array.from(captured.items[1].addonIds), ["egg"]);
assert.equal(captured.items[1].notes, "no salt");
assert.equal(captured.items[1].qty, 1);
assert.deepEqual(errors, []);
console.log("orderDetailEdit.test.js: actual JSX handlers update extras, subtotal, payload and preserve revision/notes");

// Exercise the picker's real functional updater, including clicks batched
// before React renders again (the old render-captured count missed the cap).
hooks.length = 0;
cursor = 0;
const pickerModule = { exports: {} };
runInNewContext(transformSync(readFileSync(new URL("../src/components/AddonPicker.jsx", import.meta.url), "utf8"),
  { loader: "jsx", format: "cjs" }).code, { module: pickerModule, exports: pickerModule.exports, require: imports, React: react });
let picked;
const pickerProps = { item: menu[0], initialIds: ["egg"], onCancel: () => {}, onConfirm: (ids) => { picked = ids; } };
const renderPicker = () => { cursor = 0; return pickerModule.exports.default(pickerProps); };
let pickerTree = renderPicker();
const plus = nodes(pickerTree).find((n) => n.props["aria-label"] === "+ Boiled Egg");
for (let i = 0; i < 15; i++) plus.props.onClick();
pickerTree = renderPicker();
button(pickerTree, "Add with extra").props.onClick();
assert.equal(picked.length, 10);
for (let i = 0; i < 12; i++) {
  nodes(pickerTree).find((n) => n.props["aria-label"] === "− Boiled Egg").props.onClick();
}
pickerTree = renderPicker();
assert.ok(nodes(pickerTree).find((n) => n.props["aria-label"] === "− Boiled Egg").props.disabled);
button(pickerTree, "No extra").props.onClick();
assert.equal(picked.length, 0);
console.log("orderDetailEdit.test.js: actual picker handlers initialize extras, cap rapid increases and remove at zero");
