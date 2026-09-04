import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../context/AppState.jsx";
import { getMyOrders, getGuestOrderHistory } from "../services/orderService.js";
import { Loader, EmptyState, ErrorState } from "../components/StateViews.jsx";
import { PINK, TEXT_MUTED, TEXT_FAINT, BORDER, GREEN, RED, AMBER, NAV_HEIGHT } from "../theme.js";

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

const statusColor = (s) => {
  if (s === "CANCELLED") return RED;
  if (s === "COMPLETED") return TEXT_MUTED;
  if (s === "PENDING_CONFIRMATION") return AMBER;
  return GREEN;
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
      <div style={{ padding: "16px 16px 4px", fontSize: 18, fontWeight: 800 }}>Your Orders</div>

      <div style={{ display: "flex", gap: 8, padding: "10px 16px" }}>
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
        <div style={{ padding: "4px 16px" }}>
          {list.map((o) => (
            <div
              key={o._id}
              onClick={() => nav(`/order/${o._id}`)}
              style={{
                padding: "14px 4px", borderBottom: `1px solid ${BORDER}`, cursor: "pointer",
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>{o.orderId}</div>
                <div style={{ fontSize: 12, color: TEXT_FAINT, marginTop: 2 }}>
                  {(o.items || []).slice(0, 3).map((i) => i.name).join(", ")}
                  {o.items?.length > 3 ? ` +${o.items.length - 3} more` : ""}
                </div>
                <div style={{ fontSize: 11, color: TEXT_FAINT, marginTop: 3 }}>
                  {new Date(o.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>₹{o.total}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: statusColor(o.status), marginTop: 4 }}>
                  {STATUS_LABEL[o.status] || o.status}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TabBtn = ({ active, onClick, children }) => (
  <button onClick={onClick} style={{
    flex: 1, padding: "9px 10px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
    border: `1.5px solid ${active ? PINK : BORDER}`,
    background: active ? PINK : "#fff", color: active ? "#fff" : TEXT_MUTED,
  }}>
    {children}
  </button>
);
