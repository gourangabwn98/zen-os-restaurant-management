import { useState, useMemo, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import toast from "react-hot-toast";
import { useAppState } from "../context/AppState.jsx";
import { placeOrder, quoteOrder, saveGuestOrderToken, newIdempotencyKey } from "../services/orderService.js";
import { checkCoupon } from "../services/couponService.js";
import { getRestaurantProfile } from "../services/restaurantService.js";
import { initiatePhonePePayment } from "../services/paymentService.js";
import { EmptyState } from "../components/StateViews.jsx";
import TableBadge from "../components/TableBadge.jsx";
import QtyStepper from "../components/ui/QtyStepper.jsx";
import Button from "../components/ui/Button.jsx";
import Icon from "../components/ui/Icon.jsx";
import { VegDot } from "../components/ItemCard.jsx";
import CouponSheet from "../components/CouponSheet.jsx";
import OrderEditReview from "../components/OrderEditReview.jsx";
import { describeCoupon } from "../utils/coupon.js";

const LOGIN_REQUIRED = "LOGIN_REQUIRED";
const rupees = (n) => `₹${Math.round((Number(n) || 0) * 100) / 100}`;

export default function CartPage() {
  const { orderEdit } = useAppState();
  // ORD-02: changing a placed order — the cart screen reviews and saves it.
  if (orderEdit.active) return <OrderEditReview />;
  return <ShoppingCart />;
}

function ShoppingCart() {
  const nav = useNavigate();
  const location = useLocation();
  const { cart, auth, table } = useAppState();

  const [orderType, setOrderType] = useState(table.isDineIn ? "DINE_IN" : "TAKEAWAY");
  // SET-01: which services the restaurant has switched on (Admin → Profile).
  // The server refuses a switched-off one too; this just never offers it.
  const [services, setServices] = useState({ dineIn: true, takeAway: true, delivery: false });
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [placing, setPlacing] = useState(false);
  const [idemKey] = useState(newIdempotencyKey);
  const [phonePeEnabled, setPhonePeEnabled] = useState(false);
  // Admin → Profile → Payment (server: utils/paymentMode.js). The server
  // enforces it too; this only decides which options to offer.
  const [payMode, setPayMode] = useState("BOTH");
  // Applied coupon (public fields from GET /api/coupons). Only its CODE is
  // sent with the order — the server re-checks it and computes the discount.
  const [coupon, setCoupon] = useState(null);
  const [couponOpen, setCouponOpen] = useState(false);

  useEffect(() => {
    getRestaurantProfile()
      .then((r) => {
        const d = r.data?.data || {};
        setPhonePeEnabled(Boolean(d.phonePeEnabled));
        setServices({ dineIn: true, takeAway: true, delivery: false, ...(d.services || {}) });
        const mode = d.effectivePaymentMode || "BOTH";
        setPayMode(mode);
        if (mode === "ONLINE") setPaymentMethod("Online");
        if (mode === "CASH") setPaymentMethod("Cash");
      })
      .catch(() => {});
  }, []);

  const methods = payMode === "CASH" ? ["Cash"] : payMode === "ONLINE" ? ["Online"] : ["Cash", "Online"];
  // Online + PhonePe = pay first: the order reaches the restaurant only once paid.
  const payFirst = paymentMethod === "Online" && phonePeEnabled;

  // Table verification (see useTableSession) can resolve asynchronously
  // after this page has already mounted with its initial guess — keep
  // orderType in sync so a slightly-late QR validation isn't missed.
  // SET-01: the order types this customer can actually use right now.
  const canDineIn = table.isDineIn && services.dineIn !== false;
  const canTakeaway = services.takeAway !== false;
  useEffect(() => {
    if (canDineIn) setOrderType("DINE_IN");
    else if (canTakeaway) setOrderType("TAKEAWAY");
  }, [canDineIn, canTakeaway]);

  // ── Live bill from the server (POST /orders/quote) ──────────────────────
  // The SAME pricing the order is stored with (orderService.priceOrderDraft):
  // item total, coupon, GST, service charge, total payable. Re-asked whenever
  // the items, the coupon or the login change; nothing is computed here.
  const [quote, setQuote] = useState(null);
  const [quoteState, setQuoteState] = useState("loading"); // loading | ok | error
  const quoteKey = JSON.stringify([cart.cart.map((c) => [c.item._id, c.qty]), coupon?.code || "", auth.isLoggedIn]);
  useEffect(() => {
    if (cart.itemCount === 0) return undefined;
    let live = true;
    setQuoteState("loading");
    const h = setTimeout(() => {
      quoteOrder({ items: cart.cart.map((c) => ({ menuItemId: c.item._id, qty: c.qty })), couponCode: coupon?.code || undefined })
        .then(({ data }) => { if (live) { setQuote(data); setQuoteState("ok"); } })
        .catch(() => { if (live) setQuoteState("error"); });
    }, 250);
    return () => { live = false; clearTimeout(h); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- quoteKey captures items, coupon and login
  }, [quoteKey]);

  const couponError = quoteState === "ok" ? quote?.couponError : null;
  const couponOk = Boolean(coupon && quoteState === "ok" && quote?.coupon && !couponError);
  const saving = couponOk ? quote.discount : 0;
  const toPay = quoteState === "ok" ? quote.total : null;

  // Logged out (here or in another tab) → a coupon can't stay applied.
  useEffect(() => {
    if (couponError?.code === LOGIN_REQUIRED) setCoupon(null);
  }, [couponError?.code]);

  const askLogin = () => nav("/login", { state: { from: "/cart" } });

  const applyCoupon = (c) => {
    if (!auth.isLoggedIn) { setCouponOpen(false); toast.error("Please log in to use coupons."); return; }
    setCoupon(c);
    setCouponOpen(false);
    toast.success(`🎟️ ${c.code} applied`);
  };

  // "Apply in cart" from a coupon notification (NotificationsPage) — check
  // it with the server first (dates, who it's for), then apply.
  const pendingCode = location.state?.applyCoupon;
  useEffect(() => {
    if (!pendingCode) return;
    nav(location.pathname, { replace: true, state: null }); // don't re-apply on refresh/back
    if (!auth.isLoggedIn) { toast.error("Please log in to use coupons."); return; }
    checkCoupon(pendingCode)
      .then(({ data }) => applyCoupon(data.coupon))
      .catch((err) => toast.error(err.response?.data?.message || `Couldn't apply ${pendingCode}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCode]);

  // Guests order with no name, phone or login (the server never required them).
  const canPlace = useMemo(() => {
    if (cart.itemCount === 0) return false;
    if (table.checking) return false; // a scanned QR is still being verified
    if (orderType === "DINE_IN" && !canDineIn) return false;
    if (orderType === "TAKEAWAY" && !canTakeaway) return false;
    return true;
  }, [cart.itemCount, table.checking, orderType, canDineIn, canTakeaway]);

  const handlePlace = async () => {
    if (!canPlace || placing) return;
    setPlacing(true);
    try {
      const body = {
        items: cart.cart.map((c) => ({ menuItemId: c.item._id, qty: c.qty, notes: c.notes })),
        orderType,
        tableNo: orderType === "DINE_IN" ? table.tableNo : undefined,
        tableToken: orderType === "DINE_IN" ? table.tableToken : undefined,
        // A logged-in customer's profile; a guest sends nothing.
        customerName: auth.user?.name || undefined,
        customerPhone: auth.user?.phone || undefined,
        paymentMethod,
        // Only a coupon the server just accepted in the quote is sent.
        couponCode: couponOk ? coupon.code : undefined,
        notes: "",
        idempotencyKey: idemKey,
      };
      const { data: order } = await placeOrder(body);

      if (!auth.isLoggedIn && order.guestAccessToken) {
        saveGuestOrderToken(order._id, order.guestAccessToken);
      }

      cart.clearCart();

      if (order.status === "AWAITING_PAYMENT") {
        // Pay-first: straight on to PhonePe. If that can't start, the order
        // page shows a "Pay" button (and the time left to pay).
        try {
          const { data } = await initiatePhonePePayment(order._id);
          if (data?.redirectUrl) { window.location.href = data.redirectUrl; return; }
        } catch (err) {
          toast.error(err.response?.data?.message || "Couldn't open PhonePe — tap Pay on the next screen to try again.");
        }
        nav(`/order/${order._id}`, { replace: true });
        return;
      }

      toast.success(`Order ${order.orderId} placed!`);
      nav(`/order/${order._id}`, { replace: true });
    } catch (err) {
      const msg = err.response?.data?.message || "Couldn't place your order. Please try again.";
      // e.g. the coupon expired while the cart was open — drop it so the
      // customer sees the real price before trying again.
      if (coupon && err.response?.status === 400 && /coupon/i.test(msg)) setCoupon(null);
      toast.error(msg);
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
  const blocker = table.checking ? "Checking your table…"
    : !canDineIn && !canTakeaway
    ? (table.isDineIn ? "Ordering from the table is switched off right now — please ask a waiter." : "Takeaway orders are switched off right now — please ask at the counter.")
    : orderType === "DINE_IN" && !table.isDineIn ? "Scan your table's QR code for dine-in" : null;

  return (
    <>
      <div className="page-h">
        <button type="button" className="back" onClick={() => nav(-1)}><Icon name="back" />Back</button>
        <h2>Your order</h2>
      </div>

      {/* ── CUS-04: the ONE place the cart shows table / order type ── */}
      <div className="card order-type-top">
        {orderType === "DINE_IN" && canDineIn ? (
          <>
            <TableBadge onClear={() => setOrderType("TAKEAWAY")} />
            <p className="muted small" style={{ margin: "8px 0 0" }}>
              Not your table? Tap ✕ to switch to takeaway.
            </p>
          </>
        ) : canTakeaway ? (
          <>
            <div className="opt is-on" style={{ margin: 0 }}>
              <span className="ic">🛍️</span>
              <span><b>Takeaway</b><span className="muted small">You'll collect this order at the restaurant</span></span>
            </div>
            {table.isDineIn && !services.dineIn && (
              <p className="muted small" style={{ margin: "8px 0 0" }}>Dine-in ordering is switched off right now, so this order is takeaway.</p>
            )}
            {!table.isDineIn && services.dineIn && (
              <p className="muted small" style={{ margin: "8px 0 0" }}>Eating here? Scan the QR code on your table to order for dine-in.</p>
            )}
          </>
        ) : (
          <p className="small danger" style={{ margin: 0 }}>{blocker}</p>
        )}
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

      {/* ── Optional login (guests order without name, phone or login) ── */}
      {!auth.isLoggedIn && (
        <div className="card login-nudge">
          <span className="ic" aria-hidden="true">✨</span>
          <span className="grow">
            <b>Login is optional</b>
            <span className="muted small">You can order as a guest. Log in to use coupons, get special offers and hear about upcoming offers first.</span>
          </span>
          <button type="button" className="btn btn-ghost sm" onClick={askLogin}>Log in</button>
        </div>
      )}

      {/* ── Coupon — guests see it; only logged-in customers can apply ── */}
      {coupon ? (
        <div className="card coupon-applied">
          <span className="ic" aria-hidden="true">🎟️</span>
          <span className="grow">
            <b>{coupon.code}</b>
            <span className={`small ${couponError ? "danger" : "ok"}`}>
              {quoteState === "loading" ? "Checking…" : couponError ? couponError.message : couponOk ? `You save ${rupees(saving)} · ${describeCoupon(coupon)}` : describeCoupon(coupon)}
            </span>
          </span>
          <button type="button" className="link-btn" onClick={() => setCoupon(null)}>Remove</button>
        </div>
      ) : (
        <button type="button" className="card coupon-cta" onClick={() => setCouponOpen(true)}>
          <span className="ic" aria-hidden="true">🎟️</span>
          <span className="grow">
            <b>{auth.isLoggedIn ? "Apply coupon" : "Coupons"}</b>
            <span className="muted small">{auth.isLoggedIn ? "See offers available right now" : "See today's coupons · log in to use them"}</span>
          </span>
          <Icon name="chevron" />
        </button>
      )}
      {coupon && (
        <button type="button" className="link-btn small" style={{ margin: "-4px 4px 4px" }} onClick={() => setCouponOpen(true)}>
          View all coupons
        </button>
      )}

      {/* ── Bill — the server's own figures (the amount the order is stored with) ── */}
      <div className="card bill" aria-busy={quoteState === "loading"}>
        {quoteState === "error" ? (
          <>
            <div className="row"><span className="muted">Item total</span><span>{rupees(cart.subtotal)}</span></div>
            <p className="small danger" style={{ margin: "6px 0 0" }}>Couldn't calculate taxes right now — the restaurant will add them to your bill.</p>
          </>
        ) : !quote ? (
          <p className="muted small" style={{ margin: 0 }}>Calculating your total…</p>
        ) : (
          <>
            <div className="row"><span className="muted">Item total</span><span>{rupees(quote.subtotal)}</span></div>
            {saving > 0 && <div className="row"><span className="muted">Coupon ({coupon.code})</span><span className="ok">−{rupees(saving)}</span></div>}
            {quote.tax > 0 && <div className="row"><span className="muted">GST{quote.gstRate ? ` (${quote.gstRate}%)` : ""}</span><span>{rupees(quote.tax)}</span></div>}
            {quote.serviceCharge > 0 && <div className="row"><span className="muted">Service charge</span><span>{rupees(quote.serviceCharge)}</span></div>}
            <div className={`row total${quoteState === "loading" ? " stale" : ""}`}><span>Total payable</span><span>{rupees(quote.total)}</span></div>
          </>
        )}
      </div>

      {/* ── Payment method ── */}
      <div role="radiogroup" aria-label="Payment method">
        {methods.length === 1 && (
          <div className="card-title" style={{ margin: "14px 0 0" }}>
            {methods[0] === "Online" ? "This restaurant takes online payment before the order is sent" : "Payment"}
          </div>
        )}
        {methods.map((m) => (
          <button
            key={m} type="button" role="radio" className="opt" aria-checked={paymentMethod === m}
            onClick={() => setPaymentMethod(m)}
          >
            <span className="ic">{m === "Cash" ? "💵" : "📲"}</span>
            <span>
              <b>{m === "Cash" ? (orderType === "DINE_IN" ? "Pay at your table" : "Pay at the counter") : phonePeEnabled ? "Pay now online (PhonePe)" : "UPI (pay after ordering)"}</b>
              <span className="muted small">
                {m === "Cash"
                  ? orderType === "DINE_IN"
                    ? "Cash, UPI or card. After ordering, tap “Call waiter” on your order page and your waiter will come to collect it."
                    : "Cash, UPI or card when you collect your order."
                  : phonePeEnabled
                    ? "Pay securely with PhonePe first — your order is sent to the restaurant as soon as the payment goes through."
                    : "You'll get a UPI payment link after placing the order. The restaurant confirms receipt manually — your order isn't marked paid just by opening the link."}
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* ── Place order ── */}
      {blocker && <div className="notice" role="status">{blocker}</div>}
      <Button style={{ marginTop: 8 }} onClick={handlePlace} disabled={!canPlace || placing}>
        {placing ? (payFirst ? "Opening payment…" : "Placing order…")
          : payFirst ? `Continue to pay${toPay != null ? ` · ${rupees(toPay)}` : ""}`
          : `Place order${toPay != null ? ` · ${rupees(toPay)}` : ""}`}
      </Button>
      <p className="muted small center" style={{ marginTop: 10 }}>
        {payFirst
          ? "Your order is sent to the restaurant once your payment succeeds. Unpaid orders are cancelled after 15 minutes."
          : "Changed your mind? You can change this order for a few minutes after placing it — it goes to the kitchen after that."}
      </p>

      {couponOpen && (
        <CouponSheet
          subtotal={cart.subtotal} applied={coupon} onApply={applyCoupon} onClose={() => setCouponOpen(false)}
          loggedIn={auth.isLoggedIn} onLogin={() => { setCouponOpen(false); askLogin(); }}
        />
      )}
    </>
  );
}
