import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { getAllOrders, confirmOrder } from "../services/orderService.js";
import OrderCard from "../components/OrderCard.jsx";
import { Loader, ErrorState, EmptyState } from "../components/StateViews.jsx";
import { BLUE, BLUE_LIGHT, TEXT_MUTED, BORDER, NAV_HEIGHT } from "../theme.js";

const FILTERS = [
  { key: "ALL",                   label: "All" },
  { key: "PENDING_CONFIRMATION",  label: "Pending confirmation" },
  { key: "PREPARING",             label: "Preparing" },
  { key: "READY",                 label: "Ready" },
  { key: "DELIVERED",             label: "Delivered" },
  { key: "COMPLETED",             label: "Completed" },
];

export default function OrdersPage() {
  const nav = useNavigate();
  const [orders, setOrders] = useState(null);
  const [error, setError]   = useState(null);
  const [filter, setFilter] = useState("ALL");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data } = await getAllOrders({ limit: 100 });
      setOrders(data.orders || []);
    } catch {
      setError("Couldn't load orders");
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 12000);
    return () => clearInterval(iv);
  }, [load]);

  const handleQuickConfirm = async (e, order) => {
    e.stopPropagation();
    setBusyId(order._id);
    try {
      await confirmOrder(order._id);
      toast.success(`Order ${order.orderId} confirmed · KOT sent`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't confirm order");
    } finally { setBusyId(null); }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (orders === null) return <Loader label="Loading orders…" />;

  const list = filter === "ALL" ? orders.filter((o) => o.status !== "CANCELLED") : orders.filter((o) => o.status === filter);
  const pendingCount = orders.filter((o) => o.status === "PENDING_CONFIRMATION").length;

  return (
    <div style={{ paddingBottom: NAV_HEIGHT + 90 }}>
      <div style={{ padding: "16px 16px 4px", fontSize: 18, fontWeight: 800 }}>Orders</div>

      <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "10px 16px" }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              flexShrink: 0, padding: "7px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700,
              border: `1.5px solid ${filter === f.key ? BLUE : BORDER}`,
              background: filter === f.key ? BLUE_LIGHT : "#fff",
              color: filter === f.key ? BLUE : TEXT_MUTED, cursor: "pointer", position: "relative",
            }}
          >
            {f.label}
            {f.key === "PENDING_CONFIRMATION" && pendingCount > 0 && (
              <span style={{
                marginLeft: 6, background: "#dc2626", color: "#fff", fontSize: 9.5, fontWeight: 800,
                borderRadius: 10, padding: "1px 6px",
              }}>
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState icon="🧾" title="No orders here" sub="Try a different filter" />
      ) : (
        <div style={{ padding: "0 16px" }}>
          {list.map((o) => (
            <div key={o._id} onClick={() => nav(`/order/${o._id}`)} style={{ cursor: "pointer" }}>
              <OrderCard order={o} onClick={() => nav(`/order/${o._id}`)} />
              {o.status === "PENDING_CONFIRMATION" && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -8, marginBottom: 8 }}>
                  <button
                    disabled={busyId === o._id}
                    onClick={(e) => handleQuickConfirm(e, o)}
                    style={{
                      padding: "7px 16px", borderRadius: 10, border: "none", background: "#16a34a",
                      color: "#fff", fontWeight: 800, fontSize: 12, cursor: busyId === o._id ? "not-allowed" : "pointer",
                      opacity: busyId === o._id ? 0.6 : 1,
                    }}
                  >
                    {busyId === o._id ? "Confirming…" : "✓ Confirm Order"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
