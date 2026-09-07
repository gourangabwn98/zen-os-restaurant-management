// src/pages/admin/shared/charts.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Small, dependency-free chart primitives shared across admin pages. Each one
// picks its form by the job the data does (magnitude / trend / part-to-whole /
// ratio-against-a-limit — see the dataviz skill's choosing-a-form.md), not by
// what looks decorative. Colors are the app's own design tokens (tokens.css) —
// the same violet/cyan/wait/ready/stop hues used everywhere else (tags,
// StatCard, Insights) — assigned in one fixed order, never cycled per-render.
// Text always stays in text tokens; only the mark (bar/line/dot/segment)
// carries the series color, per marks-and-anatomy.md.
// ─────────────────────────────────────────────────────────────────────────────

// Fixed categorical order — reused wherever a chart needs "series N", matching
// the order already established in AnalyticsPage's CAT_COLORS.
export const CAT_COLORS = ["var(--violet)", "var(--cyan)", "var(--wait)", "var(--ready)", "var(--stop)", "var(--indigo)"];

const fmtCompact = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 100000) return `${(v / 100000).toFixed(1)}L`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return Math.round(v).toLocaleString("en-IN");
};

// ══════════════════ Ranked horizontal bars — magnitude, low→high ═══════════
// One row per item; bar length ∝ value. Pass a fixed `color` for a single-hue
// sequential read (e.g. top items by revenue), or a `color` per row (via
// `rows[i].color`) when the categories are themselves the subject (e.g.
// order status, where color = status meaning, not rank).
export function RankedBars({ rows, valuePrefix = "", showValue = true, height = 22 }) {
  if (!rows || rows.length === 0) {
    return <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-3)", fontSize: 12.5 }}>No data yet</div>;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {rows.map((r) => {
        const pct = Math.max((r.value / max) * 100, r.value > 0 ? 3 : 0);
        return (
          <div key={r.label} title={`${r.label}: ${valuePrefix}${fmtCompact(r.value)}`}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: "var(--text-1)", fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                <i style={{ width: 7, height: 7, borderRadius: 2, background: r.color, flex: "none" }} />
                {r.label}
              </span>
              {showValue && (
                <span className="tnum" style={{ color: "var(--text-2)", fontWeight: 600 }}>{valuePrefix}{fmtCompact(r.value)}</span>
              )}
            </div>
            <div style={{ height, borderRadius: height / 2, background: "var(--raise)", overflow: "hidden" }}>
              <div style={{
                width: `${pct}%`, height: "100%", borderRadius: height / 2,
                background: r.color, transition: "width .4s ease",
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════ Segmented bar — part-to-whole, categorical ═════════════
// One bar, divided into `segments`, each a fixed share of the total. A 2px
// surface-color gap separates segments instead of a border. Legend row below
// carries the identity channel (never color alone).
export function SegmentedBar({ segments, total }) {
  const t = total ?? segments.reduce((s, x) => s + x.value, 0);
  if (!t) {
    return <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-3)", fontSize: 12.5 }}>No data yet</div>;
  }
  return (
    <div>
      <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", background: "var(--raise)", gap: 2 }}>
        {segments.filter((s) => s.value > 0).map((s) => (
          <div key={s.label} title={`${s.label}: ${fmtCompact(s.value)} (${Math.round((s.value / t) * 100)}%)`}
            style={{ width: `${(s.value / t) * 100}%`, background: s.color, minWidth: 3 }} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 12 }}>
        {segments.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <i style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flex: "none" }} />
            <span style={{ color: "var(--text-2)" }}>{s.label}</span>
            <span className="tnum" style={{ color: "var(--text-1)", fontWeight: 600 }}>{Math.round((s.value / t) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════ Meter — a single ratio against a limit ═════════════════
export function Meter({ value, max, label, sub, color = "var(--violet)" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, color: "var(--text-1)", fontWeight: 500 }}>{label}</span>
        <span className="tnum" style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>{value} <span style={{ color: "var(--text-3)", fontWeight: 500 }}>/ {max}</span></span>
      </div>
      <div style={{ height: 10, borderRadius: 5, background: "var(--violet-faint)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 5, background: color, transition: "width .4s ease" }} />
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

// ══════════════════ Trend chart — line + area, change over time ════════════
// Single series: sequential use of one hue. `points` = [{label, value}].
export function TrendChart({ points, color = "var(--violet)", valuePrefix = "₹", height = 160 }) {
  if (!points || points.length < 2) {
    return <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-3)", fontSize: 12.5 }}>Not enough data yet</div>;
  }
  const W = 100, H = height;
  const values = points.map((p) => p.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = W / (points.length - 1);
  const yFor = (v) => H - ((v - min) / range) * (H - 24) - 4; // 4px top/bottom breathing room
  const coords = points.map((p, i) => [i * stepX, yFor(p.value)]);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const gridY = [max, (max + min) / 2, min];

  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 22, display: "flex", flexDirection: "column", justifyContent: "space-between", fontSize: 10, color: "var(--text-3)" }}>
        {gridY.map((g, i) => <span key={i} className="tnum">{valuePrefix}{fmtCompact(g)}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height, marginLeft: 44, display: "block" }} aria-hidden="true">
        {gridY.map((g, i) => (
          <line key={i} x1="0" x2={W} y1={yFor(g)} y2={yFor(g)} stroke="var(--edge)" strokeWidth="0.4" />
        ))}
        <path d={area} fill={color} opacity="0.1" />
        <path d={line} fill="none" stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.6" fill={color} stroke="var(--surface)" strokeWidth="0.8" vectorEffect="non-scaling-stroke">
            <title>{points[i].label}: {valuePrefix}{fmtCompact(points[i].value)}</title>
          </circle>
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--text-3)", marginLeft: 44, marginTop: 4 }}>
        {points.map((p, i) => <span key={i}>{p.label}</span>)}
      </div>
    </div>
  );
}
