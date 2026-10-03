// src/pages/admin/insights/Ladder.jsx
// "Where every rupee went" — the earnings ladder (see model.buildLadder for
// what each line is made of). Bars share one scale so lengths compare.
import { t, tn, fmtNum } from "../../../i18n/core.js";
import { signedMoney, money } from "./model.js";

function Row({ r, scale }) {
  const left = (Math.max(0, r.a) / scale) * 100;
  const width = (Math.abs(r.b - r.a) / scale) * 100;
  return (
    <div className={`ins-lr${r.total ? " tot" : ""}${r.key ? " key" : ""}${r.value < 0 && r.total ? " neg" : ""}`}>
      <span className="k">{t(r.label)}{r.sub && <small>{t(r.sub)}</small>}</span>
      <span className="ins-bx" aria-hidden="true"><i className={r.tone} style={{ left: `${left}%`, width: `${Math.min(100 - left, width)}%` }} /></span>
      <span className="v">{signedMoney(r.value)}</span>
      <span className="p">{r.pct != null ? `${fmtNum(r.pct, { maximumFractionDigits: 1 })}%` : ""}</span>
    </div>
  );
}

export default function Ladder({ ladder, data, periodLabel, delta, prevLabel }) {
  const o = data.current.sales.orders;
  const tt = data.current.sales.totals;
  const empty = o.count === 0;
  return (
    <div className="zc-card">
      <div className="zc-card-h" style={{ flexWrap: "wrap", rowGap: 4 }}>
        <span className="t">{t("Where every rupee went")}</span>
        <span className="s">{periodLabel}</span>
        <div style={{ flex: 1 }} />
        {delta != null ? (
          <span className={`ins-delta ${delta >= 0 ? "up" : "down"}`}>
            {t("Collected")} {delta >= 0 ? "▲" : "▼"} {fmtNum(Math.abs(delta), { maximumFractionDigits: 0 })}% {t("vs {when}", { when: t(prevLabel) })}
          </span>
        ) : !empty && <span className="ins-hint">{t("Nothing to compare with yet")}</span>}
      </div>
      <div className="ins-body">
        {empty ? (
          <div className="ins-empty"><b>{t("No paid bills in this period")}</b>{t("The ladder fills in as bills are paid.")}</div>
        ) : (
          <>
            <div className="ins-ladder">
              <div className="ins-lgroup">{t("Money in")} · {tn(o.count, "{n} paid bill", "{n} paid bills")} · {t("average {amount}", { amount: money(o.collected / o.count) })}</div>
              {ladder.money.map((r) => <Row key={r.id} r={r} scale={ladder.scale} />)}
              <div className="ins-lgroup">{t("What the food earned")}</div>
              {tt.costedRevenue > 0
                ? ladder.profit.map((r) => <Row key={r.id} r={r} scale={ladder.scale} />)
                : <div className="ins-note warn">{t("None of the dishes sold have a recipe yet, so food cost and profit can't be worked out. Add recipes under Inventory → Recipes.")}</div>}
            </div>
            {tt.itemsWithoutCost > 0 && tt.costedRevenue > 0 && (
              <div className="ins-note warn">
                {tn(tt.itemsWithoutCost, "{n} dish sold has no recipe, so {amount} of item sales is left out of food cost and profit.", "{n} dishes sold have no recipe, so {amount} of item sales is left out of food cost and profit.", { amount: money(tt.revenue - tt.costedRevenue) })}
              </div>
            )}
            <div className="ins-note">
              {t("Rent, gas, electricity and other running costs aren't recorded in the app, so they are not taken off.")}
              {data.cancelled.count > 0 && <> {tn(data.cancelled.count, "{n} cancelled bill ({amount}) is not counted.", "{n} cancelled bills ({amount}) are not counted.", { amount: money(data.cancelled.amount) })}</>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
