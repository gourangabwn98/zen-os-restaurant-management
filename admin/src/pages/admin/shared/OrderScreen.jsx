// src/pages/admin/shared/OrderScreen.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Full-screen layout for taking an order (OrdersPage: "New order" and
// "Add items to order"). Point-of-sale shape a manager reads at a glance:
//
//   ┌ ← Orders │ Title · context            [ search ……… 🎤 ]           ✕ ┐
//   │ categories │ dishes …                        │ ORDER PANEL          │
//   │            │                                 │  details / items     │
//   │            │                                 │  ─────────────────── │
//   │            │                                 │  totals · [ ACTION ] │
//   └──────────────────────────────────────────────────────────────────────┘
//
// Only layout + presentation live here; each screen keeps its own logic.
// Phone (≤780px): the panel becomes a sheet opened from a bottom bar
// (classes op-no-cart / op-no-cartbar / op-no-back in OrdersPage).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { t, tn, fmtNum } from "../../../i18n/core.js";

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
  </svg>
);

/**
 * @param title      "New order"
 * @param context    one short line under the title (order no · table · customer)
 * @param search / onSearch   the menu search
 * @param voice      the voice-order button
 * @param canEscape  Esc closes the screen (only while nothing has been added)
 * @param bar        phone-only bottom bar (PanelBar), under the body
 * @param overlay    things rendered above everything (the add-on picker)
 */
export function OrderScreen({ title, context, search, onSearch, voice, canEscape, onClose, bar, overlay, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && canEscape && !e.defaultPrevented) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEscape, onClose]);
  // The page behind must not scroll under a full-screen view.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="os-root" role="dialog" aria-modal="true" aria-label={title}>
      <OrderScreenStyles />
      <header className="os-head">
        <button type="button" className="os-back" onClick={onClose}>
          <span aria-hidden="true">←</span><span className="os-back-t">{t("Orders")}</span>
        </button>
        <div className="os-title">
          <h2>{title}</h2>
          {context && <p>{context}</p>}
        </div>
        <div className="os-search">
          <span className="os-search-ic"><SearchIcon /></span>
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={t("Search dishes by name or code…")}
            aria-label={t("Search items…")} />
          {search && <button type="button" className="os-search-x" onClick={() => onSearch("")} aria-label={t("Clear search")}>✕</button>}
        </div>
        {voice}
        <button type="button" className="os-close" onClick={onClose} aria-label={t("Close")}>✕</button>
      </header>
      <div className="os-body op-no-main">{children}</div>
      {bar}
      {overlay}
    </div>
  );
}

/** Right-hand panel: heading row, a scroll area and a pinned footer. */
export function OrderPanel({ open, title, count, onClear, onBack, children, footer }) {
  return (
    <aside className={`os-panel op-no-cart${open ? " open" : ""}`} aria-label={title}>
      <div className="os-panel-h">
        <button type="button" className="zc-btn sm ghost op-no-back" onClick={onBack}>← {t("Menu")}</button>
        <h3>{title}</h3>
        {count > 0 && <span className="os-count">{fmtNum(count)}</span>}
        {count > 0 && onClear && <button type="button" className="os-link danger" onClick={onClear}>{t("Clear")}</button>}
      </div>
      <div className="os-panel-b op-scroll">{children}</div>
      {footer && <div className="os-panel-f">{footer}</div>}
    </aside>
  );
}

/** A labelled block inside the panel. */
export const PanelSection = ({ label, aside, children }) => (
  <section className="os-sec">
    {(label || aside) && <div className="os-sec-h"><span>{label}</span>{aside}</div>}
    {children}
  </section>
);

/** One order line: name (+ add-ons below), ₹ each × qty, − / +, line total. */
export function OrderLine({ name, addons, unit, qty, onDec, onInc }) {
  return (
    <div className="os-line">
      <div className="os-line-main">
        <div className="os-line-nm">{name}</div>
        {addons}
        <div className="os-line-meta tnum">₹{fmtNum(unit)} × {fmtNum(qty)}</div>
      </div>
      <div className="os-step">
        <button type="button" onClick={onDec} aria-label={t("Remove one {name}", { name })}>−</button>
        <b className="tnum">{fmtNum(qty)}</b>
        <button type="button" className="pri" onClick={onInc} aria-label={t("Add {name}", { name })}>+</button>
      </div>
      <div className="os-line-amt tnum">₹{fmtNum(unit * qty)}</div>
    </div>
  );
}

export const EmptyLines = ({ title, hint }) => (
  <div className="os-empty">
    <div className="os-empty-ic" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h16l-1.5 11a2 2 0 0 1-2 1.7h-9a2 2 0 0 1-2-1.7z" /><path d="M9 7a3 3 0 0 1 6 0" />
      </svg>
    </div>
    <b>{title}</b>
    <span>{hint}</span>
  </div>
);

/** Totals: rows [label, amount, { muted }] then the bold total. */
export const Totals = ({ rows = [], totalLabel, total, note }) => (
  <div className="os-totals tnum">
    {rows.filter(Boolean).map(([label, amount, opts]) => (
      <div key={label} className={`os-tr${opts?.muted ? " muted" : ""}`}><span>{label}</span><span>₹{fmtNum(amount)}</span></div>
    ))}
    <div className="os-tr total"><span>{totalLabel}</span><span>₹{fmtNum(total)}</span></div>
    {note && <div className="os-tnote">{note}</div>}
  </div>
);

/** A segmented choice ([value, label] pairs). `tone(value)` → extra class for the active one. */
export const Seg = ({ value, options, onChange, label, tone }) => (
  <div className="os-seg" role="group" aria-label={label}>
    {options.map(([v, l]) => (
      <button key={v} type="button" aria-pressed={value === v} className={value === v ? `on ${tone?.(v) || ""}` : ""} onClick={() => onChange(v)}>{l}</button>
    ))}
  </div>
);

/** "＋ Customer details (optional)" — collapsed until needed. */
export function Collapsible({ label, summary, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`os-coll${open ? " open" : ""}`}>
      <button type="button" className="os-coll-h" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{label}</span>
        {!open && summary && <em>{summary}</em>}
        <span className="os-chev" aria-hidden="true">▾</span>
      </button>
      {open && <div className="os-coll-b">{children}</div>}
    </div>
  );
}

/** Phone only: bottom bar under the menu that opens the panel. */
export const PanelBar = ({ count, total, onOpen }) => (
  <div className="op-no-cartbar os-bar">
    <div className="os-bar-t">
      {count ? <><b>{tn(count, "{n} item", "{n} items")}</b><span className="tnum">₹{fmtNum(total)}</span></> : <span>{t("No items yet")}</span>}
    </div>
    <button type="button" className="zc-btn pri sm" disabled={!count} onClick={onOpen}>{t("Review order")} →</button>
  </div>
);

const OrderScreenStyles = () => (
  <style>{`
    .os-root { position: fixed; inset: 0; z-index: 999; display: flex; flex-direction: column; background: var(--bg); color: var(--text-1); }
    .os-head { display: flex; align-items: center; gap: 14px; padding: 10px 18px; min-height: 64px; flex-shrink: 0;
      background: var(--surface); border-bottom: 1px solid var(--edge); }
    .os-back { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px 0 10px; border-radius: 10px;
      border: 1px solid var(--edge); background: var(--card); color: var(--text-1); font-weight: 650; font-size: 13.5px; cursor: pointer; }
    .os-back:hover { border-color: var(--violet-line); }
    .os-title { min-width: 0; max-width: 34%; }
    .os-title h2 { margin: 0; font-size: 17px; font-weight: 750; letter-spacing: -.01em; white-space: nowrap; }
    .os-title p { margin: 2px 0 0; font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .os-search { flex: 1; max-width: 560px; margin-left: auto; position: relative; display: flex; align-items: center; }
    .os-search input { width: 100%; height: 42px; padding: 0 38px 0 40px; border-radius: 12px; border: 1px solid var(--edge-hi);
      background: var(--card); color: var(--text-1); font-size: 14px; outline: none; transition: border-color .15s ease, box-shadow .15s ease; }
    .os-search input:focus { border-color: var(--accent-ink); box-shadow: 0 0 0 3px var(--violet-weak); }
    .os-search-ic { position: absolute; left: 12px; color: var(--text-3); display: grid; }
    .os-search-x { position: absolute; right: 8px; width: 26px; height: 26px; border-radius: 50%; border: 0; background: var(--card-2); color: var(--text-2); cursor: pointer; }
    .os-close { width: 40px; height: 40px; border-radius: 10px; border: 1px solid var(--edge); background: var(--card); color: var(--text-2); font-size: 15px; cursor: pointer; flex-shrink: 0; }
    .os-close:hover { color: var(--stop-ink); border-color: var(--stop-ink); }
    .os-body { flex: 1; min-height: 0; background: var(--card); }

    .os-panel { width: 360px; flex-shrink: 0; display: flex; flex-direction: column; min-height: 0; background: var(--surface); border-left: 1px solid var(--edge); }
    .os-panel-h { display: flex; align-items: center; gap: 8px; padding: 14px 16px 12px; border-bottom: 1px solid var(--edge); flex-shrink: 0; }
    .os-panel-h h3 { margin: 0; font-size: 15px; font-weight: 750; }
    .os-count { min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px; display: grid; place-items: center;
      font-size: 11.5px; font-weight: 750; color: #fff; background: var(--grad-btn); }
    .os-link { margin-left: auto; border: 0; background: none; font-size: 12.5px; font-weight: 650; cursor: pointer; color: var(--accent-ink); }
    .os-link.danger { color: var(--stop-ink); }
    .os-panel-b { flex: 1; min-height: 0; overflow-y: auto; }
    .os-panel-f { flex-shrink: 0; padding: 12px 16px 16px; border-top: 1px solid var(--edge); background: var(--surface); box-shadow: 0 -8px 20px -16px rgba(0,0,0,.35); }

    .os-sec { padding: 14px 16px; border-bottom: 1px solid var(--edge); display: grid; gap: 10px; }
    .os-sec:last-child { border-bottom: 0; }
    .os-sec-h { display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; color: var(--text-3); }
    .os-field { display: grid; gap: 5px; }
    .os-field > span { font-size: 12px; font-weight: 600; color: var(--text-2); }
    .os-field select, .os-field input { height: 40px; border-radius: 10px; border: 1px solid var(--edge-hi); background: var(--card); color: var(--text-1);
      padding: 0 12px; font-size: 14px; outline: none; }
    .os-field select:focus, .os-field input:focus { border-color: var(--accent-ink); box-shadow: 0 0 0 3px var(--violet-weak); }
    .os-field.need select, .os-field.need input { border-color: var(--wait-ink); }
    .os-field small { font-size: 11px; color: var(--text-3); }
    .os-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

    .os-seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 4px; border-radius: 12px; background: var(--card-2); border: 1px solid var(--edge); }
    .os-seg button { height: 36px; border: 0; border-radius: 9px; background: transparent; color: var(--text-2); font-weight: 650; font-size: 13px; cursor: pointer; }
    .os-seg button.on { background: var(--grad-btn); color: #fff; box-shadow: 0 4px 12px -6px var(--violet-glow); }
    .os-seg button.on.good { background: var(--ready-fill); color: var(--ready-ink); box-shadow: none; }
    .os-seg button.on.warn { background: var(--wait-fill); color: var(--wait-ink); box-shadow: none; }

    .os-lines { display: grid; gap: 2px; }
    .os-line { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 10px; padding: 10px 2px; border-bottom: 1px dashed var(--edge); }
    .os-line:last-child { border-bottom: 0; }
    .os-line-main { min-width: 0; }
    .os-line-nm { font-size: 13.5px; font-weight: 650; line-height: 1.3; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .os-line-meta { font-size: 11.5px; color: var(--text-3); margin-top: 2px; }
    .os-line-amt { min-width: 56px; text-align: right; font-weight: 750; font-size: 13.5px; }
    .os-step { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border-radius: 999px; background: var(--card-2); border: 1px solid var(--edge); }
    .os-step button { width: 28px; height: 28px; border-radius: 50%; border: 0; background: transparent; color: var(--text-1); font-size: 16px; font-weight: 700; cursor: pointer; }
    .os-step button:hover { background: var(--card); }
    .os-step button.pri { background: var(--grad-btn); color: #fff; }
    .os-step b { min-width: 22px; text-align: center; font-size: 13px; }

    .os-empty { display: grid; justify-items: center; gap: 4px; padding: 26px 10px; text-align: center; color: var(--text-3); font-size: 12.5px; }
    .os-empty b { color: var(--text-2); font-size: 13.5px; }
    .os-empty-ic { width: 52px; height: 52px; border-radius: 16px; display: grid; place-items: center; background: var(--card-2); color: var(--text-3); margin-bottom: 4px; }

    .os-coll { border: 1px solid var(--edge); border-radius: 12px; background: var(--card); overflow: hidden; }
    .os-coll-h { width: 100%; display: flex; align-items: center; gap: 8px; padding: 11px 12px; border: 0; background: none; color: var(--text-1); font-weight: 650; font-size: 13px; cursor: pointer; text-align: left; }
    .os-coll-h em { font-style: normal; font-weight: 500; color: var(--text-3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .os-chev { margin-left: auto; color: var(--text-3); transition: transform .15s ease; }
    .os-coll.open .os-chev { transform: rotate(180deg); }
    .os-coll-b { padding: 0 12px 12px; display: grid; gap: 8px; }

    .os-totals { display: grid; gap: 6px; margin-bottom: 12px; }
    .os-tr { display: flex; justify-content: space-between; font-size: 13px; color: var(--text-2); }
    .os-tr.muted { font-size: 12px; color: var(--text-3); }
    .os-tr.total { padding-top: 8px; margin-top: 2px; border-top: 1px solid var(--edge); font-size: 18px; font-weight: 800; color: var(--text-1); }
    .os-tnote { font-size: 11.5px; color: var(--text-3); text-align: right; }
    .os-cta { width: 100%; height: 50px; border: 0; border-radius: 14px; background: var(--grad-btn); color: #fff; font-size: 15px; font-weight: 800;
      cursor: pointer; box-shadow: 0 10px 24px -12px var(--violet-glow); display: flex; align-items: center; justify-content: center; gap: 10px; }
    .os-cta:disabled { background: var(--card-2); color: var(--text-3); box-shadow: none; cursor: not-allowed; }
    .os-cta .amt { padding: 3px 10px; border-radius: 999px; background: rgba(255,255,255,.2); font-size: 14px; }
    .os-info { font-size: 12px; line-height: 1.45; color: var(--text-2); padding: 10px 12px; border-radius: 10px; background: var(--card-2); border: 1px solid var(--edge); }
    .os-info.warn { color: var(--wait-ink); background: var(--wait-fill); border-color: var(--wait-line); }
    .os-sum { display: grid; gap: 6px; padding: 12px; border-radius: 12px; background: var(--card); border: 1px solid var(--edge); }
    .os-sum-r { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; color: var(--text-2); }
    .os-sum-r b { color: var(--text-1); }
    .os-pill { font-size: 11px; font-weight: 750; padding: 2px 9px; border-radius: 999px; }
    .os-pill.paid { background: var(--ready-fill); color: var(--ready-ink); }
    .os-pill.due { background: var(--wait-fill); color: var(--wait-ink); }
    .os-hint { font-size: 11.5px; color: var(--ready-ink); }
    .os-bar { gap: 12px; }
    .os-bar-t { flex: 1; min-width: 0; display: flex; gap: 10px; align-items: baseline; font-size: 13px; color: var(--text-2); }
    .os-bar-t b { color: var(--text-1); }

    @media (max-width: 1100px) { .os-panel { width: 320px; } .os-title { max-width: 28%; } }
    @media (max-width: 780px) {
      .os-head { flex-wrap: wrap; gap: 10px; padding: 8px 12px; }
      .os-back-t { display: none; }
      .os-title { flex: 1; max-width: none; }
      .os-search { order: 5; flex-basis: 100%; max-width: none; margin-left: 0; }
      .os-panel { width: auto; border-left: 0; }
    }
  `}</style>
);
