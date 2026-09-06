import { useEffect, useState, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import { getSuppliers, createSupplier, updateSupplier, deleteSupplier } from "../../../services/inventoryService.js";
import { Modal, TableShell, Toolbar, Search, Spacer, Loading, ErrorBox } from "./invUI.jsx";
import { inp, label } from "./invKit.js";

const emptySupplier = { name: "", phone: "", email: "", address: "", gstNumber: "", notes: "" };

export default function SuppliersTab() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptySupplier);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setSuppliers((await getSuppliers()).data?.suppliers || []); setError(false); }
    catch { setError(true); }
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) =>
      [s.name, s.phone, s.email, s.gstNumber].some((v) => (v || "").toLowerCase().includes(q)),
    );
  }, [suppliers, search]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox onRetry={load} what="suppliers" />;

  return (
    <div>
      <Toolbar>
        <Search value={search} onChange={setSearch} placeholder="Search suppliers" />
        <Spacer />
        <button type="button" className="zc-btn pri" onClick={openNew}>＋ Add supplier</button>
      </Toolbar>

      <TableShell
        headers={["Name", "Phone", "Email", "GST no.", "Status", ""]}
        minWidth={780}
        isEmpty={filtered.length === 0}
        emptyIcon="🚚"
        emptyText={suppliers.length === 0 ? "No suppliers added yet" : "No suppliers match this search"}
      >
        {filtered.map((s) => (
          <tr key={s._id}>
            <td style={{ fontWeight: 600, color: "var(--text-1)" }}>{s.name}</td>
            <td style={{ color: "var(--text-2)" }}>{s.phone || "—"}</td>
            <td style={{ color: "var(--text-2)" }}>{s.email || "—"}</td>
            <td style={{ color: "var(--text-2)" }}>{s.gstNumber || "—"}</td>
            <td>
              <span className={`zc-tag ${s.status === "Active" ? "ready" : "stop"}`}><i />{s.status}</span>
            </td>
            <td>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button type="button" className="zc-btn ghost sm" onClick={() => openEdit(s)}>Edit</button>
                <button type="button" className="zc-btn ghost sm" onClick={() => handleToggle(s)}>
                  {s.status === "Active" ? "Deactivate" : "Activate"}
                </button>
                <button type="button" className="zc-btn danger sm" onClick={() => handleDelete(s)}>Delete</button>
              </div>
            </td>
          </tr>
        ))}
      </TableShell>

      {showForm && (
        <Modal
          title={editing ? "Edit supplier" : "Add supplier"}
          onClose={() => setShowForm(false)}
          footer={
            <>
              <button type="button" className="zc-btn" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="button" className="zc-btn pri" disabled={saving} onClick={handleSave}>
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <div style={{ display: "grid", gap: 14 }}>
            <div><label style={label}>Name</label><input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><label style={label}>Phone</label><input style={inp} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><label style={label}>Email</label><input style={inp} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <div><label style={label}>Address</label><input style={inp} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div><label style={label}>GST number</label><input style={inp} value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} /></div>
            <div><label style={label}>Notes</label><input style={inp} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
