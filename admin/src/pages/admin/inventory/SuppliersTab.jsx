import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { getSuppliers, createSupplier, updateSupplier, deleteSupplier } from "../../../services/inventoryService.js";
import { T1, T2, T3, BORDER, inp, label, btnPrimary, btnGhost, btnDanger, Modal, TableShell } from "./invUI.jsx";

const emptySupplier = { name: "", phone: "", email: "", address: "", gstNumber: "", notes: "" };

export default function SuppliersTab() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptySupplier);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setSuppliers((await getSuppliers()).data?.suppliers || []); }
    catch { toast.error("Failed to load suppliers"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(null); setForm(emptySupplier); setShowForm(true); };
  const openEdit = (s) => {
    setEditing(s);
    setForm({ name: s.name, phone: s.phone || "", email: s.email || "", address: s.address || "", gstNumber: s.gstNumber || "", notes: s.notes || "" });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error("Supplier name is required");
    setSaving(true);
    try {
      if (editing) { await updateSupplier(editing._id, form); toast.success("Supplier updated"); }
      else { await createSupplier(form); toast.success("Supplier added"); }
      setShowForm(false);
      load();
    } catch (err) { toast.error(err.response?.data?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const handleToggle = async (s) => {
    try { await updateSupplier(s._id, { status: s.status === "Active" ? "Inactive" : "Active" }); load(); }
    catch { toast.error("Failed to update"); }
  };

  const handleDelete = async (s) => {
    if (!window.confirm(`Delete "${s.name}"?`)) return;
    try { await deleteSupplier(s._id); toast.success("Supplier deleted"); load(); }
    catch { toast.error("Failed to delete"); }
  };

  if (loading) return <div style={{ textAlign: "center", padding: 80, color: T3 }}>Loading suppliers…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button onClick={openNew} style={btnPrimary(false)}>+ Add Supplier</button>
      </div>

      <TableShell
        headers={["Name", "Phone", "Email", "GST No.", "Status", "Actions"]}
        isEmpty={suppliers.length === 0}
        emptyIcon="🚚" emptyText="No suppliers added yet"
      >
        {suppliers.map((s, idx) => (
          <tr key={s._id} style={{ borderBottom: idx < suppliers.length - 1 ? `1px solid ${BORDER}` : "none" }}>
            <td style={{ padding: "13px 18px", fontWeight: 600, color: T1 }}>{s.name}</td>
            <td style={{ padding: "13px 18px", color: T2 }}>{s.phone || "—"}</td>
            <td style={{ padding: "13px 18px", color: T2 }}>{s.email || "—"}</td>
            <td style={{ padding: "13px 18px", color: T2 }}>{s.gstNumber || "—"}</td>
            <td style={{ padding: "13px 18px" }}>
              <span style={{
                padding: "4px 13px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                background: s.status === "Active" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                color: s.status === "Active" ? "#34d399" : "#f87171",
              }}>{s.status}</span>
            </td>
            <td style={{ padding: "13px 18px" }}>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => openEdit(s)} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12 }}>Edit</button>
                <button onClick={() => handleToggle(s)} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12 }}>
                  {s.status === "Active" ? "Deactivate" : "Activate"}
                </button>
                <button onClick={() => handleDelete(s)} style={btnDanger}>Delete</button>
              </div>
            </td>
          </tr>
        ))}
      </TableShell>

      {showForm && (
        <Modal title={editing ? "Edit Supplier" : "Add Supplier"} onClose={() => setShowForm(false)}>
          <div style={{ display: "grid", gap: 14 }}>
            <div><label style={label}>Name</label><input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><label style={label}>Phone</label><input style={inp} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><label style={label}>Email</label><input style={inp} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <div><label style={label}>Address</label><input style={inp} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div><label style={label}>GST Number</label><input style={inp} value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} /></div>
            <div><label style={label}>Notes</label><input style={inp} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowForm(false)} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ ...btnPrimary(saving), flex: 1 }}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
