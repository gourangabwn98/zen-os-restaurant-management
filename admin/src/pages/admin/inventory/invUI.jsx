// src/pages/admin/inventory/invUI.jsx
import { PRIMARY } from "../../../theme.js";

export const PINK   = PRIMARY;
export const CARD   = "#16132a";
export const CARD2  = "#1c1830";
export const BORDER = "rgba(255,255,255,0.07)";
export const T1     = "#f1f0f5";
export const T2     = "#9ca3af";
export const T3     = "#4b5563";

export const LEVEL_COLORS = {
  OK:            { bg: "rgba(16,185,129,0.15)",  color: "#34d399", border: "rgba(16,185,129,0.3)" },
  LOW:           { bg: "rgba(245,158,11,0.15)",  color: "#fbbf24", border: "rgba(245,158,11,0.3)" },
  CRITICAL:      { bg: "rgba(249,115,22,0.15)",  color: "#fb923c", border: "rgba(249,115,22,0.3)" },
  OUT_OF_STOCK:  { bg: "rgba(239,68,68,0.15)",   color: "#f87171", border: "rgba(239,68,68,0.3)" },
};

export const inp = {
  width: "100%", padding: "10px 14px", borderRadius: 8, boxSizing: "border-box",
  border: `1px solid ${BORDER}`, background: "#252038",
  color: T1, fontSize: 13, outline: "none",
};

export const label = {
  fontSize: 12, color: T2, fontWeight: 600, display: "block", marginBottom: 6,
};

export const btnPrimary = (disabled) => ({
  padding: "11px 20px", borderRadius: 10,
  background: disabled ? "#374151" : `linear-gradient(135deg, ${PINK}, #5b21b6)`,
  color: "#fff", border: "none", fontWeight: 700,
  cursor: disabled ? "not-allowed" : "pointer", fontSize: 13,
  boxShadow: disabled ? "none" : `0 4px 14px ${PINK}44`,
});

export const btnGhost = {
  padding: "11px 20px", borderRadius: 10, border: `1px solid ${BORDER}`,
  background: CARD, color: T2, cursor: "pointer", fontSize: 13, fontWeight: 500,
};

export const btnDanger = {
  padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 500, cursor: "pointer",
  border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#f87171",
};

export function LevelBadge({ level }) {
  const s = LEVEL_COLORS[level] || LEVEL_COLORS.OK;
  const text = level === "OUT_OF_STOCK" ? "OUT OF STOCK" : level;
  return (
    <span style={{
      padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`, whiteSpace: "nowrap",
    }}>
      {text}
    </span>
  );
}

export function StatChip({ label: l, value, color = PINK }) {
  return (
    <div style={{
      background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12,
      padding: "14px 18px", minWidth: 130, flex: "1 1 130px",
    }}>
      <div style={{ fontSize: 11, color: T2, marginBottom: 4, fontWeight: 500 }}>{l}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

export function Modal({ title, sub, onClose, width = 460, children }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, backdropFilter: "blur(4px)", padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#13111f", borderRadius: 18, width, maxWidth: "100%",
          maxHeight: "88vh", overflowY: "auto", padding: 28,
          border: "1px solid rgba(139,92,246,0.25)", boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
          <div>
            <h3 style={{ margin: 0, color: T1, fontSize: 17, fontWeight: 700 }}>{title}</h3>
            {sub && <p style={{ margin: "4px 0 0", color: T2, fontSize: 12 }}>{sub}</p>}
          </div>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: "50%", border: `1px solid ${BORDER}`,
            background: CARD, color: T2, cursor: "pointer", fontSize: 14, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function TableShell({ headers, children, emptyIcon = "📭", emptyText = "Nothing here yet", isEmpty }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: CARD2, borderBottom: `1px solid ${BORDER}` }}>
            {headers.map((h) => (
              <th key={h} style={{
                padding: "13px 18px", textAlign: "left", fontSize: 11, color: T2,
                fontWeight: 600, letterSpacing: 0.8, textTransform: "uppercase",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isEmpty ? (
            <tr><td colSpan={headers.length} style={{ padding: 48, textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>{emptyIcon}</div>
              <div style={{ fontSize: 14, color: T2 }}>{emptyText}</div>
            </td></tr>
          ) : children}
        </tbody>
      </table>
    </div>
  );
}

export const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
export const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
