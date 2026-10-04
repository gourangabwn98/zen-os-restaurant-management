// src/pages/admin/invoices/CollectModal.jsx
// "Collect payment" — records a bill as paid through the existing
// PATCH /admin/orders/:id/payment ({ paymentStatus: "PAID", paymentMethod }).
// Cash: shows the change to give back (a counter aid only, nothing stored).
// Online / UPI: staff must confirm they have seen the money arrive — opening
// a UPI app is never treated as proof of payment.
import { useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "../inventory/invUI.jsx";
import { t, fmtNum } from "../../../i18n/core.js";
import { custName, money, tableLabel } from "./model.js";

export default function CollectModal({ o, initialMode, onClose, onRecord }) {
  const [mode, setMode] = useState(initialMode || (o.paymentMethod === "Online" ? "Online" : "Cash"));
  const total = Math.round(Number(o.total) || 0);
  const [got, setGot] = useState(total);
  const [seen, setSeen] = useState(false);
  const [busy, setBusy] = useState(false);

  const quick = [total, ...[50, 100, 200, 500, 2000].map((v) => Math.ceil(total / v) * v)]
    .filter((v, i, a) => v >= total && a.indexOf(v) === i).slice(0, 5);
  const ok = mode === "Cash" ? got >= total : seen;

  const record = async () => {
    setBusy(true);
    try { await onRecord(o, mode); onClose(); }
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
          {busy ? t("Saving…") : t("Settle · {amount} {method}", { amount: money(total), method: t(mode === "Cash" ? "cash" : "online") })}
        </button>
      </>}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <span className="inv-hint">{t("Bill total")}</span>
        <span className="inv-big">{money(total)}</span>
      </div>

      <div className="inv-field" style={{ marginTop: 0, marginBottom: 6 }}>{t("How did the customer pay?")}</div>
      <div className="inv-modes">
        <button type="button" className="inv-mode" aria-pressed={mode === "Cash"} onClick={() => setMode("Cash")}>💵 {t("Cash")}</button>
        <button type="button" className="inv-mode" aria-pressed={mode === "Online"} onClick={() => setMode("Online")}>📱 {t("UPI / Online")}</button>
      </div>

      {mode === "Cash" ? (
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
