// src/pages/admin/shared/CombineBillPanel.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Orders → a table → "🧾 Bill" — two plain steps:
//   1. Choose orders: tick the table's orders (all ticked to start) → Next.
//   2. Bill: the bill for them, then Print bill · Mark all paid · Complete all.
// The only bill flow on the table view. Nothing is decided here — every action sends only the order
// ids; the server re-checks each one and uses only stored amounts
// (restaurant-server/services/combinedBillService.js). The summary shown is
// the server's preview, never a sum made in the browser.
// The selection survives a refresh (sessionStorage, per table) and is pruned
// whenever an order stops being eligible.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  previewCombinedBill, printCombinedBill, paySelectedOrders, completeSelectedOrders,
} from "../../../services/adminService.js";
import { newIdempotencyKey } from "../../../services/orderService.js";
import { statusKind } from "./statusKind.js";
import { customerName } from "./customerName.js";
import { t, tn, fmtNum, localName } from "../../../i18n/core.js";
import { addonLabel } from "./addons.js";
import "./combineBill.css";
import { ORDER_STATUS_LABEL } from "./statusLabels.js";

// Same rule as the server (COMBINABLE): accepted and still on the table.
const COMBINABLE = ["CONFIRMED", "PREPARING", "READY", "DELIVERED"];
const STATUS_TEXT = ORDER_STATUS_LABEL; // shared floor words (DSH-04)
const reasonFor = (o) => (o.status === "PENDING_CONFIRMATION" ? "Accept it first" : o.status === "CANCELLED" ? "Cancelled" : "Can't be combined");
const money = (n) => `₹${fmtNum(Number(n) || 0, { maximumFractionDigits: 2 })}`;
const storeKey = (tableNo) => `combineBill:${tableNo}`;

/** One toast that says exactly what happened to every selected order. */
const report = (lines, failures) => {
  const msg = [...lines.filter(Boolean), ...failures.map((r) => `${r.orderId || r.id}: ${t(r.reason)}`)].join("\n");
  if (failures.length && !lines.some(Boolean)) toast.error(msg, { duration: 6000 });
  else if (failures.length) toast(msg, { icon: "⚠️", duration: 6000 });
  else toast.success(msg);
};

export default function CombineBillPanel({ tableNo, tableName, orders, onExit, onRefresh }) {
  const name = tableName || t("Table {n}", { n: tableNo });
  const [selected, setSelected] = useState(() => {
    try {
      const kept = sessionStorage.getItem(storeKey(tableNo));
      if (kept) return new Set(JSON.parse(kept));
    } catch { /* storage off */ }
    // Nothing kept → every order that can go on the bill starts ticked.
    return new Set(orders.filter((o) => COMBINABLE.includes(o.status)).map((o) => String(o._id)));
  });
  const [step, setStep] = useState(1); // 1 = choose orders · 2 = bill + actions
  const [preview, setPreview] = useState(null);       // server figures for the selection
  const [previewErr, setPreviewErr] = useState("");
  const [busy, setBusy] = useState(null);             // "print" | "pay" | "complete"
  const [payOpen, setPayOpen] = useState(false);
  const printKey = useRef(newIdempotencyKey());       // one per print intent (double-click safe)

  const eligible = useMemo(() => new Set(orders.filter((o) => COMBINABLE.includes(o.status)).map((o) => String(o._id))), [orders]);
  // Drop ticks on orders that left the table or stopped being eligible.
  const ids = useMemo(() => [...selected].filter((id) => eligible.has(id)), [selected, eligible]);
  const idsKey = ids.slice().sort().join(",");
  // Re-ask the server whenever a ticked order itself changes (paid, served,
  // edited — by this screen or live from someone else), not only the ticks.
  const stateKey = orders.filter((o) => ids.includes(String(o._id)))
    .map((o) => `${o._id}:${o.status}:${o.paymentStatus}:${o.total}`).sort().join("|");

  useEffect(() => {
    try { sessionStorage.setItem(storeKey(tableNo), JSON.stringify(ids)); } catch { /* storage off */ }
  }, [tableNo, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps -- idsKey captures ids

  // Server preview of the current selection (debounced).
  useEffect(() => {
    if (!ids.length) { setPreview(null); setPreviewErr(""); return undefined; }
    let live = true;
    const h = setTimeout(() => {
      previewCombinedBill(tableNo, ids)
        .then(({ data }) => { if (live) { setPreview(data); setPreviewErr(""); } })
        .catch((e) => { if (live) { setPreview(null); setPreviewErr(e.response?.data?.message || t("Couldn't work out the bill")); } });
    }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [tableNo, idsKey, stateKey]); // eslint-disable-line react-hooks/exhaustive-deps -- idsKey/stateKey capture ids + their state

  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allEligible = [...eligible];
  const allOn = allEligible.length > 0 && allEligible.every((id) => selected.has(id));
  const selectAll = () => setSelected(allOn ? new Set() : new Set(allEligible));
  const exit = () => { try { sessionStorage.removeItem(storeKey(tableNo)); } catch { /* storage off */ } onExit(); };

  const totals = preview?.totals;
  const ready = ids.length > 0 && !!totals && !previewErr;
  const unpaidCount = (preview?.orders || []).filter((o) => o.paymentStatus !== "PAID").length;
  // BIL-02: paid bills can be settled (served ones complete as a result).
  const settleable = (preview?.orders || []).filter((o) => o.paymentStatus === "PAID").length;

  const run = async (kind, fn) => {
    if (busy) return;
    setBusy(kind);
    try { await fn(); } catch (e) { toast.error(e.response?.data?.message || t("Something went wrong — nothing was changed")); }
    finally { setBusy(null); }
  };

  const print = () => {
    return run("print", async () => {
    const { data } = await printCombinedBill(tableNo, ids, printKey.current);
    printKey.current = newIdempotencyKey(); // the next click is a new, intended print
    report([data.duplicate ? t("Already sent to the printer") : t("Combined bill sent to the printer — {n} orders", { n: ids.length - (data.rejected?.length || 0) })], data.rejected || []);
  });
  };

  const pay = (method) => run("pay", async () => {
    const { data } = await paySelectedOrders(tableNo, ids, method);
    setPayOpen(false);
    report([
      data.paid.length ? t("{n} marked paid ({method})", { n: data.paid.length, method: method === "Online" ? t("UPI") : t("Cash") }) : "",
      data.alreadyPaid.length ? t("{n} already paid — not changed", { n: data.alreadyPaid.length }) : "",
    ], data.rejected);
    onRefresh?.();
  });

  // BIL-01/02 — settle the selected PAID bills. A served order completes as a
  // result (and leaves the table); one still cooking completes when served.
  const settle = () => {
    if (!window.confirm(t("Complete {n} orders? Their bills are closed; served orders leave the table.", { n: ids.length }))) return;
    run("complete", async () => {
      const { data } = await completeSelectedOrders(tableNo, ids);
      report([
        data.settled?.length ? t("{n} bills settled", { n: data.settled.length }) : "",
        data.completed?.length ? t("{n} orders completed", { n: data.completed.length }) : "",
        data.alreadySettled?.length ? t("{n} already settled", { n: data.alreadySettled.length }) : "",
      ], data.rejected);
      onRefresh?.();
    });
  };

  const bill = preview && !previewErr ? preview : null;
  const allPaid = ready && unpaidCount === 0;

  return (
    <div className="cb">
      <div className="cb-head">
        <div>
          <b>{t("Bill · {table}", { table: name })}</b>
          <span>{step === 1 ? t("Tick the orders to put on the bill, then Next.") : t("Print the bill, take payment, then complete.")}</span>
        </div>
        <button type="button" className="zc-btn sm ghost" onClick={exit}>✕ {t("Close")}</button>
      </div>

      {/* 1 Choose orders → 2 Bill */}
      <ol className="cb-steps" aria-label={t("Steps")}>
        <li className={step === 1 ? "now" : "done"} aria-current={step === 1 ? "step" : undefined}><i>{step === 1 ? "1" : "✓"}</i>{t("Choose orders")}</li>
        <li className={step === 2 ? "now" : ""} aria-current={step === 2 ? "step" : undefined}><i>2</i>{t("Bill")}</li>
      </ol>

      {step === 1 ? (
        <>
          {allEligible.length > 1 && (
            <label className="cb-all">
              <input type="checkbox" checked={allOn} onChange={selectAll} /> {t("Select all {n} orders", { n: allEligible.length })}
            </label>
          )}

          <div className="cb-list" role="group" aria-label={t("Orders of table {n}", { n: tableNo })}>
            {orders.map((o) => {
              const id = String(o._id);
              const can = eligible.has(id);
              const on = can && selected.has(id);
              return (
                <label key={id} className={`cb-row${on ? " on" : ""}${can ? "" : " off"}`}>
                  <input type="checkbox" checked={on} disabled={!can || !!busy} onChange={() => toggle(id)}
                    aria-label={t("Select order {id}", { id: o.orderId })} />
                  <div className="cb-main">
                    <div className="cb-top">
                      <b className="cb-no">#{o.orderId}</b>
                      <span className="cb-who">{customerName(o) || t("Walk-in")}</span>
                    </div>
                    <div className="cb-tags">
                      <span className={`zc-tag ${statusKind(o.status)}`}><i />{t(STATUS_TEXT[o.status] || o.status)}</span>
                      <span className={`zc-tag ${o.paymentStatus === "PAID" ? "ready" : "wait"}`}>{o.paymentStatus === "PAID" ? t("Paid") : t("Unpaid")}</span>
                      <span className="cb-items">{tn(o.items?.length || 0, "{n} item", "{n} items")}</span>
                      {!can && <span className="cb-why">{t(reasonFor(o))}</span>}
                    </div>
                  </div>
                  <b className="cb-amt">{money(o.total)}</b>
                </label>
              );
            })}
          </div>

          <div className="cb-bar" aria-live="polite">
            <div className="cb-sum">
              <div className="cb-sel">{tn(ids.length, "{n} order selected", "{n} orders selected")}</div>
              {ids.length === 0 ? <div className="cb-hint">{t("Tick one or more orders.")}</div>
                : previewErr ? <div className="cb-err">{previewErr}</div>
                : !totals ? <div className="cb-hint">{t("Working out the bill…")}</div>
                : <div className="cb-figs"><span className="gt">{t("Grand Total")} <b>{money(totals.total)}</b></span></div>}
            </div>
            <button type="button" className="zc-btn pri cb-next" disabled={!ready} onClick={() => setStep(2)}>
              {t("Next")} →
            </button>
          </div>
        </>
      ) : (
        <>
          {!bill ? (
            <div className={previewErr ? "cb-err" : "cb-hint"}>{previewErr || t("Working out the bill…")}</div>
          ) : (
            <div className="cb-billcard">
              {bill.orders.map((o) => (
                <div key={o._id} className="cb-bill-order">
                  <div className="cb-bill-oh">
                    <b>{t("Order #{id}", { id: o.orderId })}{customerName(o) ? ` · ${customerName(o)}` : ""}</b>
                    <span className={`zc-tag ${o.paymentStatus === "PAID" ? "ready" : "wait"}`}>{o.paymentStatus === "PAID" ? t("Paid") : t("Unpaid")}</span>
                  </div>
                  {o.items.map((it, i) => (
                    <div key={i} className="cb-bill-line"><span>{localName(it)} × {fmtNum(it.qty)}{(it.addons || []).map((a) => <small key={a.name} style={{ display: "block", color: "var(--live-ink)" }}>+ {addonLabel(a)}</small>)}</span><span>{money(it.price * it.qty)}</span></div>
                  ))}
                </div>
              ))}
              <div className="cb-bill-tot">
                <div><span>{t("Subtotal")}</span><span>{money(bill.totals.subtotal)}</span></div>
                {bill.totals.discount > 0 && <div><span>{t("Discount")}</span><span>−{money(bill.totals.discount)}</span></div>}
                <div><span>{t("GST")}</span><span>{money(bill.totals.tax)}</span></div>
                <div><span>{t("Service Charge")}</span><span>{money(bill.totals.serviceCharge)}</span></div>
                <div className="gt"><span>{t("Grand Total")}</span><span>{money(bill.totals.total)}</span></div>
                {bill.totals.paidTotal > 0 && <div><span>{t("Already paid")}</span><span>{money(bill.totals.paidTotal)}</span></div>}
                {bill.totals.paidTotal > 0 && <div className="due"><span>{t("Due")}</span><span>{money(bill.totals.dueTotal)}</span></div>}
              </div>
              {bill.rejected?.length > 0 && (
                <div className="cb-err" style={{ marginTop: 10 }}>{t("Left out:")} {bill.rejected.map((r) => `${r.orderId || r.id} (${t(r.reason)})`).join(", ")}</div>
              )}
            </div>
          )}

          {/* The three things to do, in order */}
          <div className="cb-bar" aria-live="polite">
            <div className="cb-act-row">
              <span className="cb-act-n">1</span>
              <button type="button" className="zc-btn pri" disabled={!ready || !!busy} onClick={print}>
                {busy === "print" ? t("Sending…") : `🖨️ ${t("Print bill")}`}
              </button>
            </div>
            <div className="cb-act-row">
              <span className="cb-act-n">2</span>
              {allPaid ? (
                <span className="cb-done">✓ {t("All paid")}</span>
              ) : payOpen ? (
                <span className="cb-pay">
                  <button type="button" className="zc-btn pri" disabled={!!busy} onClick={() => pay("Cash")}>{busy === "pay" ? t("Saving…") : `💵 ${t("Paid in cash")}`}</button>
                  <button type="button" className="zc-btn pri" disabled={!!busy} onClick={() => pay("Online")}>{busy === "pay" ? t("Saving…") : `📱 ${t("Paid online")}`}</button>
                  <button type="button" className="zc-btn ghost" disabled={!!busy} onClick={() => setPayOpen(false)}>{t("Cancel")}</button>
                </span>
              ) : (
                <button type="button" className="zc-btn" disabled={!ready || !!busy} onClick={() => setPayOpen(true)}>
                  ✓ {t("Mark all paid")}
                </button>
              )}
            </div>
            <div className="cb-act-row">
              <span className="cb-act-n">3</span>
              <button type="button" className="zc-btn good" disabled={!ready || !!busy || settleable === 0} onClick={settle}
                title={ready && settleable === 0 ? t("Mark them paid first") : undefined}>
                {busy === "complete" ? t("Saving…") : `✔ ${t("Complete all")}`}
              </button>
              {ready && !allPaid && settleable === 0 && <span className="cb-hint">{t("Mark them paid first")}</span>}
            </div>
            <button type="button" className="zc-btn ghost sm" style={{ alignSelf: "flex-start" }} disabled={!!busy}
              onClick={() => { setPayOpen(false); setStep(1); }}>← {t("Back to orders")}</button>
          </div>
        </>
      )}
    </div>
  );
}
