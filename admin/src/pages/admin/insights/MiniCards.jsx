// src/pages/admin/insights/MiniCards.jsx
// One card each for customers, staff, offers and money to collect — taken
// from the pages that already hold them:
//   Customers  overview.customers (paid bills, by user id or guest phone)
//   Staff      overview.reviews + staffPay for the period, and the Employees
//              page's own team summary (GET /admin/employees/hr/summary)
//   Offers     overview.offers (coupon use on paid bills, live/upcoming coupons)
//   Dues       the Invoices page's own rule (invoices/model.js isInvoice +
//              billState) on GET /admin/orders?paymentStatus=PENDING_VERIFICATION
import { t, tn, fmtNum, fmtDate } from "../../../i18n/core.js";
import { money, pct, PERIOD_WORD } from "./model.js";

function Mini({ label, value, tone, sub, children, go, onGo }) {
  return (
    <div className="zc-card ins-mini">
      <div className="l">{label}</div>
      <div className={`v${tone ? ` ${tone}` : ""}`}>{value}</div>
      {sub && <div className="s">{sub}</div>}
      {children}
      {go && <div className="go"><button type="button" className="zc-btn sm ghost" onClick={onGo}>{go} →</button></div>}
    </div>
  );
}

export default function MiniCards({ data, periodKey, dues, hr, onNavigate }) {
  const c = data.customers;
  const rate = c.identified ? pct(c.returning, c.identified) : null;
  const walkInShare = pct(c.walkInBills, c.bills);
  const rv = data.reviews;
  const pay = data.current.staffPay;
  const used = data.offers.used;
  const couponBills = used.reduce((s, u) => s + u.bills, 0);
  const couponDiscount = used.reduce((s, u) => s + u.discount, 0);
  const live = data.offers.live[0], next = data.offers.upcoming[0];
  const word = t(PERIOD_WORD[periodKey]);

  return (
    <div className="ins-minis">
      <Mini
        label={t("Customers")}
        value={rate == null ? "—" : `${fmtNum(rate, { maximumFractionDigits: 0 })}%`}
        tone={rate == null ? "muted" : ""}
        sub={rate == null ? t("no named customers {when}", { when: word }) : t("came back again · {a} new, {b} returning", { a: fmtNum(c.newCount), b: fmtNum(c.returning) })}
        go={t("Open Users")} onGo={() => onNavigate?.("users")}
      >
        {c.identified > 0 && (
          <div className="ins-split" aria-hidden="true">
            <i style={{ width: `${pct(c.newCount, c.identified)}%`, background: "var(--violet)" }} />
            <i style={{ width: `${pct(c.returning, c.identified)}%`, background: "var(--done)" }} />
          </div>
        )}
        <div className="x">
          {c.bills > 0
            ? <>{t("{pct}% of paid bills are walk-ins with no name or phone", { pct: fmtNum(walkInShare, { maximumFractionDigits: 0 }) })}{c.repeatInPeriod > 0 && <> · {tn(c.repeatInPeriod, "{n} customer came more than once", "{n} customers came more than once")}</>}</>
            : t("No paid bills yet")}
        </div>
      </Mini>

      <Mini
        label={t("Staff")}
        value={rv.avg == null ? "—" : `★ ${fmtNum(rv.avg, { maximumFractionDigits: 1 })}`}
        tone={rv.avg == null ? "muted" : ""}
        sub={rv.count ? `${tn(rv.count, "{n} customer review", "{n} customer reviews")}${rv.complaints ? ` · ${tn(rv.complaints, "{n} complaint", "{n} complaints")}` : ""}` : t("no customer reviews {when}", { when: word })}
        go={t("Open Employees")} onGo={() => onNavigate?.("employees")}
      >
        <div className="x">
          {pay.amount > 0 && <div>{t("Paid out {when}: {amount}", { when: word, amount: money(pay.amount) })}</div>}
          {hr === undefined ? null : hr === null ? <div>{t("Team summary unavailable")}</div> : (
            <>
              {hr.totals.salaryDue > 0 && <div>{t("Salary still due this month: {amount}", { amount: money(hr.totals.salaryDue) })} ({tn(hr.totals.unpaidPeople, "{n} person", "{n} people")})</div>}
              {hr.totals.pendingLeaves > 0 && <div>{tn(hr.totals.pendingLeaves, "{n} leave request waiting", "{n} leave requests waiting")}</div>}
              {hr.totals.openComplaints > 0 && <div>{tn(hr.totals.openComplaints, "{n} complaint not looked into", "{n} complaints not looked into")}</div>}
            </>
          )}
        </div>
      </Mini>

      <Mini
        label={t("Offers")}
        value={couponBills ? money(couponDiscount) : "—"}
        tone={couponBills ? "" : "muted"}
        sub={couponBills ? `${t("discount given")} · ${tn(couponBills, "{n} bill used a coupon", "{n} bills used a coupon")}` : t("no coupon used {when}", { when: word })}
        go={t("Open Coupons")} onGo={() => onNavigate?.("coupons")}
      >
        <div className="x">
          {used[0] && <div>{t("Most used: {code} · {amount} billed", { code: used[0].code, amount: money(used[0].revenue) })}</div>}
          {live && <div>{t("Live now: {code} till {date}", { code: live.code, date: fmtDate(live.endsAt, { day: "numeric", month: "short" }) })}</div>}
          {next && <div>{t("Next: {code} from {date}", { code: next.code, date: fmtDate(next.startsAt, { day: "numeric", month: "short" }) })}</div>}
          {!live && !next && <div>{t("No coupon is live or scheduled")}</div>}
        </div>
      </Mini>

      <Mini
        label={t("Money to collect")}
        value={dues === undefined ? "…" : dues === null ? "—" : money(dues.total)}
        tone={dues?.total > 0 ? "warn" : dues ? "" : "muted"}
        sub={dues === null ? t("Could not load unpaid bills") : dues ? (dues.count ? `${t("{a} today · {b} older", { a: money(dues.today), b: money(dues.older) })} · ${tn(dues.count, "{n} bill", "{n} bills")}` : t("Every bill is paid")) : ""}
        go={t("Open Invoices")} onGo={() => onNavigate?.("invoices")}
      >
        {dues?.count > 0 && (
          <div className="x">
            {dues.checkUpiN > 0 && <div>{tn(dues.checkUpiN, "{n} UPI payment to check", "{n} UPI payments to check")} ({money(dues.checkUpi)})</div>}
            {dues.oldest && <div>{t("Oldest: {when}", { when: tn(dues.oldest.days, "{n} day", "{n} days") })}{dues.oldest.name ? ` · ${dues.oldest.name}` : ""} {money(dues.oldest.total)}</div>}
          </div>
        )}
      </Mini>
    </div>
  );
}
