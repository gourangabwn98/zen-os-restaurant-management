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
//   • Order type / payment method / top items / category revenue
//                       = grouped straight from those same orders
// Cancelled orders are excluded everywhere (they were never fulfilled).
// Where a breakdown has no data, the panel says so rather than estimating.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useMemo } from "react";
import { getAllOrders } from "../../services/adminService.js";
import { getMenu } from "../../services/menuService.js";
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

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
export default function AnalyticsPage() {
  const [orders, setOrders] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [range, setRange] = useState("Week");

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([getAllOrders({ limit: 5000 }), getMenu({ includeUnavailable: true })])
      .then(([oRes, mRes]) => {
        setOrders(oRes.data?.orders || []);
        setMenuItems(Array.isArray(mRes.data) ? mRes.data : []);
        setError(false);
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  // menuItem id / name → category, for the revenue-by-category breakdown
  const categoryOf = useMemo(() => {
    const byId = new Map(), byName = new Map();
    menuItems.forEach((m) => { byId.set(m._id, m.category); byName.set(m.name, m.category); });
    return (item) => byId.get(item.menuItem) || byName.get(item.name) || "Other";
  }, [menuItems]);

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

  // top items by revenue, and revenue by category — from rangeOrders' items
  const { topItems, categoryRevenue } = useMemo(() => {
    const items = {}, cats = {};
    rangeOrders.forEach((o) => {
      (o.items || []).forEach((it) => {
        const rev = Number(it.price || 0) * Number(it.qty || 0);
        if (!items[it.name]) items[it.name] = { name: it.name, qty: 0, revenue: 0 };
        items[it.name].qty += it.qty || 0;
        items[it.name].revenue += rev;
        const cat = categoryOf(it);
        cats[cat] = (cats[cat] || 0) + rev;
      });
    });
    return {
      topItems: Object.values(items).sort((a, b) => b.revenue - a.revenue).slice(0, 6),
      categoryRevenue: Object.entries(cats).map(([category, rev]) => ({ category, revenue: rev })).sort((a, b) => b.revenue - a.revenue).slice(0, 6),
    };
  }, [rangeOrders, categoryOf]);
  const maxCategoryRevenue = Math.max(...categoryRevenue.map((c) => c.revenue), 1);

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

      {/* row 2: top items + revenue by category */}
      <div className="ins-row2">
        <div className="zc-card">
          <div className="zc-card-h"><span className="t">Top items</span><span className="s">by revenue, {RANGE_LABEL[range]}</span></div>
          <div style={{ padding: "8px 18px 16px" }}>
            {topItems.length === 0 ? <div className="ins-empty">No sales data yet</div> : topItems.map((it, i) => (
              <div key={it.name} style={{ display: "flex", alignItems: "center", gap: 13, padding: "11px 0", borderBottom: "1px solid var(--edge)" }}>
                <span style={{
                  width: 25, height: 25, borderRadius: 8, display: "grid", placeItems: "center", fontSize: 11.5, fontWeight: 700, flex: "none",
                  color: i < 3 ? "var(--accent-ink)" : "var(--text-3)",
                  background: i < 3 ? "var(--violet-weak)" : "var(--raise)",
                  border: `1px solid ${i < 3 ? "var(--violet-mid)" : "var(--edge)"}`,
                }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500, color: "var(--text-1)" }}>{it.name}</span>
                <span style={{ fontSize: 11.5, color: "var(--text-3)", width: 64, textAlign: "right" }}>{it.qty} sold</span>
                <span className="tnum" style={{ fontSize: 13, fontWeight: 700, width: 76, textAlign: "right", color: "var(--text-1)" }}>₹{fmt(it.revenue)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="zc-card">
          <div className="zc-card-h"><span className="t">Revenue by category</span><span className="s">{RANGE_LABEL[range]}</span></div>
          <div style={{ padding: 20 }}>
            {categoryRevenue.length === 0 ? <div className="ins-empty">No sales data yet</div> : categoryRevenue.map((c, i) => {
              const pct = Math.round((c.revenue / maxCategoryRevenue) * 100);
              const color = CAT_COLORS[i % CAT_COLORS.length];
              return (
                <div key={c.category} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 7, color: "var(--text-1)" }}>
                      <i style={{ width: 8, height: 8, borderRadius: 2, background: color, display: "inline-block" }} />
                      {c.category}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
                      {c.revenue >= 1000 ? `₹${(c.revenue / 1000).toFixed(1)}k` : `₹${fmt(c.revenue)}`}
                    </span>
                  </div>
                  <div className="zc-bar"><i style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}, transparent)` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
