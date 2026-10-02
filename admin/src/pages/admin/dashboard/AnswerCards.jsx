// src/pages/admin/dashboard/AnswerCards.jsx
// The three questions the dashboard answers first: how much came in today,
// how much is still to collect, how many orders today.
import Ico from "./icons.jsx";
import { t, tn, fmtNum } from "../../../i18n/core.js";

const money = (n) => `₹${fmtNum(Math.round(n || 0))}`;

export default function AnswerCards({ today, onNavigate }) {
  const cashPct = today.collected ? (today.cash / today.collected) * 100 : 0;
  const otherPaid = Math.max(0, today.collected - today.cash - today.online);
  return (
    <div className="zd-answers">
      <div className="zd-card">
        <div className="zd-lbl"><span className="zd-itile"><Ico id="money" /></span>{t("Collected today")}</div>
        <div className={`zd-num${today.collected ? "" : " zero"}`}>{money(today.collected)}</div>
        {today.collected ? (
          <>
            <div className="zd-split" aria-hidden="true">
              <i style={{ width: `${cashPct}%`, background: "var(--zd-green)" }} />
              <i style={{ width: `${(today.online / today.collected) * 100}%`, background: "var(--zd-accent2)" }} />
            </div>
            <div className="zd-legend">
              <span style={{ "--c": "var(--zd-green)" }}>{t("Cash")} {money(today.cash)}</span>
              <span style={{ "--c": "var(--zd-accent2)" }}>{t("Online")} {money(today.online)}</span>
              {otherPaid > 0 && <span style={{ "--c": "var(--zd-line2)" }}>{t("Other")} {money(otherPaid)}</span>}
            </div>
          </>
        ) : (
          <div className="zd-foot">{t("No sales yet today")}</div>
        )}
      </div>

      <div className="zd-card">
        <div className="zd-lbl"><span className="zd-itile"><Ico id="clock" /></span>{t("Still to collect")}</div>
        <div className={`zd-num${today.openAmount ? "" : " zero"}`} style={today.openAmount ? { color: "var(--zd-amber)" } : undefined}>
          {money(today.openAmount)}
        </div>
        <div className="zd-foot">
          {today.openCount
            ? <>
                {tn(today.openCount, "{n} open bill today", "{n} open bills today")}
                {today.openTables > 0 && <> · {tn(today.openTables, "{n} table", "{n} tables")}</>}
              </>
            : t("No open bills right now")}
        </div>
        {today.openCount > 0 && (
          <div className="zd-act">
            <button type="button" className="zd-btn ghost sm" onClick={() => onNavigate?.("tables")}>{t("See tables")} →</button>
          </div>
        )}
      </div>

      <div className="zd-card">
        <div className="zd-lbl"><span className="zd-itile"><Ico id="bag" /></span>{t("Orders today")}</div>
        <div className={`zd-num${today.count ? "" : " zero"}`}>{fmtNum(today.count)}</div>
        <div className="zd-foot">
          {today.count
            ? <><b>{fmtNum(today.inProgress)}</b> {t("in progress")} · <b>{fmtNum(today.done)}</b> {t("done")} · <b>{fmtNum(today.cancelled)}</b> {t("cancelled")}</>
            : t("No orders yet")}
        </div>
      </div>
    </div>
  );
}
