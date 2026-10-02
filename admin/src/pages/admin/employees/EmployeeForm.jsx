// src/pages/admin/employees/EmployeeForm.jsx
// Add / edit an employee. Same fields, validation and endpoints as before
// (POST /admin/employees, PUT /admin/employees/:id); phone is fixed after
// creation because it is the OTP login identity.
import { useState } from "react";
import toast from "react-hot-toast";
import { addEmployee, editEmployee } from "../../../services/adminService.js";
import { Modal } from "../inventory/invUI.jsx";
import { t } from "../../../i18n/core.js";
import { ROLE_LABEL } from "./shared.js";

const Field = ({ label, hint, children }) => (
  <label style={{ display: "block", marginBottom: 14 }}>
    <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--text-2)", marginBottom: 6 }}>{label}</span>
    {children}
    {hint && <span style={{ display: "block", fontSize: 11.5, color: "var(--text-3)", marginTop: 5 }}>{hint}</span>}
  </label>
);

export default function EmployeeForm({ employee, onClose, onSaved }) {
  const isEdit = !!employee;
  const [name, setName] = useState(employee?.name || "");
  const [phone, setPhone] = useState(employee?.phone || "");
  const [address, setAddress] = useState(employee?.address || "");
  const [role, setRole] = useState(employee?.role || "waiter");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return toast.error(t("Enter employee name"));
    if (!isEdit && !/^[6-9]\d{9}$/.test(phone)) return toast.error(t("Enter a valid 10-digit phone number"));
    setSaving(true);
    try {
      let saved;
      if (isEdit) {
        ({ data: { employee: saved } = {} } = await editEmployee(employee._id, { name, address, role }));
        toast.success(t("Employee updated"));
      } else {
        ({ data: { employee: saved } = {} } = await addEmployee({ name, phone, address, role }));
        toast.success(t("{name} added as {role}", { name, role: t(ROLE_LABEL[role]) }));
      }
      onSaved(saved);
    } catch (err) {
      toast.error(err.response?.data?.message || t("Couldn't save employee"));
    } finally { setSaving(false); }
  };

  return (
    <Modal
      title={isEdit ? t("Edit Employee") : t("Add Employee")}
      sub={isEdit ? undefined : t("Waiters and kitchen staff — created here, log in with their own phone + OTP")}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button type="button" className="zc-btn ghost" onClick={onClose}>{t("Cancel")}</button>
          <button type="submit" form="emp-form" className="zc-btn pri" disabled={saving}>
            {saving ? t("Saving…") : isEdit ? t("Save Changes") : t("Add Employee")}
          </button>
        </>
      }
    >
      <form id="emp-form" onSubmit={handleSubmit}>
        <Field label={t("Employee Name")}>
          <input className="zc-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Rahul")} autoFocus />
        </Field>
        <Field label={t("Phone Number")} hint={isEdit ? t("Phone number can't be changed after creation.") : undefined}>
          <input
            className="zc-input" inputMode="numeric" value={phone} disabled={isEdit}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="9876543210" style={isEdit ? { opacity: 0.6 } : undefined}
          />
        </Field>
        <Field label={t("Address")}>
          <input className="zc-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("e.g. Kolkata, West Bengal")} />
        </Field>
        <Field label={t("Role")}>
          <select className="zc-select" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="waiter">{t("Waiter")}</option>
            <option value="chef">{t("Chef")}</option>
          </select>
        </Field>
      </form>
    </Modal>
  );
}
