// src/pages/admin/inventory/WastageTab.jsx — Inventory → Wastage (losses).
// GET /admin/inventory/wastage?from= (server-side period filter). Cost impact
// is the stored WastageLog.costImpact (qty × cost price when it was logged).
import { useEffect, useState, useCallback, useMemo } from "react";
import { getWastage } from "../../../services/inventoryService.js";
import { Loading, ErrorBox } from "./invUI.jsx";
import { money, fmtDateTime, daysAgo, WASTAGE_REASONS } from "./invKit.js";
import EmptyState from "../shared/EmptyState.jsx";
import { t, tn, N_, fmtNum, localName } from "../../../i18n/core.js";
import { formatQty } from "../../../utils/units.js";

const PERIODS = [["7", N_("Last 7 days")], ["30", N_("Last 30 days")], ["all", N_("All time")]];
const REASON_KIND = { Spoilage: "stop", Expired: "stop", Damaged: "wait", Accident: "wait", Other: "done" };

// INV-08: a hand-typed (not stocked) item has only its name.
const wName = (l) => (l.inventoryItem ? localName(l.inventoryItem) : l.itemName) || "—";

export default function WastageTab({ version, open }) {
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState(false);
  const [period, setPeriod] = useState("30");
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("All");

  const load = useCallback(() => {
    getWastage(period === "all" ? {} : { from: daysAgo(Number(period)).toISOString() })
      .then((r) => { setLogs(r.data?.logs || []); setError(false); }).catch(() => setError(true));
  }, [period]);
  useEffect(() => { load(); }, [load, version]);

  const stats = useMemo(() => {
    const list = logs || [];
    const byReason = {};
    list.forEach((l) => { byReason[l.reason] = (byReason[l.reason] || 0) + Number(l.costImpact || 0); });
    const top = Object.entries(byReason).sort((a, b) => b[1] - a[1])[0];
    return {
      total: list.reduce((s, l) => s + Number(l.costImpact || 0), 0),
      items: new Set(list.map((l) => l.inventoryItem?._id || `n:${(l.itemName || "").toLowerCase()}`)).size,
      byReason, top,
    };
  }, [logs]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (logs || []).filter((l) => (reason === "All" || l.reason === reason)
      && (!q || [l.inventoryItem?.name, l.inventoryItem?.nameBn, l.itemName, l.notes, l.reasonText].some((v) => (v || "").toLowerCase().includes(q))));
  }, [logs, search, reason]);

  if (error) return <ErrorBox onRetry={load} what={N_("wastage logs")} />;
  if (!logs) return <Loading />;

  return (
    <>
      <div className="zc-card ivt-strip" style={{ "--n": 4 }}>
        <div><div className="k">{t("Written off")}</div><div className="v" style={stats.total ? { color: "var(--stop-ink)" } : undefined}>{money(stats.total)}</div><div className="d">{t(PERIODS.find((x) => x[0] === period)[1])}</div></div>
        <div><div className="k">{t("Entries")}</div><div className="v">{fmtNum(logs.length)}</div><div className="d">{t("across {n} item(s)", { n: stats.items })}</div></div>
        <div><div className="k">{t("Top reason")}</div><div className="v">{stats.top ? t(stats.top[0]) : "—"}</div><div className="d">{stats.top ? money(stats.top[1]) : t("nothing logged")}</div></div>
        <div><div className="k">{t("Average entry")}</div><div className="v">{logs.length ? money(stats.total / logs.length) : "—"}</div><div className="d">{t("cost impact")}</div></div>
      </div>

      <div className="ivt-fbar">
        <input className="zc-input search" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={t("Search wastage log")} aria-label={t("Search wastage log")} />
        <div className="zc-seg" role="group" aria-label={t("Period")}>
          {PERIODS.map(([k, l]) => <button key={k} type="button" className={period === k ? "on" : ""} onClick={() => setPeriod(k)}>{t(l)}</button>)}
        </div>
        <span className="ivt-sp" />
        <button type="button" className="zc-btn pri" onClick={() => open("wastage")}>＋ {t("Log wastage")}</button>
      </div>
      <div className="ivt-fbar">
        <div className="zc-seg" role="tablist" aria-label={t("Filter by reason")}>
          {["All", ...WASTAGE_REASONS].map((r) => (
            <button key={r} type="button" role="tab" aria-selected={reason === r} className={reason === r ? "on" : ""} onClick={() => setReason(r)}>
              {t(r)}{r !== "All" && stats.byReason[r] ? <span className="ivt-seg-n">{money(stats.byReason[r])}</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="zc-card">
        {rows.length === 0 ? (
          <EmptyState title={logs.length === 0 ? t("No wastage recorded") : t("No entries match these filters")}
            action={logs.length === 0 ? <button type="button" className="zc-btn pri" onClick={() => open("wastage")}>＋ {t("Log wastage")}</button> : null} />
        ) : (
          <>
            <div className="ivt-tablewrap">
              <table className="zc-ledger">
                <thead>
                  <tr><th>{t("Date")}</th><th>{t("Item")}</th><th className="num">{t("Qty")}</th><th>{t("Reason")}</th><th>{t("Notes")}</th><th>{t("Recorded by")}</th><th className="num">{t("Cost impact")}</th></tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l._id}>
                      <td className="nw" style={{ color: "var(--text-2)", fontSize: 11.5 }}>{fmtDateTime(l.wastageDate || l.createdAt)}</td>
                      <td style={{ fontWeight: 600 }}>{wName(l)}{!l.inventoryItem && <span className="ivt-hint"> · {t("not stocked")}</span>}</td>
                      <td className="num" style={{ color: "var(--text-2)" }}>{formatQty(l.quantity, l.unit || l.inventoryItem?.unit)}</td>
                      <td><span className={`zc-tag ${REASON_KIND[l.reason] || "done"}`}><i />{l.reason === "Other" && l.reasonText ? l.reasonText : t(l.reason)}</span></td>
                      <td style={{ color: "var(--text-3)", fontSize: 11.5 }}>{l.notes || "—"}</td>
                      <td style={{ color: "var(--text-3)", fontSize: 11.5 }}>{l.recordedBy?.name || "—"}</td>
                      <td className="money neg">{money(l.costImpact)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ivt-cards">
              {rows.map((l) => (
                <div key={l._id} className="ivt-ocard">
                  <div className="top">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{wName(l)} · {formatQty(l.quantity, l.unit || l.inventoryItem?.unit)}</div>
                      <div className="ivt-hint">{fmtDateTime(l.wastageDate || l.createdAt)}{l.recordedBy?.name ? ` · ${l.recordedBy.name}` : ""}</div>
                    </div>
                    <b className="tnum" style={{ color: "var(--stop-ink)", flex: "none" }}>{money(l.costImpact)}</b>
                  </div>
                  <div className="meta">
                    <span className={`zc-tag ${REASON_KIND[l.reason] || "done"}`}><i />{l.reason === "Other" && l.reasonText ? l.reasonText : t(l.reason)}</span>
                    {l.notes && <span className="ivt-hint">{l.notes}</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="ivt-tfoot"><span>{tn(rows.length, "{n} entry", "{n} entries")}</span></div>
          </>
        )}
      </div>
    </>
  );
}
