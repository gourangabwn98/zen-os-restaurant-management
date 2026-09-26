import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import { getOrder, cancelOrder, getGuestOrderToken } from "../services/orderService.js";
import { initiatePhonePePayment, getPhonePePaymentStatus } from "../services/paymentService.js";
import { getRestaurantProfile } from "../services/restaurantService.js";
import { subscribeToOrder } from "../services/socketService.js";
import StatusStepper from "../components/StatusStepper.jsx";
import { Loader, ErrorState } from "../components/StateViews.jsx";
import Button from "../components/ui/Button.jsx";
import Icon from "../components/ui/Icon.jsx";
import {
  STATUS_LABEL, statusPillClass, PAYMENT_LABEL, paymentPillClass, formatOrderTime, isActiveOrder,
} from "../utils/orderStatus.js";

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
          if (!stopped) { toast.success("Payment received — thank you!"); load(); }
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

  const canCancel = order && order.status === "PENDING_CONFIRMATION";

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

        {order.paymentMethod === "Online" && order.paymentStatus !== "PAID" && (
          <>
            {profile?.phonePeEnabled ? (
              <Button style={{ marginTop: 14 }} onClick={startPhonePe} disabled={payBusy}>
                {payBusy ? "Starting…" : `Pay ₹${order.total} with PhonePe`}
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
            {order.discount > 0 && <div className="row"><span className="muted">Discount</span><span className="ok">−₹{order.discount}</span></div>}
            <div className="row total"><span>Total</span><span>₹{order.total}</span></div>
          </div>
        )}
      </div>

      {canCancel && (
        <Button variant="danger" onClick={handleCancel} disabled={cancelling} style={{ marginTop: 4 }}>
          {cancelling ? "Cancelling…" : "Cancel order"}
        </Button>
      )}
    </>
  );
}
