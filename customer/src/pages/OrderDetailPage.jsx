import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { getOrder, cancelOrder, getGuestOrderToken } from "../services/orderService.js";
import { getRestaurantProfile } from "../services/restaurantService.js";
import { subscribeToOrder } from "../services/socketService.js";
import { useAppState } from "../context/AppState.jsx";
import StatusStepper from "../components/StatusStepper.jsx";
import { Loader, ErrorState } from "../components/StateViews.jsx";
import { PINK, TEXT_MUTED, TEXT_FAINT, BORDER, GREEN, AMBER, RED } from "../theme.js";

const PAYMENT_LABEL = {
  PENDING_VERIFICATION: "Payment pending verification",
  PAID: "Paid",
  FAILED: "Payment failed",
};
const paymentColor = (s) => (s === "PAID" ? GREEN : s === "FAILED" ? RED : AMBER);

export default function OrderDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { auth } = useAppState();

  const [order, setOrder]   = useState(null);
  const [profile, setProfile] = useState(null);
  const [error, setError]   = useState(null);
  const [cancelling, setCancelling] = useState(false);
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
      <div style={{ padding: "16px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{order.orderId}</div>
          <div style={{ fontSize: 11.5, color: TEXT_FAINT, marginTop: 2 }}>
            {order.orderType === "DINE_IN" ? `Dine-in${order.tableNo ? ` · Table ${order.tableNo}` : ""}` : "Takeaway"}
          </div>
        </div>
        <button onClick={() => nav("/orders")} style={{
          border: `1px solid ${BORDER}`, background: "#fff", borderRadius: 20,
          padding: "7px 14px", fontSize: 12, fontWeight: 700, color: TEXT_MUTED, cursor: "pointer",
        }}>
          All Orders
        </button>
      </div>

      <StatusStepper status={order.status} />

      {/* ── Payment ── */}
      <div style={{ margin: "6px 16px", padding: "12px 14px", borderRadius: 12, background: "#fafafa", border: `1px solid ${BORDER}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: TEXT_MUTED }}>Payment</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: paymentColor(order.paymentStatus), marginTop: 2 }}>
              {PAYMENT_LABEL[order.paymentStatus] || order.paymentStatus} · {order.paymentMethod}
            </div>
          </div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>₹{order.total}</div>
        </div>

        {order.paymentMethod === "Online" && order.paymentStatus !== "PAID" && (
          <>
            {upiLink ? (
              <a href={upiLink} style={{
                display: "block", textAlign: "center", marginTop: 12, padding: "12px", borderRadius: 10,
                background: PINK, color: "#fff", fontWeight: 800, fontSize: 13.5, textDecoration: "none",
              }}>
                📱 Pay ₹{order.total} via UPI
              </a>
            ) : (
              <div style={{ fontSize: 11.5, color: TEXT_FAINT, marginTop: 10 }}>
                Online payment isn't set up yet — please pay by cash at the restaurant.
              </div>
            )}
            <div style={{ fontSize: 10.5, color: TEXT_FAINT, marginTop: 8, lineHeight: 1.5 }}>
              Opening the UPI app doesn't confirm your payment automatically — our staff verifies receipt and updates this once confirmed.
            </div>
          </>
        )}
      </div>

      {/* ── Bill ── */}
      <div style={{ margin: "10px 16px" }}>
        <button
          onClick={() => setShowBill((v) => !v)}
          style={{
            width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "12px 14px", borderRadius: 12, border: `1px solid ${BORDER}`, background: "#fff",
            fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >
          <span>🧾 View Bill</span>
          <span>{showBill ? "▲" : "▼"}</span>
        </button>

        {showBill && (
          <div style={{ border: `1px solid ${BORDER}`, borderTop: "none", borderRadius: "0 0 12px 12px", padding: "12px 14px" }}>
            {(order.items || []).map((it, i) => (
              <Row key={i} label={`${it.name} ×${it.qty}`} value={`₹${it.price * it.qty}`} />
            ))}
            <div style={{ borderTop: `1px dashed ${BORDER}`, margin: "8px 0" }} />
            <Row label="Subtotal" value={`₹${order.subtotal}`} />
            {order.tax > 0 && <Row label="GST" value={`₹${order.tax}`} />}
            {order.serviceCharge > 0 && <Row label="Service Charge" value={`₹${order.serviceCharge}`} />}
            {order.discount > 0 && <Row label="Discount" value={`−₹${order.discount}`} />}
            <div style={{ borderTop: `1px dashed ${BORDER}`, margin: "8px 0" }} />
            <Row label="Total" value={`₹${order.total}`} bold />
          </div>
        )}
      </div>

      {canCancel && (
        <div style={{ margin: "16px 16px 0" }}>
          <button onClick={handleCancel} disabled={cancelling} style={{
            width: "100%", padding: 13, borderRadius: 12, border: `1.5px solid ${RED}`,
            background: "#fff", color: RED, fontWeight: 800, fontSize: 13.5,
            cursor: cancelling ? "not-allowed" : "pointer", opacity: cancelling ? 0.6 : 1,
          }}>
            {cancelling ? "Cancelling…" : "Cancel Order"}
          </button>
        </div>
      )}
    </div>
  );
}

const Row = ({ label, value, bold }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: bold ? 14 : 12.5, fontWeight: bold ? 800 : 500, color: bold ? "#111" : TEXT_MUTED }}>
    <span>{label}</span>
    <span>{value}</span>
  </div>
);
