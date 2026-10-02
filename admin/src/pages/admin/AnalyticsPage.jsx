// src/pages/admin/AnalyticsPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Zen OS "Insights" — migrated to the shared design system
// (design-reference/zen-os-design-reference.html → "Insights" screen) to
// match Invoices / Users.
//
// The previous build's order-type and revenue-split panels FABRICATED a
// 65/35 dine-in/takeaway split (`Math.round(totalOrders * 0.65)` etc.) —
// every one of those numbers was invented, including on revenue. This build
// replaces all of it with real aggregates computed from GET /admin/orders
// (already used by Invoices/Users), grouped by the actual orderType,
// paymentMethod and order items, in the selected date range:
//   • Revenue          = sum of PAID orders' total (money actually collected)
//   • Orders / AOV      = all non-cancelled orders' total (order volume/value,
//                          independent of whether payment has cleared yet)
//   • Order type / payment method = grouped straight from those same orders
//   • Revenue by category / item, making cost, gross profit
//                       = GET /admin/insights/sales (services/insightsService.js),
//                         aggregated server-side with the SAME revenue rule
//                         (PAID, not cancelled); item revenue = line price × qty
// Cancelled orders are excluded everywhere (they were never fulfilled).
// Where a breakdown has no data, the panel says so rather than estimating.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useMemo } from "react";
import { getAllOrders, getSalesInsights } from "../../services/adminService.js";
import PageHeader from "./shared/PageHeader.jsx";
import StatCard from "./shared/StatCard.jsx";
import Loader from "./shared/Loader.jsx";
import ErrorState from "./shared/ErrorState.jsx";

const RANGES = ["Today", "Week", "Month", "Year"];
const RANGE_DAYS = { Today: 1, Week: 7, Month: 30, Year: 365 };
const RANGE_LABEL = { Today: "today", Week: "last 7 days", Month: "last 30 days", Year: "last 12 months" };
const TYPE_LABEL = { DINE_IN: "Dine-in", TAKEAWAY: "Takeaway", ONLINE: "Online" };
const TYPE_COLOR = { DINE_IN: "var(--violet)", TAKEAWAY: "var(--cyan)", ONLINE: "var(--wait)" };
const CAT_COLORS = ["var(--violet)", "var(--cyan)", "var(--wait)", "var(--ready)", "var(--stop)", "var(--indigo)"];
const DAY_LABEL = (d) => d.toLocaleDateString("en-IN", { weekday: "short" });

const fmt = (n) => Math.round(n || 0).toLocaleString("en-IN");

// ── page-scoped styles (tokens only — light / dark safe) ─────────────────────
if (typeof document !== "undefined" && !document.getElementById("ins-styles")) {
  const s = document.createElement("style");
  s.id = "ins-styles";
  s.textContent = `
    .ins-empty { text-align: center; padding: 40px 0; color: var(--text-3); font-size: 13px; }
    .ins-row { display: grid; grid-template-columns: 1.45fr 1fr; gap: 16px; margin-bottom: 16px; }
    .ins-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 980px) { .ins-row, .ins-row2 { grid-template-columns: 1fr; } }
    .ins-daybar { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; height: 100%; }
    .ins-daybar .col { flex: 1; width: 100%; display: flex; align-items: flex-end; }
    .ins-scroll { max-height: 380px; overflow-y: auto; overscroll-behavior: contain; }
    .ins-items { width: 100%; }
    .ins-items thead th { position: sticky; top: 0; z-index: 1; background: var(--card); }
    .ins-items .r { text-align: right; }
    @media (max-width: 560px) { .ins-hide-sm { display: none; } }
  `;
  document.head.appendChild(s);
}

// ── tiny inline sparkline (7-value trend line for a metric card) ─────────────
function Sparkline({ values, color }) {
  if (!values || values.filter((v) => v > 0).length < 2) return null;
  const w = 120, h = 44;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = w / (values.length - 1);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function csvExport(rows, filename) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── revenue by category / item (server-aggregated, see insightsService.js) ──
const money2 = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const BREAKDOWN_VIEWS = [["category", "Category"], ["item", "Item"]];

function RevenueBreakdown({ sales, state, rangeLabel, onRetry }) {
  const [view, setView] = useState("category");
  const categories = sales?.categories || [];
  const items = sales?.items || [];
  const total = sales?.totals?.revenue || 0;
  const maxCat = Math.max(...categories.map((c) => c.revenue), 1);

  return (
    <div className="zc-card" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div className="zc-card-h" style={{ flexWrap: "wrap", rowGap: 8 }}>
        <span className="t">Revenue by {view === "category" ? "category" : "item"}</span>
        <span className="s">{rangeLabel}</span>
        <div style={{ flex: 1 }} />
        <div className="zc-seg" role="tablist" aria-label="Group revenue by">
          {BREAKDOWN_VIEWS.map(([v, text]) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{text}</button>
          ))}
        </div>
      </div>

      {state === "loading" && !sales ? (
        <div style={{ padding: 20 }}><Loader rows={5} /></div>
      ) : state === "error" ? (
        <ErrorState title="Could not load sales breakdown" onRetry={onRetry} />
      ) : items.length === 0 ? (
        <div className="ins-empty">No paid sales in this range yet</div>
      ) : view === "category" ? (
        <div className="ins-scroll" style={{ padding: "16px 20px", opacity: state === "loading" ? 0.6 : 1 }}>
          {categories.map((c, i) => {
            const pct = Math.round((c.revenue / maxCat) * 100);
            const share = total ? Math.round((c.revenue / total) * 1000) / 10 : 0;
            const color = CAT_COLORS[i % CAT_COLORS.length];
            return (
              <div key={c.category} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 7, color: "var(--text-1)", minWidth: 0 }}>
                    <i style={{ width: 8, height: 8, borderRadius: 2, background: color, display: "inline-block", flex: "none" }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.category}</span>
                  </span>
                  <span className="tnum" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-1)", whiteSpace: "nowrap" }}>
                    {money2(c.revenue)} <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· {share}%</span>
                  </span>
                </div>
                <div className="zc-bar"><i style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}, transparent)` }} /></div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 5 }}>
                  {c.qty} sold · {c.items} item{c.items === 1 ? "" : "s"}
                  {c.grossProfit != null && <> · gross profit {money2(c.grossProfit)}</>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ins-scroll" style={{ padding: "0 10px 8px", opacity: state === "loading" ? 0.6 : 1 }}>
          <table className="zc-ledger ins-items">
            <thead>
              <tr><th>Item</th><th className="r">Sold</th><th className="r">Revenue</th><th className="r ins-hide-sm">Cost</th><th className="r ins-hide-sm">Profit</th></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.menuItem || it.name}>
                  <td>
                    <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{it.name}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{it.category}</div>
                  </td>
                  <td className="r tnum">{it.qty}</td>
                  <td className="r tnum" style={{ fontWeight: 700, color: "var(--text-1)" }}>{money2(it.revenue)}</td>
                  <td className="r tnum ins-hide-sm" title={it.costEstimated ? "Older sales costed at today's recipe cost" : undefined}>
                    {it.makingCost == null ? <span style={{ color: "var(--text-3)" }}>no recipe</span> : <>{money2(it.makingCost)}{it.costEstimated && <span style={{ color: "var(--wait-ink)" }}> ~</span>}</>}
                  </td>
                  <td className="r tnum ins-hide-sm" style={{ color: it.grossProfit == null ? "var(--text-3)" : it.grossProfit < 0 ? "var(--stop-ink)" : "var(--ready-ink)" }}>
                    {it.grossProfit == null ? "—" : money2(it.grossProfit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && state !== "error" && (
        <div style={{ padding: "10px 20px 14px", borderTop: "1px solid var(--edge)", display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-2)" }}>
          <span>{view === "category" ? `${categories.length} categories` : `${items.length} items`} · item sales before tax &amp; discounts</span>
          <span className="tnum" style={{ fontWeight: 700, color: "var(--text-1)" }}>{money2(total)}</span>
        </div>
      )}
    </div>
  );
}

function Profitability({ sales, state, rangeLabel }) {
  const t = sales?.totals;
  const o = sales?.orders;
  const rows = t ? [
    { k: "Item sales", v: money2(t.revenue), sub: `${t.qty} items sold` },
    { k: "Making cost (COGS)", v: money2(t.makingCost), sub: "from recipe costs at time of sale" },
    { k: "Gross profit", v: money2(t.grossProfit), tone: t.grossProfit < 0 ? "var(--stop-ink)" : "var(--ready-ink)",
      sub: t.grossMarginPct != null ? `${t.grossMarginPct}% margin on costed sales` : "no costed sales yet" },
  ] : [];

  return (
    <div className="zc-card">
      <div className="zc-card-h"><span className="t">Profitability</span><span className="s">{rangeLabel}</span></div>
      <div style={{ padding: 20 }}>
        {state === "loading" && !sales ? <Loader rows={4} /> : !t || t.qty === 0 ? (
          <div className="ins-empty">{state === "error" ? "Unavailable" : "No paid sales in this range yet"}</div>
        ) : (
          <>
            {rows.map((r) => (
              <div key={r.k} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--edge)" }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>{r.k}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{r.sub}</div>
                </div>
                <div className="tnum" style={{ fontSize: 17, fontWeight: 700, color: r.tone || "var(--text-1)" }}>{r.v}</div>
              </div>
            ))}
            {t.itemsWithoutCost > 0 && (
              <div style={{ fontSize: 11.5, color: "var(--wait-ink)", marginTop: 12 }}>
                {t.itemsWithoutCost} sold item{t.itemsWithoutCost === 1 ? " has" : "s have"} no recipe — {money2(t.revenue - t.costedRevenue)} of sales is left out of cost &amp; profit.
                Add recipes under Inventory → Recipes.
              </div>
            )}
            {o && (
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 12, lineHeight: 1.6 }}>
                {o.count} paid order{o.count === 1 ? "" : "s"} collected <b className="tnum" style={{ color: "var(--text-2)" }}>{money2(o.collected)}</b>
                {" "}= item sales {money2(o.subtotal)}{o.discount ? ` − discounts ${money2(o.discount)}` : ""}
                {o.tax ? ` + tax ${money2(o.tax)}` : ""}{o.serviceCharge ? ` + service ${money2(o.serviceCharge)}` : ""}.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
export default function AnalyticsPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [range, setRange] = useState("Week");

  const load = useCallback(() => {
    setLoading(true);
    getAllOrders({ limit: 5000 })
      .then((oRes) => {
        setOrders(oRes.data?.orders || []);
        setError(false);
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const bounds = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - (RANGE_DAYS[range] - 1));
    start.setHours(0, 0, 0, 0);
    const durationMs = now - start;
    return { start, end: now, prevStart: new Date(start.getTime() - durationMs), prevEnd: new Date(start.getTime() - 1) };
  }, [range]);

  const inWindow = (o, from, to) => { const t = new Date(o.createdAt); return t >= from && t <= to; };

  // non-cancelled orders in the selected range / the equal-length prior range
  const rangeOrders = useMemo(
    () => orders.filter((o) => o.status !== "CANCELLED" && inWindow(o, bounds.start, bounds.end)),
    [orders, bounds],
  );
  const prevRangeOrders = useMemo(
    () => orders.filter((o) => o.status !== "CANCELLED" && inWindow(o, bounds.prevStart, bounds.prevEnd)),
    [orders, bounds],
  );

  const paidRevenue = (list) => list.filter((o) => o.paymentStatus === "PAID").reduce((s, o) => s + Number(o.total || 0), 0);
  const revenue = paidRevenue(rangeOrders);
  const prevRevenue = paidRevenue(prevRangeOrders);
  const revenueTrendPct = prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 1000) / 10 : (revenue > 0 ? 100 : 0);

  const orderCount = rangeOrders.length;
  const orderValue = rangeOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const aov = orderCount ? orderValue / orderCount : 0;
  const prevOrderValue = prevRangeOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const prevAov = prevRangeOrders.length ? prevOrderValue / prevRangeOrders.length : 0;
  const aovDelta = Math.round(aov - prevAov);

  // busiest hour of day within the range
  const busiest = useMemo(() => {
    if (!rangeOrders.length) return null;
    const byHour = new Array(24).fill(0);
    rangeOrders.forEach((o) => byHour[new Date(o.createdAt).getHours()]++);
    const hour = byHour.indexOf(Math.max(...byHour));
    return { hour, count: byHour[hour], pct: Math.round((byHour[hour] / rangeOrders.length) * 100) };
  }, [rangeOrders]);
  const hourLabel = (h) => { const ampm = h < 12 ? "am" : "pm"; const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12}`; };

  // trailing 7 calendar days — always 7, independent of the range selector
  const dayBars = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      const dayOrders = orders.filter((o) => o.status !== "CANCELLED" && inWindow(o, d, new Date(next - 1)));
      days.push({ label: DAY_LABEL(d), revenue: paidRevenue(dayOrders), count: dayOrders.length });
    }
    return days;
  }, [orders]);
  const maxDayRevenue = Math.max(...dayBars.map((d) => d.revenue), 1);
  const sparkRevenue = dayBars.map((d) => d.revenue);
  const sparkOrders = dayBars.map((d) => d.count);

  // order type / payment method breakdown — grouped straight from rangeOrders
  const typeBreakdown = useMemo(() => {
    const map = {};
    rangeOrders.forEach((o) => {
      const t = o.orderType || "DINE_IN";
      if (!map[t]) map[t] = { type: t, count: 0, revenue: 0 };
      map[t].count++; map[t].revenue += Number(o.total || 0);
    });
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [rangeOrders]);

  const paymentBreakdown = useMemo(() => {
    const map = {};
    rangeOrders.forEach((o) => {
      const m = o.paymentMethod || "Cash";
      map[m] = (map[m] || 0) + 1;
    });
    return Object.entries(map).map(([method, count]) => ({ method, count })).sort((a, b) => b.count - a.count);
  }, [rangeOrders]);

  // revenue by category / item + cost analysis — aggregated server-side for
  // the selected range, refetched when it changes (stale responses ignored)
  const [salesTick, setSalesTick] = useState(0);
  const salesKey = `${bounds.start.toISOString()}|${bounds.end.toISOString()}|${salesTick}`;
  // { key } says which request the data answers — loading = it's not this one yet
  const [salesResult, setSalesResult] = useState({ key: null, data: null, error: false });
  useEffect(() => {
    let live = true;
    getSalesInsights({ from: bounds.start.toISOString(), to: bounds.end.toISOString() })
      .then((r) => { if (live) setSalesResult({ key: salesKey, data: r.data?.data || null, error: false }); })
      .catch(() => { if (live) setSalesResult((prev) => ({ key: salesKey, data: prev.data, error: true })); });
    return () => { live = false; };
  }, [bounds, salesKey]);
  const sales = salesResult.data;
  const salesState = salesResult.key !== salesKey ? "loading" : salesResult.error ? "error" : "ready";

  const handleExport = () => {
    csvExport(
      rangeOrders.map((o) => ({
        orderId: o.orderId, date: new Date(o.createdAt).toLocaleString("en-IN"),
        type: TYPE_LABEL[o.orderType] || o.orderType, status: o.status,
        paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod, total: o.total,
      })),
      `insights-${range.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Insights" sub="Loading…" />
        <Loader rows={6} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <PageHeader title="Insights" />
        <div className="zc-card"><ErrorState title="Could not load insights" onRetry={load} /></div>
      </div>
    );
  }

  const STATS = [
    { label: `Revenue this ${range.toLowerCase()}`, value: `₹${fmt(revenue)}`, grad: true,
      sub: `${revenueTrendPct >= 0 ? "+" : ""}${revenueTrendPct}% vs previous ${RANGE_LABEL[range]}`,
      spark: <Sparkline values={sparkRevenue} color="var(--violet)" /> },
    { label: "Orders", value: fmt(orderCount), color: "var(--live-ink)",
      sub: `${(orderCount / RANGE_DAYS[range]).toFixed(orderCount / RANGE_DAYS[range] < 10 ? 1 : 0)} per day average`,
      spark: <Sparkline values={sparkOrders} color="var(--cyan)" /> },
    { label: "Average order value", value: `₹${fmt(aov)}`, color: "var(--text-1)",
      sub: prevRangeOrders.length ? `${aovDelta >= 0 ? "Up" : "Down"} ₹${Math.abs(aovDelta)} vs previous ${RANGE_LABEL[range]}` : "No prior period to compare" },
    { label: "Busiest hour", value: busiest ? <>{hourLabel(busiest.hour)}–{hourLabel(busiest.hour + 1)}<span style={{ fontSize: 14, color: "var(--text-3)", fontWeight: 500 }}> {busiest.hour < 12 ? "am" : "pm"}</span></> : "—",
      sub: busiest ? `${busiest.pct}% of orders in this range` : "No orders yet" },
  ];

  return (
    <div>
      <PageHeader
        title="Insights"
        sub={`${orderCount} order${orderCount === 1 ? "" : "s"} · ${RANGE_LABEL[range]}`}
        right={
          <>
            <div className="zc-seg" role="tablist" aria-label="Date range">
              {RANGES.map((r) => (
                <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>{r}</button>
              ))}
            </div>
            <button type="button" className="zc-btn" onClick={handleExport} disabled={!rangeOrders.length}>Export</button>
          </>
        }
      />

      {/* stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 20 }}>
        {STATS.map((b, i) => <StatCard key={i} {...b} />)}
      </div>

      {/* row 1: revenue by day + order type / payment method */}
      <div className="ins-row">
        <div className="zc-card">
          <div className="zc-card-h">
            <span className="t">Revenue by day</span><span className="s">last 7 days</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>Bars show revenue · number shows order count</span>
          </div>
          <div style={{ padding: "22px 20px 16px", display: "flex", alignItems: "flex-end", gap: 14, height: 220 }}>
            {dayBars.every((d) => d.revenue === 0) ? (
              <div className="ins-empty" style={{ width: "100%" }}>No revenue data yet</div>
            ) : dayBars.map((d, i) => {
              const h = Math.round((d.revenue / maxDayRevenue) * 150);
              const best = d.revenue === maxDayRevenue && d.revenue > 0;
              return (
                <div key={i} className="ins-daybar">
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: best ? "var(--accent-ink)" : "var(--text-2)" }}>
                    {d.revenue >= 1000 ? `₹${(d.revenue / 1000).toFixed(1)}k` : `₹${fmt(d.revenue)}`}
                  </div>
                  <div className="col">
                    <div style={{
                      width: "100%", height: Math.max(h, 3), borderRadius: "9px 9px 4px 4px",
                      background: best ? "var(--grad-btn)" : "linear-gradient(180deg, var(--violet-mid), var(--violet-faint))",
                      boxShadow: best ? "0 0 26px -6px var(--violet-glow)" : "none",
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: best ? "var(--text-1)" : "var(--text-3)", fontWeight: best ? 600 : 400 }}>{d.label}</div>
                  <div style={{ fontSize: 10, color: "var(--text-3)" }}>{d.count}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="zc-card">
          <div className="zc-card-h"><span className="t">Order type</span><span className="s">grouped from orders</span></div>
          <div style={{ padding: 20 }}>
            {typeBreakdown.length === 0 ? <div className="ins-empty">No orders yet</div> : typeBreakdown.map((t) => {
              const pct = Math.round((t.count / orderCount) * 100);
              const c = TYPE_COLOR[t.type] || "var(--violet)";
              return (
                <div key={t.type} style={{ marginBottom: 17 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
                      <i style={{ width: 8, height: 8, borderRadius: 2, background: c, boxShadow: `0 0 8px ${c}`, display: "inline-block" }} />
                      {TYPE_LABEL[t.type] || t.type}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-2)" }}>{t.count} · {pct}%</span>
                  </div>
                  <div className="zc-bar"><i style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${c}, transparent)` }} /></div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 5 }}>₹{fmt(t.revenue)}</div>
                </div>
              );
            })}

            <div style={{ marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--edge)" }}>
              <div style={{ fontSize: 11.5, color: "var(--text-2)", marginBottom: 11, fontWeight: 600 }}>Payment method</div>
              {paymentBreakdown.length === 0 ? <div className="ins-empty" style={{ padding: "12px 0" }}>No orders yet</div> : paymentBreakdown.map(({ method, count }) => {
                const pct = Math.round((count / orderCount) * 100);
                const c = method === "Cash" ? "var(--ready)" : "var(--live)";
                return (
                  <div key={method} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
                    <span style={{ fontSize: 11.5, color: "var(--text-2)", width: 44 }}>{method}</span>
                    <div className="zc-bar" style={{ flex: 1 }}><i style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${c}, transparent)` }} /></div>
                    <span style={{ fontSize: 11.5, fontWeight: 600, width: 34, textAlign: "right" }}>{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* row 2: revenue by category / item + profitability */}
      <div className="ins-row">
        <RevenueBreakdown sales={sales} state={salesState} rangeLabel={RANGE_LABEL[range]} onRetry={() => setSalesTick((t) => t + 1)} />
        <Profitability sales={sales} state={salesState} rangeLabel={RANGE_LABEL[range]} />
      </div>
    </div>
  );
}
