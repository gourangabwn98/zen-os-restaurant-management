import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import { getOrder, cancelOrder, getGuestOrderToken } from "../services/orderService.js";
import { initiatePhonePePayment, getPhonePePaymentStatus } from "../services/paymentService.js";
import { getRestaurantProfile } from "../services/restaurantService.js";
import { subscribeToOrder } from "../services/socketService.js";
import { useAppState } from "../context/AppState.jsx";
import StatusStepper from "../components/StatusStepper.jsx";
import { Loader, ErrorState } from "../components/StateViews.jsx";
import GlassCard from "../components/ui/GlassCard.jsx";
import PrimaryButton from "../components/ui/PrimaryButton.jsx";
import StatusBadge, { paymentStatusColor } from "../components/ui/StatusBadge.jsx";
import { ACCENT, TEXT_MUTED, TEXT_FAINT, GLASS_BORDER } from "../theme.js";

const PAYMENT_LABEL = {
  PENDING_VERIFICATION: "Payment pending verification",
  PAID: "Paid",
  FAILED: "Payment failed",
};

export default function OrderDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { search } = useLocation();
  const { auth } = useAppState();

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

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: "20px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>{order.orderId}</div>
          <div style={{ fontSize: 11.5, color: TEXT_FAINT, marginTop: 2 }}>
            {order.orderType === "DINE_IN" ? `Dine-in${order.tableNo ? ` · Table ${order.tableNo}` : ""}` : "Takeaway"}
          </div>
        </div>
        <button onClick={() => nav("/orders")} style={{
          border: `1px solid ${GLASS_BORDER}`, background: "rgba(255,255,255,0.06)", borderRadius: 20,
          padding: "8px 16px", fontSize: 12, fontWeight: 700, color: TEXT_MUTED, cursor: "pointer",
        }}>
          All Orders
        </button>
      </div>

      <StatusStepper status={order.status} />

      {/* ── Payment ── */}
      <div style={{ margin: "6px 16px" }}>
        <GlassCard style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: TEXT_MUTED }}>Payment</div>
              <div style={{ marginTop: 6 }}>
                <StatusBadge label={`${PAYMENT_LABEL[order.paymentStatus] || order.paymentStatus} · ${order.paymentMethod}`} color={paymentStatusColor(order.paymentStatus)} />
              </div>
            </div>
            <div style={{ fontSize: 19, fontWeight: 800, color: ACCENT }}>₹{order.total}</div>
          </div>

          {order.paymentMethod === "Online" && order.paymentStatus !== "PAID" && (
            <>
              {profile?.phonePeEnabled ? (
                <div style={{ marginTop: 14 }}>
                  <PrimaryButton onClick={startPhonePe} disabled={payBusy}>
                    {payBusy ? "Starting…" : `Pay ₹${order.total} with PhonePe`}
                  </PrimaryButton>
                </div>
              ) : upiLink ? (
                <a href={upiLink} style={{
                  display: "block", textAlign: "center", marginTop: 14, padding: "13px", borderRadius: 14,
                  background: "linear-gradient(135deg, #FF9F1C 0%, #FF8A00 100%)", color: "#fff", fontWeight: 800,
                  fontSize: 13.5, textDecoration: "none",
                }}>
                  📱 Pay ₹{order.total} via UPI
                </a>
              ) : (
                <div style={{ fontSize: 11.5, color: TEXT_FAINT, marginTop: 10 }}>
                  Online payment isn't set up yet — please pay by cash at the restaurant.
                </div>
              )}
              <div style={{ fontSize: 10.5, color: TEXT_FAINT, marginTop: 10, lineHeight: 1.5 }}>
                {profile?.phonePeEnabled
                  ? "You'll be taken to PhonePe to pay securely. This page updates on its own once payment is confirmed."
                  : "Opening the UPI app doesn't confirm your payment automatically — our staff verifies receipt and updates this once confirmed."}
              </div>
            </>
          )}
        </GlassCard>
      </div>

      {/* ── Bill ── */}
      <div style={{ margin: "10px 16px" }}>
        <GlassCard onClick={() => setShowBill((v) => !v)} style={{ padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>🧾 View Bill</span>
          <span style={{ color: TEXT_FAINT }}>{showBill ? "▲" : "▼"}</span>
        </GlassCard>

        {showBill && (
          <div style={{ marginTop: 8 }}>
            <GlassCard style={{ padding: "14px 16px" }}>
              {(order.items || []).map((it, i) => (
                <Row key={i} label={`${it.name} ×${it.qty}`} value={`₹${it.price * it.qty}`} />
              ))}
              <div style={{ borderTop: `1px dashed ${GLASS_BORDER}`, margin: "8px 0" }} />
              <Row label="Subtotal" value={`₹${order.subtotal}`} />
              {order.tax > 0 && <Row label="GST" value={`₹${order.tax}`} />}
              {order.serviceCharge > 0 && <Row label="Service Charge" value={`₹${order.serviceCharge}`} />}
              {order.discount > 0 && <Row label="Discount" value={`−₹${order.discount}`} />}
              <div style={{ borderTop: `1px dashed ${GLASS_BORDER}`, margin: "8px 0" }} />
              <Row label="Total" value={`₹${order.total}`} bold />
            </GlassCard>
          </div>
        )}
      </div>

      {canCancel && (
        <div style={{ margin: "16px 16px 0" }}>
          <PrimaryButton variant="danger" onClick={handleCancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : "Cancel Order"}
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}

const Row = ({ label, value, bold }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: bold ? 14 : 12.5, fontWeight: bold ? 800 : 500, color: bold ? "#fff" : "rgba(255,255,255,0.65)" }}>
    <span>{label}</span>
    <span>{value}</span>
  </div>
);
