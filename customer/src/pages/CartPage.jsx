import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAppState } from "../context/AppState.jsx";
import { placeOrder, saveGuestOrderToken, newIdempotencyKey } from "../services/orderService.js";
import { getRestaurantProfile } from "../services/restaurantService.js";
import { EmptyState } from "../components/StateViews.jsx";
import TableBadge from "../components/TableBadge.jsx";
import { PINK, PINK_LIGHT, TEXT_MUTED, TEXT_FAINT, BORDER, NAV_HEIGHT } from "../theme.js";

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
      <div style={{ paddingTop: 40 }}>
        <EmptyState
          icon="🛒" title="Your cart is empty" sub="Add something tasty from the menu"
          action={
            <button onClick={() => nav("/")} style={primaryBtnStyle}>Browse Menu</button>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: NAV_HEIGHT + 120 }}>
      <div style={{ padding: "16px 16px 4px", fontSize: 18, fontWeight: 800 }}>Your Cart</div>

      {/* ── Items ── */}
      <div style={{ padding: "8px 16px" }}>
        {cart.cart.map((c) => (
          <div key={c.item._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.item.name}</div>
              <div style={{ fontSize: 12, color: TEXT_FAINT }}>₹{c.item.price} each{c.notes ? ` · "${c.notes}"` : ""}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, border: `1.5px solid ${PINK}`, borderRadius: 8, padding: "4px 10px" }}>
              <button onClick={() => cart.removeItem(c.item._id)} style={qtyBtn}>−</button>
              <span style={{ fontWeight: 700, fontSize: 13, minWidth: 14, textAlign: "center" }}>{c.qty}</span>
              <button onClick={() => cart.addItem(c.item, 1)} style={qtyBtn}>+</button>
            </div>
            <div style={{ width: 54, textAlign: "right", fontWeight: 700, fontSize: 13 }}>₹{c.item.price * c.qty}</div>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", fontWeight: 800, fontSize: 14 }}>
          <span>Subtotal</span>
          <span>₹{cart.subtotal}</span>
        </div>
        <div style={{ fontSize: 11, color: TEXT_FAINT, marginTop: -8 }}>{gstNote}</div>
      </div>

      {/* ── Customer details ── */}
      <Section title="Customer Details">
        <Field label="Your Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" style={inputStyle} />
        </Field>
        <Field label="Phone Number">
          <input
            value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="10-digit mobile number" inputMode="numeric" style={inputStyle}
          />
        </Field>
        {!auth.isLoggedIn && (
          <div style={{ fontSize: 11.5, color: TEXT_FAINT, marginTop: 2 }}>
            Ordering as guest. <span onClick={() => nav("/profile")} style={{ color: PINK, fontWeight: 700, cursor: "pointer" }}>Log in</span> to save order history.
          </div>
        )}
      </Section>

      {/* ── Order type ── */}
      <Section title="Order Type">
        {table.isDineIn ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <TableBadge label={table.tableLabel} onClear={() => { table.clearTable(); setOrderType("TAKEAWAY"); }} />
            <div style={{ fontSize: 12, color: TEXT_FAINT }}>
              Ordering for dine-in at your scanned table. Not your table? Tap ✕ above to switch to takeaway.
            </div>
          </div>
        ) : (
          <div>
            <div style={{
              padding: "12px 14px", borderRadius: 10, border: `1.5px solid ${PINK}`,
              background: PINK_LIGHT, fontSize: 13, fontWeight: 700, color: PINK,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              🛍️ Takeaway — you'll collect this order at the restaurant
            </div>
            <div style={{ fontSize: 11.5, color: TEXT_FAINT, marginTop: 8 }}>
              For dine-in, scan the QR code on your table before ordering — we don't accept manually-entered table numbers, to make sure your order reaches the right table.
            </div>
          </div>
        )}
      </Section>

      {/* ── Payment method ── */}
      <Section title="Payment Method">
        <div style={{ display: "flex", gap: 10 }}>
          {["Cash", "Online"].map((m) => (
            <button
              key={m}
              onClick={() => setPaymentMethod(m)}
              style={{
                flex: 1, padding: "12px 10px", borderRadius: 10, cursor: "pointer",
                border: `1.5px solid ${paymentMethod === m ? PINK : BORDER}`,
                background: paymentMethod === m ? PINK_LIGHT : "#fff",
                color: paymentMethod === m ? PINK : TEXT_MUTED, fontWeight: 700, fontSize: 13,
              }}
            >
              {m === "Cash"
                ? "💵 Cash at restaurant"
                : phonePeEnabled ? "📱 Pay online (PhonePe)" : "📱 UPI (pay after ordering)"}
            </button>
          ))}
        </div>
        {paymentMethod === "Online" && (
          <div style={{ fontSize: 11.5, color: TEXT_FAINT, marginTop: 8 }}>
            {phonePeEnabled
              ? "After placing the order you'll pay securely via PhonePe. Your order is marked paid automatically once PhonePe confirms."
              : "You'll get a UPI payment link after placing the order. The restaurant confirms receipt manually — your order isn't marked paid just by opening the link."}
          </div>
        )}
      </Section>

      {/* ── Place order ── */}
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: NAV_HEIGHT, padding: "12px 16px",
        background: "#fff", borderTop: `1px solid ${BORDER}`, zIndex: 30,
      }}>
        <button onClick={handlePlace} disabled={!canPlace || placing} style={{
          ...primaryBtnStyle, width: "100%",
          opacity: !canPlace || placing ? 0.5 : 1,
          cursor: !canPlace || placing ? "not-allowed" : "pointer",
        }}>
          {placing ? "Placing order…" : `Place Order · ₹${cart.subtotal}`}
        </button>
      </div>
    </div>
  );
}

const Section = ({ title, children }) => (
  <div style={{ padding: "14px 16px", borderTop: `8px solid #f7f7f8` }}>
    <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>{title}</div>
    {children}
  </div>
);

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 12 }}>
    <label style={{ fontSize: 11.5, fontWeight: 700, color: TEXT_FAINT, display: "block", marginBottom: 6 }}>{label}</label>
    {children}
  </div>
);

const inputStyle = {
  width: "100%", padding: "11px 13px", borderRadius: 10, border: `1px solid ${BORDER}`,
  fontSize: 14, boxSizing: "border-box", fontFamily: "inherit",
};

const qtyBtn = { border: "none", background: "none", color: PINK, fontWeight: 800, fontSize: 15, cursor: "pointer", width: 16 };

const primaryBtnStyle = {
  padding: "14px 20px", borderRadius: 14, border: "none", background: PINK,
  color: "#fff", fontWeight: 800, fontSize: 14.5,
};
