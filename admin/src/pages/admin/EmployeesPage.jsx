import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import {
  getEmployees, addEmployee, editEmployee, setEmployeeStatus, getEmployeeStats,
} from "../../services/adminService.js";
import {
  PRIMARY, BG_CARD, BG_INPUT, BORDER, TEXT_PRIMARY, TEXT_MUTED, GREEN, GREEN_LIGHT,
} from "../../theme.js";

const RED = "#ef4444";
const CATEGORY_LABEL = { waiter: "Waiter", chef: "Chef" };
const CATEGORY_ICON  = { waiter: "🧑‍🍽️", chef: "🧑‍🍳" };

export default function EmployeesPage() {
  const [employees, setEmployees] = useState(null);
  const [search, setSearch]       = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showAdd, setShowAdd]     = useState(false);
  const [editing, setEditing]     = useState(null);
  const [statsFor, setStatsFor]   = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await getEmployees({
        search: search || undefined, role: roleFilter || undefined, status: statusFilter || undefined,
      });
      setEmployees(data.employees || []);
    } catch {
      toast.error("Couldn't load employees");
    }
  }, [search, roleFilter, statusFilter]);

  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [load]);

  const handleToggleStatus = async (emp) => {
    const next = emp.status === "Active" ? "Inactive" : "Active";
    if (!window.confirm(`${next === "Inactive" ? "Deactivate" : "Activate"} ${emp.name}?`)) return;
    try {
      await setEmployeeStatus(emp._id, next);
      toast.success(`${emp.name} is now ${next}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't update status");
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: TEXT_PRIMARY }}>Employees</div>
          <div style={{ fontSize: 12.5, color: TEXT_MUTED, marginTop: 2 }}>Waiters and kitchen staff — created here, log in with their own phone + OTP</div>
        </div>
        <button onClick={() => setShowAdd(true)} style={primaryBtnStyle}>+ Add Employee</button>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone…" style={{ ...inputStyle, flex: "1 1 220px" }}
        />
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={inputStyle}>
          <option value="">All categories</option>
          <option value="waiter">Waiter</option>
          <option value="chef">Chef</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle}>
          <option value="">All statuses</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
      </div>

      {employees === null ? (
        <div style={{ padding: 40, textAlign: "center", color: TEXT_MUTED }}>Loading…</div>
      ) : employees.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: TEXT_MUTED, background: BG_CARD, borderRadius: 14, border: `1px solid ${BORDER}` }}>
          No employees found
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {employees.map((emp) => (
            <div key={emp._id} style={{ background: BG_CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 22 }}>{CATEGORY_ICON[emp.role] || "👤"}</span>
                  <div>
                    <div style={{ fontWeight: 700, color: TEXT_PRIMARY, fontSize: 14.5 }}>{emp.name}</div>
                    <div style={{ fontSize: 11.5, color: PRIMARY, fontWeight: 700, textTransform: "uppercase" }}>{CATEGORY_LABEL[emp.role] || emp.role}</div>
                  </div>
                </div>
                <span style={{
                  fontSize: 10.5, fontWeight: 800, padding: "3px 9px", borderRadius: 20,
                  background: emp.status === "Active" ? GREEN_LIGHT : "rgba(239,68,68,0.15)",
                  color: emp.status === "Active" ? GREEN : RED,
                }}>
                  {emp.status}
                </span>
              </div>

              <div style={{ marginTop: 10, fontSize: 12.5, color: TEXT_MUTED }}>
                📞 +91 {emp.phone}
                {emp.address && <div style={{ marginTop: 2 }}>📍 {emp.address}</div>}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button onClick={() => setStatsFor(emp)} style={smallBtnStyle}>📊 Stats</button>
                <button onClick={() => setEditing(emp)} style={smallBtnStyle}>✎ Edit</button>
                <button
                  onClick={() => handleToggleStatus(emp)}
                  style={{ ...smallBtnStyle, color: emp.status === "Active" ? RED : GREEN, borderColor: emp.status === "Active" ? RED : GREEN }}
                >
                  {emp.status === "Active" ? "Deactivate" : "Activate"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <EmployeeFormModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {editing && <EmployeeFormModal employee={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {statsFor && <StatsModal employee={statsFor} onClose={() => setStatsFor(null)} />}
    </div>
  );
}

function EmployeeFormModal({ employee, onClose, onSaved }) {
  const isEdit = !!employee;
  const [name, setName] = useState(employee?.name || "");
  const [phone, setPhone] = useState(employee?.phone || "");
  const [address, setAddress] = useState(employee?.address || "");
  const [role, setRole] = useState(employee?.role || "waiter");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return toast.error("Enter employee name");
    if (!isEdit && !/^[6-9]\d{9}$/.test(phone)) return toast.error("Enter a valid 10-digit phone number");
    setSaving(true);
    try {
      if (isEdit) {
        await editEmployee(employee._id, { name, address, role });
        toast.success("Employee updated");
      } else {
        await addEmployee({ name, phone, address, role });
        toast.success(`${name} added as ${CATEGORY_LABEL[role]}`);
      }
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't save employee");
    } finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose} title={isEdit ? "Edit Employee" : "Add Employee"}>
      <Field label="Employee Name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahul" style={inputStyle} />
      </Field>
      <Field label="Phone Number">
        <input
          value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
          placeholder="9876543210" disabled={isEdit} style={{ ...inputStyle, opacity: isEdit ? 0.6 : 1 }}
        />
        {isEdit && <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 4 }}>Phone number can't be changed after creation.</div>}
      </Field>
      <Field label="Address">
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. Kolkata, West Bengal" style={inputStyle} />
      </Field>
      <Field label="Category">
        <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
          <option value="waiter">Waiter</option>
          <option value="chef">Chef</option>
        </select>
      </Field>
      <button onClick={handleSubmit} disabled={saving} style={{ ...primaryBtnStyle, width: "100%", marginTop: 6, opacity: saving ? 0.6 : 1 }}>
        {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Employee"}
      </button>
    </Modal>
  );
}

function StatsModal({ employee, onClose }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    getEmployeeStats(employee._id).then(({ data }) => setStats(data.stats)).catch(() => toast.error("Couldn't load stats"));
  }, [employee._id]);

  const isChef = employee.role === "chef";

  return (
    <Modal onClose={onClose} title={`${employee.name}'s Stats`}>
      <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 14, textTransform: "uppercase", fontWeight: 700 }}>
        {CATEGORY_LABEL[employee.role]} · Today
      </div>
      {!stats ? (
        <div style={{ color: TEXT_MUTED, fontSize: 13 }}>Loading…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {isChef ? (
            <>
              <StatBox label="Prepared Today" value={stats.preparedToday} />
              <StatBox label="Preparing" value={stats.preparing} />
              <StatBox label="Ready" value={stats.ready} />
              <StatBox label="Completed" value={stats.completedToday} />
            </>
          ) : (
            <>
              <StatBox label="Orders Today" value={stats.ordersToday} />
              <StatBox label="Active" value={stats.pending} />
              <StatBox label="Completed" value={stats.completed} />
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

const StatBox = ({ label, value }) => (
  <div style={{ textAlign: "center", padding: "14px 8px", background: BG_INPUT, borderRadius: 12 }}>
    <div style={{ fontSize: 24, fontWeight: 800, color: PRIMARY }}>{value ?? 0}</div>
    <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 4 }}>{label}</div>
  </div>
);

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ fontSize: 11.5, fontWeight: 700, color: TEXT_MUTED, display: "block", marginBottom: 6 }}>{label}</label>
    {children}
  </div>
);

function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, background: BG_CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: TEXT_PRIMARY }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: TEXT_MUTED, fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputStyle = {
  padding: "10px 13px", borderRadius: 10, border: `1px solid ${BORDER}`, background: BG_INPUT,
  color: TEXT_PRIMARY, fontSize: 13.5, width: "100%", boxSizing: "border-box",
};
const primaryBtnStyle = {
  padding: "10px 18px", borderRadius: 10, border: "none", background: PRIMARY,
  color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
};
const smallBtnStyle = {
  flex: 1, padding: "8px 6px", borderRadius: 8, border: `1px solid ${BORDER}`, background: "transparent",
  color: TEXT_PRIMARY, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
};
