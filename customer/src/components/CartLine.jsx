import QtyStepper from "./ui/QtyStepper.jsx";
import { VegDot } from "./ItemCard.jsx";
import { keyOf, lineUnitPrice, nameWithSize } from "../utils/menuDisplay.js";

/** One cart / order-edit line: item (with size), its add-on on its own row,
 * ₹ each and the line amount. Prices are a preview; the server re-prices. */
export default function CartLine({ line: c, cart }) {
  const key = keyOf(c);
  const name = nameWithSize(c.item.name, c.item.size);
  const unit = lineUnitPrice(c);
  return (
    <div className="cart-line">
      <div className="thumb">
        {c.item.image ? <img src={c.item.image} alt="" loading="lazy" /> : <span aria-hidden="true">🍽️</span>}
      </div>
      <div className="nm">
        <b>{c.item.tag && <VegDot tag={c.item.tag} />}{name}</b>
        {(c.addons || []).map((a) => (
          <span key={a.addonId} className="small addon-line">+ {a.name} ₹{a.price}</span>
        ))}
        <span className="muted small">₹{unit} each{c.notes ? ` · “${c.notes}”` : ""}</span>
      </div>
      <QtyStepper qty={c.qty} label={`${name} quantity`} onDec={() => cart.removeItem(key)} onInc={() => cart.incLine(key)} />
      <span className="amt">₹{unit * c.qty}</span>
    </div>
  );
}

/** A cart line as the order API wants it: ids only, never a price. */
export const toOrderLine = (c) => ({
  menuItemId: c.item._id, qty: c.qty,
  ...(c.addonIds?.length && { addonIds: c.addonIds }),
});
