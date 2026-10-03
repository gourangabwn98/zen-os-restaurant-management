// src/pages/admin/CouponsPage.jsx — Admin → Offers
// ─────────────────────────────────────────────────────────────────────────────
// Layout follows the Offers hub reference: reach strip → ideas for this week
// → composer (who / what / when + preview, cost check, review) → "Did it
// work?" results. Look and components are the app's own (PageHeader,
// zc-card, zc-seg, zc-btn, zc-tag, zc-ledger, zc-modal).
//
// An offer IS a coupon (services/couponService.js), so nothing here is a
// second offer system:
//   GET/POST/PUT/DELETE /coupons/admin   the existing coupon API — the server
//     validates every field, computes every discount at order time, and
//     (couponOfferService.js) sends the push at the coupon's start time.
//   GET  /coupons/admin/stats            read-only reach / results / signals
//   POST /coupons/admin/check            cost check of a draft (saves nothing)
//   POST /notifications/admin/:id/cancel cancel a scheduled plain message
// Plain messages without a coupon are still sent from Notifications.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { getAllCoupons, createCoupon, updateCoupon, deleteCoupon, getOfferStats } from "../../services/couponService.js";
import { cancelScheduledOffer } from "../../services/notificationService.js";
import { PageHeader, Loader } from "./shared/index.js";
import ErrorState from "./shared/ErrorState.jsx";
import { t, tn, fmtNum, fmtDate } from "../../i18n/core.js";
import { EMPTY_FORM, formFromCoupon, payloadOf, money, stateOf, fmtDay, fmtWhen, buildIdeas } from "./offers/model.js";
import Composer from "./offers/Composer.jsx";
import Results from "./offers/Results.jsx";
import Ideas from "./offers/Ideas.jsx";
import "./offers/offers.css";

export default function CouponsPage() {
  const [coupons, setCoupons] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(false);
  const [statsError, setStatsError] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const composerRef = useRef(null);

  const load = useCallback(() => {
    setError(false); setStatsError(false);
    getAllCoupons()
      .then(({ data }) => setCoupons(data.coupons || []))
      .catch(() => setError(true));
    getOfferStats()
      .then(({ data }) => setStats(data))
      .catch(() => setStatsError(true));
    setNow(Date.now());
  }, []);
  useEffect(() => { load(); }, [load]);
  // Keep Live / Upcoming / Expired current while the page stays open; refresh
  // the figures when a scheduled push is due to flip to Sent.
  const pending = (coupons || []).some((c) => c.notification?.status === "SCHEDULED") || (stats?.pushes || []).some((p) => p.status === "SCHEDULED");
  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); if (pending) load(); }, 60 * 1000);
    return () => clearInterval(id);
  }, [pending, load]);

  const editing = editingId ? (coupons || []).find((c) => c._id === editingId) || null : null;
  const scrollToComposer = () => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const reset = () => { setForm(EMPTY_FORM); setEditingId(null); };
  const newOffer = (patch = {}) => { setEditingId(null); setForm({ ...EMPTY_FORM, ...patch }); scrollToComposer(); };
  const startEdit = (c, patch = {}) => { setEditingId(c._id); setForm({ ...formFromCoupon(c), ...patch }); scrollToComposer(); };

  /** Review → the existing create/update API. Returns true on success. */
  const save = async (start) => {
    setSaving(true);
    try {
      const payload = payloadOf(form, start);
      const { data } = editing ? await updateCoupon(editing._id, payload) : await createCoupon(payload);
      const n = data?.coupon?.notification;
      const sentBefore = ["SENT", "SENDING"].includes(editing?.notification?.status);
      toast.success(
        (editing ? t("Offer updated") : t("Offer created"))
        + (n?.status === "SCHEDULED" ? ` — ${t("notification will be sent {when}", { when: fmtWhen(new Date(n.startsAt)) })}` : n?.status === "SENT" && !sentBefore ? ` — ${t("notification sent")}` : ""),
      );
      if (data?.warning) toast(data.warning, { icon: "⚠️", duration: 6000 });
      reset();
      load();
      return true;
    } catch (err) {
      toast.error(err?.response?.data?.message || t("Couldn't save the offer"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const togglePause = async (c) => {
    try {
      await updateCoupon(c._id, { isActive: !c.isActive });
      toast.success(c.isActive ? t("{code} paused", { code: c.code }) : t("{code} resumed", { code: c.code }));
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || t("Couldn't update the offer"));
    }
  };

  const remove = async (c) => {
    if (!window.confirm(t("Delete offer {code}? Orders already placed with it keep their discount.", { code: c.code }))) return;
    try {
      await deleteCoupon(c._id);
      toast.success(t("Offer deleted"));
      if (editingId === c._id) reset();
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || t("Couldn't delete the offer"));
    }
  };

  const cancelPush = async (p) => {
    if (!window.confirm(t("Cancel \"{title}\"? It won't be sent.", { title: p.title }))) return;
    try { await cancelScheduledOffer(p._id); toast.success(t("Scheduled notification cancelled")); }
    catch (err) { toast.error(err?.response?.data?.message || t("Couldn't cancel")); }
    finally { load(); }
  };

  const ideas = useMemo(() => buildIdeas({ stats, coupons: coupons || [], now }), [stats, coupons, now]);
  const useIdea = (a) => (a.kind === "edit" ? startEdit(a.coupon, a.patch) : newOffer(a.patch));

  const header = (
    <PageHeader
      title={t("Offers")}
      sub={t("Reach your customers, and see what each offer really earned")}
      right={<button type="button" className="zc-btn pri" onClick={() => newOffer()}>+ {t("New offer")}</button>}
    />
  );

  if (error) {
    return <div className="ofr">{header}<div className="zc-card"><ErrorState title={t("Couldn't load offers")} onRetry={load} /></div></div>;
  }
  if (coupons === null) {
    return <div className="ofr">{header}<div className="zc-card" style={{ padding: 20 }}><Loader rows={6} /></div></div>;
  }

  const live = coupons.filter((c) => stateOf(c, now).key === "live");
  const upcoming = coupons.filter((c) => stateOf(c, now).key === "upcoming");
  const nextEnd = live.map((c) => new Date(c.endsAt)).sort((a, b) => a - b)[0];
  const r = stats?.reach;
  const monthName = stats ? fmtDate(new Date(stats.month.from), { month: "short" }) : "";

  return (
    <div className="ofr">
      {header}

      {statsError && (
        <div className="zc-card"><ErrorState title={t("Couldn't load offer results")} sub={t("Your offers are below; reach and results will show once the server responds.")} onRetry={load} /></div>
      )}

      <div className="zc-card ofr-strip" aria-busy={!stats && !statsError}>
        <div>
          <div className="k">{t("Get your notifications")}</div>
          <div className="v tnum">{r ? fmtNum(r.subscribers) : "…"} {r && <span className="ofr-of">{t("of {n} registered customers", { n: fmtNum(r.customers) })}</span>}</div>
          {r && r.customers > 0 && <div className="ofr-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (r.subscribers / r.customers) * 100)}%` }} /></div>}
          <div className="d">{t("Guests can't get notifications · every diner sees live offers in the cart")}</div>
        </div>
        <div>
          <div className="k">{t("Earned from offers · {month}", { month: monthName })}</div>
          <div className="v tnum" style={stats?.month.earned ? { color: "var(--ready-ink)" } : undefined}>{stats ? money(stats.month.earned) : "…"}</div>
          <div className="d">{stats ? tn(stats.month.bills, "{n} paid bill used a code", "{n} paid bills used a code") : ""}</div>
        </div>
        <div>
          <div className="k">{t("Discount given · {month}", { month: monthName })}</div>
          <div className="v tnum">{stats ? money(stats.month.discount) : "…"}</div>
          <div className="d">{t("shown on each bill in Invoices too")}</div>
        </div>
        <div>
          <div className="k">{t("Running now")}</div>
          <div className="v tnum">{fmtNum(live.length)} <span className="ofr-of">{t("live")} · {fmtNum(upcoming.length)} {t("scheduled")}</span></div>
          <div className="d">{nextEnd ? t("next one ends {date}", { date: fmtDay(nextEnd) }) : t("no offer is live right now")}</div>
        </div>
      </div>

      {stats && <Ideas ideas={ideas} onUse={useIdea} />}

      <Composer
        form={form} setForm={setForm} editing={editing} coupons={coupons} stats={stats} saving={saving} now={now}
        onSave={save} onCancelEdit={reset} composerRef={composerRef}
      />

      <Results coupons={coupons} stats={stats} now={now} onEdit={(c) => startEdit(c)} onPause={togglePause} onDelete={remove} onCancelPush={cancelPush} />
    </div>
  );
}
