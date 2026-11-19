// Settings (admin only — PATCH /api/delivery/admin/settings is requireAdmin):
// delivery payment methods (COD default), rider capacity and broadcast rules.
// Shows exactly what customers will see at checkout right now.
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { getDeliverySettings, updateDeliverySettings, errMsg } from "../../../services/deliveryAdminService.js";
import { Loader, EmptyState } from "../shared";
import { t, N_ } from "../../../i18n/core.js";

const NUMBERS = [
  { key: "defaultCapacity", label: N_("Active orders per rider (default)"), min: 1, max: 10, hint: N_("A rider can hold this many deliveries at once. Override per rider in Partners.") },
  { key: "offerTtlSeconds", label: N_("Seconds riders get to accept"), min: 15, max: 300, hint: N_("After this, the request goes out again.") },
  { key: "maxRounds", label: N_("Broadcast rounds before escalating"), min: 1, max: 20, hint: N_("Then it shows as Escalated on the Board for you to assign.") },
  { key: "presenceTimeoutMinutes", label: N_("Idle rider goes offline after (min)"), min: 2, max: 240, hint: N_("Only riders with no active delivery and no signal.") },
  { key: "maxOtpAttempts", label: N_("Wrong hand-over codes allowed"), min: 3, max: 10, hint: N_("Then the code locks until you reset it.") },
  { key: "trackingTtlHours", label: N_("Tracking link stays open after delivery (h)"), min: 0, max: 48, hint: "" },
];

const Toggle = ({ checked, onChange, label, sub, disabled }) => (
  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1 }}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18 }} />
    <span><b>{label}</b>{sub && <div style={{ fontSize: 12, color: "var(--text-3)" }}>{sub}</div>}</span>
  </label>
);

export default function SettingsTab() {
  const [s, setS] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const load = () => getDeliverySettings().then((r) => { setS(r.data); setDraft(r.data); setError(false); }).catch(() => setError(true));
  useEffect(() => { load(); }, []);

  if (error) return <div className="zc-card"><EmptyState title={t("Couldn't load delivery settings")} action={<button type="button" className="zc-btn" onClick={load}>{t("Retry")}</button>} /></div>;
  if (!draft) return <div className="zc-card" style={{ padding: 20 }}><Loader rows={5} /></div>;

  const setPay = (k, v) => setDraft((d) => ({ ...d, payment: { ...d.payment, [k]: v } }));
  const changed = JSON.stringify(draft) !== JSON.stringify(s);
  const noneEnabled = !draft.payment.codEnabled && !(draft.payment.onlineEnabled && s.phonePeConfigured);

  const save = async () => {
    if (noneEnabled && !window.confirm(t("No payment method will be available, so customers can't order home delivery. Save anyway?"))) return;
    setSaving(true);
    try {
      const body = { payment: draft.payment };
      for (const n of NUMBERS) if (draft[n.key] !== s[n.key]) body[n.key] = Number(draft[n.key]);
      const r = await updateDeliverySettings(body);
      setS(r.data); setDraft(r.data);
      toast.success(t("Delivery settings saved"));
    } catch (err) { toast.error(errMsg(err, t("Couldn't save"))); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 760 }}>
      {(!s.deliveryServiceOn || !s.restaurantLocationSet) && (
        <div className="zc-card"><div className="zc-card-b" style={{ display: "grid", gap: 6 }}>
          {!s.deliveryServiceOn && <div className="zc-tag wait">{t("Home delivery is switched off for customers — turn on “Delivery” in Profile → Services.")}</div>}
          {!s.restaurantLocationSet && <div className="zc-tag wait">{t("Set the restaurant's location in Profile — delivery range and maps need it.")}</div>}
        </div></div>
      )}

      <div className="zc-card">
        <div className="zc-card-h"><div><div className="t">{t("Delivery payment methods")}</div><div className="s">{t("Only for home delivery — dine-in and takeaway keep their own payment settings")}</div></div></div>
        <div className="zc-card-b">
          <Toggle checked={draft.payment.codEnabled} onChange={(v) => setPay("codEnabled", v)} label={t("Cash on Delivery (COD)")}
            sub={t("The rider collects cash at the door and records it at hand-over. You verify the hand-in under Cash (COD).")} />
          <Toggle checked={draft.payment.onlineEnabled} onChange={(v) => setPay("onlineEnabled", v)} label={t("Pay online (PhonePe)")}
            sub={s.phonePeConfigured ? t("Customers pay before the order reaches the kitchen.") : t("PhonePe isn't configured on the server, so this won't appear to customers even if switched on.")} />
          <label style={{ display: "grid", gap: 4, marginTop: 8, fontSize: 12.5 }}>{t("Default method")}
            <select className="zc-select" value={draft.payment.defaultMethod} onChange={(e) => setPay("defaultMethod", e.target.value)} style={{ maxWidth: 260 }}>
              <option value="COD">{t("Cash on Delivery")}</option>
              <option value="ONLINE">{t("Pay online")}</option>
            </select>
          </label>
          <div style={{ marginTop: 12, fontSize: 12.5, color: noneEnabled ? "var(--stop-ink)" : "var(--text-2)" }}>
            {noneEnabled ? t("Customers will see: home delivery unavailable (no payment method).")
              : t("Customers will see: {m}", { m: [draft.payment.codEnabled && t("Cash on Delivery"), draft.payment.onlineEnabled && s.phonePeConfigured && t("Pay online")].filter(Boolean).join(" · ") })}
          </div>
        </div>
      </div>

      <div className="zc-card">
        <div className="zc-card-h"><div><div className="t">{t("Riders and broadcasting")}</div><div className="s">{t("Delivery range: {km} km (Profile)", { km: s.deliveryRange != null ? (s.deliveryRange / 1000).toFixed(1) : "—" })}</div></div></div>
        <div className="zc-card-b" style={{ display: "grid", gap: 12 }}>
          {NUMBERS.map((n) => (
            <label key={n.key} style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
              <span><b>{t(n.label)}</b> <span style={{ color: "var(--text-3)" }}>({n.min}–{n.max})</span></span>
              <input className="zc-input" type="number" min={n.min} max={n.max} step={1} value={draft[n.key]} style={{ maxWidth: 160 }}
                onChange={(e) => setDraft((d) => ({ ...d, [n.key]: e.target.value === "" ? "" : Number(e.target.value) }))} />
              {n.hint && <span style={{ color: "var(--text-3)", fontSize: 11.5 }}>{t(n.hint)}</span>}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="zc-btn pri" disabled={!changed || saving} onClick={save}>{saving ? t("Saving…") : t("Save settings")}</button>
        {changed && <button type="button" className="zc-btn" onClick={() => setDraft(s)}>{t("Discard")}</button>}
      </div>
    </div>
  );
}
