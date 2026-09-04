import { PINK, TEXT_MUTED, TEXT_FAINT } from "../theme.js";

export function Loader({ label = "Loading…" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", gap: 12 }}>
      <div style={{
        width: 32, height: 32, borderRadius: "50%",
        border: "3px solid #f0d3de", borderTopColor: PINK,
        animation: "spin .7s linear infinite",
      }} />
      <div style={{ fontSize: 13, color: TEXT_MUTED }}>{label}</div>
    </div>
  );
}

export function EmptyState({ icon = "🍽️", title = "Nothing here", sub, action }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 24px" }}>
      <div style={{ fontSize: 46, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: TEXT_FAINT, marginTop: 6 }}>{sub}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ message = "Something went wrong", onRetry }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 24px" }}>
      <div style={{ fontSize: 40, marginBottom: 10 }}>⚠️</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#b91c1c" }}>{message}</div>
      {onRetry && (
        <button onClick={onRetry} style={{
          marginTop: 16, padding: "9px 20px", borderRadius: 20, border: `1.5px solid ${PINK}`,
          background: "#fff", color: PINK, fontWeight: 700, fontSize: 13, cursor: "pointer",
        }}>
          Try again
        </button>
      )}
    </div>
  );
}
