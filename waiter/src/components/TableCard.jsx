import { ACCENT, AMBER, GREEN, RED, GLASS_BG, GLASS_BORDER, TEXT_FAINT } from "../theme.js";
import { statusColor } from "./StatusBadge.jsx";
import {
  activeOrders, dominantStatus, needsConfirmation, paymentLabel,
  runningTotal, earliestOrderTime, formatElapsed, elapsedKind,
} from "../utils/tableSession.js";

const ELAPSED_COLOR = { normal: TEXT_FAINT, wait: AMBER, stop: RED };

export default function TableCard({ table, session, active, onClick }) {
  const occupied = table.occupancyStatus === "OCCUPIED";
  const orders = session?.orders || [];
  const orderCount = activeOrders(orders).length;
  const total = runningTotal(orders);
  const dom = dominantStatus(orders);
  const ringColor = dom ? statusColor(dom) : ACCENT;
  // Timed off the earliest active ORDER, not when the table session opened —
  // a free table has no orders at all, so this is naturally null there and
  // no clock is shown.
  const placedAt = earliestOrderTime(orders);
  const elapsed = formatElapsed(placedAt);
  const elapsedColor = ELAPSED_COLOR[elapsedKind(placedAt)];
  const needsAttention = needsConfirmation(orders);
  const payLabel = paymentLabel(orders);
  const payColor = payLabel === "Due" ? RED : payLabel === "Paid" ? GREEN : TEXT_FAINT;

  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 16, padding: "14px 8px 12px", cursor: "pointer", textAlign: "center",
        background: occupied ? `${ringColor}14` : GLASS_BG,
        border: `1.5px solid ${active ? ACCENT : occupied ? `${ringColor}70` : GLASS_BORDER}`,
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        opacity: table.status === "Inactive" ? 0.4 : 1,
        boxShadow: active ? `0 0 0 1px ${ringColor}55, 0 8px 20px ${ringColor}4d` : "none",
        animation: needsAttention ? "pulseAmberGlow 1.8s ease-in-out infinite" : "none",
        transition: "transform .12s ease",
      }}
    >
      <div style={{
        width: 32, height: 32, margin: "0 auto 6px", borderRadius: "50%",
        background: occupied ? ringColor : "rgba(52,211,153,0.16)",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
      }}>
        {occupied ? "🍽️" : "◻️"}
      </div>
      <div style={{ fontWeight: 800, fontSize: 14, color: "#fff" }}>Table {table.tableNo}</div>
      <div style={{ fontSize: 10, color: TEXT_FAINT, marginTop: 1 }}>{table.seats} seats</div>

      {occupied ? (
        <>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: ringColor, marginTop: 8 }}>
            🧾 {orderCount} order{orderCount === 1 ? "" : "s"}
          </div>
          {elapsed && (
            <div style={{ fontSize: 9.5, fontWeight: 700, color: elapsedColor, marginTop: 1 }}>
              ⏱ {elapsed}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 5, marginTop: 3 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#fff" }}>₹{total}</span>
            {payLabel && <span style={{ fontSize: 9, fontWeight: 700, color: payColor }}>{payLabel}</span>}
          </div>
        </>
      ) : (
        <div style={{ marginTop: 8, fontSize: 10, fontWeight: 700, color: GREEN }}>Available</div>
      )}
    </div>
  );
}
