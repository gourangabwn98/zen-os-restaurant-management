// src/pages/admin/inventory/invUI.jsx
// Shared UI kit for the eight Inventory tabs. All colour values resolve to
// tokens in src/theme/tokens.css, so every tab follows the light/dark toggle.
// Export names & shapes are unchanged.

export const PINK   = "var(--violet)";
export const CARD   = "var(--card)";
export const CARD2  = "var(--card-2)";
export const BORDER = "var(--edge)";
export const T1     = "var(--text-1)";
export const T2     = "var(--text-2)";
export const T3     = "var(--text-3)";

export const LEVEL_COLORS = {
  OK:           { bg: "var(--ready-fill)", color: "var(--ready-ink)", border: "var(--ready-line)" },
  LOW:          { bg: "var(--wait-fill)",  color: "var(--wait-ink)",  border: "var(--wait-line)" },
  CRITICAL:     { bg: "var(--wait-fill)",  color: "var(--wait-ink)",  border: "var(--wait-line)" },
  OUT_OF_STOCK: { bg: "var(--stop-fill)",  color: "var(--stop-ink)",  border: "var(--stop-line)" },
};

export const inp = {
  width: "100%", padding: "10px 14px", borderRadius: "var(--r-ctl)", boxSizing: "border-box",
  border: "1px solid var(--edge)", background: "var(--card-2)",
  color: "var(--text-1)", fontSize: 13, outline: "none",
};

export const label = {
  fontSize: 12, color: "var(--text-2)", fontWeight: 600, display: "block", marginBottom: 6,
};

export const btnPrimary = (disabled) => ({
  padding: "11px 20px", borderRadius: "var(--r-ctl)",
  background: disabled ? "var(--raise)" : "var(--grad-btn)",
  color: disabled ? "var(--text-3)" : "#fff", border: "none", fontWeight: 700,
  cursor: disabled ? "not-allowed" : "pointer", fontSize: 13,
  boxShadow: disabled ? "none" : "0 8px 22px -8px var(--violet-glow)",
});

export const btnGhost = {
  padding: "11px 20px", borderRadius: "var(--r-ctl)", border: "1px solid var(--edge)",
  background: "var(--card-2)", color: "var(--text-2)", cursor: "pointer", fontSize: 13, fontWeight: 500,
};

export const btnDanger = {
  padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
  border: "1px solid var(--stop-line)", background: "var(--stop-fill)", color: "var(--stop-ink)",
};

export function LevelBadge({ level }) {
  const kind = level === "OK" ? "ready"
    : level === "OUT_OF_STOCK" ? "stop" : "wait";
  const text = level === "OUT_OF_STOCK" ? "OUT OF STOCK" : level;
  return <span className={`zc-tag ${kind}`}><i />{text}</span>;
}

export function StatChip({ label: l, value, color = "var(--accent-ink)" }) {
  return (
    <div className="zc-metric" style={{ minWidth: 130, flex: "1 1 130px", padding: "14px 18px" }}>
      <div className="k">{l}</div>
      <div className="v tnum" style={{ fontSize: 22, color }}>{value}</div>
    </div>
  );
}

export function Modal({ title, sub, onClose, width = 520, children }) {
  return (
    <div className="zc-scrim" onClick={onClose}>
      <div
        className="zc-modal"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <div style={{ flex: 1 }}>
            <div className="t">{title}</div>
            {sub && <div className="s">{sub}</div>}
          </div>
          <button type="button" className="zc-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="mb">{children}</div>
      </div>
    </div>
  );
}

export function TableShell({ headers, children, emptyIcon, emptyText = "Nothing here yet", isEmpty }) {
  return (
    <div className="zc-card" style={{ padding: "14px 16px", overflowX: "auto" }}>
      <table className="zc-ledger">
        <thead>
          <tr>
            {headers.map((h) => <th key={h}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {isEmpty ? (
            <tr>
              <td colSpan={headers.length} style={{ padding: 40, textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>{emptyIcon || "📭"}</div>
                <div style={{ fontSize: 13, color: "var(--text-3)" }}>{emptyText}</div>
              </td>
            </tr>
          ) : children}
        </tbody>
      </table>
    </div>
  );
}

export const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
export const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
