// src/pages/admin/insights/Ebitda.jsx — INS-01 EBITDA + INS-02 "where the
// money went out", from recorded figures only (insightsService.computeEbitda /
// purchasesByFunding). Purchases are a cost whoever paid; WHO paid only
// changes the cash picture: Owner's Pocket is owed back to the owner, Credit
// is owed to the supplier — paying them back later is never a second expense.
import { t, N_, fmtNum } from "../../../i18n/core.js";
import { money, signedMoney } from "./model.js";

const FUNDING = [
  { key: "CASH_DRAWER", label: N_("From the cash drawer") },
  { key: "BANK_UPI", label: N_("From the bank / UPI") },
  { key: "OWNER_POCKET", label: N_("Owner's pocket"), note: N_("owed back to the owner") },
  { key: "CREDIT", label: N_("On supplier credit"), note: N_("owed to suppliers") },
  { key: "NOT_RECORDED", label: N_("Payment not recorded"), note: N_("older or imported bills") },
];

function Bar({ value, scale, tone }) {
  const w = scale > 0 ? Math.min(100, (Math.abs(value) / scale) * 100) : 0;
  return <span className="ins-bx" aria-hidden="true"><i className={tone} style={{ left: 0, width: `${w}%` }} /></span>;
}

export default function Ebitda({ data, periodLabel, prevLabel }) {
  const cur = data.current;
  const e = cur.ebitda;
  if (!e) return null; // older server
  const prev = data.previous?.ebitda;
  const fund = cur.purchases?.byFunding || {};
  const owed = data.openPayables || { owner: { amount: 0 }, suppliers: { amount: 0 } };
  const scale = Math.max(e.netSales, e.supplies + e.staff, 1);
  const empty = e.netSales === 0 && e.supplies === 0 && e.staff === 0;
  const pct = (v) => (e.netSales > 0 ? `${fmtNum((v / e.netSales) * 100, { maximumFractionDigits: 1 })}%` : "");
  const delta = prev && prev.ebitda !== 0 ? ((e.ebitda - prev.ebitda) / Math.abs(prev.ebitda)) * 100 : null;

  return (
    <div className="ins-row2">
      <div className="zc-card">
        <div className="zc-card-h" style={{ flexWrap: "wrap", rowGap: 4 }}>
          <span className="t">{t("Operating profit (EBITDA)")}</span>
          <span className="s">{periodLabel}</span>
          <div style={{ flex: 1 }} />
          {delta != null && (
            <span className={`ins-delta ${delta >= 0 ? "up" : "down"}`}>
              {delta >= 0 ? "▲" : "▼"} {fmtNum(Math.abs(delta), { maximumFractionDigits: 0 })}% {t("vs {when}", { when: t(prevLabel) })}
            </span>
          )}
        </div>
        <div className="ins-body">
          {empty ? (
            <div className="ins-empty"><b>{t("Nothing recorded in this period")}</b>{t("Fills in from paid bills, purchases and staff pay.")}</div>
          ) : (
            <div className="ins-ladder">
              <div className="ins-lr">
                <span className="k">{t("Net sales")}<small>{t("item sales − discounts + service charge, without GST")}</small></span>
                <Bar value={e.netSales} scale={scale} tone="base" />
                <span className="v">{money(e.netSales)}</span><span className="p" />
              </div>
              <div className="ins-lr">
                <span className="k">− {t("Food & supplies bought")}<small>{t("every purchase, whoever paid")}</small></span>
                <Bar value={e.supplies} scale={scale} tone="cost" />
                <span className="v">{signedMoney(-e.supplies)}</span><span className="p">{pct(e.supplies)}</span>
              </div>
              <div className="ins-lr">
                <span className="k">− {t("Staff pay")}<small>{t("salaries and advances paid")}</small></span>
                <Bar value={e.staff} scale={scale} tone="cost" />
                <span className="v">{signedMoney(-e.staff)}</span><span className="p">{pct(e.staff)}</span>
              </div>
              <div className={`ins-lr tot key${e.ebitda < 0 ? " neg" : ""}`}>
                <span className="k">= {t("EBITDA")}<small>{t("before rent, bills, interest, tax and depreciation")}</small></span>
                <Bar value={e.ebitda} scale={scale} tone={e.ebitda < 0 ? "stop" : "good"} />
                <span className="v">{signedMoney(e.ebitda)}</span>
                <span className="p">{e.margin != null ? `${fmtNum(e.margin, { maximumFractionDigits: 1 })}%` : ""}</span>
              </div>
              <div className="ins-note">
                {t("GST collected ({amount}) is the government's, so it is left out.", { amount: money(e.gst) })}{" "}
                {t("Rent, gas, electricity and other running costs aren't recorded in the app, so they are not taken off.")}
                {cur.manualWaste > 0 && <> {t("Waste of items not in stock: {amount} (already paid for, shown for information).", { amount: money(cur.manualWaste) })}</>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="zc-card">
        <div className="zc-card-h"><span className="t">{t("Where the money went out")}</span><span className="s">{periodLabel}</span></div>
        <div className="ins-body">
          {!cur.purchases?.count && !e.staff ? (
            <div className="ins-empty"><b>{t("No purchases or staff pay recorded")}</b>{t("Record purchases in Inventory and pay in Employees.")}</div>
          ) : (
            <table className="zc-ledger" style={{ width: "100%" }}>
              <thead><tr><th>{t("Purchases paid")}</th><th className="num">{t("Bills")}</th><th className="num">{t("Amount")}</th></tr></thead>
              <tbody>
                {FUNDING.filter((f) => fund[f.key]?.amount > 0).map((f) => (
                  <tr key={f.key}>
                    <td>{t(f.label)}{f.note && <div className="ins-hint">{t(f.note)}</div>}</td>
                    <td className="num">{fmtNum(fund[f.key].count)}</td>
                    <td className="num">{money(fund[f.key].amount)}</td>
                  </tr>
                ))}
                <tr><td>{t("Staff pay")}</td><td className="num">{fmtNum((cur.staffPay?.salaries?.count || 0) + (cur.staffPay?.advances?.count || 0))}</td><td className="num">{money(e.staff)}</td></tr>
              </tbody>
            </table>
          )}
          {(cur.payablesSettled?.ownerRepaid > 0 || cur.payablesSettled?.supplierPaid > 0) && (
            <div className="ins-note">
              {t("Paid back in this period: {owner} to the owner, {supplier} to suppliers — settling a debt, not a new cost.", { owner: money(cur.payablesSettled.ownerRepaid), supplier: money(cur.payablesSettled.supplierPaid) })}
            </div>
          )}
          {(owed.owner.amount > 0 || owed.suppliers.amount > 0) && (
            <div className="ins-note warn">
              {t("Still owed today: {owner} to the owner, {supplier} to suppliers.", { owner: money(owed.owner.amount), supplier: money(owed.suppliers.amount) })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
