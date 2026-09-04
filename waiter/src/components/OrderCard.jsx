import StatusBadge from "./StatusBadge.jsx";
import { BORDER, TEXT_FAINT, TEXT_MUTED, BLUE } from "../theme.js";

export default function OrderCard({ order, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "13px 4px", borderBottom: `1px solid ${BORDER}`, cursor: "pointer",
        display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 13.5 }}>{order.orderId}</span>
          <span style={{
            fontSize: 9.5, fontWeight: 700, color: BLUE, background: "rgba(37,99,235,0.1)",
            padding: "1px 7px", borderRadius: 8,
          }}>
            {order.source}
          </span>
          {order.tableNo ? (
            <span style={{ fontSize: 10.5, color: TEXT_MUTED }}>Table {order.tableNo}</span>
          ) : (
            <span style={{ fontSize: 10.5, color: TEXT_MUTED }}>Takeaway</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: TEXT_FAINT, marginTop: 4 }}>
          {(order.items || []).slice(0, 3).map((i) => `${i.name} ×${i.qty}`).join(", ")}
          {order.items?.length > 3 ? ` +${order.items.length - 3} more` : ""}
        </div>
        <div style={{ fontSize: 10.5, color: TEXT_FAINT, marginTop: 3 }}>
          {order.guestName || order.user?.name || "Guest"} ·{" "}
          {new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 13.5 }}>₹{order.total}</div>
        <div style={{ marginTop: 5 }}><StatusBadge status={order.status} /></div>
      </div>
    </div>
  );
}
