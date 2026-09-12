import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { getAllOrders, confirmOrder } from "../services/orderService.js";
import { getSocket } from "../services/socketService.js";
import OrderCard from "../components/OrderCard.jsx";
import Chip from "../components/ui/Chip.jsx";
import PrimaryButton from "../components/ui/PrimaryButton.jsx";
import { Loader, ErrorState, EmptyState } from "../components/StateViews.jsx";
import { NAV_HEIGHT } from "../theme.js";

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
    // Realtime: refresh the list the instant an order is placed/confirmed/
    // rejected/changed anywhere (same staff-room events the admin panel uses).
    // The 12s poll stays as a safety net if the socket drops.
    const iv = setInterval(load, 12000);
    const socket = getSocket();
    const events = ["order:new", "order:confirmed", "order:status_changed", "order:cancelled", "order:payment_changed"];
    if (socket) events.forEach((e) => socket.on(e, load));
    return () => {
      clearInterval(iv);
      if (socket) events.forEach((e) => socket.off(e, load));
    };
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
      <div style={{ padding: "20px 16px 4px", fontSize: 19, fontWeight: 800, color: "#fff" }}>Orders</div>

      <div className="hide-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 16px" }}>
        {FILTERS.map((f) => (
          <Chip
            key={f.key}
            active={filter === f.key}
            onClick={() => setFilter(f.key)}
            badge={f.key === "PENDING_CONFIRMATION" ? pendingCount : null}
          >
            {f.label}
          </Chip>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState icon="🧾" title="No orders here" sub="Try a different filter" />
      ) : (
        <div style={{ padding: "4px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {list.map((o) => (
            <div key={o._id}>
              <OrderCard order={o} onClick={() => nav(`/order/${o._id}`)} />
              {o.status === "PENDING_CONFIRMATION" && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                  <PrimaryButton
                    variant="success"
                    disabled={busyId === o._id}
                    onClick={(e) => handleQuickConfirm(e, o)}
                    style={{ padding: "8px 18px", fontSize: 12 }}
                  >
                    {busyId === o._id ? "Confirming…" : "✓ Confirm Order"}
                  </PrimaryButton>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
