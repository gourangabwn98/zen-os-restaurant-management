// src/pages/admin/offers/Results.jsx
// "Did it work?" — every coupon (and every past push that wasn't tied to a
// coupon) with Sent → Used, orders vs the restaurant's normal rate, money
// earned vs discount given, and a plain verdict. Figures: stats.byCoupon /
// stats.pushes (services/offerStatsService.js) — "used/earned" = paid,
// not-cancelled bills carrying the code (the shared revenue rule).
import { useState } from "react";
import { t, tn, N_, fmtNum } from "../../../i18n/core.js";
import { money, fmtWhen, fmtDay, describeDiscount, stateOf, couponVerdict, pushVerdict, AUDIENCE } from "./model.js";

const VIEWS = [["all", N_("All")], ["running", N_("Running")], ["scheduled", N_("Scheduled")], ["ended", N_("Ended")], ["messages", N_("Messages")]];
const PUSH_STATE = { SCHEDULED: N_("Scheduled"), SENDING: N_("Sending"), SENT: N_("Sent"), FAILED: N_("Failed"), CANCELLED: N_("Cancelled") };

function sentCell(n, recipients) {
  if (!n) return <span className="ofr-hint">{t("Not announced")}</span>;
  if (n.status === "SCHEDULED") return <>{t("Sends {when}", { when: fmtWhen(new Date(n.startsAt)) })}</>;
  if (n.status === "SENT") return <>{fmtDay(new Date(n.sentAt || n.startsAt))}<div className="ofr-hint">{tn(recipients ?? 0, "{n} phone", "{n} phones")}</div></>;
  return <span title={n.error || undefined}>{t(PUSH_STATE[n.status] || n.status)}</span>;
}

function vsNormal(v, state) {
  if (state === "upcoming" || !v) return <span className="ofr-hint">—</span>;
  if (v.extra == null) return <span className="ofr-hint" title={t("Fewer than 7 days of earlier orders to compare with")}>{tn(v.during, "{n} order", "{n} orders")} · {t("no baseline")}</span>;
  const up = v.extra > 0;
  return (
    <span title={t("{a} paid bills while it ran vs about {b} on a normal day-rate", { a: fmtNum(v.during), b: fmtNum(v.expected, { maximumFractionDigits: 1 }) })}>
      <b className={up ? "ofr-up" : "ofr-down"}>{up ? "+" : "−"}{fmtNum(Math.abs(v.extra), { maximumFractionDigits: 1 })}</b>
      <div className="ofr-hint">{t("{a} vs {b} normal", { a: fmtNum(v.during), b: fmtNum(v.expected, { maximumFractionDigits: 1 }) })}</div>
    </span>
  );
}

export default function Results({ coupons, stats, now, onEdit, onPause, onDelete, onCancelPush }) {
  const [view, setView] = useState("all");
  const byCoupon = stats?.byCoupon || {};
  const pushes = stats?.pushes || [];

  const rows = [
    ...coupons.map((c) => ({ kind: "c", c, r: byCoupon[c._id], st: stateOf(c, now) })),
    ...pushes.map((p) => ({ kind: "p", p })),
  ].filter((x) => {
    if (view === "all") return true;
    if (view === "messages") return x.kind === "p";
    if (x.kind === "p") return view === "scheduled" ? x.p.status === "SCHEDULED" : false;
    if (view === "running") return x.st.key === "live";
    if (view === "scheduled") return x.st.key === "upcoming";
    return x.st.key === "ended" || x.st.key === "paused";
  });

  return (
    <div className="zc-card">
      <div className="zc-card-h" style={{ flexWrap: "wrap", rowGap: 8 }}>
        <span className="t">{t("Did it work?")}</span>
        <span className="s">{t("Used = paid bills with the code · vs normal = paid bills while it ran vs your usual rate before it")}</span>
        <div style={{ flex: 1 }} />
        <div className="zc-seg" role="group" aria-label={t("Show")}>
          {VIEWS.map(([k, label]) => (
            <button key={k} type="button" className={view === k ? "on" : ""} aria-pressed={view === k} onClick={() => setView(k)}>{t(label)}</button>
          ))}
        </div>
      </div>
      <div className="ofr-tw">
        {rows.length === 0 ? (
          <div className="ofr-empty">
            <b>{coupons.length + pushes.length === 0 ? t("No offers yet") : t("Nothing here")}</b>
            {coupons.length + pushes.length === 0 ? t("Create your first offer above — its results show up here.") : t("Try another filter.")}
          </div>
        ) : (
          <table className="zc-ledger ofr-tbl">
            <thead>
              <tr>
                <th>{t("Offer")}</th>
                <th>{t("Notification")}</th>
                <th className="num">{t("Sent → Used")}</th>
                <th className="num">{t("vs normal")}</th>
                <th className="num">{t("Earned")}</th>
                <th className="num">{t("Discount")}</th>
                <th>{t("Verdict")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                if (x.kind === "c") {
                  const { c, r, st } = x;
                  const v = couponVerdict(c, r, now);
                  return (
                    <tr key={c._id}>
                      <td data-l={t("Offer")}>
                        <div className="ofr-name">
                          <span className="ofr-codetag">{c.code}</span>
                          <b>{c.title}</b>
                        </div>
                        <div className="ofr-hint">
                          {describeDiscount(c)}{c.minOrderAmount ? ` · ${t("min ₹{min}", { min: fmtNum(c.minOrderAmount) })}` : ""} · {t(AUDIENCE[c.audience || "ALL"].label)}
                        </div>
                        <div className="ofr-hint"><span className={`zc-tag ${st.cls}`}><i />{t(st.label)}</span> {fmtWhen(new Date(c.startsAt))} – {fmtDay(new Date(c.endsAt))}</div>
                      </td>
                      <td data-l={t("Notification")}>{sentCell(c.notification, r?.recipients)}</td>
                      <td data-l={t("Sent → Used")} className="num tnum">
                        <span className="ofr-funnel">{r?.recipients != null ? fmtNum(r.recipients) : "—"}<i>→</i><b>{fmtNum(r?.bills || 0)}</b></span>
                        {r?.unpaidBills > 0 && <div className="ofr-hint">{tn(r.unpaidBills, "+{n} bill not paid yet", "+{n} bills not paid yet")}</div>}
                      </td>
                      <td data-l={t("vs normal")} className="num tnum">{vsNormal(r?.vsNormal, st.key)}</td>
                      <td data-l={t("Earned")} className="num tnum" style={{ fontWeight: 700, color: r?.earned ? "var(--ready-ink)" : undefined }}>{r?.bills ? money(r.earned) : "—"}</td>
                      <td data-l={t("Discount")} className="num tnum">{r?.bills ? money(r.discount) : "—"}</td>
                      <td data-l={t("Verdict")}><span className={`zc-tag ${v.cls}`}>{v.text}</span></td>
                      <td className="ofr-acts">
                        <button type="button" className="zc-btn sm" onClick={() => onEdit(c)}>{t("Edit")}</button>
                        <button type="button" className="zc-btn sm" onClick={() => onPause(c)}>{c.isActive ? t("Pause") : t("Resume")}</button>
                        <button type="button" className="zc-btn ghost sm" onClick={() => onDelete(c)}>{t("Delete")}</button>
                      </td>
                    </tr>
                  );
                }
                const { p } = x;
                const v = pushVerdict(p);
                return (
                  <tr key={p._id} className="ofr-msg">
                    <td data-l={t("Offer")}>
                      <div className="ofr-name">
                        {p.couponCode && <span className="ofr-codetag">{p.couponCode}</span>}
                        <b>{p.title}</b>
                      </div>
                      <div className="ofr-hint ofr-clip" title={p.body}>{t("Message")} · {p.body}</div>
                    </td>
                    <td data-l={t("Notification")}>
                      {p.status === "SENT"
                        ? <>{fmtDay(new Date(p.sentAt || p.createdAt))}<div className="ofr-hint">{tn(p.recipients, "{n} phone", "{n} phones")}{p.sentBy ? ` · ${p.sentBy}` : ""}</div></>
                        : p.status === "SCHEDULED" ? t("Sends {when}", { when: fmtWhen(new Date(p.startsAt)) })
                          : <span title={p.error || undefined}>{t(PUSH_STATE[p.status] || p.status)}</span>}
                    </td>
                    <td data-l={t("Sent → Used")} className="num tnum">
                      <span className="ofr-funnel">{p.status === "SENT" ? fmtNum(p.recipients) : "—"}<i>→</i><b>{p.couponCode ? fmtNum(p.bills) : "?"}</b></span>
                    </td>
                    <td data-l={t("vs normal")} className="num"><span className="ofr-hint">—</span></td>
                    <td data-l={t("Earned")} className="num tnum">{p.bills ? money(p.earned) : "—"}</td>
                    <td data-l={t("Discount")} className="num tnum">{p.bills ? money(p.discount) : "—"}</td>
                    <td data-l={t("Verdict")}><span className={`zc-tag ${v.cls}`}>{v.text}</span></td>
                    <td className="ofr-acts">
                      {p.status === "SCHEDULED" && <button type="button" className="zc-btn sm" onClick={() => onCancelPush(p)}>{t("Cancel")}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="ofr-foot">
        {t("“Opened” isn't shown: phone notifications don't report back who opened them. Old messages without a real coupon code can't be measured.")}
      </div>
    </div>
  );
}
