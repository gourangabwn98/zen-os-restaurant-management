import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import { getOrder, cancelOrder, getGuestOrderToken } from "../services/orderService.js";
import { initiatePhonePePayment, getPhonePePaymentStatus } from "../services/paymentService.js";
import { getRestaurantProfile } from "../services/restaurantService.js";
import { subscribeToOrder } from "../services/socketService.js";
import StatusStepper from "../components/StatusStepper.jsx";
import WaiterCallCard from "../components/WaiterCallCard.jsx";
import RateOrderCard from "../components/RateOrderCard.jsx";
import EditOrderSheet from "../components/EditOrderSheet.jsx";
import { Loader, ErrorState } from "../components/StateViews.jsx";
import Button from "../components/ui/Button.jsx";
import Icon from "../components/ui/Icon.jsx";
import {
  STATUS_LABEL, statusPillClass, PAYMENT_LABEL, paymentPillClass, formatOrderTime, isActiveOrder,
} from "../utils/orderStatus.js";

/** "Starts preparing in 2:42" while a Placed order can still be changed. */
function KitchenCountdown({ at }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, Math.ceil((new Date(at).getTime() - now) / 1000));
  if (!left) return <>Starting preparation…</>;
  return <>Starts preparing in <b style={{ fontVariantNumeric: "tabular-nums" }}>{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</b></>;
}

// Order statuses during which a dine-in customer can call a waiter.
const CALLABLE = ["PENDING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY", "DELIVERED"];

/** "Pay within 12:34" — counts down to a pay-first order's deadline. */
function PayDeadline({ deadline }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const left = Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
  if (!left) return <p className="muted small" style={{ marginTop: 8 }}>The time to pay has run out — this order will be cancelled shortly.</p>;
  return (
    <p className="small" style={{ marginTop: 8 }}>
      Pay within <b style={{ fontVariantNumeric: "tabular-nums" }}>{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</b>, or the order is cancelled.
    </p>
  );
}

export default function OrderDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { search } = useLocation();

  const [order, setOrder]   = useState(null);
  const [profile, setProfile] = useState(null);
  const [error, setError]   = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [showBill, setShowBill] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    setError(null);
    getOrder(id).then((r) => setOrder(r.data)).catch(() => setError("Couldn't load this order"));
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getRestaurantProfile().then((r) => setProfile(r.data?.data)).catch(() => {}); }, []);

  // ── Realtime updates via socket, with a light polling fallback ───────────
  useEffect(() => {
    const guestToken = getGuestOrderToken(id);
    const unsubscribe = subscribeToOrder(id, guestToken, (updated) => setOrder(updated));

    // Fallback: also poll every 15s in case the socket connection drops —
    // cheap insurance, matches the original app's pre-Phase-3 behaviour.
    const poll = setInterval(load, 15000);
    return () => { unsubscribe(); clearInterval(poll); };
  }, [id, load]);

  // ── Returned from PhonePe's hosted page (?payment=phonepe) ──────────────
  // The redirect landing is NOT proof of payment — the backend does its own
  // checksum-signed status check. We just poll it for a few seconds so the
  // page reflects the outcome without waiting for the socket / 15s poll.
  useEffect(() => {
    if (!new URLSearchParams(search).get("payment")) return;
    let stopped = false;
    let tries = 0;
    const tick = async () => {
      tries += 1;
      try {
        const { data } = await getPhonePePaymentStatus(id);
        if (data?.paymentStatus === "PAID") {
          if (!stopped) {
            // A pay-first order is promoted server-side on the verified payment.
            toast.success(data?.status && data.status !== "AWAITING_PAYMENT"
              ? "Payment received — your order has been sent to the restaurant!"
              : "Payment received — thank you!");
            load();
          }
          return;
        }
        if (data?.paymentState === "FAILED") {
          if (!stopped) { toast.error("Payment didn't go through — you can try again or pay cash."); load(); }
          return;
        }
      } catch { /* transient — keep trying */ }
      if (!stopped && tries < 6) setTimeout(tick, 2500);
      else if (!stopped) load();
    };
    tick();
    return () => { stopped = true; };
  }, [search, id, load]);

  const startPhonePe = async () => {
    setPayBusy(true);
    try {
      const { data } = await initiatePhonePePayment(order._id);
      if (data?.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        toast.error("Couldn't start the payment. Please try again.");
        setPayBusy(false);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't start the payment. Please try again.");
      setPayBusy(false);
    }
  };

  // An unpaid pay-first order hasn't reached the restaurant yet, so the
  // customer may drop it any time (the server allows the same).
  const canCancel = order && (order.status === "PENDING_CONFIRMATION" || order.status === "AWAITING_PAYMENT");

  const handleCancel = async () => {
    if (!window.confirm("Cancel this order?")) return;
    setCancelling(true);
    try {
      const { data } = await cancelOrder(id, "Cancelled by customer");
      setOrder(data.order || data);
      toast.success("Order cancelled");
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't cancel — the kitchen may already have started");
    } finally {
      setCancelling(false);
    }
  };

  const upiLink = useMemo(() => {
    if (!order || !profile?.upiId) return null;
    const payee = encodeURIComponent(profile.upiPayeeName || profile.restaurantName || "Restaurant");
    const note  = encodeURIComponent(`Order ${order.orderId}`);
    return `upi://pay?pa=${encodeURIComponent(profile.upiId)}&pn=${payee}&am=${order.total}&tn=${note}&cu=INR`;
  }, [order, profile]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!order) return <Loader label="Loading order…" />;

  const live = isActiveOrder(order);

  return (
    <>
      <div className="page-h">
        <button type="button" className="back" onClick={() => nav("/orders")}><Icon name="back" />All orders</button>
        <h2>#{order.orderId}</h2>
        <p className="small">
          {order.orderType === "DINE_IN" ? `Dine-in${order.tableNo ? ` · Table ${order.tableNo}` : ""}` : "Takeaway"}
          {order.createdAt ? ` · ${formatOrderTime(order.createdAt)}` : ""}
        </p>
      </div>

      {/* ── Live status ── */}
      <div className={`live-card${order.status === "CANCELLED" ? " bad" : ""}`}>
        <div className="live-head">
          {live && <span className="pulse" />}
          <b>{STATUS_LABEL[order.status] || order.status}</b>
          <span className={`status-pill ${statusPillClass(order.status)}`}>{live ? "Live" : STATUS_LABEL[order.status]}</span>
        </div>
        <StatusStepper status={order.status} />
      </div>

      {/* ── Placed: can still be changed until it starts preparing ── */}
      {order.status === "CONFIRMED" && !order.stockDeducted && (
        <div className="card">
          <div className="card-title">Want to change something?</div>
          <p className="small" style={{ margin: "4px 0 12px", lineHeight: 1.5 }}>
            {order.autoPrepareAt ? <KitchenCountdown at={order.autoPrepareAt} /> : "It will start preparing shortly"}
            {" "}— until then you can add, remove or change items.
          </p>
          {order.paymentStatus === "PAID" ? (
            <p className="muted small">This order is already paid — ask a waiter if you need to change it.</p>
          ) : (
            <Button variant="ghost" onClick={() => setEditing(true)}>✎ Change order</Button>
          )}
        </div>
      )}

      {/* ── Payment ── */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div className="card-title">Payment</div>
            <span className={`status-pill ${paymentPillClass(order.paymentStatus)}`} style={{ whiteSpace: "normal" }}>
              {PAYMENT_LABEL[order.paymentStatus] || order.paymentStatus} · {order.paymentMethod}
            </span>
          </div>
          <div className="price" style={{ fontSize: 22 }}>₹{order.total}</div>
        </div>

        {order.status === "AWAITING_PAYMENT" && (
          <div className="notice" role="status" style={{ marginTop: 12 }}>
            <b>Your order hasn&rsquo;t been sent yet.</b> Pay online to send it to the restaurant.
            {order.paymentDeadline && <PayDeadline deadline={order.paymentDeadline} />}
          </div>
        )}

        {order.paymentMethod === "Cash" && order.paymentStatus !== "PAID" && order.status !== "CANCELLED" && (
          <p className="muted small" style={{ marginTop: 10, lineHeight: 1.5 }}>
            {order.orderType === "DINE_IN"
              ? "💡 To pay, tap “Call waiter” below — your waiter will come to your table to collect cash, UPI or card."
              : "💡 Pay at the counter when you collect your order."}
          </p>
        )}

        {order.paymentMethod === "Online" && order.paymentStatus !== "PAID" && order.status !== "CANCELLED" && (
          <>
            {profile?.phonePeEnabled ? (
              <Button style={{ marginTop: 14 }} onClick={startPhonePe} disabled={payBusy}>
                {payBusy ? "Starting…" : order.status === "AWAITING_PAYMENT" ? `Pay ₹${order.total} & send order` : `Pay ₹${order.total} with PhonePe`}
              </Button>
            ) : upiLink ? (
              <a href={upiLink} className="btn btn-primary" style={{ marginTop: 14 }}>📲 Pay ₹{order.total} via UPI</a>
            ) : (
              <p className="muted small" style={{ marginTop: 10 }}>
                Online payment isn't set up yet — please pay by cash at the restaurant.
              </p>
            )}
            <p className="muted tiny" style={{ marginTop: 10, lineHeight: 1.5 }}>
              {profile?.phonePeEnabled
                ? "You'll be taken to PhonePe to pay securely. This page updates on its own once payment is confirmed."
                : "Opening the UPI app doesn't confirm your payment automatically — our staff verifies receipt and updates this once confirmed."}
            </p>
          </>
        )}
      </div>

      {/* ── Rate the meal (once paid) ── */}
      {order.paymentStatus === "PAID" && order.status !== "CANCELLED" && <RateOrderCard orderId={order._id} />}

      {/* ── Call waiter (dine-in) ── */}
      {order.orderType === "DINE_IN" && CALLABLE.includes(order.status) && (
        <WaiterCallCard
          orderId={order._id}
          reason={order.paymentStatus !== "PAID" && order.paymentMethod === "Cash"
            ? "Ready to pay, or need anything? A waiter will come to your table."
            : undefined}
        />
      )}

      {/* ── Bill ── */}
      <div className="card bill">
        <button
          type="button" className="bill-toggle" onClick={() => setShowBill((v) => !v)} aria-expanded={showBill}
        >
          <span>🧾 View bill</span><span className="muted">{showBill ? "▲" : "▼"}</span>
        </button>
        {showBill && (
          <div style={{ marginTop: 10 }}>
            {(order.items || []).map((it, i) => (
              <div key={i} className="row">
                <span className="muted">{it.name} ×{it.qty}</span><span>₹{it.price * it.qty}</span>
              </div>
            ))}
            <div className="sep" />
            <div className="row"><span className="muted">Subtotal</span><span>₹{order.subtotal}</span></div>
            {order.tax > 0 && <div className="row"><span className="muted">GST</span><span>₹{order.tax}</span></div>}
            {order.serviceCharge > 0 && <div className="row"><span className="muted">Service Charge</span><span>₹{order.serviceCharge}</span></div>}
            {order.discount > 0 && <div className="row"><span className="muted">Discount{order.coupon?.code ? ` (${order.coupon.code})` : ""}</span><span className="ok">−₹{order.discount}</span></div>}
            <div className="row total"><span>Total</span><span>₹{order.total}</span></div>
          </div>
        )}
      </div>

      {editing && order.status === "CONFIRMED" && (
        <EditOrderSheet order={order} onClose={() => setEditing(false)} onSaved={(o) => setOrder(o)} />
      )}

      {canCancel && (
        <Button variant="danger" onClick={handleCancel} disabled={cancelling} style={{ marginTop: 4 }}>
          {cancelling ? "Cancelling…" : "Cancel order"}
        </Button>
      )}
    </>
  );
}
