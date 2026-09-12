import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../context/AppState.jsx";
import { getMyOrders, getGuestOrderHistory } from "../services/orderService.js";
import { Loader, EmptyState, ErrorState } from "../components/StateViews.jsx";
import GlassCard from "../components/ui/GlassCard.jsx";
import StatusBadge, { orderStatusColor } from "../components/ui/StatusBadge.jsx";
import { ACCENT, ACCENT_GRADIENT, TEXT_FAINT, GLASS_BG, GLASS_BORDER, NAV_HEIGHT } from "../theme.js";

const ACTIVE_STATUSES = ["PENDING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY", "DELIVERED"];

const STATUS_LABEL = {
  PENDING_CONFIRMATION: "Awaiting confirmation",
  CONFIRMED: "Confirmed",
  PREPARING: "Preparing",
  READY: "Ready",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export default function OrdersPage() {
  const nav = useNavigate();
  const { auth } = useAppState();
  const [orders, setOrders] = useState(null);
  const [error, setError]   = useState(null);
  const [tab, setTab]       = useState("active"); // "active" | "history"

  const load = useCallback(() => {
    setError(null);
    const fetcher = auth.isLoggedIn
      ? getMyOrders().then((r) => r.data)
      : getGuestOrderHistory();
    fetcher.then(setOrders).catch(() => setError("Couldn't load your orders"));
  }, [auth.isLoggedIn]);

  useEffect(() => { load(); }, [load]);

  if (orders === null && !error) return <Loader label="Loading your orders…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const active  = orders.filter((o) => ACTIVE_STATUSES.includes(o.status));
  const history = orders.filter((o) => !ACTIVE_STATUSES.includes(o.status));
  const list = tab === "active" ? active : history;

  return (
    <div style={{ paddingBottom: NAV_HEIGHT + 16 }}>
      <div style={{ padding: "20px 16px 10px", fontSize: 19, fontWeight: 800, color: "#fff" }}>Your Orders</div>

      <div style={{ display: "flex", gap: 8, padding: "8px 16px" }}>
        <TabBtn active={tab === "active"} onClick={() => setTab("active")}>Active ({active.length})</TabBtn>
        <TabBtn active={tab === "history"} onClick={() => setTab("history")}>History ({history.length})</TabBtn>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={tab === "active" ? "🧾" : "📜"}
          title={tab === "active" ? "No active orders" : "No past orders yet"}
          sub={tab === "active" ? "Place an order from the menu to see it here" : undefined}
        />
      ) : (
        <div style={{ padding: "8px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {list.map((o) => (
            <GlassCard key={o._id} onClick={() => nav(`/order/${o._id}`)} style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13.5, color: "#fff" }}>{o.orderId}</div>
                  <div style={{ fontSize: 12, color: TEXT_FAINT, marginTop: 4 }}>
                    {(o.items || []).slice(0, 3).map((i) => i.name).join(", ")}
                    {o.items?.length > 3 ? ` +${o.items.length - 3} more` : ""}
                  </div>
                  <div style={{ fontSize: 11, color: TEXT_FAINT, marginTop: 4 }}>
                    {new Date(o.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: ACCENT }}>₹{o.total}</div>
                  <div style={{ marginTop: 6 }}>
                    <StatusBadge label={STATUS_LABEL[o.status] || o.status} color={orderStatusColor(o.status)} />
                  </div>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}

const TabBtn = ({ active, onClick, children }) => (
  <button onClick={onClick} style={{
    flex: 1, padding: "10px 10px", borderRadius: 12, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${active ? "transparent" : GLASS_BORDER}`,
    background: active ? ACCENT_GRADIENT : GLASS_BG, color: active ? "#fff" : "rgba(255,255,255,0.65)",
    boxShadow: active ? "0 6px 16px rgba(255,138,0,0.35)" : "none",
  }}>
    {children}
  </button>
);
