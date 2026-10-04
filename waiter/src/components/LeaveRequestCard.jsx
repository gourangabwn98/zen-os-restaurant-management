import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import GlassCard from "./ui/GlassCard.jsx";
import { getMyLeave, requestMyLeave, cancelMyLeave } from "../services/authService.js";
import { ACCENT, ACCENT_GRADIENT, TEXT_FAINT } from "../theme.js";
import { t, tn, N_, getLang } from "../i18n/index.jsx";

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return ymd(d); };
const fmt = (d) => new Date(d).toLocaleDateString(getLang() === "bn" ? "bn-IN" : "en-IN", { weekday: "short", day: "numeric", month: "short" });
const STATUS = {
  PENDING: { label: N_("Waiting for approval"), color: "#FBBF24" },
  APPROVED: { label: N_("Approved"), color: "#34D399" },
  DECLINED: { label: N_("Declined"), color: "#F87171" },
  CANCELLED: { label: N_("Withdrawn"), color: TEXT_FAINT },
};
const input = {
  width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 14,
};

/** "Request leave" — goes to the owner's Employees page (Leave tab) to approve. */
export default function LeaveRequestCard() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(() => ({ from: tomorrow(), to: tomorrow(), reason: "" }));
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { getMyLeave().then(({ data: d }) => setData(d)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await requestMyLeave(f);
      toast.success(t("Leave request sent"));
      setOpen(false); setF({ from: tomorrow(), to: tomorrow(), reason: "" });
      load();
    } catch (err) { toast.error(err.response?.data?.message || t("Couldn't send the request")); }
    finally { setBusy(false); }
  };
  const withdraw = async (id) => {
    try { await cancelMyLeave(id); toast.success(t("Request withdrawn")); load(); }
    catch (err) { toast.error(err.response?.data?.message || t("Couldn't withdraw")); }
  };

  const recent = (data?.leaves || []).slice(0, 5);
  return (
    <GlassCard style={{ padding: "16px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: "#fff" }}>{t("Leave")}</div>
        {/* EMP-02: running balance — unused leave carries forward month to month */}
        {data && <div style={{ fontSize: 12, color: TEXT_FAINT }}>{t("Leave balance")}: <b style={{ color: "#fff" }}>{data.balance.balance ?? data.balance.paidLeft}</b></div>}
      </div>

      {!open ? (
        <button type="button" onClick={() => setOpen(true)} style={{
          marginTop: 12, width: "100%", padding: 12, borderRadius: 12, border: "none",
          background: ACCENT_GRADIENT, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
        }}>{t("Request leave")}</button>
      ) : (
        <form onSubmit={send} style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ fontSize: 12, color: TEXT_FAINT }}>{t("From")}
              <input type="date" style={input} min={ymd(new Date())} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: f.to < e.target.value ? e.target.value : f.to })} required />
            </label>
            <label style={{ fontSize: 12, color: TEXT_FAINT }}>{t("To")}
              <input type="date" style={input} min={f.from} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} required />
            </label>
          </div>
          <input style={input} placeholder={t("Reason (optional)")} maxLength={300} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={() => setOpen(false)} style={{ flex: 1, padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.16)", background: "transparent", color: "#fff", fontWeight: 600, cursor: "pointer" }}>{t("Cancel")}</button>
            <button type="submit" disabled={busy} style={{ flex: 1, padding: 12, borderRadius: 12, border: "none", background: ACCENT_GRADIENT, color: "#fff", fontWeight: 700, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>{busy ? t("Sending…") : t("Send request")}</button>
          </div>
        </form>
      )}

      {recent.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {recent.map((l) => (
            <div key={l._id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: "#fff", fontWeight: 600 }}>{fmt(l.from)}{l.days > 1 ? ` – ${fmt(l.to)}` : ""} · {tn(l.days, "{n} day", "{n} days")}</div>
                <div style={{ fontSize: 12, color: STATUS[l.status]?.color || TEXT_FAINT, marginTop: 2 }}>
                  {t(STATUS[l.status]?.label || l.status)}{l.status === "APPROVED" ? ` · ${t("paid")}` : l.status === "DECLINED" ? ` · ${t("loss of pay")}` : ""}
                </div>
              </div>
              {l.status === "PENDING" && (
                <button type="button" onClick={() => withdraw(l._id)} style={{ border: "none", background: "none", color: ACCENT, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{t("Withdraw")}</button>
              )}
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
