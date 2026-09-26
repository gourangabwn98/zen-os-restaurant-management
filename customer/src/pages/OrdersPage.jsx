import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useMyOrders } from "../hooks/useMyOrders.js";
import {
  ACTIVE_STATUSES, STATUS_LABEL, statusPillClass, PAYMENT_LABEL, formatOrderTime,
} from "../utils/orderStatus.js";
import StatusStepper from "../components/StatusStepper.jsx";
import { Loader, EmptyState, ErrorState } from "../components/StateViews.jsx";

export default function OrdersPage() {
  const nav = useNavigate();
  const { orders, error, reload } = useMyOrders();
  const [tab, setTab] = useState("active"); // "active" | "history"

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (orders === null) return <Loader label="Loading your orders…" />;

  const active  = orders.filter((o) => ACTIVE_STATUSES.includes(o.status));
  const history = orders.filter((o) => !ACTIVE_STATUSES.includes(o.status));
  const list = tab === "active" ? active : history;

  return (
    <>
      <div className="page-h">
        <h2>Your orders</h2>
        {active.length > 0 && <p><span className="pulse" style={{ marginRight: 8 }} />Tap an order to track it live</p>}
      </div>

      <div className="seg" role="group" aria-label="Order filter" style={{ marginBottom: 16 }}>
        <button type="button" aria-pressed={tab === "active"} onClick={() => setTab("active")}>Active ({active.length})</button>
        <button type="button" aria-pressed={tab === "history"} onClick={() => setTab("history")}>History ({history.length})</button>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={tab === "active" ? "🧾" : "📜"}
          title={tab === "active" ? "No active orders" : "No past orders yet"}
          sub={tab === "active" ? "Place an order from the menu to see it here" : undefined}
          action={tab === "active" && <Link to="/menu" className="btn btn-primary">Browse menu</Link>}
        />
      ) : (
        list.map((o) => (
          <button key={o._id} type="button" className="order" onClick={() => nav(`/order/${o._id}`)}>
            <div className="row">
              <b>#{o.orderId}</b>
              <span className={`status-pill ${statusPillClass(o.status)}`}>{STATUS_LABEL[o.status] || o.status}</span>
            </div>
            <div className="muted small" style={{ marginTop: 2 }}>
              {o.orderType === "DINE_IN" ? `Dine-in${o.tableNo ? ` · Table ${o.tableNo}` : ""}` : "Takeaway"}
              {" · "}{formatOrderTime(o.createdAt)}{" · "}<b style={{ color: "var(--text)" }}>₹{o.total}</b>
            </div>
            {ACTIVE_STATUSES.includes(o.status) && <StatusStepper status={o.status} />}
            <div className="items-mini">
              {(o.items || []).slice(0, 3).map((i) => `${i.qty}× ${i.name}`).join(" · ")}
              {o.items?.length > 3 ? ` +${o.items.length - 3} more` : ""}
            </div>
            <div className="muted small" style={{ marginTop: 8 }}>
              {o.paymentMethod === "Online" ? "Online" : "Cash"} · {PAYMENT_LABEL[o.paymentStatus] || o.paymentStatus}
            </div>
          </button>
        ))
      )}
    </>
  );
}
