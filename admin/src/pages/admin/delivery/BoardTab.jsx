// Board — today's numbers, every delivery, and the admin's exception tools:
// assign / reassign (before pickup), re-broadcast, cancel the delivery,
// reset the hand-over code, revoke the customer's tracking link, history.
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  getDeliveryOverview, getDeliveryJobs, getDeliveryPartners, getDeliveryJobEvents, assignDeliveryJob, unassignDeliveryJob,
  rebroadcastDeliveryJob, cancelDeliveryJob, resetDeliveryOtp, revokeDeliveryTracking, errMsg,
} from "../../../services/deliveryAdminService.js";
import { EmptyState, Loader } from "../shared";
import { t, N_ } from "../../../i18n/core.js";
import { JOB_STATUS, ACTIVE, UNASSIGNABLE, km, clock, dayTime } from "./shared.js";
import Tag from "./DeliveryTag.jsx";

const FILTERS = [
  { key: "attention", label: N_("Needs attention") },
  { key: "ACTIVE", label: N_("In progress") },
  { key: "DELIVERED", label: N_("Delivered") },
  { key: "FAILED", label: N_("Failed") },
  { key: "", label: N_("All") },
];

const Metric = ({ k, v, tone, d }) => (
  <div className="zc-metric sm">
    <div className="k">{k}</div>
    <div className={`v${tone ? ` ${tone}` : ""}`}>{v}</div>
    {d && <div className="d">{d}</div>}
  </div>
);

function AssignDialog({ job, onClose, onDone }) {
  const [partners, setPartners] = useState(null);
  const [busy, setBusy] = useState("");
  useEffect(() => { getDeliveryPartners().then((r) => setPartners(r.data.partners)).catch(() => setPartners([])); }, []);
  const pick = async (p) => {
    setBusy(p.id);
    try { await assignDeliveryJob(job.jobId, p.id); toast.success(t("Assigned to {name}", { name: p.name })); onDone(); }
    catch (err) { toast.error(errMsg(err, t("Couldn't assign"))); setBusy(""); }
  };
  return (
    <div className="zc-scrim" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", background: "var(--scrim)" }}>
      <div className="zc-modal zc-card" role="dialog" aria-label={t("Assign a partner")} onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 94vw)", maxHeight: "80vh", overflow: "auto" }}>
        <div className="zc-card-h"><div><div className="t">{t("Assign {order}", { order: job.orderNo })}</div><div className="s">{t("Manual assignment is the exception — normally riders accept from the broadcast.")}</div></div></div>
        <div className="zc-card-b">
          {partners === null ? <Loader rows={3} /> : partners.length === 0 ? <EmptyState title={t("No delivery partners yet")} sub={t("Add one in Employees → Delivery partner.")} /> : partners.map((p) => {
            const full = p.activeCount >= p.capacity;
            const blocked = p.suspended || p.accountStatus === "Inactive";
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--edge)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{p.name} {p.online ? <span className="zc-tag ready">{t("Online")}</span> : <span className="zc-tag done">{t("Offline")}</span>}</div>
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>{t("{a} of {c} active", { a: p.activeCount, c: p.capacity })}{p.suspended ? ` · ${t("Suspended")}` : ""}</div>
                </div>
                <button type="button" className="zc-btn sm pri" disabled={full || blocked || !!busy} onClick={() => pick(p)}>
                  {busy === p.id ? "…" : full ? t("Full") : t("Assign")}
                </button>
              </div>
            );
          })}
        </div>
        <div className="zc-card-b" style={{ textAlign: "right" }}><button type="button" className="zc-btn" onClick={onClose}>{t("Close")}</button></div>
      </div>
    </div>
  );
}

function History({ jobId }) {
  const [events, setEvents] = useState(null);
  useEffect(() => { getDeliveryJobEvents(jobId).then((r) => setEvents(r.data.events)).catch(() => setEvents([])); }, [jobId]);
  if (!events) return <Loader rows={2} />;
  if (!events.length) return <div style={{ color: "var(--text-3)", fontSize: 12 }}>{t("No history yet")}</div>;
  return (
    <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--text-2)" }}>
      {events.map((e) => (
        <li key={e._id}>{dayTime(e.at)} · <b>{e.type.replace(/_/g, " ").toLowerCase()}</b>{e.actor?.name ? ` · ${e.actor.name}` : ""}
          {e.data?.reason ? ` — ${e.data.reason}` : ""}{e.data?.round ? ` (round ${e.data.round})` : ""}{e.data?.offered != null ? ` · ${t("{n} riders notified", { n: e.data.offered })}` : ""}
        </li>
      ))}
    </ol>
  );
}

export default function BoardTab({ rev }) {
  const [overview, setOverview] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [filter, setFilter] = useState("attention");
  const [assigning, setAssigning] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    const params = filter === "attention" ? { status: "ACTIVE" } : filter ? { status: filter } : {};
    Promise.all([getDeliveryOverview(), getDeliveryJobs(params)])
      .then(([o, j]) => {
        setOverview(o.data);
        const list = j.data.jobs;
        setJobs(filter === "attention" ? list.filter((x) => x.escalated || x.status === "SEARCHING") : list);
        setError(false);
      })
      .catch(() => setError(true));
  }, [filter]);
  useEffect(() => { load(); }, [load, rev]);

  const act = async (fn, ok) => {
    try { await fn(); toast.success(ok); load(); } catch (err) { toast.error(errMsg(err, t("That didn't work"))); }
  };
  const ask = (q) => { const r = window.prompt(q); return r === null ? null : r.trim(); };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <Metric k={t("Looking for a partner")} v={overview?.searching ?? "—"} tone={overview?.searching ? "alert" : ""} />
        <Metric k={t("Escalated (nobody accepted)")} v={overview?.escalated ?? "—"} tone={overview?.escalated ? "alert" : ""} />
        <Metric k={t("Out for delivery")} v={overview?.active ?? "—"} />
        <Metric k={t("Partners online")} v={overview?.onlinePartners ?? "—"} tone="pos" />
        <Metric k={t("Delivered today")} v={overview?.deliveredToday ?? "—"} tone="gr" />
        <Metric k={t("Failed today")} v={overview?.failedToday ?? "—"} tone={overview?.failedToday ? "alert" : ""} />
      </div>

      <div className="zc-card">
        <div className="zc-card-h" style={{ flexWrap: "wrap", gap: 10 }}>
          <div><div className="t">{t("Deliveries")}</div><div className="s">{t("Updates live as riders accept and move")}</div></div>
          <div className="zc-seg" style={{ flexWrap: "wrap" }}>
            {FILTERS.map((f) => <button key={f.key} type="button" className={filter === f.key ? "on" : ""} onClick={() => { setFilter(f.key); setJobs(null); }}>{t(f.label)}</button>)}
          </div>
        </div>
        <div className="zc-card-b">
          {error && <EmptyState title={t("Couldn't load deliveries")} action={<button type="button" className="zc-btn" onClick={load}>{t("Retry")}</button>} />}
          {!error && jobs === null && <Loader rows={4} />}
          {!error && jobs?.length === 0 && <EmptyState title={filter === "attention" ? t("Nothing needs you right now") : t("No deliveries here")} sub={filter === "attention" ? t("Orders waiting for a rider, or that nobody accepted, show here.") : undefined} />}
          {!error && jobs?.map((j) => (
            <div key={j.jobId} style={{ borderBottom: "1px solid var(--edge)", padding: "12px 0" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <b>{j.orderNo}</b> <Tag map={JOB_STATUS} value={j.status} />
                    {j.escalated && <span className="zc-tag stop">{t("Escalated")}</span>}
                    {j.status === "SEARCHING" && !j.escalated && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{t("round {n}", { n: j.round })} · {t("closes {time}", { time: clock(j.offerExpiresAt) })}</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 3 }}>
                    {j.drop?.address}{j.drop?.landmark ? ` · ${j.drop.landmark}` : ""} · {km(j.distanceMeters)}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                    {j.partnerName ? t("Rider: {name}", { name: j.partnerName }) : t("No rider yet")} · {t("placed {time}", { time: clock(j.createdAt) })}
                    {j.otpAttempts ? ` · ${t("{n} wrong codes", { n: j.otpAttempts })}` : ""}
                    {j.failReason ? ` · ${j.failReason}` : ""}{j.cancelReason ? ` · ${j.cancelReason}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {j.status === "SEARCHING" && <button type="button" className="zc-btn sm pri" onClick={() => setAssigning(j)}>{t("Assign")}</button>}
                  {j.status === "SEARCHING" && <button type="button" className="zc-btn sm" onClick={() => act(() => rebroadcastDeliveryJob(j.jobId), t("Sent to riders again"))}>{t("Re-broadcast")}</button>}
                  {UNASSIGNABLE.includes(j.status) && (
                    <button type="button" className="zc-btn sm" onClick={() => { const r = ask(t("Why take it off {name}? (it goes back to all riders)", { name: j.partnerName })); if (r !== null) act(() => unassignDeliveryJob(j.jobId, r), t("Back to broadcasting")); }}>{t("Reassign")}</button>
                  )}
                  {ACTIVE.includes(j.status) && <button type="button" className="zc-btn sm" onClick={() => window.confirm(t("Give the customer a new hand-over code? The old one stops working.")) && act(() => resetDeliveryOtp(j.jobId), t("New code issued — the customer sees it in their order"))}>{t("Reset code")}</button>}
                  {!["CANCELLED"].includes(j.status) && <button type="button" className="zc-btn sm ghost" onClick={() => window.confirm(t("Invalidate the customer's tracking link? Their app gets a new one.")) && act(() => revokeDeliveryTracking(j.jobId), t("Tracking link revoked"))}>{t("Revoke link")}</button>}
                  {!["DELIVERED", "FAILED", "CANCELLED"].includes(j.status) && (
                    <button type="button" className="zc-btn sm danger" onClick={() => { const r = ask(t("Cancel this DELIVERY (the order itself is not cancelled)? Reason:")); if (r) act(() => cancelDeliveryJob(j.jobId, r), t("Delivery cancelled")); }}>{t("Cancel delivery")}</button>
                  )}
                  <button type="button" className="zc-btn sm ghost" onClick={() => setOpen(open === j.jobId ? null : j.jobId)}>{open === j.jobId ? t("Hide history") : t("History")}</button>
                </div>
              </div>
              {open === j.jobId && <div style={{ marginTop: 10 }}><History jobId={j.jobId} /></div>}
            </div>
          ))}
        </div>
      </div>
      {assigning && <AssignDialog job={assigning} onClose={() => setAssigning(null)} onDone={() => { setAssigning(null); load(); }} />}
    </div>
  );
}
