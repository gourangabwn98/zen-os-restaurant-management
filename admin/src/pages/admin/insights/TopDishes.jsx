// src/pages/admin/insights/TopDishes.jsx
// Top dishes by gross profit (the reference's ranking), plus the existing
// Insights views kept from the previous build: by plates sold and by
// category. All rows come from insightsService's sales breakdown — item
// sales = line price × qty on paid, not-cancelled bills.
import { useState } from "react";
import { t, tn, N_, fmtNum, localName } from "../../../i18n/core.js";
import { money, signedMoney, pct, PERIOD_WORD } from "./model.js";

const VIEWS = [["profit", N_("By profit")], ["sold", N_("By plates")], ["category", N_("By category")]];
const TOP = 10;
const catName = (c) => localName({ name: c.category, nameBn: c.categoryBn });

export default function TopDishes({ sales, periodKey }) {
  const [view, setView] = useState("profit");
  const [all, setAll] = useState(false);
  const items = sales.items || [];
  const cats = sales.categories || [];
  const total = sales.totals.revenue;
  const catBn = new Map(cats.map((c) => [c.category, c]));

  const profitRows = items.filter((i) => i.grossProfit != null).sort((a, b) => b.grossProfit - a.grossProfit);
  const soldRows = [...items].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
  const rows = view === "profit" ? profitRows : view === "sold" ? soldRows : cats;
  const shown = all ? rows : rows.slice(0, TOP);
  const maxCat = Math.max(...cats.map((c) => c.revenue), 1);

  return (
    <div className="zc-card" style={{ minWidth: 0 }}>
      <div className="zc-card-h" style={{ flexWrap: "wrap", rowGap: 8 }}>
        <span className="t">{t("Top dishes")}</span>
        <span className="s">{t(PERIOD_WORD[periodKey])}</span>
        <div style={{ flex: 1 }} />
        <div className="zc-seg" role="group" aria-label={t("Rank dishes")}>
          {VIEWS.map(([v, label]) => (
            <button key={v} type="button" aria-pressed={view === v} className={view === v ? "on" : ""} onClick={() => { setView(v); setAll(false); }}>{t(label)}</button>
          ))}
        </div>
      </div>
      <div style={{ padding: "0 10px 10px" }}>
        {items.length === 0 ? (
          <div className="ins-empty"><b>{t("No dishes sold in this period")}</b>{t("Dishes from paid bills show up here.")}</div>
        ) : rows.length === 0 ? (
          <div className="ins-empty"><b>{t("No dish has a recipe yet")}</b>{t("Profit needs a food cost. Add recipes under Inventory → Recipes.")}</div>
        ) : (
          <table className="zc-ledger ins-top">
            <thead>
              {view === "category" ? (
                <tr><th>{t("Category")}</th><th className="r">{t("Plates")}</th><th className="r">{t("Item sales")}</th><th className="r hide-sm">{t("Profit")}</th></tr>
              ) : (
                <tr><th className="rank">#</th><th>{t("Dish")}</th><th className="r">{t("Plates")}</th><th className="r hide-sm">{view === "profit" ? t("Food cost") : t("Item sales")}</th><th className="r">{view === "profit" ? t("Profit") : t("Share")}</th></tr>
              )}
            </thead>
            <tbody>
              {view === "category" ? shown.map((c) => (
                <tr key={c.category}>
                  <td>
                    <b style={{ fontWeight: 600, color: "var(--text-1)" }}>{catName(c)}</b>
                    <span className="sub">{tn(c.items, "{n} dish", "{n} dishes")} · {fmtNum(pct(c.revenue, total), { maximumFractionDigits: 1 })}%</span>
                    <div className="zc-bar ins-catbar"><i style={{ width: `${pct(c.revenue, maxCat)}%` }} /></div>
                  </td>
                  <td className="r tnum">{fmtNum(c.qty)}</td>
                  <td className="r tnum" style={{ fontWeight: 700, color: "var(--text-1)" }}>{money(c.revenue)}</td>
                  <td className={`r tnum hide-sm${c.grossProfit < 0 ? " neg" : ""}`}>{c.grossProfit == null ? "—" : signedMoney(c.grossProfit)}</td>
                </tr>
              )) : shown.map((it, i) => (
                <tr key={it.menuItem || it.name}>
                  <td className="rank tnum">{fmtNum(i + 1)}</td>
                  <td>
                    <b style={{ fontWeight: 600, color: "var(--text-1)" }}>{localName(it)}</b>
                    <span className="sub">{catName(catBn.get(it.category) || { category: it.category })}{it.costEstimated ? ` · ${t("older sales costed at today's recipe cost")}` : ""}</span>
                  </td>
                  <td className="r tnum">{fmtNum(it.qty)}</td>
                  {view === "profit" ? (
                    <>
                      <td className="r tnum hide-sm">{money(it.makingCost)}</td>
                      <td className={`r tnum${it.grossProfit < 0 ? " neg" : ""}`} style={{ fontWeight: 700 }}>{signedMoney(it.grossProfit)}</td>
                    </>
                  ) : (
                    <>
                      <td className="r tnum hide-sm" style={{ color: "var(--text-1)" }}>{money(it.revenue)}</td>
                      <td className="r tnum">{fmtNum(pct(it.revenue, total), { maximumFractionDigits: 1 })}%</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "10px 8px 2px", alignItems: "center" }}>
          <span className="ins-hint">
            {view === "profit"
              ? t("Profit = item sales − food cost. Dishes without a recipe aren't ranked.")
              : t("Item sales = price × plates, before discounts and tax.")}
          </span>
          {rows.length > TOP && (
            <button type="button" className="zc-btn sm ghost" onClick={() => setAll((v) => !v)}>
              {all ? t("Show top {n}", { n: TOP }) : t("Show all {n}", { n: rows.length })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
