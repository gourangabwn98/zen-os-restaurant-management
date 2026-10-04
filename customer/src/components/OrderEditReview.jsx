import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAppState } from "../context/AppState.jsx";
import { modifyOrder } from "../services/orderService.js";
import QtyStepper from "./ui/QtyStepper.jsx";
import Button from "./ui/Button.jsx";
import Icon from "./ui/Icon.jsx";
import { VegDot } from "./ItemCard.jsx";

/** ORD-01/02 — the cart screen while an order is being changed: the draft's
 * lines, "+ Add more items" back into the real menu, and Save. The server
 * re-prices everything (taxes included) and refuses once the KOT has fired. */
export default function OrderEditReview() {
  const nav = useNavigate();
  const { cart, orderEdit } = useAppState();
  const [saving, setSaving] = useState(false);
  const { meta } = orderEdit;

  const discard = () => {
    const id = meta.orderId;
    orderEdit.stop();
    nav(`/order/${id}`, { replace: true });
  };

  const save = async () => {
    if (!cart.itemCount) return toast.error("Your order needs at least one item — cancel the order instead");
    setSaving(true);
    try {
      await modifyOrder(meta.orderId, cart.cart.map((c) => ({ menuItemId: c.item._id, qty: c.qty, notes: c.notes || "" })), meta.revision);
      toast.success(`Order #${meta.orderNo} updated`);
      const id = meta.orderId;
      orderEdit.stop();
      nav(`/order/${id}`, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't update your order");
      if (err.response?.status === 409) {
        // Gone to the kitchen, or changed elsewhere — the draft can't be saved.
        const id = meta.orderId;
        orderEdit.stop();
        nav(`/order/${id}`, { replace: true });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-h">
        <button type="button" className="back" onClick={() => nav(-1)}><Icon name="back" />Back</button>
        <h2>Change order #{meta.orderNo}</h2>
        <p className="small">Add, remove or change items before it goes to the kitchen.</p>
      </div>

      <div className="card" style={{ padding: "4px 16px" }}>
        {cart.cart.length === 0 && <p className="muted small" style={{ margin: "14px 0" }}>No items — add something, or cancel the order from its page.</p>}
        {cart.cart.map((c) => (
          <div key={c.item._id} className="cart-line">
            <div className="thumb">
              {c.item.image ? <img src={c.item.image} alt="" loading="lazy" /> : <span aria-hidden="true">🍽️</span>}
            </div>
            <div className="nm">
              <b>{c.item.tag && <VegDot veg={c.item.tag === "Veg"} />}{c.item.name}</b>
              <span className="muted small">₹{c.item.price} each{c.notes ? ` · “${c.notes}”` : ""}</span>
            </div>
            <QtyStepper qty={c.qty} label={`${c.item.name} quantity`} onDec={() => cart.removeItem(c.item._id)} onInc={() => cart.addItem(c.item, 1)} />
            <span className="amt">₹{c.item.price * c.qty}</span>
          </div>
        ))}
        <Link to="/menu" className="btn btn-ghost" style={{ margin: "12px 0", minHeight: 46 }}>+ Add more items</Link>
      </div>

      <div className="card bill">
        <div className="row"><span className="muted">Item total</span><span>₹{cart.subtotal}</span></div>
        <p className="muted tiny" style={{ margin: "6px 0 0" }}>Taxes and any coupon are recalculated by the restaurant when you save.</p>
      </div>

      <Button onClick={save} disabled={saving || cart.itemCount === 0}>{saving ? "Saving…" : "Save changes"}</Button>
      <button type="button" className="btn btn-ghost" style={{ marginTop: 10 }} onClick={discard} disabled={saving}>Discard changes</button>
    </>
  );
}
