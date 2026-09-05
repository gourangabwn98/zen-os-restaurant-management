// src/pages/admin/shared/StatCard.jsx
const ACCENTS = {
  0: { ink: "var(--accent-ink)", hue: "var(--violet)" },
  1: { ink: "var(--ready-ink)",  hue: "var(--ready)" },
  2: { ink: "var(--live-ink)",   hue: "var(--live)" },
  3: { ink: "var(--wait-ink)",   hue: "var(--wait)" },
};

// `value` / `val` and `color` (explicit override) are all accepted so existing
// call sites keep working. `colorIdx` picks one of the theme accent pairs.
// `grad` renders the value as brand-gradient text (large/bold only — AA rule).
// `spark` is an optional <svg class="spark"> node for a real-data sparkline.
export default function StatCard({ label, value, val, sub, colorIdx = 0, color, icon, grad, spark }) {
  const shown = value ?? val;
  const accent = ACCENTS[colorIdx % 4] || ACCENTS[0];
  const valueColor = color || accent.ink;

  return (
    <div className="zc-metric">
      <div style={{
        position: "absolute", top: 0, right: 0, width: 80, height: 80,
        background: `radial-gradient(circle, ${accent.hue}, transparent 70%)`,
        opacity: 0.14, borderRadius: "0 var(--r-card) 0 80px",
      }} />
      {icon && (
        <div className="ic" style={{ color: valueColor, borderColor: "var(--violet-mid)" }}>
          {icon}
        </div>
      )}
      <div className="k">{label}</div>
      <div
        className={`v tnum${grad ? " gr" : ""}`}
        style={grad ? undefined : { color: valueColor }}
      >
        {shown}
      </div>
      {sub && <div className="d">{sub}</div>}
      {spark}
    </div>
  );
}
