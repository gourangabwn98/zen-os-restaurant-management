import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Sheet from "./ui/Sheet.jsx";
import QtyStepper from "./ui/QtyStepper.jsx";
import Button from "./ui/Button.jsx";
import { getMenu } from "../services/menuService.js";
import { modifyOrder } from "../services/orderService.js";

const lineId = (it) => String(it.menuItem?._id ?? it.menuItem);

/**
 * Change an order while it's still editable (before it goes to the
 * kitchen). Prices shown are the menu's; the restaurant's server re-prices
 * everything (and adds taxes) when it's saved.
 */
export default function EditOrderSheet({ order, onClose, onSaved }) {
  const [lines, setLines] = useState(() => (order.items || []).map((it) => ({
    menuItemId: lineId(it), name: it.name, price: it.price, qty: it.qty, notes: it.notes || "",
  })));
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(null);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!adding || menu) return;
    getMenu().then(({ data }) => setMenu(Array.isArray(data) ? data : [])).catch(() => setMenu([]));
  }, [adding, menu]);

  const setQty = (id, d) => setLines((p) => p
    .map((l) => (l.menuItemId === id ? { ...l, qty: Math.min(99, l.qty + d) } : l))
    .filter((l) => l.qty > 0));
  const add = (m) => setLines((p) => (p.some((l) => l.menuItemId === m._id)
    ? p.map((l) => (l.menuItemId === m._id ? { ...l, qty: Math.min(99, l.qty + 1) } : l))
    : [...p, { menuItemId: m._id, name: m.name, price: m.price, qty: 1, notes: "" }]));

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = (menu || []).filter((m) => !(m.stockTracked && !m.stockAvailable));
    return s ? list.filter((m) => m.name.toLowerCase().includes(s) || m.category?.toLowerCase().includes(s)) : list;
  }, [menu, q]);

  const itemsTotal = lines.reduce((s, l) => s + l.price * l.qty, 0);

  const save = async () => {
    if (!lines.length) return toast.error("Your order needs at least one item — cancel it instead");
    setSaving(true);
    try {
      const { data } = await modifyOrder(order._id, lines.map(({ menuItemId, qty, notes }) => ({ menuItemId, qty, notes })), order.revision ?? 0);
      toast.success("Order updated");
      onSaved(data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't update your order");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      label="Change your order"
      onClose={() => !saving && onClose()}
      footer={
        <Button onClick={save} disabled={saving || !lines.length}>
          {saving ? "Saving…" : `Save changes · ₹${itemsTotal} + tax`}
        </Button>
      }
    >
      <h3 style={{ margin: "4px 0 12px" }}>Change your order</h3>

      {lines.map((l) => (
        <div key={l.menuItemId} className="cart-line">
          <div className="nm">
            <b>{l.name}</b>
            <span className="muted small">₹{l.price} each</span>
          </div>
          <QtyStepper qty={l.qty} label={`${l.name} quantity`} onDec={() => setQty(l.menuItemId, -1)} onInc={() => setQty(l.menuItemId, 1)} />
          <span className="amt">₹{l.price * l.qty}</span>
        </div>
      ))}
      {!lines.length && (
        <p className="muted small center" style={{ margin: "14px 0" }}>
          No items left. Add something below, or close this and cancel the order instead.
        </p>
      )}

      {!adding ? (
        <button type="button" className="btn btn-ghost" style={{ marginTop: 12, minHeight: 46 }} onClick={() => setAdding(true)}>
          + Add items
        </button>
      ) : (
        <div style={{ marginTop: 14 }}>
          <label className="field" style={{ margin: 0 }}>
            <span>Add items</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the menu" autoFocus />
          </label>
          {menu === null ? (
            <p className="muted small" style={{ marginTop: 10 }}>Loading menu…</p>
          ) : shown.length === 0 ? (
            <p className="muted small" style={{ marginTop: 10 }}>Nothing matches.</p>
          ) : (
            <div style={{ marginTop: 8 }}>
              {shown.slice(0, 40).map((m) => (
                <div key={m._id} className="cart-line">
                  <div className="nm">
                    <b>{m.name}</b>
                    <span className="muted small">{m.category} · ₹{m.price}</span>
                  </div>
                  <button type="button" className="btn btn-ghost" style={{ width: "auto", minHeight: 38, padding: "0 16px" }}
                    onClick={() => add(m)} aria-label={`Add ${m.name}`}>+ Add</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
