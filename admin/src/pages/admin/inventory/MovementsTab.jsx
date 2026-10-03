// src/pages/admin/inventory/MovementsTab.jsx — Inventory → History.
// The append-only StockLedger (GET /admin/inventory/movements), filtered and
// paged server-side. "Before" = balanceAfter − quantity of the same row.
import { useEffect, useState, useCallback } from "react";
import { getStockMovements } from "../../../services/inventoryService.js";
import { ErrorBox, TableFooter } from "./invUI.jsx";
import Loader from "../shared/Loader.jsx";
import { fmtDateTime, LEDGER_TYPES, LEDGER_LABEL, LEDGER_KIND, reasonLabel } from "./invKit.js";
import EmptyState from "../shared/EmptyState.jsx";
import { t, tn, N_, fmtNum, localName } from "../../../i18n/core.js";
import { formatQty, unitLabel } from "../../../utils/units.js";

const PER_PAGE = 25;
const typeLabel = (ty) => t(LEDGER_LABEL[ty] || ty);

function Change({ m }) {
  const inbound = m.quantity >= 0;
  return <span className={`ivt-chg ${inbound ? "in" : "out"}`}>{inbound ? "+" : "−"}{fmtNum(Math.abs(m.quantity), { maximumFractionDigits: 3 })} {unitLabel(m.inventoryItem?.unit)}</span>;
}
function BeforeAfter({ m }) {
  const unit = m.inventoryItem?.unit;
  const before = Math.round((Number(m.balanceAfter) - Number(m.quantity)) * 1000) / 1000;
  return <span className="ivt-ba">{formatQty(before, unit)} → <b>{formatQty(m.balanceAfter, unit)}</b></span>;
}

export default function MovementsTab({ items, version, initialItem = "", openItem }) {
  const [movements, setMovements] = useState(null);
  const [meta, setMeta] = useState({ total: 0, pages: 1 });
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [item, setItem] = useState(initialItem);
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const res = await getStockMovements({
        inventoryItem: item || undefined, type: type || undefined, page, limit: PER_PAGE,
        from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
      });
      setMovements(res.data?.movements || []);
      setMeta({ total: res.data?.total || 0, pages: Math.max(1, res.data?.pages || 1) });
      setError(false);
    } catch { setError(true); }
    finally { setLoaded(true); }
  }, [item, type, from, to, page]);
  useEffect(() => { load(); }, [load, version]);

  const f = (fn) => (e) => { fn(e.target.value); setPage(1); };
  const filtersOn = item || type || from || to;

  if (error) return <ErrorBox onRetry={load} what={N_("stock movements")} />;

  return (
    <>
      <div className="ivt-fbar">
        <select className="zc-select" value={item} onChange={f(setItem)} aria-label={t("Filter by item")}>
          <option value="">{t("All items")}</option>
          {items.map((i) => <option key={i._id} value={i._id}>{localName(i)}</option>)}
        </select>
        <select className="zc-select" value={type} onChange={f(setType)} aria-label={t("Filter by movement type")}>
          <option value="">{t("All movement types")}</option>
          {LEDGER_TYPES.map((ty) => <option key={ty} value={ty}>{typeLabel(ty)}</option>)}
        </select>
        <input type="date" className="zc-input" value={from} max={to || undefined} onChange={f(setFrom)} aria-label={t("From date")} />
        <span className="ivt-hint">{t("to")}</span>
        <input type="date" className="zc-input" value={to} min={from || undefined} onChange={f(setTo)} aria-label={t("To date")} />
        {filtersOn && <button type="button" className="zc-btn ghost sm" onClick={() => { setItem(""); setType(""); setFrom(""); setTo(""); setPage(1); }}>{t("Clear filters")}</button>}
        <span className="ivt-sp" />
        <span className="ivt-hint">{tn(meta.total, "{n} movement", "{n} movements")}</span>
      </div>

      <div className="zc-card">
        {!loaded || movements === null ? (
          <div style={{ padding: "16px 18px" }}><Loader rows={8} /></div>
        ) : movements.length === 0 ? (
          <EmptyState title={t("No stock movements match these filters")} />
        ) : (
          <>
            <div className="ivt-tablewrap">
              <table className="zc-ledger" style={{ minWidth: 880 }}>
                <thead>
                  <tr><th>{t("When")}</th><th>{t("Item")}</th><th>{t("Type")}</th><th className="num">{t("Change")}</th><th>{t("Before → after")}</th><th>{t("Reason")}</th><th>{t("By")}</th></tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m._id}>
                      <td className="nw" style={{ color: "var(--text-3)", fontSize: 11.5 }}>{fmtDateTime(m.createdAt)}</td>
                      <td style={{ fontWeight: 600 }}>
                        {m.inventoryItem?._id
                          ? <button type="button" className="ivt-link" style={{ fontSize: 12.5, color: "var(--text-1)" }} onClick={() => openItem(m.inventoryItem._id)}>{localName(m.inventoryItem)}</button>
                          : "—"}
                      </td>
                      <td><span className={`zc-tag ${LEDGER_KIND[m.type] || "done"} sq`}>{typeLabel(m.type)}</span></td>
                      <td className="num"><Change m={m} /></td>
                      <td><BeforeAfter m={m} /></td>
                      <td style={{ color: "var(--text-2)", fontSize: 11.5, maxWidth: 240 }}>{reasonLabel(m.reason) || "—"}</td>
                      <td style={{ color: "var(--text-3)", fontSize: 11.5 }}>{m.createdBy?.name || t("System")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ivt-cards">
              {movements.map((m) => (
                <div key={m._id} className="ivt-ocard">
                  <div className="top">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{localName(m.inventoryItem) || "—"}</div>
                      <div className="ivt-hint">{fmtDateTime(m.createdAt)} · {m.createdBy?.name || t("System")}</div>
                    </div>
                    <Change m={m} />
                  </div>
                  <div className="meta">
                    <span className={`zc-tag ${LEDGER_KIND[m.type] || "done"} sq`}>{typeLabel(m.type)}</span>
                    <BeforeAfter m={m} />
                    {m.reason && <span className="ivt-hint">{reasonLabel(m.reason)}</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="ivt-tfoot">
              <span>{tn(meta.total, "{n} movement", "{n} movements")}</span>
              <TableFooter page={page} pages={meta.pages} total={meta.total} perPage={PER_PAGE} onPage={setPage} unit={N_("movements")} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
