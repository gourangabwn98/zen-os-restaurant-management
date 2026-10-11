// "Cash + Online" — a bill paid partly in cash and partly online. A button
// that opens two amount boxes; typing one fills the other with the rest of
// the bill. "Save" stays off until both are more than ₹0 and add up to the
// total exactly (the server checks the same again).
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { t, fmtNum } from "../../../i18n/core.js";
import { splitOk } from "../../../utils/payment.js";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function SplitPayModal({ total, title, onClose, onConfirm }) {
  const due = r2(total);
  const [cash, setCash] = useState("");
  const [online, setOnline] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = splitOk(cash, online, due);
  const sum = r2(Number(cash) + Number(online));

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const type = (which, v) => {
    const rest = v === "" ? "" : String(Math.max(0, r2(due - Number(v))));
    if (which === "cash") { setCash(v); setOnline(rest); } else { setOnline(v); setCash(rest); }
  };
  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try { if (await onConfirm({ cash: r2(cash), online: r2(online) }) !== false) onClose(); }
    finally { setBusy(false); }
  };
  const box = (which, label, value) => (
    <div className="menu-field" style={{ flex: 1 }}>
      <label htmlFor={`split-${which}`} style={{ fontSize: 12, fontWeight: 600 }}>{label}</label>
      <input id={`split-${which}`} className="zc-input" type="number" min="0" step="0.01" inputMode="decimal"
        value={value} onChange={(e) => type(which, e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()}
        autoFocus={which === "cash"} placeholder="0" />
    </div>
  );

  return createPortal(
    <div className="zc-scrim" onClick={() => !busy && onClose()} style={{ zIndex: 1300 }}>
      <div className="zc-modal" style={{ width: 400 }} role="dialog" aria-modal="true" aria-labelledby="split-title" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div style={{ flex: 1 }}>
            <div className="t" id="split-title">💵 + 📱 {t("Cash + Online")}</div>
            <div className="s">{title}</div>
          </div>
          <button type="button" className="zc-x" onClick={onClose} disabled={busy} aria-label={t("Close")}>✕</button>
        </div>
        <div className="mb" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>{t("Bill total")}</span>
            <b className="tnum" style={{ fontSize: 20 }}>₹{fmtNum(due)}</b>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {box("cash", `💵 ${t("Cash amount")}`, cash)}
            {box("online", `📱 ${t("Online amount")}`, online)}
          </div>
          <div role="status" style={{ fontSize: 12.5, fontWeight: 600, color: ok ? "var(--ready-ink)" : "var(--stop-ink)" }}>
            {cash === "" && online === "" ? t("Enter how much came in cash — the rest is online.")
              : ok ? `✓ ${t("Cash ₹{cash} + Online ₹{online} = ₹{total}", { cash: fmtNum(r2(cash)), online: fmtNum(r2(online)), total: fmtNum(due) })}`
              : Number(cash) <= 0 || Number(online) <= 0 ? t("Both amounts must be more than ₹0 — otherwise choose Cash or Online.")
              : t("₹{sum} entered, but the bill is ₹{total}", { sum: fmtNum(sum), total: fmtNum(due) })}
          </div>
        </div>
        <div className="mf">
          <button type="button" className="zc-btn ghost" onClick={onClose} disabled={busy}>{t("Cancel")}</button>
          <button type="button" className="zc-btn good" onClick={save} disabled={!ok || busy}>{busy ? t("Saving…") : t("Save payment")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A button that opens the split dialog. `onConfirm({ cash, online })` may
 * return false to keep the dialog open (e.g. the server refused it). */
export default function SplitPayButton({ total, title, onConfirm, disabled, className = "zc-btn pri", style, children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} style={style} disabled={disabled} onClick={() => setOpen(true)}>
        {children || <>💵+📱 {t("Cash + Online")}</>}
      </button>
      {open && <SplitPayModal total={total} title={title} onClose={() => setOpen(false)} onConfirm={onConfirm} />}
    </>
  );
}
