import { PINK_LIGHT, PINK } from "../theme.js";

export default function TableBadge({ label, onClear }) {
  if (!label) return null;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: PINK_LIGHT, color: PINK, fontWeight: 700, fontSize: 12,
      padding: "6px 12px", borderRadius: 20,
    }}>
      📍 {label} — Dine-in
      {onClear && (
        <button onClick={onClear} title="Not your table? Order takeaway instead" style={{
          border: "none", background: "none", color: PINK, cursor: "pointer",
          fontSize: 13, fontWeight: 800, lineHeight: 1, padding: 0, marginLeft: 2,
        }}>✕</button>
      )}
    </div>
  );
}
