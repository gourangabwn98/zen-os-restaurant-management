// src/pages/admin/inventory/PurchasesTab.jsx — Inventory → Purchases (bills).
// GET /admin/inventory/purchases; totals are the stored purchase totalCost.
// New purchases go through the page's shared PurchaseModal / Import modal.
// INV-02: a system-made bill number is always labelled "System-generated".
// INV-06/07: how each bill was paid, and the "Money owed" panel — Owner's
// Pocket loans and supplier credit, paid back from the drawer or the bank.
import { useEffect, useState, useCallback, useMemo, Fragment } from "react";
import toast from "react-hot-toast";
import { getPurchases, getPayables, settlePurchasePayable } from "../../../services/inventoryService.js";
import { Loading, ErrorBox } from "./invUI.jsx";
import { money, fmtDate, daysAgo } from "./invKit.js";
import EmptyState from "../shared/EmptyState.jsx";
import { t, tn, N_, fmtNum, localName } from "../../../i18n/core.js";
import { formatQty, unitLabel } from "../../../utils/units.js";

const PERIODS = [["7", N_("Last 7 days")], ["30", N_("Last 30 days")], ["all", N_("All time")]];
const billDate = (p) => p.purchaseDate || p.createdAt;
const lineName = (l) => localName(l.inventoryItem) || l.name || "—";
const lineUnit = (l) => l.unit || l.inventoryItem?.unit;
const SOURCE_LABEL = { CASH_DRAWER: N_("Cash drawer"), BANK_UPI: N_("Bank / UPI"), OWNER_POCKET: N_("Owner's pocket") };
const payLabel = (p) => {
  if (p.paymentType === "CREDIT") return { text: t("Credit"), kind: p.payable?.settledAt ? "ready" : "wait", owed: !p.payable?.settledAt };
  if (p.paymentType === "PAID") {
    const owed = p.paymentSource === "OWNER_POCKET" && !p.payable?.settledAt;
    return { text: `${t("Paid")} · ${t(SOURCE_LABEL[p.paymentSource] || "")}`, kind: owed ? "wait" : "ready", owed };
  }
  return { text: t("Not recorded"), kind: "done", owed: false };
};

// Money still owed: to the owner (Owner's Pocket) and to suppliers (Credit).
function PayablesPanel({ version, onChanged }) {
  const [data, setData] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(null);
  const load = useCallback(() => {
    getPayables().then((r) => setData(r.data)).catch((e) => { if (e?.response?.status === 403) setHidden(true); });
  }, []);
  useEffect(() => { load(); }, [load, version]);
  if (hidden || !data) return null;
  const rows = [...(data.owner || []).map((p) => ({ p, to: t("Owner") })), ...(data.suppliers || []).map((p) => ({ p, to: p.supplier?.name || t("Supplier") }))];
  if (!rows.length) return null;

  const payBack = async (p, source) => {
    if (!window.confirm(t("Record {amount} paid back from the {source}?", { amount: money(p.payable.amount), source: t(SOURCE_LABEL[source]).toLowerCase() }))) return;
    setBusy(p._id);
    try { await settlePurchasePayable(p._id, source); toast.success(t("Marked as paid back")); load(); onChanged?.(); }
    catch (e) { toast.error(e?.response?.data?.message || t("Couldn't record it")); }
    finally { setBusy(null); }
  };

  return (
    <div className="zc-card" style={{ marginBottom: 14, padding: 14 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "baseline", marginBottom: 10 }}>
        <b style={{ fontSize: 14 }}>{t("Money owed")}</b>
        <span className="ivt-hint">{t("To the owner")}: <b>{money(data.ownerTotal)}</b></span>
        <span className="ivt-hint">{t("To suppliers")}: <b>{money(data.supplierTotal)}</b></span>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {rows.map(({ p, to }) => (
          <div key={p._id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", border: "1px solid var(--edge)", borderRadius: 10 }}>
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{to} · {money(p.payable.amount)}</div>
              <div className="ivt-hint">{fmtDate(billDate(p))} · {p.invoiceNumber || "—"}{p.supplier?.name && p.payable.to === "OWNER" ? ` · ${p.supplier.name}` : ""}</div>
            </div>
            <span className="ivt-hint">{t("Pay back from")}</span>
            <button type="button" className="zc-btn sm" disabled={busy === p._id} onClick={() => payBack(p, "CASH_DRAWER")}>{t("Cash drawer")}</button>
            <button type="button" className="zc-btn sm" disabled={busy === p._id} onClick={() => payBack(p, "BANK_UPI")}>{t("Bank / UPI")}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PurchasesTab({ version, open }) {
  const [purchases, setPurchases] = useState(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("30");
  const [openId, setOpenId] = useState(null);

  const load = useCallback(() => {
    getPurchases().then((r) => { setPurchases(r.data?.purchases || []); setError(false); }).catch(() => setError(true));
  }, []);
  useEffect(() => { load(); }, [load, version]);

  const inPeriod = useMemo(() => {
    if (!purchases) return [];
    const since = period === "all" ? 0 : daysAgo(Number(period)).getTime();
    return purchases.filter((p) => new Date(billDate(p)).getTime() >= since)
      .sort((a, b) => new Date(billDate(b)) - new Date(billDate(a)));
  }, [purchases, period]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return inPeriod;
    return inPeriod.filter((p) => (p.supplier?.name || "").toLowerCase().includes(q)
      || (p.invoiceNumber || "").toLowerCase().includes(q)
      || p.items?.some((it) => [it.inventoryItem?.name, it.inventoryItem?.nameBn, it.name].some((v) => (v || "").toLowerCase().includes(q))));
  }, [inPeriod, search]);

  if (error) return <ErrorBox onRetry={load} what={N_("purchases")} />;
  if (!purchases) return <Loading />;

  const total = inPeriod.reduce((s, p) => s + Number(p.totalCost || 0), 0);
  const suppliers = new Set(inPeriod.map((p) => p.supplier?._id).filter(Boolean)).size;
  const lines = inPeriod.reduce((s, p) => s + (p.items?.length || 0), 0);

  const linesTable = (p) => (
    <table className="ivt-sublines">
      <thead><tr><th>{t("Item")}</th><th className="num">{t("Qty")}</th><th className="num">{t("Rate")}</th><th className="num">{t("Amount")}</th></tr></thead>
      <tbody>
        {p.items.map((l, i) => (
          <tr key={i}>
            <td>{lineName(l)}{l.batchNo ? <span className="ivt-hint"> · {l.batchNo}</span> : null}{l.expiryDate ? <span className="ivt-hint"> · {t("expires {date}", { date: fmtDate(l.expiryDate) })}</span> : null}</td>
            <td className="num">{formatQty(l.quantity, lineUnit(l))}</td>
            <td className="num">{money(l.costPrice)}/{unitLabel(lineUnit(l))}</td>
            <td className="num">{money(l.amount ?? Number(l.quantity) * Number(l.costPrice))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const billNo = (p) => (
    <>
      {p.invoiceNumber || "—"}
      {p.billNumberSource === "SYSTEM" && <span className="zc-tag done sq" style={{ marginLeft: 6 }}>{t("System-generated")}</span>}
      {p.billNumberSource === "MANUAL" && <span className="ivt-hint"> · {t("own number")}</span>}
      {p.billPhoto && <a href={p.billPhoto} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ marginLeft: 6 }}>📷</a>}
    </>
  );

  return (
    <>
      <PayablesPanel version={version} onChanged={load} />
      <div className="zc-card ivt-strip" style={{ "--n": 4 }}>
        <div><div className="k">{t("Spent on stock")}</div><div className="v">{money(total)}</div><div className="d">{t(PERIODS.find((x) => x[0] === period)[1])}</div></div>
        <div><div className="k">{t("Purchases")}</div><div className="v">{fmtNum(inPeriod.length)}</div><div className="d">{tn(lines, "{n} line", "{n} lines")}</div></div>
        <div><div className="k">{t("Suppliers")}</div><div className="v">{fmtNum(suppliers)}</div><div className="d">{t("bought from")}</div></div>
        <div><div className="k">{t("Average bill")}</div><div className="v">{inPeriod.length ? money(total / inPeriod.length) : "—"}</div><div className="d">{t("per purchase")}</div></div>
      </div>

      <div className="ivt-fbar">
        <input className="zc-input search" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={t("Search by supplier, invoice or item")} aria-label={t("Search purchases")} />
        <div className="zc-seg" role="group" aria-label={t("Period")}>
          {PERIODS.map(([k, l]) => <button key={k} type="button" className={period === k ? "on" : ""} onClick={() => setPeriod(k)}>{t(l)}</button>)}
        </div>
        <span className="ivt-sp" />
        <button type="button" className="zc-btn" onClick={() => open("import")}>⇪ {t("Import a bill")}</button>
        <button type="button" className="zc-btn pri" onClick={() => open("purchase")}>＋ {t("Record purchase")}</button>
      </div>

      <div className="zc-card">
        {rows.length === 0 ? (
          <EmptyState
            title={purchases.length === 0 ? t("No purchases recorded yet") : t("No purchases match this search")}
            sub={purchases.length === 0 ? t("Record a purchase or import a bill to bring stock in.") : undefined}
            action={purchases.length === 0 ? <button type="button" className="zc-btn pri" onClick={() => open("purchase")}>＋ {t("Record purchase")}</button> : null}
          />
        ) : (
          <>
            <div className="ivt-tablewrap">
              <table className="zc-ledger">
                <thead>
                  <tr><th style={{ width: 110 }}>{t("Date")}</th><th>{t("Supplier")}</th><th>{t("Items")}</th><th>{t("Invoice #")}</th><th>{t("Payment")}</th><th>{t("Recorded by")}</th><th className="num">{t("Total cost")}</th></tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <Fragment key={p._id}>
                      <tr className="ivt-click" onClick={() => setOpenId(openId === p._id ? null : p._id)} aria-expanded={openId === p._id}>
                        <td className="nw" style={{ color: "var(--text-2)" }}>{fmtDate(billDate(p))}</td>
                        <td style={{ fontWeight: 600 }}>{p.supplier?.name || "—"}</td>
                        <td style={{ color: "var(--text-2)", fontSize: 11.5, maxWidth: 340 }}>
                          {p.items.slice(0, 3).map(lineName).join(", ")}
                          {p.items.length > 3 && ` +${fmtNum(p.items.length - 3)}`}
                          <span className="ivt-hint"> · {openId === p._id ? t("hide lines") : t("show lines")}</span>
                        </td>
                        <td style={{ color: "var(--text-2)" }}>{billNo(p)}</td>
                        <td>{(() => { const pl = payLabel(p); return <span className={`zc-tag ${pl.kind}`}><i />{pl.text}{pl.owed ? ` · ${t("owed")}` : ""}</span>; })()}</td>
                        <td style={{ color: "var(--text-3)", fontSize: 11.5 }}>{p.createdBy?.name || "—"}</td>
                        <td className="money">{money(p.totalCost)}</td>
                      </tr>
                      {openId === p._id && (
                        <tr className="ivt-exp"><td colSpan={7}>{linesTable(p)}{p.notes && <div className="ivt-hint" style={{ marginTop: 6 }}>{p.notes}</div>}</td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ivt-cards">
              {rows.map((p) => (
                <div key={p._id} className="ivt-ocard click" onClick={() => setOpenId(openId === p._id ? null : p._id)}>
                  <div className="top">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{p.supplier?.name || t("No supplier")}</div>
                      <div className="ivt-hint">{fmtDate(billDate(p))} · {billNo(p)} · {tn(p.items.length, "{n} item", "{n} items")}</div>
                      <div className="ivt-hint">{payLabel(p).text}{payLabel(p).owed ? ` · ${t("owed")}` : ""}</div>
                    </div>
                    <b className="tnum" style={{ flex: "none" }}>{money(p.totalCost)}</b>
                  </div>
                  {openId === p._id && <div style={{ marginTop: 10 }}>{linesTable(p)}</div>}
                </div>
              ))}
            </div>
            <div className="ivt-tfoot"><span>{tn(rows.length, "{n} purchase", "{n} purchases")}</span></div>
          </>
        )}
      </div>
    </>
  );
}
