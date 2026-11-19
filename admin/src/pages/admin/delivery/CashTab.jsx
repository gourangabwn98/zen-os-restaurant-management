// Cash (COD) — what riders collected at the door, who still holds cash, and
// verification. "Verify" means the cash was handed in to you: it runs the
// normal billing settle (Cash) — the order becomes Paid + Settled and, if it
// was delivered, Completed. Nothing here marks an order paid any other way.
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { getCodCollections, verifyCodCollection, disputeCodCollection, errMsg } from "../../../services/deliveryAdminService.js";
import { EmptyState, Loader } from "../shared";
import { t, N_ } from "../../../i18n/core.js";
import { COD_STATUS, rupees, dayTime } from "./shared.js";
import Tag from "./DeliveryTag.jsx";

const FILTERS = [
  { key: "COLLECTED", label: N_("To verify") },
  { key: "DISPUTED", label: N_("Disputed") },
  { key: "VERIFIED", label: N_("Verified") },
  { key: "", label: N_("All") },
];

export default function CashTab({ rev }) {
  const [filter, setFilter] = useState("COLLECTED");
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState("");
  const load = useCallback(() => {
    getCodCollections(filter ? { status: filter } : {}).then((r) => { setData(r.data); setError(false); }).catch(() => setError(true));
  }, [filter]);
  useEffect(() => { load(); }, [load, rev]);

  const verify = async (c) => {
    if (!window.confirm(t("Confirm {name} handed in {amt} for {order}? This marks the bill paid (Cash) and settles it.", { name: c.partnerName, amt: rupees(c.amount), order: c.orderNo }))) return;
    setBusy(c.id);
    try {
      const r = await verifyCodCollection(c.id);
      toast.success(r.data.completed?.length ? t("Verified — order {o} completed", { o: c.orderNo }) : t("Verified and settled"));
      load();
    } catch (err) { toast.error(errMsg(err, t("Couldn't verify"))); }
    finally { setBusy(""); }
  };
  const dispute = async (c) => {
    const reason = window.prompt(t("What's wrong with {amt} from {name}?", { amt: rupees(c.amount), name: c.partnerName }));
    if (!reason || !reason.trim()) return;
    try { await disputeCodCollection(c.id, reason.trim()); toast.success(t("Marked disputed")); load(); }
    catch (err) { toast.error(errMsg(err, t("Couldn't update"))); }
  };

  if (error) return <div className="zc-card"><EmptyState title={t("Couldn't load cash collections")} action={<button type="button" className="zc-btn" onClick={load}>{t("Retry")}</button>} /></div>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="zc-card">
        <div className="zc-card-h"><div><div className="t">{t("Cash with riders")}</div><div className="s">{t("Collected at the door, not yet verified as handed in")}</div></div></div>
        <div className="zc-card-b" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {!data ? <Loader rows={1} /> : data.cashWithRiders.length === 0 ? <span style={{ color: "var(--text-3)" }}>{t("No cash outstanding")}</span>
            : data.cashWithRiders.map((r) => (
              <div key={r.partnerId} className="zc-metric sm" style={{ minWidth: 160 }}>
                <div className="k">{r.partnerName}</div><div className="v">{rupees(r.amount)}</div><div className="d">{t("{n} orders", { n: r.count })}</div>
              </div>
            ))}
        </div>
      </div>
      <div className="zc-card">
        <div className="zc-card-h" style={{ flexWrap: "wrap", gap: 10 }}>
          <div><div className="t">{t("Collections")}</div><div className="s">{t("One record per COD order — written by the rider's OTP hand-over")}</div></div>
          <div className="zc-seg">{FILTERS.map((f) => <button key={f.key} type="button" className={filter === f.key ? "on" : ""} onClick={() => { setFilter(f.key); setData(null); }}>{t(f.label)}</button>)}</div>
        </div>
        <div className="zc-card-b">
          {!data && <Loader rows={4} />}
          {data?.collections.length === 0 && <EmptyState title={t("Nothing here")} />}
          {data?.collections.map((c) => (
            <div key={c.id} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--edge)" }}>
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <div><b>{c.orderNo}</b> · {rupees(c.amount)} <Tag map={COD_STATUS} value={c.status} /></div>
                <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                  {t("{name} collected {when}", { name: c.partnerName, when: dayTime(c.collectedAt) })}
                  {c.verifiedAt ? ` · ${t("verified by {who} {when}", { who: c.verifiedBy, when: dayTime(c.verifiedAt) })}` : ""}
                  {c.disputeReason ? ` · ${c.disputeReason}` : ""}{c.note ? ` · ${c.note}` : ""}
                </div>
              </div>
              {["COLLECTED", "DISPUTED"].includes(c.status) && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="zc-btn sm good" disabled={busy === c.id} onClick={() => verify(c)}>{busy === c.id ? "…" : t("Verify hand-in")}</button>
                  {c.status === "COLLECTED" && <button type="button" className="zc-btn sm danger" onClick={() => dispute(c)}>{t("Dispute")}</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
