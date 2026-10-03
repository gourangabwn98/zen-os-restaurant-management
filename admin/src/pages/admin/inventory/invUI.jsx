// src/pages/admin/inventory/invUI.jsx
// ─────────────────────────────────────────────────────────────────────────────
// React components for the eight Inventory tabs, in the Zen OS visual language
// (design-reference/zen-os-design-reference.html → "Inventory" screens).
// Non-component helpers (tokens, formatters, style objects) live in invKit.js.
// Data, API calls and business logic are untouched — this is presentation only.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import Loader from "../shared/Loader.jsx";
import ErrorState from "../shared/ErrorState.jsx";
import EmptyState from "../shared/EmptyState.jsx";
import { levelKind } from "./invKit.js";
import { t, N_, fmtNum } from "../../../i18n/core.js";

// ── status badge ────────────────────────────────────────────────────────────
const LEVEL_TEXT = { OK: N_("Ok"), LOW: N_("Low"), CRITICAL: N_("Critical"), OUT_OF_STOCK: N_("Out of stock") };
export function LevelBadge({ level }) {
  const text = LEVEL_TEXT[level] ? t(LEVEL_TEXT[level]) : level || "—";
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
export function Search({ value, onChange, placeholder = t("Search…"), style }) {
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
            {typeof text === "string" ? t(text) : text}
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
export function ErrorBox({ onRetry, what = N_("this") }) {
  return (
    <div className="zc-card">
      <ErrorState
        title={t("Could not load {what}", { what: t(what) })}
        sub={t("The server did not respond. Check your connection, then try again.")}
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
          <button type="button" className="zc-x" onClick={onClose} aria-label={t("Close")}>✕</button>
        </div>
        <div className="mb">{children}</div>
        {footer && <div className="mf">{footer}</div>}
      </div>
    </div>
  );
}

// ── table shell (Zen OS ledger) ─────────────────────────────────────────────
export function TableShell({ headers, children, emptyIcon, emptyText = t("Nothing here yet"), isEmpty, minWidth = 640, footer }) {
  return (
    <div className="zc-card">
      {isEmpty ? (
        <EmptyState icon={emptyIcon} title={emptyText} />
      ) : (
        <div style={{ overflowX: "auto", padding: "6px 10px 8px" }}>
          <table className="zc-ledger" style={{ minWidth }}>
            <thead><tr>{headers.map((h) => <th key={h}>{h ? t(h) : h}</th>)}</tr></thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      )}
      {footer}
    </div>
  );
}

// ── pager (matches the reference .tfoot + .pager) ──────────────────────────
export function TableFooter({ page, pages, total, perPage, onPage, unit = N_("rows") }) {
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
      <span>{t("Showing {from}–{to} of {total} {unit}", { from: (page - 1) * perPage + 1, to: Math.min(page * perPage, total), total, unit: t(unit) })}</span>
      <div className="zc-pager">
        <button type="button" disabled={page === 1} onClick={() => onPage(page - 1)} aria-label={t("Previous page")}>‹</button>
        {list.map((p, i) => p === "…"
          ? <span key={`g${i}`} className="gap">…</span>
          : <button type="button" key={p} className={page === p ? "on" : ""} onClick={() => onPage(p)}>{fmtNum(p)}</button>)}
        <button type="button" disabled={page === pages} onClick={() => onPage(page + 1)} aria-label={t("Next page")}>›</button>
      </div>
    </div>
  );
}

// ── line icons (same stroke style as the sidebar / Dashboard icons) ─────────
const ICONS = {
  cart:  <><path d="M3 4h2l2 11h11l2-8H6" /><circle cx="9" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" /></>,
  bin:   <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></>,
  box:   <><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></>,
  cam:   <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  plus:  <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8M8 12h8" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
};
export function Icon({ id, size }) {
  return (
    <svg className="ivt-ico" viewBox="0 0 24 24" aria-hidden="true" style={size ? { width: size, height: size } : undefined}>
      {ICONS[id]}
    </svg>
  );
}

// ── side drawer (same pattern as invoices/InvoiceDrawer) ────────────────────
export function Drawer({ onClose, label: ariaLabel, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="ivt-drawer-scrim" onClick={onClose}>
      <aside className="ivt-drawer" role="dialog" aria-modal="true" aria-label={ariaLabel} onClick={(e) => e.stopPropagation()}>
        {children}
      </aside>
    </div>
  );
}

// ── row "⋯" menu — items: [{ label, onClick, danger? } | "-"] ───────────────
export function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <span style={{ position: "relative", display: "inline-flex" }} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="zc-btn ghost sm" aria-haspopup="menu" aria-expanded={open} aria-label={t("More actions")}
        onClick={() => setOpen((o) => !o)}>⋯</button>
      {open && (
        <>
          <div className="ivt-menu-scrim" onClick={() => setOpen(false)} />
          <div className="ivt-menu" role="menu">
            {items.filter(Boolean).map((it, i) => (it === "-"
              ? <hr key={`s${i}`} />
              : (
                <button key={it.label} type="button" role="menuitem" className={it.danger ? "danger" : undefined}
                  onClick={() => { setOpen(false); it.onClick(); }}>
                  {it.label}
                </button>
              )))}
          </div>
        </>
      )}
    </span>
  );
}
