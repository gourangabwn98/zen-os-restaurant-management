// src/pages/admin/invoices/CollectModal.jsx
// "Collect payment" — records a bill as paid through the existing
// PATCH /admin/orders/:id/payment ({ paymentStatus: "PAID", paymentMethod }).
// Cash: shows the change to give back (a counter aid only, nothing stored).
// Online / UPI: staff must confirm they have seen the money arrive — opening
// a UPI app is never treated as proof of payment.
// Cash + Online ("Both"): part of each — the two amounts must add up to the
// bill total exactly (checked again on the server), online part confirmed too.
import { useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "../inventory/invUI.jsx";
import { t, fmtNum } from "../../../i18n/core.js";
import { custName, money, tableLabel } from "./model.js";
import { SPLIT, splitOk } from "../../../utils/payment.js";

export default function CollectModal({ o, initialMode, onClose, onRecord }) {
  const [mode, setMode] = useState(initialMode || (o.paymentMethod === "Online" ? "Online" : "Cash"));
  const total = Math.round(Number(o.total) || 0);
  const [got, setGot] = useState(total);
  const [seen, setSeen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cash, setCash] = useState(""); // split only
  const [online, setOnline] = useState("");
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const typeSplit = (which, v) => {
    const rest = v === "" ? "" : String(Math.max(0, r2(Number(o.total) - Number(v))));
    if (which === "cash") { setCash(v); setOnline(rest); } else { setOnline(v); setCash(rest); }
  };
  const splitValid = splitOk(cash, online, o.total);

  const quick = [total, ...[50, 100, 200, 500, 2000].map((v) => Math.ceil(total / v) * v)]
    .filter((v, i, a) => v >= total && a.indexOf(v) === i).slice(0, 5);
  const ok = mode === "Cash" ? got >= total : mode === SPLIT ? splitValid && seen : seen;

  const record = async () => {
    setBusy(true);
    try { await onRecord(o, mode, mode === SPLIT ? { cash: r2(cash), online: r2(online) } : undefined); onClose(); }
    catch { /* toast shown by the page */ }
    finally { setBusy(false); }
  };

  // Portalled after the bill drawer, so it always sits on top of it.
  return createPortal(
    <Modal
      title={t("Collect & settle")}
      sub={`${o.orderId} · ${custName(o) || t("Walk-in guest")} · ${tableLabel(o)}`}
      onClose={onClose}
      width={460}
      footer={<>
        <button type="button" className="zc-btn ghost" onClick={onClose}>{t("Cancel")}</button>
        <button type="button" className="zc-btn good" disabled={!ok || busy} onClick={record}>
          {busy ? t("Saving…") : t("Settle · {amount} {method}", { amount: money(mode === SPLIT ? o.total : total), method: t(mode === "Cash" ? "cash" : mode === SPLIT ? "cash + online" : "online") })}
        </button>
      </>}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <span className="inv-hint">{t("Bill total")}</span>
        <span className="inv-big">{money(total)}</span>
      </div>

      <div className="inv-field" style={{ marginTop: 0, marginBottom: 6 }}>{t("How did the customer pay?")}</div>
      <div className="inv-modes" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <button type="button" className="inv-mode" aria-pressed={mode === "Cash"} onClick={() => setMode("Cash")}>💵 {t("Cash")}</button>
        <button type="button" className="inv-mode" aria-pressed={mode === "Online"} onClick={() => setMode("Online")}>📱 {t("UPI / Online")}</button>
        <button type="button" className="inv-mode" aria-pressed={mode === SPLIT} onClick={() => setMode(SPLIT)}>💵+📱 {t("Cash + Online")}</button>
      </div>

      {mode === SPLIT ? (
        <>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            {[["cash", `💵 ${t("Cash amount")}`, cash], ["online", `📱 ${t("Online amount")}`, online]].map(([k, label, v]) => (
              <label key={k} style={{ flex: 1, display: "grid", gap: 4 }}>
                <span className="inv-field" style={{ margin: 0 }}>{label}</span>
                <input className="zc-input" type="number" min="0" step="0.01" inputMode="decimal" value={v} placeholder="0"
                  autoFocus={k === "cash"} onChange={(e) => typeSplit(k, e.target.value)} />
              </label>
            ))}
          </div>
          <div role="status" className={`inv-change${splitValid ? "" : " short"}`}>
            <span>{splitValid ? t("Adds up to the bill") : t("Must add up to {amount}, both more than ₹0", { amount: money(o.total) })}</span>
            <b>₹{fmtNum(r2(Number(cash) + Number(online)))}</b>
          </div>
          <button type="button" className="inv-check" aria-pressed={seen} onClick={() => setSeen((s) => !s)}>
            <i>{seen ? "✓" : ""}</i>{t("Yes, I have seen the online part arrive")}
          </button>
        </>
      ) : mode === "Cash" ? (
        <>
          <div className="inv-field">{t("Money received from customer")}</div>
          <div className="inv-quick">
            {quick.map((v, i) => (
              <button type="button" key={v} className={`zc-btn sm${got === v ? " pri" : ""}`} onClick={() => setGot(v)}>
                {i === 0 ? `${t("Exact")} ${money(v)}` : money(v)}
              </button>
            ))}
            <input className="zc-input" type="number" min="0" inputMode="numeric" value={got}
              onChange={(e) => setGot(Math.max(0, Math.round(Number(e.target.value) || 0)))}
              aria-label={t("Money received from customer")} style={{ width: 110 }} />
          </div>
          <div className={`inv-change${got >= total ? "" : " short"}`}>
            <span>{got >= total ? t("Give back") : t("Still short")}</span>
            <b>₹{fmtNum(Math.abs(got - total))}</b>
          </div>
        </>
      ) : (
        <>
          <p className="inv-hint" style={{ fontSize: 12.5, color: "var(--text-2)", margin: "14px 0 0", lineHeight: 1.5 }}>
            {t("Open your UPI app or bank SMS. Do you see {amount} from this customer?", { amount: money(total) })}
          </p>
          <button type="button" className="inv-check" aria-pressed={seen} onClick={() => setSeen((s) => !s)}>
            <i>{seen ? "✓" : ""}</i>{t("Yes, I have seen the money arrive")}
          </button>
        </>
      )}
    </Modal>,
    document.body,
  );
}
