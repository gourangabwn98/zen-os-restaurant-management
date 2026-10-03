// src/pages/admin/inventory/InventoryOverview.jsx — Inventory → Overview.
// ─────────────────────────────────────────────────────────────────────────────
// Kitchen cost control (last 7 days) + records check + needs attention +
// recent purchases. Sources, all existing endpoints:
//   GET /admin/inventory/overview   stockValue, level buckets, expiring batches, today's ledger counts
//   GET /admin/insights/sales       making cost vs recipe-costed sales (the Insights rule — PAID, not CANCELLED)
//   GET /admin/inventory/purchases  spend on stock (purchase totalCost by bill date)
//   GET /admin/inventory/wastage    cost impact written off
//   GET /admin/inventory/recipes + /menu, GET /movements?type=PHYSICAL_COUNT&limit=1   records check
// Stock items (with the server's stockLevel) come from the page.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  getInventoryOverview, getPurchases, getWastage, getRecipes, getStockMovements,
} from "../../../services/inventoryService.js";
import { getSalesInsights } from "../../../services/adminService.js";
import { getMenu } from "../../../services/menuService.js";
import { Loading, ErrorBox } from "./invUI.jsx";
import { money, fmtDate, daysAgo, LEVEL_RANK, needsReorder } from "./invKit.js";
import EmptyState from "../shared/EmptyState.jsx";
import { t, tn, fmtNum, localName } from "../../../i18n/core.js";
import { formatQty, unitLabel } from "../../../utils/units.js";

const WEEKS = 4;
const SPLIT_COLORS = ["var(--violet)", "var(--cyan)", "var(--wait)", "var(--ready)", "var(--live)", "var(--done)"];
const LEVEL_DOT = { OUT_OF_STOCK: "var(--stop)", CRITICAL: "var(--wait)", LOW: "var(--wait)" };
const pct1 = (n) => `${fmtNum(Math.round(n * 10) / 10)}%`;

// [from, to] for week i back (0 = the last 7 days including today).
const weekRange = (i) => {
  const from = daysAgo(7 * (i + 1));
  const to = i === 0 ? new Date() : new Date(daysAgo(7 * i).getTime() - 1);
  return { from, to };
};
const foodCostPct = (totals) => (totals && totals.costedRevenue > 0 ? (totals.makingCost / totals.costedRevenue) * 100 : null);

export default function InventoryOverview({ items, itemsLoading, version, open, openItem, setSection, onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const weekFrom = daysAgo(7);
      // The overview itself must load; everything else degrades to "—" on its own.
      const [ov, ...rest] = await Promise.allSettled([
        getInventoryOverview(),
        getPurchases(),
        getWastage({ from: weekFrom.toISOString() }),
        getRecipes(),
        getMenu({ ignoreSchedule: true }),
        getStockMovements({ type: "PHYSICAL_COUNT", limit: 1, page: 1 }),
        ...Array.from({ length: WEEKS }, (_, i) => {
          const { from, to } = weekRange(i);
          return getSalesInsights({ from: from.toISOString(), to: to.toISOString() });
        }),
      ]);
      if (ov.status !== "fulfilled") throw ov.reason;
      const val = (r) => (r.status === "fulfilled" ? r.value.data : null);
      const [pur, was, rec, menu, cnt, ...weeks] = rest.map(val);
      setData({
        overview: ov.value.data?.data,
        purchases: pur?.purchases ?? null,
        wastage: was?.logs ?? null,
        recipes: rec?.recipes ?? null,
        menu: Array.isArray(menu) ? menu : null,
        lastCount: cnt ? (cnt.movements?.[0] || false) : null,
        weeks: weeks.map((w) => w?.data?.totals ?? null),
      });
    } catch { setError(true); }
  }, []);
  useEffect(() => { load(); }, [load, version]);

  const itemById = useMemo(() => new Map(items.map((i) => [i._id, i])), [items]);
  const active = useMemo(() => items.filter((i) => i.status === "Active"), [items]);

  const derived = useMemo(() => {
    if (!data) return null;
    const since = daysAgo(7).getTime();
    const weekPurchases = (data.purchases || []).filter((p) => new Date(p.purchaseDate || p.createdAt).getTime() >= since);
    const spend = weekPurchases.reduce((s, p) => s + Number(p.totalCost || 0), 0);
    const byCat = new Map();
    weekPurchases.forEach((p) => p.items?.forEach((l) => {
      const cat = itemById.get(l.inventoryItem?._id)?.category || t("Uncategorised");
      byCat.set(cat, (byCat.get(cat) || 0) + Number(l.quantity || 0) * Number(l.costPrice || 0));
    }));
    const split = [...byCat.entries()].sort((a, b) => b[1] - a[1]);

    const wasteTotal = (data.wastage || []).reduce((s, l) => s + Number(l.costImpact || 0), 0);
    const wasteByItem = new Map();
    (data.wastage || []).forEach((l) => {
      const k = l.inventoryItem?._id || "?";
      const cur = wasteByItem.get(k) || { item: l.inventoryItem, qty: 0, cost: 0 };
      cur.qty += Number(l.quantity || 0); cur.cost += Number(l.costImpact || 0);
      wasteByItem.set(k, cur);
    });
    const topWaste = [...wasteByItem.values()].sort((a, b) => b.cost - a.cost).slice(0, 2);

    const attention = active.filter(needsReorder)
      .sort((a, b) => LEVEL_RANK[a.stockLevel] - LEVEL_RANK[b.stockLevel] || a.name.localeCompare(b.name));
    const noCost = active.filter((i) => !(Number(i.costPrice) > 0));
    const noReorder = active.filter((i) => !(Number(i.reorderLevel) > 0));
    const recipeIds = new Set((data.recipes || []).map((r) => String(r.menuItem?._id || r.menuItem)));
    const menuTotal = data.menu?.length ?? null;
    const menuTracked = data.menu ? data.menu.filter((m) => recipeIds.has(String(m._id))).length : null;
    const recent = [...(data.purchases || [])]
      .sort((a, b) => new Date(b.purchaseDate || b.createdAt) - new Date(a.purchaseDate || a.createdAt)).slice(0, 5);
    return { weekPurchases, spend, split, wasteTotal, topWaste, attention, noCost, noReorder, menuTotal, menuTracked, recent };
  }, [data, active, itemById]);

  if (error) return <ErrorBox onRetry={load} what="the inventory overview" />;
  if (!data || itemsLoading) return <Loading rows={6} />;

  const ov = data.overview;
  if (!ov || ov.totalItems === 0) {
    return (
      <div className="zc-card">
        <EmptyState
          title={t("No stock items yet")}
          sub={t("Add stock items and record purchases to start tracking inventory value, low stock and wastage.")}
          action={<button type="button" className="zc-btn pri" onClick={() => open("item")}>＋ {t("Add stock item")}</button>}
        />
      </div>
    );
  }

  const d = derived;
  const week = data.weeks[0];
  const fc = foodCostPct(week);
  const trend = data.weeks.map(foodCostPct).reverse(); // oldest → this week
  const trendMax = Math.max(...trend.filter((v) => v != null), 1);
  const needsCount = ov.outOfStock.count + ov.critical.count + ov.lowStock.count;
  const today = ov.today;
  const todayMoves = today.consumption.count + today.purchases.count + today.wastage.count;

  // Records check — each line is a yes/no fact about the stored data.
  const checks = [
    {
      ok: d.noCost.length === 0,
      title: d.noCost.length ? tn(d.noCost.length, "{n} stock item has no cost price", "{n} stock items have no cost price") : t("Every stock item has a cost price"),
      sub: d.noCost.length ? t("Stock value and recipe making cost leave them out") : t("Stock value and making cost are complete"),
      act: d.noCost.length ? { label: t("Set cost"), run: () => open("edit", d.noCost[0]) } : null,
    },
    {
      ok: d.noReorder.length === 0,
      title: d.noReorder.length ? tn(d.noReorder.length, "{n} stock item has no reorder level", "{n} stock items have no reorder level") : t("Every stock item has a reorder level"),
      sub: d.noReorder.length ? t("Low-stock alerts only fire for items with one") : t("Low-stock alerts cover every item"),
      act: d.noReorder.length ? { label: t("Set level"), run: () => open("edit", d.noReorder[0]) } : null,
    },
    d.menuTotal != null && {
      ok: d.menuTracked === d.menuTotal,
      title: t("{a} of {b} menu items have a recipe", { a: d.menuTracked, b: d.menuTotal }),
      sub: t("A dish without a recipe deducts no stock when it is sold"),
      act: d.menuTracked !== d.menuTotal ? { label: t("Open recipes"), run: () => setSection("recipes") } : null,
    },
    data.lastCount != null && {
      ok: !!data.lastCount,
      warn: !data.lastCount,
      title: data.lastCount ? t("Last physical count {date}", { date: fmtDate(data.lastCount.createdAt) }) : t("No physical count recorded yet"),
      sub: t("A count corrects the system figure to what is on the shelf"),
      act: { label: t("Count stock"), run: () => open("count") },
    },
    data.purchases != null && {
      ok: data.purchases.length > 0,
      warn: data.purchases.length === 0,
      title: data.purchases.length ? t("Last purchase recorded {date}", { date: fmtDate(d.recent[0]?.purchaseDate || d.recent[0]?.createdAt) }) : t("No purchases recorded yet"),
      sub: t("Purchases bring stock in and set each item's cost price"),
      act: { label: t("Record purchase"), run: () => open("purchase") },
    },
  ].filter(Boolean);
  const done = checks.filter((c) => c.ok).length;
  const pct = checks.length ? Math.round((done / checks.length) * 100) : 0;

  return (
    <>
      {/* ── Kitchen cost control ── */}
      <div className="zc-card">
        <div className="zc-card-h">
          <span className="t">{t("Kitchen cost control")}</span>
          <span className="s">{t("last 7 days")} · {fmtDate(daysAgo(7), { day: "numeric", month: "short" })} – {fmtDate(new Date(), { day: "numeric", month: "short" })}</span>
        </div>
        <div className="ivt-kcc">
          <div className="ivt-tile">
            <div className="k">{t("Food cost")}</div>
            <div className="v">{fc == null ? "—" : pct1(fc)}</div>
            <div className="d">
              {week == null ? t("Insights unavailable")
                : fc == null ? t("No recipe-costed sales in these days")
                  : t("making cost {a} on {b} of costed sales", { a: money(week.makingCost), b: money(week.costedRevenue) })}
            </div>
            {trend.some((v) => v != null) && (
              <>
                <div className="ivt-spark" aria-hidden="true">
                  {trend.map((v, i) => (
                    <i key={i} className={i === trend.length - 1 ? "cur" : undefined}
                      title={v == null ? "—" : pct1(v)} style={{ height: v == null ? 3 : Math.max(4, (v / trendMax) * 30) }} />
                  ))}
                </div>
                <div className="ivt-hint" style={{ fontSize: 11 }}>{t("last 4 weeks")}</div>
              </>
            )}
          </div>

          <div className="ivt-tile">
            <div className="k">{t("Spent on stock")}</div>
            <div className="v">{data.purchases == null ? "—" : money(d.spend)}</div>
            <div className="d">{data.purchases == null ? t("Purchases unavailable") : tn(d.weekPurchases.length, "{n} purchase", "{n} purchases")}</div>
            {d.split.length > 0 && d.spend > 0 && (
              <>
                <div className="ivt-split" aria-hidden="true">
                  {d.split.map(([c, v], i) => <i key={c} style={{ width: `${(v / d.spend) * 100}%`, background: SPLIT_COLORS[i % SPLIT_COLORS.length] }} title={`${c} ${money(v)}`} />)}
                </div>
                <div className="ivt-hint" style={{ fontSize: 11, marginTop: 4 }}>
                  {d.split.slice(0, 3).map(([c, v]) => `${c} ${fmtNum(Math.round((v / d.spend) * 100))}%`).join(" · ")}
                </div>
              </>
            )}
            <div className="gap" />
            <button type="button" className="zc-btn ghost sm" style={{ marginTop: 8 }} onClick={() => setSection("purchases")}>{t("Open purchases")}</button>
          </div>

          <div className="ivt-tile">
            <div className="k">{t("Wastage")}</div>
            <div className="v" style={d.wasteTotal > 0 ? { color: "var(--stop-ink)" } : undefined}>{data.wastage == null ? "—" : money(d.wasteTotal)}</div>
            <div className="d">{data.wastage == null ? t("Wastage unavailable") : tn(data.wastage.length, "{n} entry", "{n} entries")}</div>
            {d.topWaste.length > 0 && (
              <div className="ivt-hint" style={{ marginTop: 6 }}>
                {d.topWaste.map((w) => `${localName(w.item) || "—"} ${formatQty(w.qty, w.item?.unit)} (${money(w.cost)})`).join(" · ")}
              </div>
            )}
            <div className="gap" />
            <button type="button" className="zc-btn ghost sm" style={{ marginTop: 8 }} onClick={() => setSection("wastage")}>{t("See wastage")}</button>
          </div>

          <div className="ivt-tile">
            <div className="k">{t("Stock on hand")}</div>
            <div className="v">{money(ov.stockValue)}</div>
            <div className="d">{tn(ov.totalItems, "{n} tracked item", "{n} tracked items")}</div>
            <div className="ivt-hint" style={{ marginTop: 6, color: needsCount ? "var(--wait-ink)" : "var(--ready-ink)" }}>
              {needsCount ? tn(needsCount, "{n} item to buy now", "{n} items to buy now") : t("All levels healthy")}
            </div>
            <div className="gap" />
            <button type="button" className="zc-btn ghost sm" style={{ marginTop: 8 }} onClick={() => setSection("items")}>{t("Open stock")}</button>
          </div>

          <div className="ivt-tile">
            <div className="k">{t("Stock movements today")}</div>
            <div className="v">{fmtNum(todayMoves)}</div>
            <div className="d">
              {tn(today.consumption.count, "{n} order deduction", "{n} order deductions")} · {tn(today.purchases.count, "{n} purchase line", "{n} purchase lines")} · {tn(today.wastage.count, "{n} wastage", "{n} wastage entries")}
            </div>
            <div className="gap" />
            <button type="button" className="zc-btn ghost sm" style={{ marginTop: 8 }} onClick={() => setSection("movements")}>{t("Open history")}</button>
          </div>
        </div>
        {week && week.costedRevenue > 0 && (
          <div className="ivt-kcc-f">
            <span>
              {t("Gross profit on recipe-costed sales:")} <b style={{ color: week.grossProfit >= 0 ? "var(--ready-ink)" : "var(--stop-ink)" }}>{money(week.grossProfit)}</b>
              {week.itemsWithoutCost > 0 && <>{" · "}{tn(week.itemsWithoutCost, "{n} dish sold had no recipe cost", "{n} dishes sold had no recipe cost")}</>}
            </span>
            {onNavigate && <button type="button" className="zc-btn ghost sm" onClick={() => onNavigate("analytics")}>{t("See in Insights")} →</button>}
          </div>
        )}
      </div>

      {/* ── Records complete · how entries change stock ── */}
      <div className="ivt-pl">
        <div className="zc-card">
          <div className="zc-card-h">
            <span className="t">{t("Records complete")}</span>
            <span className="s">{t("{a} of {b} checks", { a: done, b: checks.length })}</span>
            <b className="tnum" style={{ marginLeft: "auto", fontSize: 21, letterSpacing: "-.025em", color: pct === 100 ? "var(--ready-ink)" : "var(--wait-ink)" }}>{fmtNum(pct)}%</b>
          </div>
          <div className="ivt-meter" style={{ marginTop: 12 }}><i style={{ width: `${pct}%` }} /></div>
          <div className="ivt-hint" style={{ padding: "0 18px" }}>{t("Stock value and food cost are only as accurate as these records.")}</div>
          <div className="ivt-rows">
            {checks.map((c) => (
              <div key={c.title} className="ivt-ck">
                <span className="m" style={{ color: c.ok ? "var(--ready-ink)" : c.warn ? "var(--wait-ink)" : "var(--stop-ink)" }}>{c.ok ? "✓" : c.warn ? "!" : "✗"}</span>
                <div>{c.title}<small>{c.sub}</small></div>
                {c.act ? <button type="button" className="zc-btn ghost sm" onClick={c.act.run}>{c.act.label}</button> : <span />}
              </div>
            ))}
          </div>
        </div>

        <div className="zc-card">
          <div className="zc-card-h"><span className="t">{t("How entries change stock")}</span></div>
          <div className="ivt-explain">
            <p><b>{t("Record purchase")}</b> — {t("stock goes up by each line, and the item's cost price becomes the bill's rate.")}</p>
            <p><b>{t("Orders")}</b> — {t("when an order goes to the kitchen, each dish's recipe quantities are deducted once; a cancelled order puts them back.")}</p>
            <p><b>{t("Log wastage")}</b> — {t("stock goes down and the cost impact is quantity × cost price.")}</p>
            <p><b>{t("Count / Adjust")}</b> — {t("you enter what is really there; the difference is logged.")}</p>
            <p style={{ margin: 0 }}><b>{t("Status")}</b> — {t("Low at or below the reorder level, Critical at or below the critical level, Out at 0.")}</p>
          </div>
        </div>
      </div>

      {/* ── Needs attention · recent purchases ── */}
      <div className="ivt-pl">
        <div className="zc-card">
          <div className="zc-card-h">
            <span className="t">{t("Needs attention")}</span>
            <span className="s">{t("act today")}</span>
            {d.attention.length > 1 && (
              <button type="button" className="zc-btn sm" style={{ marginLeft: "auto" }}
                onClick={() => open("purchase", null, { prefill: d.attention.map((i) => i._id) })}>
                {t("Record purchase for all {n}", { n: d.attention.length })}
              </button>
            )}
          </div>
          <div className="ivt-rows">
            {d.attention.length === 0 && ov.expiringSoon.batches.length === 0 && (
              <div style={{ color: "var(--text-3)", fontSize: 12.5, padding: "22px 0", textAlign: "center" }}>{t("All stock levels healthy ✓")}</div>
            )}
            {d.attention.slice(0, 6).map((it) => (
              <div key={it._id} className="ivt-row">
                <span className="ivt-dot" style={{ background: LEVEL_DOT[it.stockLevel] }} />
                <div style={{ minWidth: 0 }}>
                  <button type="button" className="ivt-link" style={{ fontSize: 12.5, color: "var(--text-1)" }} onClick={() => openItem(it._id)}>
                    {it.stockLevel === "OUT_OF_STOCK" ? t("{name} is out", { name: localName(it) })
                      : it.stockLevel === "CRITICAL" ? t("{name} is at critical level", { name: localName(it) })
                        : t("{name} is at reorder level", { name: localName(it) })}
                  </button>
                  <small>
                    {formatQty(it.currentStock, it.unit)} {t("left")}
                    {it.reorderLevel > 0 && ` · ${t("reorder at {qty}", { qty: formatQty(it.reorderLevel, it.unit) })}`}
                    {it.costPrice > 0 && ` · ${t("last paid {price}", { price: `${money(it.costPrice)}/${unitLabel(it.unit)}` })}`}
                    {it.supplier?.name && ` · ${it.supplier.name}`}
                  </small>
                </div>
                <div className="r"><button type="button" className="zc-btn ghost sm" onClick={() => open("purchase", it)}>{t("Record purchase")}</button></div>
              </div>
            ))}
            {ov.expiringSoon.batches.slice(0, 4).map((b) => (
              <div key={b._id} className="ivt-row">
                <span className="ivt-dot" style={{ background: "var(--live)" }} />
                <div style={{ minWidth: 0 }}>
                  {t("{name} expires {date}", { name: `${localName(b.inventoryItem) || "—"}${b.batchNo ? ` · ${b.batchNo}` : ""}`, date: fmtDate(b.expiryDate) })}
                  <small>{t("{qty} left in this batch", { qty: formatQty(b.quantity, b.inventoryItem?.unit) })}</small>
                </div>
                <div className="r">
                  {b.inventoryItem?._id && itemById.get(b.inventoryItem._id) && (
                    <button type="button" className="zc-btn ghost sm" onClick={() => open("wastage", itemById.get(b.inventoryItem._id))}>{t("Log wastage")}</button>
                  )}
                </div>
              </div>
            ))}
            {d.attention.length > 6 && (
              <button type="button" className="ivt-more" onClick={() => setSection("items")}>{t("View all {n} in Stock", { n: d.attention.length })} →</button>
            )}
          </div>
        </div>

        <div className="zc-card">
          <div className="zc-card-h"><span className="t">{t("Recent purchases")}</span></div>
          <div className="ivt-rows">
            {data.purchases == null ? (
              <div className="ivt-hint" style={{ padding: "22px 0", textAlign: "center" }}>{t("Purchases unavailable")}</div>
            ) : d.recent.length === 0 ? (
              <div style={{ color: "var(--text-3)", fontSize: 12.5, padding: "22px 0", textAlign: "center" }}>{t("No purchases recorded yet")}</div>
            ) : d.recent.map((p) => (
              <div key={p._id} className="ivt-row">
                <span className="zc-tag done sq tnum">{fmtDate(p.purchaseDate || p.createdAt, { day: "numeric", month: "short" })}</span>
                <div style={{ minWidth: 0 }}>
                  {p.supplier?.name || t("No supplier")}
                  <small>{tn(p.items?.length || 0, "{n} item", "{n} items")}{p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""}</small>
                </div>
                <b className="tnum">{money(p.totalCost)}</b>
              </div>
            ))}
            {d.recent.length > 0 && <button type="button" className="ivt-more" onClick={() => setSection("purchases")}>{t("See all purchases")} →</button>}
          </div>
        </div>
      </div>
    </>
  );
}
