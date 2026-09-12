import { ACCENT, ACCENT_SOFT } from "../theme.js";

export default function TableBadge({ label, onClear }) {
  if (!label) return null;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 7,
      background: ACCENT_SOFT, color: ACCENT, fontWeight: 700, fontSize: 12,
      padding: "6px 12px", borderRadius: 20, border: `1px solid rgba(255,138,0,0.3)`,
    }}>
      📍 {label} — Dine-in
      {onClear && (
        <button onClick={onClear} title="Not your table? Order takeaway instead" style={{
          border: "none", background: "none", color: ACCENT, cursor: "pointer",
          fontSize: 13, fontWeight: 800, lineHeight: 1, padding: 0, marginLeft: 2,
        }}>✕</button>
      )}
    </div>
  );
}
