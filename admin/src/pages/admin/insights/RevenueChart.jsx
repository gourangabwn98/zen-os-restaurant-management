// src/pages/admin/insights/RevenueChart.jsx
// Money collected per hour / day / week / month of the period (bars) with
// the comparison period in the same slots (dashed line), then the order-type
// and payment-method splits of the same money. Plain SVG drawn at the card's
// real width (like the Dashboard's SalesChart), so text never scales down.
import { useEffect, useRef, useState } from "react";
import { t, tn, N_, fmtNum } from "../../../i18n/core.js";
import { compact, money, niceMax, pct } from "./model.js";

const H = 236, PT = 22, PB = 30;
const CH = H - PT - PB;
const BY = { hour: N_("by hour"), day: N_("by day"), week: N_("by week"), month: N_("by month") };
const TYPE = { DINE_IN: [N_("Dine-in"), "var(--violet)"], TAKEAWAY: [N_("Takeaway"), "var(--cyan)"], ONLINE: [N_("Online order"), "var(--wait)"] };
const METHOD = { Cash: [N_("Cash"), "var(--ready)"], Online: [N_("Online / UPI"), "var(--live)"] };

function Split({ title, rows, map }) {
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  return (
    <div style={{ minWidth: 0 }}>
      <div className="ins-hint" style={{ marginBottom: 2 }}>{t(title)}</div>
      <div className="ins-split" aria-hidden="true">
        {rows.filter((r) => r.revenue > 0).map((r) => <i key={r.key} style={{ width: `${pct(r.revenue, total)}%`, background: (map[r.key] || [null, "var(--done)"])[1] }} />)}
      </div>
      <div className="ins-legend" style={{ marginTop: 6 }}>
        {rows.map((r) => (
          <span key={r.key} style={{ "--c": (map[r.key] || [null, "var(--done)"])[1] }} title={`${money(r.revenue)} · ${fmtNum(r.orders)}`}>
            {t((map[r.key] || [r.key])[0])} <b>{fmtNum(pct(r.revenue, total), { maximumFractionDigits: 0 })}%</b>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function RevenueChart({ series, unit, split, prevLabel }) {
  const box = useRef(null);
  const [W, setW] = useState(560);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { slots, best, busiest } = series;
  const vals = slots.flatMap((s) => [s.value || 0, s.prev || 0]);
  const any = slots.some((s) => s.value > 0);
  const hasPrev = slots.some((s) => s.prev > 0);
  const max = niceMax(Math.max(...vals, 1));
  const PL = W < 420 ? 40 : 50;
  const n = slots.length;
  const gap = (W - PL - 8) / n;
  const bw = Math.min(40, Math.max(4, gap * 0.62));
  const Y = (v) => PT + CH - (Math.max(0, v) / max) * CH;
  const showVals = gap >= 34;
  const every = Math.max(1, Math.ceil(30 / gap)); // keep x labels from overlapping
  const line = hasPrev ? slots.map((s, i) => [PL + gap * i + gap / 2, Y(s.prev || 0)]) : [];

  return (
    <div className="zc-card ins-chart">
      <div className="zc-card-h" style={{ flexWrap: "wrap", rowGap: 4 }}>
        <span className="t">{t("Money collected")} {t(BY[unit])}</span>
        <div style={{ flex: 1 }} />
        <span className="ins-hint" style={{ display: "inline-flex", gap: 12, flexWrap: "wrap" }}>
          <span className="ins-key"><i />{t("this period")}</span>
          {hasPrev && <span className="ins-key"><i className="line" />{t(prevLabel)}</span>}
        </span>
      </div>
      <div className="ins-body">
        <div ref={box}>
          {!any ? (
            <div className="ins-empty"><b>{t("No paid bills in this period")}</b>{t("Bars appear as bills are paid.")}</div>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${t("Money collected")} ${t(BY[unit])}`}>
              {[0, max / 2, max].map((v) => (
                <g key={v}>
                  <line className="grid" x1={PL} x2={W - 4} y1={Y(v)} y2={Y(v)} />
                  <text className="ax" x={PL - 7} y={Y(v) + 4} textAnchor="end">{compact(v)}</text>
                </g>
              ))}
              {slots.map((s, i) => {
                const cx = PL + gap * i + gap / 2;
                return (
                  <g key={s.i}>
                    <title>{`${s.full}: ${s.value == null ? t("not yet") : `${money(s.value)} · ${tn(s.orders, "{n} bill", "{n} bills")}`}${s.prev != null ? ` · ${t(prevLabel)}: ${money(s.prev)}` : ""}`}</title>
                    <rect x={cx - gap / 2} y={PT} width={gap} height={CH} fill="transparent" className="hit" />
                    {s.value == null ? (
                      <text className="none" x={cx} y={PT + CH - 4} textAnchor="middle">—</text>
                    ) : s.value > 0 && (
                      <>
                        <rect className={`bar${best && s.i === best.i ? " best" : ""}`} x={cx - bw / 2} y={Y(s.value)} width={bw} height={PT + CH - Y(s.value)} rx={Math.min(5, bw / 3)} />
                        {showVals && <text className="val" x={cx} y={Y(s.value) - 6} textAnchor="middle">{compact(s.value)}</text>}
                      </>
                    )}
                    {i % every === 0 && <text className="lbl" x={cx} y={H - 9} textAnchor="middle">{s.short}</text>}
                  </g>
                );
              })}
              {line.length > 1 && (
                <>
                  <polyline className="prev" points={line.map((p) => p.join(",")).join(" ")} />
                  {gap >= 14 && line.map((p, i) => <circle key={i} className="prevdot" cx={p[0]} cy={p[1]} r="2.5" />)}
                </>
              )}
            </svg>
          )}
        </div>
        {any && (
          <>
            <div className="ins-splits">
              <Split title={N_("Order type (share of money collected)")} rows={split.type} map={TYPE} />
              <Split title={N_("Payment method")} rows={split.method} map={METHOD} />
            </div>
            <div className="ins-note">
              {best && <>{t("Best")}: <b style={{ color: "var(--text-1)" }}>{best.full}</b> ({money(best.value)}). </>}
              {busiest && unit !== "hour" && <>{t("Busiest hour")}: <b style={{ color: "var(--text-1)" }}>{busiest.label}</b> ({t("{pct}% of the money", { pct: fmtNum(busiest.share, { maximumFractionDigits: 0 }) })}).</>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
