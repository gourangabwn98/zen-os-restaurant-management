// src/components/NotificationBell.jsx — NTF-01 / NTF-02 / NTF-03
// ─────────────────────────────────────────────────────────────────────────────
// The POS notification centre. The bell sits top-left (sidebar brand row, or
// the top of the collapsed rail / phone bar — AdminLayout) so it is always in
// the same reachable spot; it opens an expandable panel next to it with every
// alert: new orders and their progress, waiter calls (silent copy — admins are
// never rung), stock alerts, print failures, freed tables. A toast and a panel
// entry are drawn by the same <AlertLine> so an alert looks the same wherever
// it appears. Data: hooks/useNotificationFeed.js (one socket subscription).
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { disconnectSocket } from "../services/socketService.js";
import { requestOrderFocus } from "../services/orderFocus.js";
import { useNotificationFeed } from "../hooks/useNotificationFeed.js";
import { KINDS, describeSlim } from "../notifications/model.js";
import { t, fmtNum, fmtTime } from "../i18n/core.js";

const P = {
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 6 2 7H4c.5-1 2-3 2-7Z" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  flow: <><circle cx="6" cy="12" r="2" /><circle cx="18" cy="12" r="2" /><path d="M8 12h8M14 9l3 3-3 3" /></>,
  dish: <><path d="M3 15h18M5 15a7 7 0 0 1 14 0M12 8V6M10 6h4" /><path d="M4 19h16" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  rupee: <path d="M7 5h10M7 9h10M7 5c5 0 6 4 0 8l7 6" />,
  alert: <><path d="M12 4L2.5 20h19z" /><path d="M12 10v4M12 17v.01" /></>,
  call: <><path d="M4 17h16M6 17a6 6 0 0 1 12 0M12 9V7M10 7h4" /></>,
  walk: <><circle cx="13" cy="4.5" r="1.8" /><path d="M10 21l2-6-2-3 1-4 3 3 3 1M8 13l2-5" /></>,
  box: <><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></>,
  printer: <><path d="M7 9V3h10v6M7 17H4v-7h16v7h-3" /><path d="M7 14h10v7H7z" /></>,
  table: <><circle cx="12" cy="10" r="6" /><path d="M12 16v5M8 21h8" /></>,
};
const TONE = { info: "var(--violet)", good: "var(--ready)", warn: "var(--wait)", bad: "var(--stop)" };

export function Glyph({ name, size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name] || P.bell}</svg>
  );
}

/** One alert, drawn the same in a toast and in the panel (NTF-03). */
function AlertLine({ d, at, unread, onClick }) {
  const c = TONE[d.tone] || TONE.info;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={`ntf-line${unread ? " unread" : ""}`}>
      <span className="ntf-ico" style={{ color: c, background: `color-mix(in srgb, ${c} 16%, transparent)` }}><Glyph name={d.icon} /></span>
      <span className="ntf-txt">
        <b>{d.title}</b>
        {d.sub && <small>{d.sub}</small>}
      </span>
      {at && <time>{fmtTime(at)}</time>}
    </Tag>
  );
}

if (typeof document !== "undefined" && !document.getElementById("ntf-styles")) {
  const s = document.createElement("style");
  s.id = "ntf-styles";
  s.textContent = `
    .ntf-btn { width: 36px; height: 36px; border-radius: var(--r-ctl); border: 1px solid var(--edge);
      background: var(--card-2); color: var(--text-1); cursor: pointer; position: relative; flex: none;
      display: grid; place-items: center; transition: var(--theme-transition); }
    .ntf-btn:hover, .ntf-btn[aria-expanded="true"] { background: var(--raise); }
    .ntf-count { position: absolute; top: -5px; right: -5px; min-width: 18px; height: 18px; border-radius: 9px; padding: 0 4px;
      background: var(--stop); color: #fff; font-size: 10px; font-weight: 800; display: grid; place-items: center;
      box-shadow: 0 0 0 2px var(--bg); }
    .ntf-panel { position: fixed; top: 0; bottom: 0; z-index: 960; width: min(380px, calc(100vw - 24px));
      display: flex; flex-direction: column; background: var(--grad-modal, var(--card)); border-right: 1px solid var(--edge-hi);
      box-shadow: var(--shadow-pop); animation: ntfIn .18s ease-out; }
    @keyframes ntfIn { from { transform: translateX(-16px); opacity: 0 } to { transform: none; opacity: 1 } }
    .ntf-scrim { position: fixed; inset: 0; z-index: 955; background: var(--scrim); }
    .ntf-head { display: flex; align-items: center; gap: 8px; padding: 18px 16px 10px; }
    .ntf-head h3 { margin: 0; flex: 1; font-size: 16px; color: var(--text-1); }
    .ntf-tabs { display: flex; gap: 6px; padding: 0 16px 10px; flex-wrap: wrap; }
    .ntf-tabs button { border: 1px solid var(--edge); background: transparent; color: var(--text-2); border-radius: 999px;
      padding: 5px 11px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .ntf-tabs button[aria-pressed="true"] { background: var(--violet-soft, var(--raise)); color: var(--text-1); border-color: var(--edge-hi); }
    .ntf-list { flex: 1; overflow-y: auto; padding: 4px 10px 16px; }
    .ntf-line { display: flex; gap: 10px; align-items: flex-start; width: 100%; text-align: left; padding: 10px 10px;
      border-radius: 12px; border: none; background: transparent; color: var(--text-1); font-family: inherit; cursor: default; }
    button.ntf-line { cursor: pointer; }
    button.ntf-line:hover { background: var(--raise); }
    .ntf-line.unread { background: color-mix(in srgb, var(--violet) 8%, transparent); }
    .ntf-ico { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; flex: none; }
    .ntf-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .ntf-txt b { font-size: 13px; font-weight: 650; line-height: 1.35; }
    .ntf-txt small { font-size: 11.5px; color: var(--text-3); }
    .ntf-line time { font-size: 10.5px; color: var(--text-3); flex: none; padding-top: 2px; }
    .ntf-empty { padding: 40px 16px; text-align: center; color: var(--text-3); font-size: 13px; }
    .ntf-toast { min-width: 260px; max-width: 360px; background: var(--card); border: 1px solid var(--edge-hi);
      border-radius: 14px; box-shadow: var(--shadow-pop); }
  `;
  document.head.appendChild(s);
}

/**
 * @param user        signed-in admin (null → disconnect the socket)
 * @param onGo        (page) => void — open a page of the admin
 * @param panelLeft   where the panel opens (px from the left edge)
 */
export default function NotificationBell({ user, onGo, panelLeft = 0 }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("all");
  const [highlightAfter, setHighlightAfter] = useState(0); // "new" = arrived after the last look
  const btnRef = useRef(null);

  const go = useCallback((target) => {
    if (!target) return;
    onGo?.(target.page);
    if (target.order) requestOrderFocus(target.order);
  }, [onGo]);

  const onToast = useCallback((d) => {
    toast.custom((tst) => (
      <div className="ntf-toast">
        <AlertLine d={d} onClick={() => { toast.dismiss(tst.id); go(d.go); }} />
      </div>
    ), { duration: d.tone === "bad" ? 7000 : 4500 });
  }, [go]);

  const feed = useNotificationFeed({ enabled: Boolean(user), onToast });

  useEffect(() => { if (!user) disconnectSocket(); }, [user]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const shown = useMemo(() => feed.items
    .map((e) => ({ ...e, d: describeSlim(e.data) }))
    .filter((e) => e.d && (kind === "all" || e.d.kind === kind)), [feed.items, kind]);

  if (!user) return null;

  const toggle = () => {
    if (!open) { setHighlightAfter(feed.seenAt); feed.markAllRead(); }
    setOpen((v) => !v);
  };

  return (
    <>
      <button ref={btnRef} type="button" className="ntf-btn" onClick={toggle} aria-expanded={open} aria-haspopup="dialog"
        title={t("Notifications")} aria-label={feed.unread ? t("Notifications, {n} new", { n: feed.unread }) : t("Notifications")}>
        <Glyph name="bell" />
        {feed.unread > 0 && <span className="ntf-count">{feed.unread > 9 ? `${fmtNum(9)}+` : fmtNum(feed.unread)}</span>}
      </button>

      {open && createPortal(
        <>
          <div className="ntf-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside className="ntf-panel" role="dialog" aria-label={t("Notifications")} style={{ left: panelLeft }}>
            <div className="ntf-head">
              <h3>{t("Notifications")}</h3>
              {feed.items.length > 0 && <button type="button" className="zc-btn sm ghost" onClick={feed.clear}>{t("Clear")}</button>}
              <button type="button" className="zc-x" onClick={() => setOpen(false)} aria-label={t("Close")}>✕</button>
            </div>
            <div className="ntf-tabs" role="group" aria-label={t("Show")}>
              {KINDS.map((k) => (
                <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => setKind(k.key)}>{t(k.label)}</button>
              ))}
            </div>
            <div className="ntf-list">
              {shown.length === 0 ? (
                <div className="ntf-empty">{t("Nothing yet — new orders, waiter calls and alerts show up here.")}</div>
              ) : shown.map((e) => (
                <AlertLine key={e.id} d={e.d} at={e.at} unread={e.at > highlightAfter}
                  onClick={e.d.go ? () => { setOpen(false); go(e.d.go); } : undefined} />
              ))}
            </div>
          </aside>
        </>,
        document.body,
      )}
    </>
  );
}
