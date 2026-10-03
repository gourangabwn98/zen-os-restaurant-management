// src/pages/admin/dashboard/FloorCard.jsx
// Live floor map. Tap a table to see its open orders, move them along the
// state machine, and mark a pending invoice paid / cancelled — the same
// actions the old table map offered.
import { useState } from "react";
import Ico from "./icons.jsx";
import Badge from "../shared/Badge.jsx";
import { needsPaidFirst, PAID_FIRST_HINT } from "../shared/paymentRules.js";
import { t, N_, fmtNum, localName } from "../../../i18n/core.js";
import { customerName } from "../shared/customerName.js";

const money = (n) => `₹${fmtNum(Math.round(n || 0))}`;
const STATE_LABEL = {
  free: N_("Free"), eating: N_("Eating"), cooking: N_("Cooking"), long: N_("Long stay"), bill: N_("Bill pending"),
};
const duration = (minutes) => {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h
    ? t("{h}h {m}m", { h: fmtNum(h), m: fmtNum(m, { minimumIntegerDigits: 2 }) })
    : t("{m}m", { m: fmtNum(m) });
};

export default function FloorCard({ tables, tablesLoaded, nextStatus, statusLabel, statusKey, onStatusChange, onInvoiceStatusChange, onNavigate }) {
  const [active, setActive] = useState(null);
  const busy = tables.filter((tb) => tb.state !== "free").length;
  const sel = active != null ? tables.find((tb) => tb.tableNo === active) : null;

  return (
    <div className="zd-card">
      <div className="zd-ch">
        <h3>{t("On the floor now")}</h3>
        {tables.length > 0 && <span className="zd-hint">{t("{a} of {b} tables busy", { a: fmtNum(busy), b: fmtNum(tables.length) })}</span>}
      </div>

      {!tablesLoaded ? (
        <div className="zd-floor" aria-busy="true">
          {Array.from({ length: 10 }).map((_, i) => <div key={i} className="zd-tb free" />)}
        </div>
      ) : tables.length === 0 ? (
        <div className="zd-empty">
          <Ico id="table" />
          <b>{t("No tables yet")}</b>
          <span>{t("Add your tables to see who is sitting where.")}</span>
          <button type="button" className="zd-btn ghost sm" style={{ marginTop: 6 }} onClick={() => onNavigate?.("tables")}>{t("Open Table Map")}</button>
        </div>
      ) : (
        <>
          <div className="zd-floor">
            {tables.map((tb) => (
              <button
                type="button"
                key={tb.tableNo}
                className={`zd-tb ${tb.state}`}
                aria-pressed={active === tb.tableNo}
                onClick={() => setActive(active === tb.tableNo ? null : tb.tableNo)}
              >
                <span className="top">
                  <b>{t("T{n}", { n: fmtNum(tb.tableNo) })}</b>
                  {tb.amount > 0 && <span className="a">{money(tb.amount)}</span>}
                </span>
                <span className="s">{t(STATE_LABEL[tb.state])}</span>
                {tb.state !== "free" && <span className="s2">{duration(tb.minutes)}</span>}
              </button>
            ))}
          </div>
          <div className="zd-fl-leg">
            <span><i style={{ "--c": "var(--zd-busy-line)" }} />{t("Eating")} / {t("Cooking")}</span>
            <span><i style={{ "--c": "var(--zd-amber)" }} />{t("Long stay")} / {t("Bill pending")}</span>
            <span><i className="d" style={{ "--c": "var(--zd-line2)" }} />{t("Free")}</span>
          </div>
        </>
      )}

      {sel && (
        <div className={`zd-tdetail${sel.billPending ? " warn" : ""}`}>
          <div className="zd-tdetail-h">
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <b>{t("Table {n}", { n: fmtNum(sel.tableNo) })}</b>
              {sel.billPending && <span className="zd-chip zd-c-amber">{t("Invoice pending")}</span>}
            </div>
            <button type="button" className="zd-x" onClick={() => setActive(null)} aria-label={t("Close")}><Ico id="close" size={16} /></button>
          </div>

          {sel.orders.length === 0 ? (
            <div className="zd-hint" style={{ textAlign: "center", padding: "12px 0" }}>{t("This table is free — no active order")}</div>
          ) : sel.orders.map((o) => {
            const next = nextStatus[o.status] || [];
            return (
              <div className="zd-tord" key={o._id}>
                <div>
                  <div className="zd-cap">{o.orderId} · {customerName(o) || t("Guest")}</div>
                  {o.items?.map((item, i) => (
                    <div className="zd-item" key={i}>
                      <span><span className="zd-qty">{fmtNum(item.qty)}</span>{localName(item)}</span>
                      <span className="tnum">{money(item.price * item.qty)}</span>
                    </div>
                  ))}
                  <div className="zd-total"><span>{t("Total")}</span><span className="tnum">{money(o.total)}</span></div>
                </div>
                <div>
                  <div className="zd-cap">{t("Update order")}</div>
                  <div style={{ marginBottom: 8 }}><Badge label={o.status} format={statusKey} /></div>
                  <div className="zd-opts">
                    {next.map((s) => {
                      const blocked = needsPaidFirst(o, s);
                      return (
                        <button
                          type="button" key={s} className="zd-opt" disabled={blocked}
                          title={blocked ? t(PAID_FIRST_HINT) : undefined}
                          onClick={() => { if (!blocked) onStatusChange(o._id, s); }}
                        >
                          {statusLabel(s)}
                        </button>
                      );
                    })}
                    {next.length === 0 && <span className="zd-hint">{t("No further changes")}</span>}
                  </div>
                </div>
              </div>
            );
          })}

          {sel.invoice && sel.billPending && (
            <div className="zd-opts" style={{ marginTop: 12 }}>
              <button type="button" className="zd-opt good" onClick={() => { onInvoiceStatusChange(sel.invoice._id, "completed"); setActive(null); }}>{t("Mark paid")}</button>
              <button type="button" className="zd-opt bad" onClick={() => { onInvoiceStatusChange(sel.invoice._id, "cancelled"); setActive(null); }}>{t("Cancel")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
