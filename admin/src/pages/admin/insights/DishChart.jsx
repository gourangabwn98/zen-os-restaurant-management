// src/pages/admin/insights/DishChart.jsx
// "Which dishes really make money": plates sold (across) × gross profit per
// plate (up), split into four groups at YOUR averages (dashed lines). Only
// dishes with a recipe can be placed — profit needs a known food cost.
import { useEffect, useRef, useState } from "react";
import { t, tn, fmtNum } from "../../../i18n/core.js";
import { QUADS, niceMax, signedMoney, PERIOD_WORD } from "./model.js";

const H = 300, PL = 50, PR = 12, PT = 14, PB = 34;

export default function DishChart({ dishes, periodKey, withoutRecipe, onNavigate }) {
  const box = useRef(null);
  const [W, setW] = useState(560);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = dishes?.points || [];
  const xmax = niceMax(Math.max(...pts.map((p) => p.sold), 1) * 1.08);
  const yTop = niceMax(Math.max(...pts.map((p) => p.perPlate), 1) * 1.1);
  const yLow = Math.min(0, ...pts.map((p) => p.perPlate));
  const yMin = yLow < 0 ? -niceMax(-yLow * 1.15) : 0;
  const X = (v) => PL + (v / xmax) * (W - PL - PR);
  const Y = (v) => PT + ((yTop - v) / (yTop - yMin)) * (H - PT - PB);
  const labels = pts.length <= 14 && W >= 380;
  const yTicks = [yMin, 0, yTop / 2, yTop].filter((v, i, a) => a.indexOf(v) === i);
  const groups = QUADS.map((q, i) => ({ ...q, names: pts.filter((p) => p.q === i).sort((a, b) => b.sold - a.sold).map((p) => p.name) }));
  const list = (names) => (names.length > 5 ? `${names.slice(0, 5).join(", ")} ${t("+{n} more", { n: names.length - 5 })}` : names.join(", ") || "—");

  return (
    <div className="zc-card ins-chart">
      <div className="zc-card-h" style={{ flexWrap: "wrap", rowGap: 4 }}>
        <span className="t">{t("Which dishes really make money")}</span>
        <div style={{ flex: 1 }} />
        <span className="ins-hint">{t("only dishes with a recipe")}</span>
      </div>
      <div className="ins-body">
        <div className="ins-hint" style={{ marginBottom: 8 }}>{t("Plates sold (across) × profit per plate after food cost (up). Dashed lines are your averages.")}</div>
        <div ref={box}>
          {!dishes ? (
            <div className="ins-empty">
              <b>{pts.length === 0 && withoutRecipe === 0 ? t("No dishes sold in this period") : t("Not enough dishes with a recipe yet")}</b>
              {t("At least two dishes sold with a recipe are needed to compare them.")}
            </div>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={t("Which dishes really make money")}>
              <rect className="zone-good" x={X(dishes.avgSold)} y={PT} width={X(xmax) - X(dishes.avgSold)} height={Y(dishes.avgPlate) - PT} />
              <rect className="zone-bad" x={PL} y={Y(dishes.avgPlate)} width={X(dishes.avgSold) - PL} height={H - PB - Y(dishes.avgPlate)} />
              {yTicks.map((v) => (
                <g key={v}>
                  <line className="grid" x1={PL} x2={W - PR} y1={Y(v)} y2={Y(v)} />
                  <text className="ax" x={PL - 6} y={Y(v) + 4} textAnchor="end">{signedMoney(v)}</text>
                </g>
              ))}
              {[0, xmax / 2, xmax].map((v) => <text key={v} className="ax" x={X(v)} y={H - 16} textAnchor="middle">{fmtNum(Math.round(v))}</text>)}
              <line className="avg" x1={X(dishes.avgSold)} x2={X(dishes.avgSold)} y1={PT} y2={H - PB} />
              <line className="avg" x1={PL} x2={W - PR} y1={Y(dishes.avgPlate)} y2={Y(dishes.avgPlate)} />
              <text className="qlbl" x={W - PR - 4} y={PT + 14} textAnchor="end" fill={QUADS[0].color}>{t(QUADS[0].label)}</text>
              <text className="qlbl" x={W - PR - 4} y={H - PB - 6} textAnchor="end" fill={QUADS[1].color}>{t(QUADS[1].label)}</text>
              <text className="qlbl" x={PL + 4} y={PT + 14} fill={QUADS[2].color}>{t(QUADS[2].label)}</text>
              <text className="qlbl" x={PL + 4} y={H - PB - 6} fill={QUADS[3].color}>{t(QUADS[3].label)}</text>
              {pts.map((p) => {
                const cx = X(p.sold), cy = Y(p.perPlate), right = cx > W * 0.72;
                return (
                  <g key={p.id}>
                    <title>{`${p.name}: ${tn(p.sold, "{n} plate sold", "{n} plates sold")} · ${t("{amount} profit a plate", { amount: signedMoney(p.perPlate) })} · ${t(QUADS[p.q].label)}`}</title>
                    <circle cx={cx} cy={cy} r="6" fill={QUADS[p.q].dot} stroke="var(--card)" strokeWidth="1.5" />
                    {labels && <text className="dlbl" x={cx + (right ? -9 : 9)} y={cy + 4} textAnchor={right ? "end" : "start"}>{p.name} {signedMoney(p.perPlate)}</text>}
                  </g>
                );
              })}
              <text className="ax" x={(PL + W - PR) / 2} y={H - 1} textAnchor="middle">{t("plates sold")} · {t(PERIOD_WORD[periodKey])} →</text>
            </svg>
          )}
        </div>
        {dishes && (
          <>
            <div className="ins-quad">
              {groups.map((g) => (
                <div key={g.label}>
                  <b style={{ color: g.color }}>{t(g.label)}</b>
                  {list(g.names)}
                  <div className="act">→ {t(g.act)}</div>
                </div>
              ))}
            </div>
            <div className="ins-acts">
              <button type="button" className="zc-btn sm" onClick={() => onNavigate?.("menu")}>{t("Change prices in Menu")}</button>
              <button type="button" className="zc-btn sm ghost" onClick={() => onNavigate?.("coupons")}>{t("Make an offer")}</button>
              <button type="button" className="zc-btn sm ghost" onClick={() => onNavigate?.("inventory")}>{t("Fix recipes")}</button>
            </div>
          </>
        )}
        {withoutRecipe > 0 && <div className="ins-note warn">{tn(withoutRecipe, "{n} dish sold has no recipe, so it isn't on this chart.", "{n} dishes sold have no recipe, so they aren't on this chart.")}</div>}
      </div>
    </div>
  );
}
