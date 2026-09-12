import { ACCENT, TEXT_MUTED, TEXT_FAINT } from "../theme.js";
import { MenuCardSkeleton } from "./ui/Skeleton.jsx";

export function Loader({ label = "Loading…", skeleton = false }) {
  if (skeleton) {
    return (
      <div className="menu-grid" style={{ padding: "4px 0" }}>
        {[0, 1, 2, 3].map((i) => <MenuCardSkeleton key={i} />)}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", gap: 14 }}>
      <div style={{
        width: 34, height: 34, borderRadius: "50%",
        border: "3px solid rgba(255,138,0,0.18)", borderTopColor: ACCENT,
        animation: "spin .7s linear infinite",
      }} />
      <div style={{ fontSize: 13, color: TEXT_MUTED }}>{label}</div>
    </div>
  );
}

export function EmptyState({ icon = "🍽️", title = "Nothing here", sub, action }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 24px", animation: "fadeUp .3s ease" }}>
      <div style={{
        width: 72, height: 72, margin: "0 auto 16px", borderRadius: "50%",
        background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32,
      }}>
        {icon}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: TEXT_FAINT, marginTop: 6 }}>{sub}</div>}
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ message = "Something went wrong", onRetry }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 24px" }}>
      <div style={{ fontSize: 40, marginBottom: 10 }}>⚠️</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#F87171" }}>{message}</div>
      {onRetry && (
        <button onClick={onRetry} style={{
          marginTop: 16, padding: "9px 22px", borderRadius: 20, border: `1.5px solid ${ACCENT}`,
          background: "rgba(255,138,0,0.08)", color: ACCENT, fontWeight: 700, fontSize: 13, cursor: "pointer",
        }}>
          Try again
        </button>
      )}
    </div>
  );
}
