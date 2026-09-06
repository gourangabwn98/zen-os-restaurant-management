// src/pages/admin/inventory/invUI.jsx
// ─────────────────────────────────────────────────────────────────────────────
// React components for the eight Inventory tabs, in the Zen OS visual language
// (design-reference/zen-os-design-reference.html → "Inventory" screens).
// Non-component helpers (tokens, formatters, style objects) live in invKit.js.
// Data, API calls and business logic are untouched — this is presentation only.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from "react";
import Loader from "../shared/Loader.jsx";
import ErrorState from "../shared/ErrorState.jsx";
import EmptyState from "../shared/EmptyState.jsx";
import { levelKind } from "./invKit.js";

// ── status badge ────────────────────────────────────────────────────────────
const LEVEL_TEXT = { OK: "Ok", LOW: "Low", CRITICAL: "Critical", OUT_OF_STOCK: "Out of stock" };
export function LevelBadge({ level }) {
  const text = LEVEL_TEXT[level] || level || "—";
  return <span className={`zc-tag ${levelKind(level)}`}><i />{text}</span>;
}

// ── metric / stat tile (real values only — no invented comparisons) ─────────
const TONE_INK = {
  good:  "var(--ready-ink)",
  warn:  "var(--wait-ink)",
  stop:  "var(--stop-ink)",
  info:  "var(--live-ink)",
  muted: "var(--text-2)",
};
export function StatChip({ label: l, value, sub, tone = "info" }) {
  const grad = tone === "brand";
  return (
    <div className="zc-metric" style={{ minWidth: 150, flex: "1 1 160px" }}>
      <div className="k">{l}</div>
      <div className={`v tnum${grad ? " gr" : ""}`} style={grad ? undefined : { color: TONE_INK[tone], fontSize: 22 }}>
        {value}
      </div>
      {sub != null && sub !== "" && <div className="d">{sub}</div>}
    </div>
  );
}
export function StatRow({ children, mb = 16 }) {
  return <div style={{ display: "flex", gap: 12, marginBottom: mb, flexWrap: "wrap" }}>{children}</div>;
}

// ── toolbar / filter row ────────────────────────────────────────────────────
export function Toolbar({ children }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
      {children}
    </div>
  );
}
export function Search({ value, onChange, placeholder = "Search…", style }) {
  return (
    <input
      className="zc-input" value={value} placeholder={placeholder} aria-label={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ flex: 1, minWidth: 220, maxWidth: 320, ...style }}
    />
  );
}
export function Seg({ options, value, onChange, ariaLabel }) {
  return (
    <div className="zc-seg" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => {
        const val = Array.isArray(o) ? o[0] : o;
        const text = Array.isArray(o) ? o[1] : o;
        return (
          <button key={val} type="button" role="tab" aria-selected={value === val}
            className={value === val ? "on" : ""} onClick={() => onChange(val)}>
            {text}
          </button>
        );
      })}
    </div>
  );
}
export function Spacer() { return <div style={{ flex: 1 }} />; }
export function Count({ children }) {
  return <span style={{ fontSize: 12, color: "var(--text-3)" }}>{children}</span>;
}

// ── loading / error ─────────────────────────────────────────────────────────
export function Loading({ rows = 7 }) {
  return <div className="zc-card" style={{ padding: "16px 18px" }}><Loader rows={rows} /></div>;
}
export function ErrorBox({ onRetry, what = "this" }) {
  return (
    <div className="zc-card">
      <ErrorState
        title={`Could not load ${what}`}
        sub="The server did not respond. Check your connection, then try again."
        onRetry={onRetry}
      />
    </div>
  );
}

// ── modal ───────────────────────────────────────────────────────────────────
export function Modal({ title, sub, onClose, width = 520, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="zc-scrim" onClick={onClose}>
      <div className="zc-modal" style={{ width }} onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t">{title}</div>
            {sub && <div className="s">{sub}</div>}
          </div>
          <button type="button" className="zc-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="mb">{children}</div>
        {footer && <div className="mf">{footer}</div>}
      </div>
    </div>
  );
}

// ── table shell (Zen OS ledger) ─────────────────────────────────────────────
export function TableShell({ headers, children, emptyIcon, emptyText = "Nothing here yet", isEmpty, minWidth = 640, footer }) {
  return (
    <div className="zc-card">
      {isEmpty ? (
        <EmptyState icon={emptyIcon} title={emptyText} />
      ) : (
        <div style={{ overflowX: "auto", padding: "6px 10px 8px" }}>
          <table className="zc-ledger" style={{ minWidth }}>
            <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      )}
      {footer}
    </div>
  );
}

// ── pager (matches the reference .tfoot + .pager) ──────────────────────────
export function TableFooter({ page, pages, total, perPage, onPage, unit = "rows" }) {
  if (pages <= 1) return null;
  const list = Array.from({ length: pages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 1)
    .reduce((acc, p, i, arr) => {
      if (i > 0 && arr[i - 1] !== p - 1) acc.push("…");
      acc.push(p);
      return acc;
    }, []);
  return (
    <div className="zc-tfoot" style={{ padding: "14px 18px 6px" }}>
      <span>Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total} {unit}</span>
      <div className="zc-pager">
        <button type="button" disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="Previous page">‹</button>
        {list.map((p, i) => p === "…"
          ? <span key={`g${i}`} className="gap">…</span>
          : <button type="button" key={p} className={page === p ? "on" : ""} onClick={() => onPage(p)}>{p}</button>)}
        <button type="button" disabled={page === pages} onClick={() => onPage(page + 1)} aria-label="Next page">›</button>
      </div>
    </div>
  );
}
