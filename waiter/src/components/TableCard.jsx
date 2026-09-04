import { BLUE, BLUE_LIGHT, GREEN, BORDER, TEXT_MUTED, TEXT_FAINT } from "../theme.js";

export default function TableCard({ table, session, onClick }) {
  const occupied = table.occupancyStatus === "OCCUPIED";
  const orderCount = session?.orders?.length || 0;

  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 16, padding: "16px 14px", cursor: "pointer", textAlign: "center",
        background: occupied ? BLUE_LIGHT : "#fff",
        border: `1.5px solid ${occupied ? BLUE : BORDER}`,
        opacity: table.status === "Inactive" ? 0.45 : 1,
      }}
    >
      <div style={{ fontSize: 22, marginBottom: 4 }}>{occupied ? "🍽️" : "◻️"}</div>
      <div style={{ fontWeight: 800, fontSize: 15 }}>Table {table.tableNo}</div>
      <div style={{ fontSize: 11, color: TEXT_FAINT, marginTop: 2 }}>{table.seats} seats</div>
      <div style={{
        marginTop: 8, fontSize: 10.5, fontWeight: 700,
        color: occupied ? BLUE : GREEN,
      }}>
        {occupied ? `Occupied${orderCount ? ` · ${orderCount} order${orderCount > 1 ? "s" : ""}` : ""}` : "Available"}
      </div>
    </div>
  );
}
