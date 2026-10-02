// src/pages/admin/employees/DocumentsTab.jsx
// Joining paperwork kept on the employee (User.hr). ID proof stores the type
// and last 4 characters only — the full number is never sent or saved.
import { useState } from "react";
import toast from "react-hot-toast";
import { editEmployee, uploadEmployeePhoto } from "../../../services/adminService.js";
import { Modal } from "../inventory/invUI.jsx";
import { Badge } from "../shared/index.js";
import { t, N_ } from "../../../i18n/core.js";
import { toDateInput, documentSlots } from "./shared.js";

const ID_TYPES = [N_("Aadhaar"), N_("PAN"), N_("Voter ID"), N_("Driving licence"), N_("Passport")];

export default function DocumentsTab({ employee, onEmployeeUpdated }) {
  const [editing, setEditing] = useState(false);
  const slots = documentSlots(employee);
  return (
    <div>
      <div className="emp-docs">
        {slots.map((s) => (
          <div key={s.key} className={`zc-panel emp-doc${s.ok ? "" : " miss"}`}>
            {s.photo && <img src={s.photo} alt="" className="emp-doc-photo" />}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="emp-doc-k">{t(s.label)}</div>
              <small>{s.ok ? (s.key === "photo" ? t(s.value) : s.value) : t("Missing, add now")}{s.note ? ` · ${t(s.note)}` : ""}</small>
            </div>
            {s.ok
              ? <Badge label="✓" kind="ready" dot={false} />
              : <button type="button" className="zc-btn sm ghost" onClick={() => setEditing(true)}>+ {t("Add")}</button>}
          </div>
        ))}
      </div>
      <div className="emp-actrow">
        <button type="button" className="zc-btn sm" onClick={() => setEditing(true)}>✎ {t("Edit documents")}</button>
        <span className="emp-hint">{t("Only the last 4 characters of an ID number are kept.")}</span>
      </div>
      {editing && <DocumentsForm employee={employee} onClose={() => setEditing(false)} onSaved={(emp) => { setEditing(false); onEmployeeUpdated?.(emp); }} />}
    </div>
  );
}

function DocumentsForm({ employee, onClose, onSaved }) {
  const hr = employee.hr || {};
  const [f, setF] = useState({
    idProofType: hr.idProofType || "", idProofLast4: hr.idProofLast4 || "",
    joinedAt: hr.joinedAt ? toDateInput(hr.joinedAt) : "",
    address: employee.address || "",
    emergencyName: hr.emergencyName || "", emergencyPhone: hr.emergencyPhone || "",
    payoutUpi: hr.payoutUpi || "", payoutBank: hr.payoutBank || "",
  });
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { address, ...rest } = f;
      let { data } = await editEmployee(employee._id, { address, hr: { ...rest, joinedAt: rest.joinedAt || null } });
      if (photo) ({ data } = await uploadEmployeePhoto(employee._id, photo));
      toast.success(t("Documents saved"));
      onSaved(data.employee);
    } catch (err) {
      toast.error(err.response?.data?.message || t("Update failed"));
    } finally { setBusy(false); }
  };

  return (
    <Modal
      title={t("Documents & joining")} sub={employee.name} onClose={onClose} width={560}
      footer={<>
        <button type="button" className="zc-btn ghost" onClick={onClose}>{t("Cancel")}</button>
        <button type="submit" form="emp-docs-form" className="zc-btn pri" disabled={busy}>{busy ? t("Saving…") : t("Save")}</button>
      </>}
    >
      <form id="emp-docs-form" onSubmit={save} className="emp-form2">
        <label><span>{t("ID proof")}</span>
          <select className="zc-select" value={f.idProofType} onChange={set("idProofType")}>
            <option value="">—</option>
            {ID_TYPES.map((x) => <option key={x} value={x}>{t(x)}</option>)}
          </select>
        </label>
        <label><span>{t("Last 4 characters of the ID")}</span>
          <input className="zc-input" value={f.idProofLast4} maxLength={4} placeholder="4821" onChange={(e) => setF({ ...f, idProofLast4: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} />
        </label>
        <label><span>{t("Joining date")}</span><input className="zc-input" type="date" max={toDateInput(new Date())} value={f.joinedAt} onChange={set("joinedAt")} /></label>
        <label><span>{t("Address")}</span><input className="zc-input" value={f.address} onChange={set("address")} /></label>
        <label><span>{t("Emergency contact name")}</span><input className="zc-input" value={f.emergencyName} onChange={set("emergencyName")} /></label>
        <label><span>{t("Emergency phone")}</span><input className="zc-input" inputMode="numeric" value={f.emergencyPhone} onChange={(e) => setF({ ...f, emergencyPhone: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="9876543210" /></label>
        <label><span>{t("UPI ID for salary")}</span><input className="zc-input" value={f.payoutUpi} onChange={set("payoutUpi")} placeholder="name@ybl" /></label>
        <label><span>{t("Bank account (optional)")}</span><input className="zc-input" value={f.payoutBank} onChange={set("payoutBank")} placeholder={t("Bank · last 4 digits")} /></label>
        <label className="full"><span>{t("Photo")}</span><input className="zc-input" type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} /></label>
      </form>
    </Modal>
  );
}
