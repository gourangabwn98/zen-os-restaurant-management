// src/pages/admin/dashboard/FloorCard.jsx
// "On the floor now" — DSH-04/05. Each table shows the state of its CURRENT
// order (model.floorTables): Placed → Cooking → Ready to Deliver → Eating →
// Completed. Tapping a table opens its Table Detail View (DSH-02). The
// Dashboard is operational only: no completing, no billing here (DSH-03,
// BIL-01) — bills are settled in Invoices.
import { useState } from "react";
import Ico from "./icons.jsx";
import TableDetailView from "./TableDetailView.jsx";
import { FLOOR_LABEL } from "./floorLabels.js";
import { t, fmtNum } from "../../../i18n/core.js";

const money = (n) => `₹${fmtNum(Math.round(n || 0))}`;
const duration = (minutes) => {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h
    ? t("{h}h {m}m", { h: fmtNum(h), m: fmtNum(m, { minimumIntegerDigits: 2 }) })
    : t("{m}m", { m: fmtNum(m) });
};

export default function FloorCard({ tables, tablesLoaded, onStatusChange, onNavigate, statusKey, typeLabel }) {
  const [active, setActive] = useState(null);
  const busy = tables.filter((tb) => tb.state !== "free" && tb.state !== "completed").length;
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
                className={`zd-tb ${tb.state}${tb.longStay ? " long" : ""}`}
                onClick={() => setActive(tb.tableNo)}
                aria-label={`${t("Table {n}", { n: fmtNum(tb.tableNo) })} · ${t(FLOOR_LABEL[tb.state])}`}
              >
                <span className="top">
                  <b>{t("T{n}", { n: fmtNum(tb.tableNo) })}</b>
                  {tb.amount > 0 && <span className="a">{money(tb.amount)}</span>}
                </span>
                <span className="s">{t(FLOOR_LABEL[tb.state])}</span>
                {tb.orders.length > 0 && <span className="s2">{duration(tb.minutes)}{tb.longStay ? ` · ${t("long stay")}` : ""}</span>}
              </button>
            ))}
          </div>
          <div className="zd-fl-leg">
            <span><i style={{ "--c": "var(--zd-accent2)" }} />{t("Order placed")}</span>
            <span><i style={{ "--c": "var(--zd-amber)" }} />{t("Cooking")}</span>
            <span><i style={{ "--c": "var(--zd-green)" }} />{t("Ready to Deliver")}</span>
            <span><i style={{ "--c": "var(--zd-busy-line)" }} />{t("Eating")}</span>
            <span><i className="d" style={{ "--c": "var(--zd-line2)" }} />{t("Free")} / {t("Completed")}</span>
          </div>
        </>
      )}

      {sel && (
        <TableDetailView
          table={sel} onClose={() => setActive(null)}
          onStatusChange={onStatusChange} onNavigate={onNavigate}
          statusKey={statusKey} typeLabel={typeLabel}
        />
      )}
    </div>
  );
}
