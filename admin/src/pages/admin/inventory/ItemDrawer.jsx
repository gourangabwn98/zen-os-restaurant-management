// src/pages/admin/inventory/ItemDrawer.jsx — one stock item: its stored
// fields, the server-computed stock level, and its latest stock movements
// (GET /admin/inventory/items/:id → { item, recentLedger } — the last 30
// StockLedger rows). "Before" is balanceAfter − quantity of the same row.
import { useEffect, useState, useCallback } from "react";
import { getInventoryItem } from "../../../services/inventoryService.js";
import { Drawer, LevelBadge } from "./invUI.jsx";
import { money, fmtDate, fmtDateTime, itemValue, LEDGER_LABEL, LEDGER_KIND, reasonLabel } from "./invKit.js";
import Loader from "../shared/Loader.jsx";
import ErrorState from "../shared/ErrorState.jsx";
import { t, localName, fmtNum } from "../../../i18n/core.js";
import { formatQty, unitLabel } from "../../../utils/units.js";

export default function ItemDrawer({ id, version, onClose, onAction, onFullHistory }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    getInventoryItem(id)
      .then((res) => { setData(res.data || null); setError(false); })
      .catch(() => setError(true));
  }, [id]);
  useEffect(() => { load(); }, [load, version]);

  const it = data?.item;
  const ledger = data?.recentLedger || [];
  const active = it?.status === "Active";

  return (
    <Drawer onClose={onClose} label={it ? localName(it) : t("Stock item")}>
      <div className="ivt-dr-h">
        <div style={{ minWidth: 0 }}>
          <div className="ivt-hint">{it?.category || t("Uncategorised")}</div>
          <h3>{it ? localName(it) : "…"}</h3>
          {it && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <LevelBadge level={it.stockLevel} />
              {!active && <span className="zc-tag done"><i />{t("Inactive")}</span>}
              {it.isBatchTracked && <span className="zc-tag vio sq">{t("Batch tracked")}</span>}
            </div>
          )}
        </div>
        <button type="button" className="zc-x" onClick={onClose} aria-label={t("Close")}>✕</button>
      </div>

      {error ? (
        <ErrorState title={t("Could not load {what}", { what: t("this item") })} sub={t("The server did not respond. Check your connection, then try again.")} onRetry={load} />
      ) : !it ? (
        <Loader rows={6} />
      ) : (
        <>
          <div className="ivt-facts">
            <div><div className="k">{t("In stock")}</div><div className="v" style={{ color: `var(--${it.stockLevel === "OK" ? "ready" : it.stockLevel === "OUT_OF_STOCK" ? "stop" : "wait"}-ink)` }}>{formatQty(it.currentStock, it.unit)}</div></div>
            <div><div className="k">{t("Value")}</div><div className="v">{money(itemValue(it))}</div></div>
            <div><div className="k">{t("Reorder at")}</div><div className="v">{it.reorderLevel ? formatQty(it.reorderLevel, it.unit) : "—"}</div></div>
            <div><div className="k">{t("Critical at")}</div><div className="v">{it.criticalLevel ? formatQty(it.criticalLevel, it.unit) : "—"}</div></div>
            <div><div className="k">{t("Unit cost")}</div><div className="v">{it.costPrice ? `${money(it.costPrice)}/${unitLabel(it.unit)}` : <span style={{ color: "var(--wait-ink)" }}>{t("Not set")}</span>}</div></div>
            <div><div className="k">{t("Default supplier")}</div><div className="v" style={{ fontSize: 13 }}>{it.supplier?.name || "—"}</div></div>
          </div>
          {it.notes && <div className="ivt-note">{it.notes}</div>}
          <div className="ivt-hint">{t("Last changed {date}", { date: fmtDateTime(it.updatedAt) })} · {t("Added {date}", { date: fmtDate(it.createdAt) })}</div>

          {active && (
            <div className="ivt-dr-acts">
              <button type="button" className="zc-btn pri sm" onClick={() => onAction("purchase", it)}>＋ {t("Add stock")}</button>
              <button type="button" className="zc-btn sm" onClick={() => onAction("count", it)}>{t("Count")}</button>
              <button type="button" className="zc-btn sm" onClick={() => onAction("adjust", it)}>{t("Adjust")}</button>
              <button type="button" className="zc-btn sm" onClick={() => onAction("wastage", it)}>{t("Log wastage")}</button>
              <button type="button" className="zc-btn sm ghost" onClick={() => onAction("edit", it)}>{t("Edit")}</button>
            </div>
          )}

          <div>
            <div className="ivt-sec-k">{t("Stock history")}</div>
            {ledger.length === 0 ? (
              <div className="ivt-hint" style={{ padding: "10px 0" }}>{t("No stock movements yet")}</div>
            ) : (
              <div className="ivt-hist">
                {ledger.map((m) => {
                  const inbound = m.quantity >= 0;
                  const before = Math.round((Number(m.balanceAfter) - Number(m.quantity)) * 1000) / 1000;
                  return (
                    <div key={m._id}>
                      <span className={`ivt-mv ${inbound ? "in" : "out"}`}>{inbound ? "+" : "−"}</span>
                      <div style={{ minWidth: 0 }}>
                        <span className={`zc-tag ${LEDGER_KIND[m.type] || "done"} sq`} style={{ marginRight: 6 }}>{t(LEDGER_LABEL[m.type] || m.type)}</span>
                        <span className="ivt-ba">{formatQty(before, it.unit)} → <b>{formatQty(m.balanceAfter, it.unit)}</b></span>
                        <small>{fmtDateTime(m.createdAt)} · {m.createdBy?.name || t("System")}{m.reason ? ` · ${reasonLabel(m.reason)}` : ""}</small>
                      </div>
                      <span className={`ivt-chg ${inbound ? "in" : "out"}`}>{inbound ? "+" : "−"}{fmtNum(Math.abs(m.quantity), { maximumFractionDigits: 3 })} {unitLabel(it.unit)}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {ledger.length > 0 && <button type="button" className="ivt-more" onClick={() => onFullHistory(it._id)}>{t("Open full history")} →</button>}
          </div>
        </>
      )}
    </Drawer>
  );
}
