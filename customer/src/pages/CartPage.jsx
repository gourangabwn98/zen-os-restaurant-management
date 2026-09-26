import { useState, useMemo, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import toast from "react-hot-toast";
import { useAppState } from "../context/AppState.jsx";
import { placeOrder, saveGuestOrderToken, newIdempotencyKey } from "../services/orderService.js";
import { getRestaurantProfile } from "../services/restaurantService.js";
import { EmptyState } from "../components/StateViews.jsx";
import TableBadge from "../components/TableBadge.jsx";
import QtyStepper from "../components/ui/QtyStepper.jsx";
import Button from "../components/ui/Button.jsx";
import Icon from "../components/ui/Icon.jsx";
import { VegDot } from "../components/ItemCard.jsx";

export default function CartPage() {
  const nav = useNavigate();
  const { cart, auth, table } = useAppState();

  const [orderType, setOrderType] = useState(table.isDineIn ? "DINE_IN" : "TAKEAWAY");
  const [name, setName]   = useState(auth.user?.name  || "");
  const [phone, setPhone] = useState(auth.user?.phone || "");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [placing, setPlacing] = useState(false);
  const [idemKey] = useState(newIdempotencyKey);
  const [phonePeEnabled, setPhonePeEnabled] = useState(false);

  useEffect(() => {
    getRestaurantProfile()
      .then((r) => setPhonePeEnabled(Boolean(r.data?.data?.phonePeEnabled)))
      .catch(() => {});
  }, []);

  // Table verification (see useTableSession) can resolve asynchronously
  // after this page has already mounted with its initial guess — keep
  // orderType in sync so a slightly-late QR validation isn't missed.
  useEffect(() => {
    if (table.isDineIn) setOrderType("DINE_IN");
  }, [table.isDineIn]);

  const gstNote = "Taxes & charges calculated at checkout by the restaurant";

  const canPlace = useMemo(() => {
    if (cart.itemCount === 0) return false;
    if (!name.trim()) return false;
    if (!/^\d{10}$/.test(phone.replace(/\D/g, ""))) return false;
    if (orderType === "DINE_IN" && !table.isDineIn) return false;
    return true;
  }, [cart.itemCount, name, phone, orderType, table.isDineIn]);

  const handlePlace = async () => {
    if (!canPlace || placing) return;
    setPlacing(true);
    try {
      const body = {
        items: cart.cart.map((c) => ({ menuItemId: c.item._id, qty: c.qty, notes: c.notes })),
        orderType,
        tableNo: orderType === "DINE_IN" ? table.tableNo : undefined,
        tableToken: orderType === "DINE_IN" ? table.tableToken : undefined,
        customerName: name.trim(),
        customerPhone: phone.replace(/\D/g, ""),
        paymentMethod,
        notes: "",
        idempotencyKey: idemKey,
      };
      const { data: order } = await placeOrder(body);

      if (!auth.isLoggedIn && order.guestAccessToken) {
        saveGuestOrderToken(order._id, order.guestAccessToken);
      }

      cart.clearCart();
      toast.success(`Order ${order.orderId} placed!`);
      nav(`/order/${order._id}`, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't place your order. Please try again.");
    } finally {
      setPlacing(false);
    }
  };

  if (cart.itemCount === 0) {
    return (
      <EmptyState
        icon="🛒" title="Your cart is empty" sub="Add something tasty from the menu"
        action={<Link to="/menu" className="btn btn-primary">Browse menu</Link>}
      />
    );
  }

  // Why the button is disabled — shown right above it so it's never a mystery.
  const blocker = !name.trim() ? "Enter your name to place the order"
    : !/^\d{10}$/.test(phone.replace(/\D/g, "")) ? "Enter a 10-digit mobile number"
    : orderType === "DINE_IN" && !table.isDineIn ? "Scan your table's QR code for dine-in"
    : null;

  return (
    <>
      <div className="page-h">
        <button type="button" className="back" onClick={() => nav(-1)}><Icon name="back" />Back</button>
        <h2>Your order{table.isDineIn ? ` · ${table.tableLabel}` : ""}</h2>
      </div>

      {/* ── Items ── */}
      <div className="card" style={{ padding: "4px 16px" }}>
        {cart.cart.map((c) => (
          <div key={c.item._id} className="cart-line">
            <div className="thumb">
              {c.item.image ? <img src={c.item.image} alt="" loading="lazy" /> : <span aria-hidden="true">🍽️</span>}
            </div>
            <div className="nm">
              <b><VegDot veg={c.item.tag === "Veg"} />{c.item.name}</b>
              <span className="muted small">₹{c.item.price} each{c.notes ? ` · “${c.notes}”` : ""}</span>
            </div>
            <QtyStepper
              qty={c.qty} label={`${c.item.name} quantity`}
              onDec={() => cart.removeItem(c.item._id)} onInc={() => cart.addItem(c.item, 1)}
            />
            <span className="amt">₹{c.item.price * c.qty}</span>
          </div>
        ))}
        <Link to="/menu" className="btn btn-ghost" style={{ margin: "12px 0", minHeight: 46 }}>+ Add more items</Link>
      </div>

      {/* ── Customer details ── */}
      <div className="two">
        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoComplete="name" />
        </label>
        <label className="field">
          <span>Mobile</span>
          <input
            value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="10-digit number" inputMode="numeric" autoComplete="tel-national"
          />
        </label>
      </div>
      {!auth.isLoggedIn && (
        <p className="muted small">
          Ordering as guest. <Link to="/profile" className="link-btn" style={{ textDecoration: "none" }}>Log in</Link> to save order history.
        </p>
      )}

      {/* ── Order type ── */}
      <div className="card">
        <div className="card-title">Order type</div>
        {table.isDineIn ? (
          <>
            <TableBadge onClear={() => setOrderType("TAKEAWAY")} />
            <p className="muted small" style={{ marginTop: 8 }}>
              Ordering for dine-in at your scanned table. Not your table? Tap ✕ above to switch to takeaway.
            </p>
          </>
        ) : (
          <>
            <div className="opt is-on" style={{ margin: "8px 0" }}>
              <span className="ic">🛍️</span>
              <span><b>Takeaway</b><span className="muted small">You'll collect this order at the restaurant</span></span>
            </div>
            <p className="muted small">
              For dine-in, scan the QR code on your table before ordering — we don't accept manually-entered table numbers, to make sure your order reaches the right table.
            </p>
          </>
        )}
      </div>

      {/* ── Bill ── */}
      <div className="card bill">
        <div className="row"><span className="muted">Item total</span><span>₹{cart.subtotal}</span></div>
        <div className="row"><span className="muted">Taxes & charges</span><span className="muted small">added on the bill</span></div>
        <div className="row total"><span>To pay</span><span>₹{cart.subtotal}<span className="muted small"> + tax</span></span></div>
        <p className="muted tiny" style={{ marginTop: 6 }}>{gstNote}</p>
      </div>

      {/* ── Payment method ── */}
      <div role="radiogroup" aria-label="Payment method">
        {["Cash", "Online"].map((m) => (
          <button
            key={m} type="button" role="radio" className="opt" aria-checked={paymentMethod === m}
            onClick={() => setPaymentMethod(m)}
          >
            <span className="ic">{m === "Cash" ? "💵" : "📲"}</span>
            <span>
              <b>{m === "Cash" ? "Cash at restaurant" : phonePeEnabled ? "Pay online (PhonePe)" : "UPI (pay after ordering)"}</b>
              <span className="muted small">
                {m === "Cash"
                  ? "Pay at the counter — cash, UPI or card"
                  : phonePeEnabled
                    ? "After placing the order you'll pay securely via PhonePe. Your order is marked paid automatically once PhonePe confirms."
                    : "You'll get a UPI payment link after placing the order. The restaurant confirms receipt manually — your order isn't marked paid just by opening the link."}
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* ── Place order ── */}
      {blocker && <div className="notice" role="status">{blocker}</div>}
      <Button style={{ marginTop: 8 }} onClick={handlePlace} disabled={!canPlace || placing}>
        {placing ? "Placing order…" : `Place order · ₹${cart.subtotal}`}
      </Button>
      <p className="muted small center" style={{ marginTop: 10 }}>
        The restaurant confirms every order before it goes to the kitchen.
      </p>
    </>
  );
}
