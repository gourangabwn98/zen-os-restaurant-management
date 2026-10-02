// src/pages/admin/dashboard/SalesChart.jsx
// One bar per day for the last 7 days, "No sales" written on empty days,
// today's bar highlighted, readable ₹ axis. Plain SVG, no chart library.
import { useEffect, useRef, useState } from "react";
import Ico from "./icons.jsx";
import { niceAxis } from "./model.js";
import { t, fmtNum, fmtDate } from "../../../i18n/core.js";

// Drawn at the card's real pixel width (not scaled), so text stays 11–12.5px
// on any screen; 640 is the reference's width and the first-paint fallback.
const H = 230, PL = 52, PB = 38, PT = 18;
const CH = H - PB - PT;
const money = (n) => `₹${fmtNum(Math.round(n || 0))}`;
const short = (v) => (v >= 1000 ? `₹${fmtNum(v / 1000, { maximumFractionDigits: 1 })}k` : money(v));
const axisLabel = (v) => (v === 0 ? "₹0" : v >= 1000 ? `₹${fmtNum(v / 1000, { maximumFractionDigits: 1 })}k` : `₹${fmtNum(v)}`);

export default function SalesChart({ days }) {
  const box = useRef(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(220, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const total = days.reduce((s, d) => s + d.value, 0);
  const ticks = niceAxis(Math.max(...days.map((d) => d.value)));
  const max = ticks[ticks.length - 1];
  // Phones: weekday-only labels, short ₹ values, no "No sales" text.
  const compact = (W - PL - 10) / days.length < 62;
  const pl = compact ? 40 : PL;
  const gap = (W - pl - 10) / days.length;
  const BW = Math.min(48, Math.max(14, gap * 0.62));

  return (
    <div className="zd-card zd-chart">
      <div className="zd-ch">
        <h3>{t("Sales, last 7 days")}</h3>
        <span className="zd-hint">{t("{amount} total", { amount: money(total) })}</span>
      </div>
      <div ref={box}>
      {total === 0 ? (
        <div className="zd-empty">
          <Ico id="chart" />
          <b>{t("No sales in the last 7 days")}</b>
          <span>{t("Paid orders show up here as daily bars.")}</span>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={t("Sales, last 7 days")}>
          {ticks.map((v) => {
            const y = PT + CH - (v / max) * CH;
            return (
              <g key={v}>
                <line className="grid" x1={pl} x2={W - 6} y1={y} y2={y} />
                <text className="ax" x={pl - 8} y={y + 4} textAnchor="end">{axisLabel(v)}</text>
              </g>
            );
          })}
          {days.map((d, i) => {
            const cx = pl + gap * i + gap / 2, x = cx - BW / 2;
            const h = (d.value / max) * CH, y = PT + CH - h;
            const full = `${fmtDate(d.date, { weekday: "short" })} ${fmtNum(d.date.getDate())}`;
            const label = compact ? fmtDate(d.date, { weekday: "narrow" }) : full;
            return (
              <g key={i}>
                <title>{`${full}: ${money(d.value)}`}</title>
                {d.value > 0 ? (
                  <>
                    <rect className={`bar${d.today ? " today" : ""}`} x={x} y={y} width={BW} height={h} rx="7" />
                    <text className="val" x={cx} y={y - 7} textAnchor="middle">{compact ? short(d.value) : money(d.value)}</text>
                  </>
                ) : (
                  <>
                    <rect className="bar empty" x={x} y={PT + CH - 3} width={BW} height="3" rx="1.5" />
                    {!compact && <text className="nos" x={cx} y={PT + CH - 12} textAnchor="middle">{t("No sales")}</text>}
                  </>
                )}
                <text className={`day${d.today ? " today" : ""}`} x={cx} y={H - 18} textAnchor="middle">{label}</text>
                {d.today && (
                  <text className="tdy" x={cx} y={H - 3} textAnchor="middle">
                    {d.value && !compact ? t("today · so far") : t("today")}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      </div>
    </div>
  );
}
