// src/pages/admin/shared/CombineBillPanel.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Orders → a table → "Generate Combine Bill": tick SOME of the table's orders,
// then preview / print ONE combined bill, mark the ticked ones paid, or
// complete them. Nothing is decided here — every action sends only the order
// ids; the server re-checks each one and uses only stored amounts
// (restaurant-server/services/combinedBillService.js). The summary shown is
// the server's preview, never a sum made in the browser.
// The selection survives a refresh (sessionStorage, per table) and is pruned
// whenever an order stops being eligible.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import {
  previewCombinedBill, printCombinedBill, paySelectedOrders, completeSelectedOrders,
} from "../../../services/adminService.js";
import { newIdempotencyKey } from "../../../services/orderService.js";
import { statusKind } from "./statusKind.js";
import { customerName } from "./customerName.js";
import { t, tn, fmtNum, localName } from "../../../i18n/core.js";
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

export default function CombineBillPanel({ tableNo, orders, onExit, onRefresh }) {
  const [selected, setSelected] = useState(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem(storeKey(tableNo)) || "[]")); } catch { return new Set(); }
  });
  const [preview, setPreview] = useState(null);       // server figures for the selection
  const [previewErr, setPreviewErr] = useState("");
  const [busy, setBusy] = useState(null);             // "print" | "pay" | "complete"
  const [payOpen, setPayOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
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
  const clear = () => { setSelected(new Set()); setPayOpen(false); };
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

  const print = () => run("print", async () => {
    const { data } = await printCombinedBill(tableNo, ids, printKey.current);
    printKey.current = newIdempotencyKey(); // the next click is a new, intended print
    report([data.duplicate ? t("Already sent to the printer") : t("Combined bill sent to the printer — {n} orders", { n: ids.length - (data.rejected?.length || 0) })], data.rejected || []);
  });

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
    if (!window.confirm(t("Settle the bills of {n} selected orders? Served orders complete and leave the table.", { n: ids.length }))) return;
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

  return (
    <div className="cb">
      <div className="cb-head">
        <div>
          <b>{t("Combine Bill · Table {n}", { n: tableNo })}</b>
          <span>{t("Tick the orders to put on one bill.")}</span>
        </div>
        <button type="button" className="zc-btn sm ghost" onClick={exit}>✕ {t("Exit")}</button>
      </div>

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
          <div className="cb-sel">{t("Selected: {n}", { n: ids.length })}</div>
          {ids.length === 0 ? <div className="cb-hint">{t("Tick one or more orders.")}</div>
            : previewErr ? <div className="cb-err">{previewErr}</div>
            : !totals ? <div className="cb-hint">{t("Working out the bill…")}</div>
            : (
              <div className="cb-figs">
                <span>{t("Subtotal")} <b>{money(totals.subtotal)}</b></span>
                {totals.discount > 0 && <span>{t("Discount")} <b>−{money(totals.discount)}</b></span>}
                <span>{t("GST + service")} <b>{money(totals.tax + totals.serviceCharge)}</b></span>
                <span className="gt">{t("Grand Total")} <b>{money(totals.total)}</b></span>
                {totals.paidTotal > 0 && <span>{t("Due")} <b>{money(totals.dueTotal)}</b></span>}
              </div>
            )}
        </div>
        <div className="cb-acts">
          <button type="button" className="zc-btn sm" disabled={!ready || !!busy} onClick={() => setBillOpen(true)}>🧾 {t("Generate Combined Bill")}</button>
          <button type="button" className="zc-btn sm" disabled={!ready || !!busy} onClick={print}>{busy === "print" ? t("Sending…") : `🖨️ ${t("Print Combined Bill")}`}</button>
          {payOpen ? (
            <span className="cb-pay">
              <button type="button" className="zc-btn sm pri" disabled={!!busy} onClick={() => pay("Cash")}>{busy === "pay" ? t("Saving…") : t("Paid in cash")}</button>
              <button type="button" className="zc-btn sm pri" disabled={!!busy} onClick={() => pay("Online")}>{busy === "pay" ? t("Saving…") : t("Paid by UPI")}</button>
              <button type="button" className="zc-btn sm ghost" disabled={!!busy} onClick={() => setPayOpen(false)}>{t("Cancel")}</button>
            </span>
          ) : (
            <button type="button" className="zc-btn sm pri" disabled={!ready || !!busy || unpaidCount === 0} onClick={() => setPayOpen(true)}
              title={ready && unpaidCount === 0 ? t("Every selected order is already paid") : undefined}>
              ✓ {t("Mark Selected as Paid")}
            </button>
          )}
          <button type="button" className="zc-btn sm" disabled={!ready || !!busy || settleable === 0} onClick={settle}
            title={ready && settleable === 0 ? t("Mark the selected orders paid first, then settle their bills") : undefined}>
            {busy === "complete" ? t("Saving…") : t("Settle Selected Bills")}
          </button>
          <button type="button" className="zc-btn sm ghost" disabled={!ids.length || !!busy} onClick={clear}>{t("Clear Selection")}</button>
        </div>
      </div>

      {billOpen && preview && createPortal(
        <div className="zc-scrim" onClick={() => setBillOpen(false)}>
          <div className="zc-modal cb-modal" role="dialog" aria-label={t("Combined bill")} onClick={(e) => e.stopPropagation()}>
            <div className="mh">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t">{t("Combined bill · Table {n}", { n: tableNo })}</div>
                <div className="s">{tn(preview.orders.length, "{n} order", "{n} orders")} · {preview.orders.map((o) => `#${o.orderId}`).join(", ")}</div>
              </div>
              <button type="button" className="zc-x" onClick={() => setBillOpen(false)} aria-label={t("Close")}>✕</button>
            </div>
            <div className="mb">
              {preview.orders.map((o) => (
                <div key={o._id} className="cb-bill-order">
                  <div className="cb-bill-oh">
                    <b>{t("Order #{id}", { id: o.orderId })}</b>
                    <span className={`zc-tag ${o.paymentStatus === "PAID" ? "ready" : "wait"}`}>{o.paymentStatus === "PAID" ? t("Paid") : t("Unpaid")}</span>
                  </div>
                  {o.items.map((it, i) => (
                    <div key={i} className="cb-bill-line"><span>{localName(it)} × {fmtNum(it.qty)}{(it.addons || []).map((a) => <small key={a.name} style={{ display: "block", color: "var(--live-ink)" }}>+ {a.name}</small>)}</span><span>{money(it.price * it.qty)}</span></div>
                  ))}
                </div>
              ))}
              <div className="cb-bill-tot">
                <div><span>{t("Subtotal")}</span><span>{money(preview.totals.subtotal)}</span></div>
                {preview.totals.discount > 0 && <div><span>{t("Discount")}</span><span>−{money(preview.totals.discount)}</span></div>}
                <div><span>{t("GST")}</span><span>{money(preview.totals.tax)}</span></div>
                <div><span>{t("Service Charge")}</span><span>{money(preview.totals.serviceCharge)}</span></div>
                <div className="gt"><span>{t("Grand Total")}</span><span>{money(preview.totals.total)}</span></div>
                {preview.totals.paidTotal > 0 && <div><span>{t("Already paid")}</span><span>{money(preview.totals.paidTotal)}</span></div>}
                {preview.totals.paidTotal > 0 && <div className="due"><span>{t("Due")}</span><span>{money(preview.totals.dueTotal)}</span></div>}
              </div>
              {preview.rejected?.length > 0 && (
                <div className="cb-err" style={{ marginTop: 10 }}>{t("Left out:")} {preview.rejected.map((r) => `${r.orderId || r.id} (${t(r.reason)})`).join(", ")}</div>
              )}
            </div>
            <div className="mf">
              <button type="button" className="zc-btn ghost" onClick={() => setBillOpen(false)}>{t("Close")}</button>
              <button type="button" className="zc-btn pri" disabled={!!busy} onClick={print}>{busy === "print" ? t("Sending…") : `🖨️ ${t("Print Combined Bill")}`}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
