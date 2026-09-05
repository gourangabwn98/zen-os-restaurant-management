// src/pages/admin/shared/Loader.jsx
// `rows` renders shimmer skeletons (preferred for list screens); otherwise a
// centred spinner.
export default function Loader({ rows = 0, label }) {
  if (rows > 0) {
    return (
      <div style={{ padding: "8px 0" }} aria-busy="true" aria-live="polite">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="zc-skel" />
        ))}
      </div>
    );
  }
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 12, padding: "60px 0", color: "var(--text-3)",
    }} aria-busy="true" aria-live="polite">
      <div className="zc-spin" />
      {label && <div style={{ fontSize: 13 }}>{label}</div>}
    </div>
  );
}
