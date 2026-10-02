// src/pages/admin/employees/LeaveTab.jsx
// Requests come from the Waiter / Kitchen apps ("Request leave"); the owner
// approves (paid or unpaid) or declines them here, or records leave directly.
import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { getEmployeeLeave, addEmployeeLeave, decideEmployeeLeave } from "../../../services/adminService.js";
import { Loader, Badge } from "../shared/index.js";
import ErrorState from "../shared/ErrorState.jsx";
import { TeamRules } from "./PayTab.jsx";
import { t, N_, tn, fmtNum, fmtDate } from "../../../i18n/core.js";
import { toDateInput } from "./shared.js";

const STATUS = {
  PENDING: { label: N_("Waiting for you"), kind: "wait" },
  APPROVED: { label: N_("Approved"), kind: "ready" },
  DECLINED: { label: N_("Declined"), kind: "done" },
  CANCELLED: { label: N_("Withdrawn"), kind: "done" },
};
const range = (l) => {
  const a = fmtDate(l.from, { weekday: "short", day: "numeric", month: "short" });
  return l.days > 1 ? `${a} – ${fmtDate(l.to, { weekday: "short", day: "numeric", month: "short" })}` : a;
};

export default function LeaveTab({ employee, policy, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const today = toDateInput(new Date());
  const [f, setF] = useState({ from: today, to: today, paid: false, reason: "" });

  const load = useCallback(() => {
    setError(false);
    getEmployeeLeave(employee._id).then(({ data: d }) => setData(d)).catch(() => setError(true));
  }, [employee._id]);
  useEffect(() => { load(); }, [load]);

  const decide = async (leave, decision, paid) => {
    setBusy(leave._id);
    try {
      await decideEmployeeLeave(leave._id, { decision, paid });
      toast.success(decision === "APPROVED"
        ? t("Leave approved for {name}", { name: employee.name })
        : t("Leave declined for {name}", { name: employee.name }));
      load(); onChanged?.();
    } catch (err) { toast.error(err.response?.data?.message || t("Update failed")); }
    finally { setBusy(null); }
  };
  const record = async (e) => {
    e.preventDefault();
    setBusy("new");
    try {
      await addEmployeeLeave(employee._id, f);
      toast.success(t("Leave recorded"));
      setFormOpen(false); setF({ from: today, to: today, paid: false, reason: "" });
      load(); onChanged?.();
    } catch (err) { toast.error(err.response?.data?.message || t("Update failed")); }
    finally { setBusy(null); }
  };

  if (error) return <ErrorState onRetry={load} />;
  if (!data) return <Loader rows={4} />;
  const { balance, leaves } = data;
  const pending = leaves.filter((l) => l.status === "PENDING");
  const history = leaves.filter((l) => l.status !== "PENDING");

  return (
    <div>
      <div className="emp-grid2">
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div className="zc-panel emp-panel">
            <h4>{t("This month")}</h4>
            <div className="emp-kv"><span>{t("Paid leave left")}</span><b>{t("{n} of {m}", { n: fmtNum(balance.paidLeft), m: fmtNum(balance.allowance) })}</b></div>
            <div className="emp-kv"><span>{t("Paid leave taken")}</span><b>{tn(balance.paidUsed, "{n} day", "{n} days")}</b></div>
            <div className="emp-kv"><span>{t("Unpaid leave taken")}</span><b>{tn(balance.unpaidUsed, "{n} day", "{n} days")}</b></div>
          </div>

          {pending.map((l) => {
            const coversPaid = balance.paidLeft >= l.days;
            return (
              <div key={l._id} className="zc-panel emp-panel emp-req">
                <h4>{t("Request")}: {range(l)} · {tn(l.days, "{n} day", "{n} days")}</h4>
                {l.reason && <p className="emp-rv-text">“{l.reason}”</p>}
                <p className="emp-hint" style={{ margin: "4px 0 0" }}>
                  {t("Sent from the staff app")} · {fmtDate(l.createdAt, { day: "numeric", month: "short" })}
                  {" · "}
                  {coversPaid
                    ? t("Paid leave left covers it")
                    : balance.paidLeft > 0
                      ? t("Only {n} paid day left — the rest would be unpaid", { n: fmtNum(balance.paidLeft) })
                      : t("No paid leave left this month — this would be unpaid")}
                </p>
                <div className="emp-actrow">
                  {coversPaid && <button type="button" className="zc-btn sm good" disabled={busy === l._id} onClick={() => decide(l, "APPROVED", true)}>{t("Approve as paid")}</button>}
                  <button type="button" className={`zc-btn sm${coversPaid ? " ghost" : " good"}`} disabled={busy === l._id} onClick={() => decide(l, "APPROVED", false)}>{t("Approve unpaid")}</button>
                  <button type="button" className="zc-btn sm ghost" disabled={busy === l._id} onClick={() => decide(l, "DECLINED")}>{t("Decline")}</button>
                </div>
              </div>
            );
          })}
          {pending.length === 0 && <div className="emp-hint" style={{ padding: "4px 2px" }}>{t("No leave requests waiting.")}</div>}

          {!formOpen ? (
            <button type="button" className="zc-btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => setFormOpen(true)}>+ {t("Record leave")}</button>
          ) : (
            <form className="zc-panel emp-panel" onSubmit={record}>
              <h4>{t("Record leave")} <small>{t("Approved straight away")}</small></h4>
              <div className="emp-form3">
                <label><span>{t("From")}</span><input className="zc-input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: f.to < e.target.value ? e.target.value : f.to })} required /></label>
                <label><span>{t("To")}</span><input className="zc-input" type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} required /></label>
                <label><span>{t("Pay")}</span>
                  <select className="zc-select" value={f.paid ? "paid" : "unpaid"} onChange={(e) => setF({ ...f, paid: e.target.value === "paid" })}>
                    <option value="unpaid">{t("Unpaid")}</option>
                    <option value="paid">{t("Paid")}</option>
                  </select>
                </label>
              </div>
              <input className="zc-input" placeholder={t("Reason (optional)")} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} style={{ marginTop: 10 }} />
              <div className="emp-actrow">
                <button type="submit" className="zc-btn sm pri" disabled={busy === "new"}>{t("Save")}</button>
                <button type="button" className="zc-btn sm ghost" onClick={() => setFormOpen(false)}>{t("Cancel")}</button>
              </div>
            </form>
          )}
        </div>

        <div className="zc-panel emp-panel">
          <h4>{t("History")}</h4>
          {history.length === 0 ? <div className="emp-hint">—</div> : history.map((l) => (
            <div className="emp-kv" key={l._id}>
              <span>
                {range(l)} · {tn(l.days, "{n} day", "{n} days")}
                {l.reason ? <small className="emp-hint" style={{ display: "block" }}>{l.reason}</small> : null}
              </span>
              <b style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <Badge label={STATUS[l.status].label} kind={STATUS[l.status].kind} />
                {l.status === "APPROVED" && <Badge label={l.paid ? N_("Paid") : N_("Unpaid")} kind={l.paid ? "ready" : "wait"} dot={false} />}
              </b>
            </div>
          ))}
        </div>
      </div>
      <TeamRules policy={policy} onChanged={onChanged} />
    </div>
  );
}
