// src/pages/admin/employees/PayTab.jsx
// One month's pay, worked out on the server (services/payService.js) from the
// salary / overtime rate set here, real attendance, approved unpaid leave and
// recorded advances. "Mark paid" records it once (server-side unique).
import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import {
  getEmployeePay, addEmployeeAdvance, payEmployeeSalary, editEmployee, updateHrPolicy,
} from "../../../services/adminService.js";
import { Loader, Badge } from "../shared/index.js";
import ErrorState from "../shared/ErrorState.jsx";
import { t, N_, fmtNum, fmtDate } from "../../../i18n/core.js";
import { useAuth } from "../../../hooks/useAuth.js";
import { isManager } from "../../../utils/access.js";

const money = (n) => `₹${fmtNum(Math.round(n || 0))}`;
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const keyToDate = (k) => { const [y, m] = k.split("-").map(Number); return new Date(y, m - 1, 1); };
const METHOD_LABEL = { Cash: N_("Cash"), UPI: N_("UPI"), Bank: N_("Bank") };
const TYPE_LABEL = { ADVANCE: N_("Advance"), SALARY: N_("Salary paid") };

export default function PayTab({ employee, policy, onEmployeeUpdated, onChanged }) {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [method, setMethod] = useState("Cash");
  const [busy, setBusy] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [adv, setAdv] = useState({ amount: "", method: "Cash", note: "" });
  const [setupOpen, setSetupOpen] = useState(false);

  const load = useCallback(() => {
    setError(false);
    getEmployeePay(employee._id, month).then(({ data: d }) => setData(d)).catch(() => setError(true));
  }, [employee._id, month]);
  useEffect(() => { setData(null); load(); }, [load]);

  const now = new Date();
  const isCurrent = month === monthKey(now);
  const shift = (n) => { const d = keyToDate(month); d.setMonth(d.getMonth() + n); setMonth(monthKey(d)); };

  const markPaid = async () => {
    setBusy(true);
    try {
      await payEmployeeSalary(employee._id, { month, method });
      toast.success(t("{name}'s salary marked paid", { name: employee.name }));
      load(); onChanged?.();
    } catch (err) { toast.error(err.response?.data?.message || t("Update failed")); }
    finally { setBusy(false); }
  };
  const saveAdvance = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await addEmployeeAdvance(employee._id, { month, amount: Number(adv.amount), method: adv.method, note: adv.note });
      toast.success(t("Advance of {amount} recorded", { amount: money(adv.amount) }));
      setAdv({ amount: "", method: "Cash", note: "" }); setAdvOpen(false);
      load(); onChanged?.();
    } catch (err) { toast.error(err.response?.data?.message || t("Update failed")); }
    finally { setBusy(false); }
  };

  if (error) return <ErrorState onRetry={load} />;
  if (!data) return <Loader rows={5} />;
  const b = data.breakdown;
  const hr = data.hr || {};
  const noSalary = !(hr.salary > 0) && !data.salaryPaid;
  const payDay = new Date(keyToDate(month).getFullYear(), keyToDate(month).getMonth() + 1, policy?.salaryDay || 5);

  return (
    <div>
      <div className="emp-calh">
        <button type="button" className="zc-btn sm ghost" onClick={() => shift(-1)} aria-label={t("Previous month")}>‹</button>
        <b>{fmtDate(keyToDate(month), { month: "long", year: "numeric" })}</b>
        <button type="button" className="zc-btn sm ghost" onClick={() => shift(1)} disabled={isCurrent} aria-label={t("Next month")}>›</button>
      </div>

      {(noSalary || setupOpen) && (
        <PaySettings
          employee={employee} hr={hr} onCancel={noSalary ? undefined : () => setSetupOpen(false)}
          onSaved={(emp) => { setSetupOpen(false); onEmployeeUpdated?.(emp); load(); onChanged?.(); }}
        />
      )}

      {!noSalary && (
        <div className="emp-grid2">
          <div className="zc-panel emp-panel">
            <h4>{t("{month} pay", { month: fmtDate(keyToDate(month), { month: "long" }) })}</h4>
            <div className="emp-kv"><span>{t("Monthly salary")}</span><b>{money(b.salary)}</b></div>
            <div className="emp-kv">
              <span>{t("Overtime")} <small className="emp-hint">({t("{h}h × {rate}/h", { h: fmtNum(b.otHours), rate: money(b.otRate) })})</small></span>
              <b>+ {money(b.overtime)}</b>
            </div>
            <div className="emp-kv"><span>{t("Advance taken")}</span><b>− {money(b.advance)}</b></div>
            <div className="emp-kv">
              <span>{t("Unpaid leave")} <small className="emp-hint">({t("{n} days", { n: fmtNum(b.unpaidLeaveDays) })})</small></span>
              <b>− {money(b.unpaidLeave)}</b>
            </div>
            <div className="emp-kv total">
              <span>{data.salaryPaid ? t("Paid") : t("To pay on {date}", { date: fmtDate(payDay, { day: "numeric", month: "short" }) })}</span>
              <b>{money(data.salaryPaid ? data.salaryPaid.amount : b.net)}</b>
            </div>

            <div className="emp-actrow">
              {data.salaryPaid ? (
                <>
                  <Badge label={N_("Paid")} kind="ready" />
                  <span className="emp-hint">
                    {t(METHOD_LABEL[data.salaryPaid.method] || data.salaryPaid.method)} · {fmtDate(data.salaryPaid.createdAt, { day: "numeric", month: "short" })} · {data.salaryPaid.by?.name || t("Admin")}
                  </span>
                </>
              ) : (
                <>
                  <select className="zc-select" value={method} onChange={(e) => setMethod(e.target.value)} aria-label={t("Paid by")} style={{ width: "auto" }}>
                    {data.methods.map((m) => <option key={m} value={m}>{t(METHOD_LABEL[m] || m)}</option>)}
                  </select>
                  <button type="button" className="zc-btn sm good" disabled={busy || b.net <= 0} onClick={markPaid}>{t("Mark paid")}</button>
                  <button type="button" className="zc-btn sm ghost" onClick={() => setAdvOpen((o) => !o)}>{t("Record advance")}</button>
                </>
              )}
            </div>

            {advOpen && !data.salaryPaid && (
              <form className="emp-inline-form" onSubmit={saveAdvance}>
                <input className="zc-input" type="number" min="1" inputMode="numeric" placeholder={t("Amount (₹)")} value={adv.amount} onChange={(e) => setAdv({ ...adv, amount: e.target.value })} required />
                <select className="zc-select" value={adv.method} onChange={(e) => setAdv({ ...adv, method: e.target.value })} aria-label={t("Paid by")}>
                  {data.methods.map((m) => <option key={m} value={m}>{t(METHOD_LABEL[m] || m)}</option>)}
                </select>
                <input className="zc-input" placeholder={t("Note (optional)")} value={adv.note} onChange={(e) => setAdv({ ...adv, note: e.target.value })} />
                <button type="submit" className="zc-btn sm pri" disabled={busy}>{t("Save advance")}</button>
              </form>
            )}
          </div>

          <div className="zc-panel emp-panel">
            <h4>{t("How it is worked out")}</h4>
            <p className="emp-hint" style={{ lineHeight: 1.6, margin: "0 0 10px" }}>
              {t("Overtime = hours worked each day beyond the {h}-hour shift, from attendance × {rate} per hour. Unpaid leave = monthly salary ÷ 30 × days. Advances come off this salary.", { h: fmtNum(b.shiftHours), rate: money(b.otRate) })}
            </p>
            <div className="emp-kv"><span>{t("Days worked")}</span><b>{fmtNum(b.daysWorked)}</b></div>
            <div className="emp-kv"><span>{t("Hours worked")}</span><b>{t("{h}h", { h: fmtNum(b.hoursWorked) })}</b></div>
            <div className="emp-kv"><span>{t("Paid leave")}</span><b>{t("{n} days", { n: fmtNum(b.paidLeaveDays) })}</b></div>
            <div className="emp-actrow">
              <button type="button" className="zc-btn sm ghost" onClick={() => setSetupOpen(true)}>{t("Change salary / overtime rate")}</button>
            </div>

            {data.history.length > 0 && (
              <div className="emp-log" style={{ marginTop: 14 }}>
                {data.history.map((r) => (
                  <div key={r._id} style={{ "--c": r.type === "SALARY" ? "var(--ready)" : "var(--wait)" }}>
                    <b>{fmtDate(r.createdAt, { day: "numeric", month: "short" })}</b>
                    {t(TYPE_LABEL[r.type])} {money(r.amount)} · {t(METHOD_LABEL[r.method] || r.method)}{r.note ? ` · ${r.note}` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <TeamRules policy={policy} onChanged={onChanged} />
    </div>
  );
}

function PaySettings({ employee, hr, onSaved, onCancel }) {
  const [f, setF] = useState({ salary: hr.salary || "", otRate: hr.otRate || "", shiftHours: hr.shiftHours || 8 });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await editEmployee(employee._id, { hr: { salary: Number(f.salary) || 0, otRate: Number(f.otRate) || 0, shiftHours: Number(f.shiftHours) || 8 } });
      toast.success(t("Pay settings saved"));
      onSaved(data.employee);
    } catch (err) { toast.error(err.response?.data?.message || t("Update failed")); }
    finally { setBusy(false); }
  };
  return (
    <form className="zc-panel emp-panel" style={{ marginBottom: 12 }} onSubmit={save}>
      <h4>{t("Pay settings")} <small>{t("Used to work out every month's pay")}</small></h4>
      <div className="emp-form3">
        <label><span>{t("Monthly salary (₹)")}</span><input className="zc-input" type="number" min="0" value={f.salary} onChange={(e) => setF({ ...f, salary: e.target.value })} required /></label>
        <label><span>{t("Overtime rate (₹ per hour)")}</span><input className="zc-input" type="number" min="0" value={f.otRate} onChange={(e) => setF({ ...f, otRate: e.target.value })} /></label>
        <label><span>{t("Shift hours per day")}</span><input className="zc-input" type="number" min="1" max="16" value={f.shiftHours} onChange={(e) => setF({ ...f, shiftHours: e.target.value })} /></label>
      </div>
      <div className="emp-actrow">
        <button type="submit" className="zc-btn sm pri" disabled={busy}>{t("Save")}</button>
        {onCancel && <button type="button" className="zc-btn sm ghost" onClick={onCancel}>{t("Cancel")}</button>}
      </div>
    </form>
  );
}

// Team-wide rules (RestaurantProfile.staffPolicy) — shared by Pay and Leave.
export function TeamRules({ policy, onChanged }) {
  const canChange = !isManager(useAuth().user); // restaurant-wide rules: admin only
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ paidLeavePerMonth: policy?.paidLeavePerMonth ?? 1, salaryDay: policy?.salaryDay ?? 5 });
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF({ paidLeavePerMonth: policy?.paidLeavePerMonth ?? 1, salaryDay: policy?.salaryDay ?? 5 }); }, [policy]);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await updateHrPolicy({ paidLeavePerMonth: Number(f.paidLeavePerMonth), salaryDay: Number(f.salaryDay) });
      toast.success(t("Team rules saved"));
      setOpen(false); onChanged?.();
    } catch (err) { toast.error(err.response?.data?.message || t("Update failed")); }
    finally { setBusy(false); }
  };
  if (!policy) return null;
  return (
    <div className="emp-rules">
      {!open ? (
        <>
          <span className="emp-hint">
            {t("Team rules: salary paid on day {d} of the next month · {n} paid leave days a month", { d: fmtNum(policy.salaryDay), n: fmtNum(policy.paidLeavePerMonth) })}
          </span>
          {canChange && <button type="button" className="zc-btn sm ghost" onClick={() => setOpen(true)}>{t("Change")}</button>}
        </>
      ) : (
        <form className="emp-inline-form" onSubmit={save}>
          <label><span>{t("Salary day")}</span><input className="zc-input" type="number" min="1" max="28" value={f.salaryDay} onChange={(e) => setF({ ...f, salaryDay: e.target.value })} /></label>
          <label><span>{t("Paid leave days a month")}</span><input className="zc-input" type="number" min="0" max="31" value={f.paidLeavePerMonth} onChange={(e) => setF({ ...f, paidLeavePerMonth: e.target.value })} /></label>
          <button type="submit" className="zc-btn sm pri" disabled={busy}>{t("Save")}</button>
          <button type="button" className="zc-btn sm ghost" onClick={() => setOpen(false)}>{t("Cancel")}</button>
        </form>
      )}
    </div>
  );
}
