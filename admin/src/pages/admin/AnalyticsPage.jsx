// src/pages/admin/AnalyticsPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Insights — the owner's weekly meeting on one page. Layout follows the
// Insights redesign reference (one-sentence summary → earnings ladder +
// revenue chart → "which dishes make money" + top dishes → customers / staff
// / offers / dues cards, Simple and Full modes); look and components are the
// app's shared design system (PageHeader, zc-card, zc-seg, zc-btn, zc-ledger).
//
// Every number is real:
//   GET /admin/insights/overview  one aggregation for the period and the
//     comparison period (services/insightsService.js). Revenue = PAID and not
//     CANCELLED — the same rule as before and as the sales breakdown.
//   GET /admin/orders?paymentStatus=PENDING_VERIFICATION  unpaid bills, read
//     with the Invoices page's own rule (invoices/model.js).
//   GET /admin/employees/hr/summary  the Employees page's team summary.
// Costs the app doesn't record (rent, gas, power…) are never estimated.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from "react";
import { getInsightsOverview, getAllOrders, getHrSummary } from "../../services/adminService.js";
import { PageHeader, Loader } from "./shared/index.js";
import ErrorState from "./shared/ErrorState.jsx";
import { t, tn, N_, fmtNum, fmtDate, localName } from "../../i18n/core.js";
import {
  PERIODS, PREV_LABEL, periodBounds, buildSeries, buildLadder, dishPoints, classifyDishes,
  pctChange, money, signedMoney, ymd, insightsCsv,
} from "./insights/model.js";
import { isInvoice, billState, custName, daysOld, downloadText } from "./invoices/model.js";
import Ladder from "./insights/Ladder.jsx";
import RevenueChart from "./insights/RevenueChart.jsx";
import DishChart from "./insights/DishChart.jsx";
import TopDishes from "./insights/TopDishes.jsx";
import MiniCards from "./insights/MiniCards.jsx";
import Ebitda from "./insights/Ebitda.jsx";
import "./insights/insights.css";

const LEAD = {
  today: N_("Today"), week: N_("This week"), month: N_("This month"),
  year: N_("This financial year so far"), custom: N_("In these dates"),
};
const BEST = {
  hour: N_("The busiest hour was {when}."), day: N_("{when} was the best day."),
  week: N_("{when} was the best week."), month: N_("{when} was the best month."),
};
const MODE_KEY = "insMode";
const PERIOD_KEY = "insPeriod";
const read = (k, ok, d) => { try { const v = localStorage.getItem(k); return ok.includes(v) ? v : d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode — fine */ } };

/** Unpaid bills, exactly as Invoices → Customer dues counts them. */
const duesOf = (orders) => {
  const open = orders.filter((o) => isInvoice(o) && ["unpaid", "checkUpi"].includes(billState(o)));
  const d = { total: 0, count: open.length, today: 0, older: 0, checkUpi: 0, checkUpiN: 0, unpaid: 0, unpaidN: 0, oldest: null };
  for (const o of open) {
    const v = Number(o.total) || 0, age = daysOld(o.createdAt);
    d.total += v;
    if (age === 0) d.today += v; else d.older += v;
    if (billState(o) === "checkUpi") { d.checkUpi += v; d.checkUpiN += 1; } else { d.unpaid += v; d.unpaidN += 1; }
    if (!d.oldest || age > d.oldest.days) d.oldest = { days: age, name: custName(o), total: v };
  }
  return d;
};

export default function AnalyticsPage({ onNavigate }) {
  const [period, setPeriodState] = useState(() => read(PERIOD_KEY, PERIODS.map((p) => p.key).filter((k) => k !== "custom"), "week"));
  const [custom, setCustom] = useState(() => {
    const to = new Date(), from = new Date(); from.setDate(from.getDate() - 6);
    return { from: ymd(from), to: ymd(to) };
  });
  const [mode, setModeState] = useState(() => read(MODE_KEY, ["simple", "full"], "full"));
  const [tick, setTick] = useState(0);
  const setPeriod = (p) => { setPeriodState(p); if (p !== "custom") write(PERIOD_KEY, p); };
  const setMode = (m) => { setModeState(m); write(MODE_KEY, m); };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` re-reads "now" on retry
  const bounds = useMemo(() => periodBounds(period, custom, new Date()), [period, custom, tick]);
  const key = `${bounds.from.toISOString()}|${bounds.to.toISOString()}|${tick}`;

  // { key } = which request the data answers; anything else means "loading"
  const [res, setRes] = useState({ key: null, data: null, error: false });
  useEffect(() => {
    let live = true;
    getInsightsOverview({
      from: bounds.from.toISOString(), to: bounds.to.toISOString(),
      prevFrom: bounds.prevFrom.toISOString(), prevTo: bounds.prevTo.toISOString(),
    })
      .then((r) => { if (live) setRes({ key, data: r.data?.data || null, error: false }); })
      .catch(() => { if (live) setRes((p) => ({ key, data: p.data, error: true })); });
    return () => { live = false; };
  }, [bounds, key]);

  const [dues, setDues] = useState(undefined); // undefined = loading, null = failed
  const [hr, setHr] = useState(undefined);
  useEffect(() => {
    let live = true;
    getAllOrders({ paymentStatus: "PENDING_VERIFICATION", limit: 5000 })
      .then((r) => { if (live) setDues(duesOf(r.data?.orders || [])); })
      .catch(() => { if (live) setDues(null); });
    getHrSummary()
      .then((r) => { if (live) setHr(r.data || null); })
      .catch(() => { if (live) setHr(null); });
    return () => { live = false; };
  }, [tick]);

  const retry = useCallback(() => setTick((n) => n + 1), []);
  const data = res.data;
  const loading = res.key !== key;

  const view = useMemo(() => {
    if (!data) return null;
    const cur = data.current, prev = data.previous;
    const series = buildSeries({ bounds, current: cur.series, previous: prev?.series || [] });
    const ladder = buildLadder(cur);
    const dishes = classifyDishes(dishPoints(cur.sales.items));
    const delta = prev ? pctChange(cur.sales.orders.collected, prev.sales.orders.collected) : null;
    return { series, ladder, dishes, delta };
  }, [data, bounds]);

  const rangeText = bounds.from.toDateString() === bounds.to.toDateString()
    ? fmtDate(bounds.from, { weekday: "short", day: "numeric", month: "short" })
    : `${fmtDate(bounds.from, { day: "numeric", month: "short" })} – ${fmtDate(bounds.to, { day: "numeric", month: "short", year: bounds.from.getFullYear() === bounds.to.getFullYear() ? undefined : "numeric" })}`;
  const periodLabel = `${t(PERIODS.find((p) => p.key === period).label)} · ${rangeText}`;

  const exportCsv = () => {
    if (!data || !view) return;
    downloadText(`insights-${ymd(bounds.from)}-to-${ymd(bounds.to)}.csv`, insightsCsv({ bounds, data, ladder: view.ladder }));
  };

  const costShare = view?.ladder.costShare;
  const header = (
    <PageHeader
      title={t("Insights")}
      sub={`${t("How the business is really doing")} · ${rangeText}`}
      right={
        <div className="ins-ctrl">
          <div className="zc-seg" role="group" aria-label={t("Period")}>
            {PERIODS.map((p) => (
              <button key={p.key} type="button" aria-pressed={period === p.key} className={period === p.key ? "on" : ""} onClick={() => setPeriod(p.key)}>{t(p.label)}</button>
            ))}
          </div>
          {period === "custom" && (
            <>
              <input type="date" className="zc-input" value={custom.from} max={custom.to} aria-label={t("From date")}
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
              <input type="date" className="zc-input" value={custom.to} min={custom.from} max={ymd(new Date())} aria-label={t("To date")}
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
            </>
          )}
          <div className="zc-seg" role="group" aria-label={t("How much to show")}>
            {[["simple", N_("Simple")], ["full", N_("Full")]].map(([m, label]) => (
              <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{t(label)}</button>
            ))}
          </div>
          <button type="button" className="zc-btn" onClick={exportCsv} disabled={!data || loading || !data.current.sales.orders.count}>{t("Export")}</button>
          {data && !loading && data.current.sales.totals.revenue > 0 && (
            <span className={`ins-badge${costShare >= 99.5 ? " ok" : ""}`} title={t("Share of item sales whose food cost is known from a recipe. The higher it is, the more exact the profit figures.")}>
              {t("Food cost known for {pct}% of sales", { pct: fmtNum(costShare, { maximumFractionDigits: 0 }) })}
            </span>
          )}
        </div>
      }
    />
  );

  if (!data) {
    return (
      <div className="ins">
        {header}
        {res.error && res.key === key
          ? <div className="zc-card"><ErrorState title={t("Could not load insights")} onRetry={retry} /></div>
          : <div className="zc-card" style={{ padding: 20 }}><Loader rows={6} /></div>}
      </div>
    );
  }

  const cur = data.current;
  const o = cur.sales.orders;
  const top = [...cur.sales.items].sort((a, b) => b.qty - a.qty)[0];
  const topPoint = top && view.dishes?.points.find((p) => p.id === (top.menuItem || top.name));
  const best = view.series.best;

  // "Things to do" for Simple mode — each from a real figure, most urgent first.
  const todo = [];
  if (dues?.unpaidN) todo.push({ text: t("Collect {amount} still unpaid", { amount: money(dues.unpaid) }), sub: tn(dues.unpaidN, "{n} bill in Invoices", "{n} bills in Invoices"), go: "invoices" });
  if (dues?.checkUpiN) todo.push({ text: tn(dues.checkUpiN, "Check {n} UPI payment", "Check {n} UPI payments"), sub: t("mark paid only after you see the money arrive"), go: "invoices" });
  const lowProfit = view.dishes?.points.filter((p) => p.q === 1).sort((a, b) => b.sold - a.sold)[0];
  if (lowProfit) todo.push({ text: t("{name} sells a lot but earns only {amount} a plate", { name: lowProfit.name, amount: signedMoney(lowProfit.perPlate) }), sub: t("raise the price a little or cut the portion"), go: "menu" });
  const fix = view.dishes?.points.filter((p) => p.q === 3);
  if (fix?.length) todo.push({ text: t("Look at {names}", { names: fix.slice(0, 3).map((p) => p.name).join(", ") }), sub: t("they sell slowly and earn little — change the recipe or drop them"), go: "menu" });
  if (cur.sales.totals.itemsWithoutCost) todo.push({ text: tn(cur.sales.totals.itemsWithoutCost, "Add a recipe for {n} dish", "Add recipes for {n} dishes"), sub: t("so food cost and profit are exact"), go: "inventory" });
  if (hr?.totals?.openComplaints) todo.push({ text: tn(hr.totals.openComplaints, "Look into {n} customer complaint", "Look into {n} customer complaints"), sub: t("in Employees → Reviews"), go: "employees" });

  return (
    <div className="ins">
      {header}
      {res.error && (
        <div className="zc-card"><ErrorState title={t("Could not refresh insights — showing the last figures")} onRetry={retry} /></div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14, opacity: loading ? 0.6 : 1, transition: "opacity .15s" }} aria-busy={loading}>
        <div className="zc-card ins-sum">
          {o.count === 0 ? (
            <>{t(LEAD[period])}: {t("no paid bills yet.")}{dues?.total > 0 && <> <span className="warn">{t("{amount} is still unpaid.", { amount: money(dues.total) })}</span></>}</>
          ) : (
            <>
              {t(LEAD[period])} {t("you collected")} <b>{money(o.collected)}</b> {tn(o.count, "from {n} paid bill", "from {n} paid bills")}
              {view.delta != null
                ? <>, <b className={view.delta >= 0 ? "up" : "down"}>{view.delta >= 0 ? "+" : "−"}{fmtNum(Math.abs(view.delta), { maximumFractionDigits: 0 })}%</b> {t("vs {when}", { when: t(PREV_LABEL[period]) })}. </>
                : <> ({t("nothing to compare with yet")}). </>}
              {best && <>{t(BEST[bounds.unit], { when: best.full })} </>}
              {top && (
                <>
                  {t("{name} sold the most ({n} plates)", { name: localName(top), n: fmtNum(top.qty) })}
                  {topPoint?.q === 1 ? <>{t(", but earns only {amount} a plate after food cost", { amount: signedMoney(topPoint.perPlate) })}. </> : ". "}
                </>
              )}
              {cur.sales.totals.itemsWithoutCost > 0 && (
                <span className="warn">{tn(cur.sales.totals.itemsWithoutCost, "{n} dish sold has no recipe, so profit is not complete.", "{n} dishes sold have no recipe, so profit is not complete.")}</span>
              )}
            </>
          )}
        </div>

        {mode === "simple" ? (
          <div className="ins-row2">
            <Ladder ladder={view.ladder} data={data} periodLabel={periodLabel} delta={view.delta} prevLabel={PREV_LABEL[period]} />
            <div className="zc-card">
              <div className="zc-card-h"><span className="t">{t("Things to do")}</span><span className="s">{t("right now")}</span></div>
              <div className="ins-body">
                {todo.length === 0 ? (
                  <div className="ins-empty"><b>{t("Nothing needs you right now")}</b>{t("Bills are paid and every dish sold has a recipe.")}</div>
                ) : (
                  <div className="ins-todo">
                    {todo.slice(0, 5).map((x, i) => (
                      <div key={i}>
                        <span className="n">{fmtNum(i + 1)}</span>
                        <span>{x.text}<small>{x.sub}</small></span>
                        <button type="button" className="zc-btn sm ghost" onClick={() => onNavigate?.(x.go)}>{t("Open")} →</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
        {/* INS-01 / INS-02 — operating profit and where the money went out */}
        <Ebitda data={data} periodLabel={periodLabel} prevLabel={PREV_LABEL[period]} />
        {mode === "simple" ? null : (
          <>
            <div className="ins-row2">
              <Ladder ladder={view.ladder} data={data} periodLabel={periodLabel} delta={view.delta} prevLabel={PREV_LABEL[period]} />
              <RevenueChart series={view.series} unit={bounds.unit} split={data.split} prevLabel={PREV_LABEL[period]} />
            </div>
            <div className="ins-row2">
              <DishChart dishes={view.dishes} periodKey={period} withoutRecipe={cur.sales.totals.itemsWithoutCost} onNavigate={onNavigate} />
              <TopDishes sales={cur.sales} periodKey={period} />
            </div>
            <MiniCards data={data} periodKey={period} dues={dues} hr={hr} onNavigate={onNavigate} />
          </>
        )}
      </div>
    </div>
  );
}
