// Partners — every rider (User role "delivery"): online, load vs capacity,
// last seen, cash held; per-rider capacity, suspend / reinstate, force offline.
// Registering / deactivating the account itself stays in Employees.
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { getDeliveryPartners, updateDeliveryPartner, forcePartnerOffline, getCodCollections, errMsg } from "../../../services/deliveryAdminService.js";
import { EmptyState, Loader } from "../shared";
import { t } from "../../../i18n/core.js";
import { JOB_STATUS, ago, rupees } from "./shared.js";
import Tag from "./DeliveryTag.jsx";

function CapacityEditor({ p, onSaved }) {
  const [v, setV] = useState(p.capacityOverride ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await updateDeliveryPartner(p.id, { capacity: v === "" ? null : Number(v) }); toast.success(t("Capacity saved")); onSaved(); }
    catch (err) { toast.error(errMsg(err, t("Couldn't save"))); }
    finally { setBusy(false); }
  };
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <select className="zc-select" value={v} onChange={(e) => setV(e.target.value)} aria-label={t("Maximum active orders for {name}", { name: p.name })} style={{ width: 120 }}>
        <option value="">{t("Restaurant default")}</option>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      {String(v) !== String(p.capacityOverride ?? "") && <button type="button" className="zc-btn sm pri" disabled={busy} onClick={save}>{t("Save")}</button>}
    </span>
  );
}

export default function PartnersTab({ rev, onNavigate }) {
  const [partners, setPartners] = useState(null);
  const [cash, setCash] = useState({});
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    Promise.all([getDeliveryPartners(), getCodCollections({ limit: 1 })])
      .then(([p, c]) => {
        setPartners(p.data.partners);
        setCash(Object.fromEntries((c.data.cashWithRiders || []).map((x) => [x.partnerId, x.amount])));
        setError(false);
      })
      .catch(() => setError(true));
  }, []);
  useEffect(() => { load(); }, [load, rev]);

  const act = async (fn, ok) => { try { await fn(); toast.success(ok); load(); } catch (err) { toast.error(errMsg(err, t("That didn't work"))); } };

  if (error) return <div className="zc-card"><EmptyState title={t("Couldn't load partners")} action={<button type="button" className="zc-btn" onClick={load}>{t("Retry")}</button>} /></div>;
  if (!partners) return <div className="zc-card" style={{ padding: 20 }}><Loader rows={4} /></div>;
  if (!partners.length) {
    return (
      <div className="zc-card">
        <EmptyState title={t("No delivery partners yet")} sub={t("Add riders in Employees: Add employee → Category: Delivery partner. They log in to the Zen OS Delivery app with that phone number.")}
          action={<button type="button" className="zc-btn pri" onClick={() => onNavigate?.("employees")}>{t("Go to Employees")}</button>} />
      </div>
    );
  }

  return (
    <div className="zc-card">
      <div className="zc-card-h"><div><div className="t">{t("Delivery partners")}</div><div className="s">{t("{n} online now", { n: partners.filter((p) => p.online).length })}</div></div></div>
      <div className="zc-card-b" style={{ display: "grid", gap: 4 }}>
        {partners.map((p) => (
          <div key={p.id} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", padding: "11px 0", borderBottom: "1px solid var(--edge)" }}>
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <b>{p.name}</b>
                {p.accountStatus === "Inactive" ? <span className="zc-tag done">{t("Deactivated")}</span>
                  : p.suspended ? <span className="zc-tag stop">{t("Suspended")}</span>
                  : p.online ? <span className="zc-tag ready"><i />{t("Online")}</span> : <span className="zc-tag done">{t("Offline")}</span>}
                {p.online && p.minutesSinceSeen != null && p.minutesSinceSeen >= 5 && <span className="zc-tag wait">{t("No signal {n} min", { n: p.minutesSinceSeen })}</span>}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 3 }}>
                {p.phone} · {t("last seen {when}", { when: ago(p.lastSeenAt) })}
                {p.suspended && p.suspendedReason ? ` · ${p.suspendedReason}` : ""}
                {cash[p.id] ? ` · ${t("holding {amt} cash", { amt: rupees(cash[p.id]) })}` : ""}
              </div>
              {p.activeJobs.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {p.activeJobs.map((j) => <span key={j.jobId} style={{ fontSize: 12 }}>{j.orderNo} <Tag map={JOB_STATUS} value={j.status} /></span>)}
                </div>
              )}
            </div>
            <div style={{ fontSize: 13, minWidth: 90 }}><b>{p.activeCount}</b> / {p.capacity} <span style={{ color: "var(--text-3)" }}>{t("active")}</span></div>
            <CapacityEditor p={p} onSaved={load} />
            <div style={{ display: "flex", gap: 6 }}>
              {p.online && p.activeCount === 0 && <button type="button" className="zc-btn sm" onClick={() => act(() => forcePartnerOffline(p.id), t("{name} is offline", { name: p.name }))}>{t("Set offline")}</button>}
              {p.suspended
                ? <button type="button" className="zc-btn sm good" onClick={() => act(() => updateDeliveryPartner(p.id, { suspended: false }), t("{name} reinstated", { name: p.name }))}>{t("Reinstate")}</button>
                : <button type="button" className="zc-btn sm danger" onClick={() => {
                    const reason = window.prompt(t("Suspend {name}? They go offline and get no new orders (current deliveries stay). Reason:", { name: p.name }));
                    if (reason && reason.trim()) act(() => updateDeliveryPartner(p.id, { suspended: true, reason: reason.trim() }), t("{name} suspended", { name: p.name }));
                  }}>{t("Suspend")}</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
