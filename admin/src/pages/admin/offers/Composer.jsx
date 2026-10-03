// src/pages/admin/offers/Composer.jsx
// "New offer" — who can use it, what they get, when — with a preview of
// what customers see, a cost check against the restaurant's own recent bills
// (server-side, POST /coupons/admin/check, which runs the real discount maths
// in utils/pricing.js) and a review step before anything is saved. Saving
// goes through the existing coupon create/update API; the push (if ticked)
// goes out at the start time — the existing couponOfferService rule.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { checkOffer } from "../../../services/couponService.js";
import { t, tn, N_, fmtNum, fmtTime } from "../../../i18n/core.js";
import {
  AUDIENCE, TITLE_MAX, DESC_MAX, money, fmtWhen, fmtDay, describeDiscount, pushBodyPreview,
  suggestCodes, startOf, validate, endOfDay, toDateInput,
} from "./model.js";

const END_PICKS = [[0, N_("End of today")], [2, N_("In 3 days")], [6, N_("In a week")], [29, N_("In 30 days")]];
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Cost check text + tone from the server's figures. */
function CostCheck({ form, res, loading }) {
  if (form.discountValue === "" || !(Number(form.discountValue) > 0)) {
    return <div className="ofr-check muted"><b>{t("Cost check")}</b> {t("Enter the discount to see what it costs you on your real bills.")}</div>;
  }
  if (!res) return <div className="ofr-check muted"><b>{t("Cost check")}</b> {loading ? t("Checking your recent bills…") : t("Couldn't run the cost check.")}</div>;
  if (!res.bills) return <div className="ofr-check muted"><b>{t("Cost check")}</b> {t("No paid bills in the last {n} days to check against.", { n: res.days })}</div>;
  const min = Number(form.minOrderAmount) || 0;
  const lowReach = min > 0 && res.sharePct < 25;
  const steep = res.discountPctOfBill != null && res.discountPctOfBill > 40;
  const loses = res.keepPerUse != null && res.keepPerUse < 0;
  const warn = lowReach || steep || loses;
  return (
    <div className={`ofr-check${warn ? " warn" : " ok"}`} aria-live="polite">
      <b>{t("Cost check")} {warn ? "⚠" : "✓"}</b>{" "}
      {min > 0
        ? t("{pct}% of your bills in the last {d} days ({q} of {n}) reach the ₹{min} minimum.", { pct: fmtNum(res.sharePct, { maximumFractionDigits: 0 }), d: res.days, q: fmtNum(res.qualifying), n: fmtNum(res.bills), min: fmtNum(min) })
        : t("Every bill can use it — there's no minimum.")}{" "}
      {t("Your typical bill is {median} (average {avg}).", { median: money(res.medianBill), avg: money(res.avgBill) })}{" "}
      {res.qualifying > 0 && t("On a bill that qualifies it takes off about {amount} ({pct}% of the bill).", { amount: money(res.avgDiscount), pct: fmtNum(res.discountPctOfBill, { maximumFractionDigits: 0 }) })}{" "}
      {res.keepPerUse != null
        ? (loses
          ? t("That's more than the food margin — you lose about {amount} per use.", { amount: money(-res.keepPerUse) })
          : t("After food cost you still keep about {amount} per use.", { amount: money(res.keepPerUse) }))
        : t("Profit per use can't be worked out: only {pct}% of item sales have a recipe cost.", { pct: fmtNum(res.costCoveragePct) })}
      {lowReach && <> {t("Few bills are that big — a lower minimum, near your typical bill, reaches more people.")}</>}
    </div>
  );
}

function ReviewModal({ form, start, now, stats, editing, saving, cost, onCancel, onConfirm }) {
  const subs = stats?.reach?.subscribers ?? 0;
  const pushes = form.notify && form.audience !== "GUEST";
  const future = start.getTime() > now + 60 * 1000;
  const verb = editing ? t("Save changes") : future ? t("Schedule for {when}", { when: fmtWhen(start) }) : t("Start now");
  return createPortal(
    <div className="zc-scrim" onClick={onCancel}>
      <div className="zc-modal" role="dialog" aria-label={t("Review the offer")} onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t">{editing ? t("Save “{title}”?", { title: form.title.trim() }) : t("Start “{title}”?", { title: form.title.trim() })}</div>
            <div className="s">{form.code} · {describeDiscount({ ...form, discountValue: Number(form.discountValue), maxDiscount: Number(form.maxDiscount) || null })}{Number(form.minOrderAmount) > 0 ? ` · ${t("on bills of ₹{min} or more", { min: fmtNum(Number(form.minOrderAmount)) })}` : ""}</div>
          </div>
          <button type="button" className="zc-x" onClick={onCancel} aria-label={t("Close")}>✕</button>
        </div>
        <div className="mb ofr-review">
          <div><span>{t("Who can use it")}</span><b>{t(AUDIENCE[form.audience].label)}</b></div>
          <div><span>{t("Works")}</span><b>{fmtWhen(start)} – {fmtWhen(endOfDay(form.end))}</b></div>
          <div>
            <span>{t("Phone notification")}</span>
            <b>{pushes
              ? (editing && ["SENT", "SENDING"].includes(editing.notification?.status)
                ? t("Already sent — not sent again")
                : `${tn(subs, "{n} customer", "{n} customers")} · ${future ? fmtWhen(start) : t("right away")}`)
              : t("None")}</b>
          </div>
          {!form.isActive && <div><span>{t("Status")}</span><b>{t("Paused — customers won't see it")}</b></div>}
          {cost && <CostCheck form={form} res={cost} loading={false} />}
          {pushes && <p className="ofr-hint">{t("A notification that has gone out can't be recalled. Customers can turn off offer notifications in the app.")}</p>}
        </div>
        <div className="mf">
          <button type="button" className="zc-btn ghost" onClick={onCancel} disabled={saving}>{t("Back to edit")}</button>
          <button type="button" className="zc-btn pri" onClick={onConfirm} disabled={saving}>{saving ? t("Saving…") : verb}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function Composer({ form, setForm, editing, coupons, stats, saving, now, onSave, onCancelEdit, composerRef }) {
  const [review, setReview] = useState(false);
  const [cost, setCost] = useState(null);
  const [costLoading, setCostLoading] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const setAudience = (a) => setForm((f) => ({
    ...f, audience: a, notify: a === "GUEST" ? false : a === "REGISTERED" && f.audience !== "REGISTERED" ? true : f.notify,
  }));

  const taken = useMemo(() => new Set((coupons || []).filter((c) => c._id !== editing?._id).map((c) => c.code)), [coupons, editing]);
  // The suggested time only while it is still ahead (the page may stay open).
  const bestAt = stats?.rush?.nextSendAt && new Date(stats.rush.nextSendAt).getTime() > now ? stats.rush.nextSendAt : null;
  const start = startOf(form, bestAt, new Date(now));
  const errors = validate(form, start, taken);
  const isPercent = form.discountType === "PERCENT";
  const alreadySent = ["SENT", "SENDING"].includes(editing?.notification?.status);
  const canReview = form.code && form.title.trim() && form.discountValue !== "" && start && form.end
    && !errors.code && !errors.value && !errors.dates && !saving;
  const codes = suggestCodes(form.title, form.discountValue, taken).filter((c) => c !== form.code);

  // Cost check — debounced, server-side, saves nothing.
  const terms = `${form.discountType}|${form.discountValue}|${isPercent ? form.maxDiscount : ""}|${form.minOrderAmount}`;
  useEffect(() => {
    if (!(Number(form.discountValue) > 0)) { setCost(null); return undefined; }
    let live = true;
    setCostLoading(true);
    const id = setTimeout(() => {
      checkOffer({
        discountType: form.discountType, discountValue: Number(form.discountValue),
        maxDiscount: isPercent && form.maxDiscount !== "" ? Number(form.maxDiscount) : null,
        minOrderAmount: Number(form.minOrderAmount) || 0,
      })
        .then(({ data }) => { if (live) setCost(data); })
        .catch(() => { if (live) setCost(null); })
        .finally(() => { if (live) setCostLoading(false); });
    }, 400);
    return () => { live = false; clearTimeout(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `terms` captures every input of the check
  }, [terms]);

  const today = new Date(now);
  const pushes = form.audience !== "GUEST" && (form.notify || alreadySent);
  const subs = stats?.reach?.subscribers ?? 0;
  const rush = stats?.rush;
  const rushLabel = rush ? (() => {
    const a = new Date(); a.setHours(rush.hour, 0, 0, 0);
    const b = new Date(a); b.setHours(rush.hour + 1);
    return `${fmtTime(a, { hour: "numeric" })}–${fmtTime(b, { hour: "numeric" })}`;
  })() : "";

  return (
    <div className="ofr-comp" ref={composerRef}>
      <div className="zc-card">
        <div className="zc-card-h" style={{ flexWrap: "wrap", rowGap: 6 }}>
          <span className="t">{editing ? t("Edit offer · {code}", { code: editing.code }) : t("New offer")}{!editing && form.title.trim() ? ` · ${form.title.trim()}` : ""}</span>
          <div style={{ flex: 1 }} />
          {editing && <button type="button" className="zc-btn ghost sm" onClick={onCancelEdit}>{t("Cancel editing")}</button>}
        </div>
        <div className="ofr-body">
          {/* 1 — who */}
          <div className="ofr-step">
            <span className="sn">1</span>
            <div>
              <b className="st">{t("Who can use it")}</b>
              <div className="ofr-opts" role="radiogroup" aria-label={t("Who can use this offer")}>
                {Object.entries(AUDIENCE).map(([key, a]) => (
                  <button key={key} type="button" role="radio" aria-checked={form.audience === key} aria-pressed={form.audience === key} onClick={() => setAudience(key)}>
                    {t(a.label)}<small>{t(a.hint)}</small>
                  </button>
                ))}
              </div>
              {form.audience !== "GUEST" ? (
                <div className="ofr-opts" style={{ marginTop: 6 }}>
                  <button type="button" aria-pressed={alreadySent || form.notify} disabled={alreadySent} onClick={() => setForm((f) => ({ ...f, notify: !f.notify }))}>
                    {(alreadySent || form.notify) ? "✓ " : ""}{t("Also send a phone notification")} · {tn(subs, "{n} customer", "{n} customers")}
                    <small>{alreadySent
                      ? t("Already sent — it can't be recalled or sent twice.")
                      : t("Goes out at the start time to registered customers who turned on offer notifications, with an “Apply in cart” button.")}</small>
                  </button>
                </div>
              ) : <div className="ofr-hint" style={{ marginTop: 6 }}>{t("Guests can't get phone notifications — they see it in the cart's coupon list.")}</div>}
            </div>
          </div>

          {/* 2 — what */}
          <div className="ofr-step">
            <span className="sn">2</span>
            <div style={{ minWidth: 0 }}>
              <b className="st">{t("What they get")}</b>
              <label className="ofr-l" htmlFor="of-title">{t("Headline")}</label>
              <input id="of-title" className="zc-input" placeholder={t("e.g. Puja offer")} value={form.title} maxLength={TITLE_MAX} onChange={set("title")} />
              <label className="ofr-l" htmlFor="of-desc">{t("Message")} <span className="ofr-opt">({t("optional")})</span></label>
              <textarea id="of-desc" className="zc-textarea" rows={2} placeholder={t("e.g. Celebrate Puja with us!")} value={form.description} maxLength={DESC_MAX} onChange={set("description")} />
              <div className="ofr-count">{fmtNum(form.description.length)}/{fmtNum(DESC_MAX)}</div>
              <div className="ofr-row3">
                <div>
                  <label className="ofr-l" htmlFor="of-type">{t("Offer")}</label>
                  <div className="ofr-inline">
                    <select id="of-type" className="zc-select" value={form.discountType} onChange={set("discountType")} aria-label={t("Discount type")}>
                      <option value="PERCENT">%</option>
                      <option value="FLAT">₹</option>
                    </select>
                    <input type="number" inputMode="numeric" min={1} max={isPercent ? 100 : undefined} className="zc-input" placeholder={isPercent ? t("e.g. 20") : t("e.g. 50")}
                      value={form.discountValue} aria-invalid={!!errors.value} aria-label={isPercent ? t("Discount %") : t("Discount ₹")} onChange={set("discountValue")} />
                  </div>
                  {errors.value && <div className="ofr-err">{errors.value}</div>}
                </div>
                <div>
                  <label className="ofr-l" htmlFor="of-min">{t("Minimum bill ₹")} <span className="ofr-opt">({t("optional")})</span></label>
                  <input id="of-min" type="number" inputMode="numeric" min={0} className="zc-input" placeholder={t("No minimum")} value={form.minOrderAmount} onChange={set("minOrderAmount")} />
                  <div className="ofr-hint">{t("On the item total, before GST.")}</div>
                </div>
                {isPercent ? (
                  <div>
                    <label className="ofr-l" htmlFor="of-max">{t("Max discount ₹")} <span className="ofr-opt">({t("optional")})</span></label>
                    <input id="of-max" type="number" inputMode="numeric" min={1} className="zc-input" placeholder={t("No limit")} value={form.maxDiscount} onChange={set("maxDiscount")} />
                  </div>
                ) : <div />}
              </div>
              <label className="ofr-l" htmlFor="of-code">{t("Code · type your own or pick a suggestion")}</label>
              <input id="of-code" className="zc-input ofr-code" placeholder={t("e.g. PUJA20")} value={form.code} maxLength={20} autoComplete="off" spellCheck={false}
                aria-invalid={!!errors.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/\s/g, "") }))} />
              {codes.length > 0 && (
                <div className="ofr-opts" style={{ marginTop: 6 }}>
                  {codes.map((c) => <button key={c} type="button" className="mono" aria-pressed={false} onClick={() => setForm((f) => ({ ...f, code: c }))}>{c}</button>)}
                </div>
              )}
              <div className={errors.code ? "ofr-err" : "ofr-hint"}>{errors.code || t("3–20 letters or numbers · customers type or tap it in the cart · shown on the invoice")}</div>
            </div>
          </div>

          {/* 3 — when */}
          <div className="ofr-step">
            <span className="sn">3</span>
            <div style={{ minWidth: 0 }}>
              <b className="st">{t("When")}</b>
              <div className="ofr-opts">
                <button type="button" aria-pressed={form.startMode === "now"} onClick={() => setForm((f) => ({ ...f, startMode: "now" }))}>
                  {t("Start now")}<small>{pushes ? t("the notification goes out right away") : t("customers can use it right away")}</small>
                </button>
                {bestAt && (
                  <button type="button" aria-pressed={form.startMode === "best"} onClick={() => setForm((f) => ({ ...f, startMode: "best" }))}>
                    ★ {t("Best time: {when}", { when: fmtWhen(new Date(bestAt)) })}
                    <small>{t("2 hours before your busiest hour ({hours}, {pct}% of bills in the last 4 weeks)", { hours: rushLabel, pct: fmtNum(rush.share, { maximumFractionDigits: 0 }) })}</small>
                  </button>
                )}
                <button type="button" aria-pressed={form.startMode === "custom"} onClick={() => setForm((f) => ({ ...f, startMode: "custom", startAt: f.startAt || `${toDateInput(today)}T00:00` }))}>
                  {t("Pick a date and time")}<small>{form.startMode === "custom" && start ? fmtWhen(start) : t("e.g. the first day of a festival")}</small>
                </button>
              </div>
              {form.startMode === "custom" && (
                <input type="datetime-local" className="zc-input ofr-dt" value={form.startAt} aria-label={t("Start")} onChange={set("startAt")} />
              )}
              <label className="ofr-l" htmlFor="of-end">{t("Ends")}</label>
              <div className="ofr-opts">
                {END_PICKS.map(([d, label]) => {
                  const v = toDateInput(addDays(start || today, d));
                  return <button key={d} type="button" aria-pressed={form.end === v} onClick={() => setForm((f) => ({ ...f, end: v }))}>{t(label)}<small>{fmtDay(endOfDay(v))}</small></button>;
                })}
                <input id="of-end" type="date" className="zc-input ofr-date" value={form.end} min={start ? toDateInput(start) : undefined} aria-invalid={!!errors.dates} aria-label={t("End date")} onChange={set("end")} />
              </div>
              <div className={errors.dates ? "ofr-err" : "ofr-hint"}>{errors.dates || t("Works until 11:59 PM on the end date.")}</div>
              {editing && (
                <label className="ofr-check-row">
                  <input type="checkbox" checked={form.isActive} onChange={set("isActive")} /> {t("Active (untick to pause)")}
                </label>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="ofr-side">
        <div className="zc-card">
          <div className="zc-card-h"><span className="t">{t("Preview")}</span><span className="s">{t("what customers see")}</span></div>
          <div className="ofr-body">
            <div className="ofr-phone">
              {pushes && (
                <>
                  <div className="ofr-ph-k">{t("Phone notification")} · {start && start.getTime() > now + 60000 ? fmtWhen(start) : t("now")}</div>
                  <div className="ofr-push">
                    <b>{form.title.trim() || t("Headline")}</b>
                    <div>{pushBodyPreview(form)}</div>
                  </div>
                </>
              )}
              <div className="ofr-ph-k">{t("Cart · coupon list")}</div>
              <div className="ofr-cpn">
                <div className="code">{form.code || "CODE"}</div>
                <div style={{ minWidth: 0 }}>
                  <b>{form.title.trim() || t("Headline")}</b>
                  <div>{form.discountValue ? describeDiscount({ ...form, discountValue: Number(form.discountValue), maxDiscount: Number(form.maxDiscount) || null }) : "—"}{Number(form.minOrderAmount) > 0 ? ` · ${t("min ₹{min}", { min: fmtNum(Number(form.minOrderAmount)) })}` : ""}</div>
                  {form.end && <small>{t("Valid till {date}", { date: fmtDay(endOfDay(form.end)) })}</small>}
                </div>
              </div>
              <div className="ofr-ph-foot">{form.audience === "REGISTERED" ? t("Guests see “Log in to use this coupon”.") : form.audience === "GUEST" ? t("Logged-in customers don't see it.") : t("Every customer sees it in the cart while it's running.")}</div>
            </div>
          </div>
        </div>
        <CostCheck form={form} res={cost} loading={costLoading} />
        <button type="button" className="zc-btn pri block" disabled={!canReview} onClick={() => setReview(true)}>
          {editing ? t("Review & save") : t("Review & start")}
        </button>
        {!canReview && !saving && (
          <div className="ofr-hint" style={{ textAlign: "center" }}>{t("Fill in the headline, discount, code and end date to continue.")}</div>
        )}
      </div>

      {review && start && (
        <ReviewModal
          form={form} start={start} now={now} stats={stats} editing={editing} saving={saving} cost={cost}
          onCancel={() => setReview(false)}
          onConfirm={async () => { const ok = await onSave(start); if (ok) setReview(false); }}
        />
      )}
    </div>
  );
}

