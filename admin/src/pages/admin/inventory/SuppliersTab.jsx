// src/pages/admin/inventory/SuppliersTab.jsx — Inventory → Suppliers.
// "Buys" = active stock items naming this supplier as default; "Purchased" =
// the stored totalCost of every purchase recorded against them. No dues /
// credit figure — the purchase model has no paid/unpaid field.
import { useEffect, useState, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import { getSuppliers, createSupplier, updateSupplier, deleteSupplier, getPurchases } from "../../../services/inventoryService.js";
import { Modal, Loading, ErrorBox } from "./invUI.jsx";
import { inp, label, money, fmtDate } from "./invKit.js";
import EmptyState from "../shared/EmptyState.jsx";
import { t, tn, N_, localName } from "../../../i18n/core.js";

const emptySupplier = { name: "", phone: "", email: "", address: "", gstNumber: "", notes: "" };

export default function SuppliersTab({ items = [], version, refresh }) {
  const [suppliers, setSuppliers] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptySupplier);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sRes, pRes] = await Promise.all([getSuppliers(), getPurchases().catch(() => null)]);
      setSuppliers(sRes.data?.suppliers || []);
      setPurchases(pRes?.data?.purchases || []);
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, version]);
  // The page shares the supplier list with the stock / purchase forms.
  const reload = () => { load(); refresh?.(); };

  const stats = useMemo(() => {
    const m = new Map();
    const get = (id) => { if (!m.has(id)) m.set(id, { items: [], spent: 0, bills: 0, last: null }); return m.get(id); };
    items.filter((i) => i.status === "Active" && i.supplier?._id).forEach((i) => get(i.supplier._id).items.push(i));
    purchases.forEach((p) => {
      if (!p.supplier?._id) return;
      const s = get(p.supplier._id);
      s.spent += Number(p.totalCost || 0);
      s.bills += 1;
      const d = new Date(p.purchaseDate || p.createdAt);
      if (!s.last || d > s.last) s.last = d;
    });
    return m;
  }, [items, purchases]);

  const openNew = () => { setEditing(null); setForm(emptySupplier); setShowForm(true); };
  const openEdit = (s) => {
    setEditing(s);
    setForm({ name: s.name, phone: s.phone || "", email: s.email || "", address: s.address || "", gstNumber: s.gstNumber || "", notes: s.notes || "" });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error(t("Supplier name is required"));
    setSaving(true);
    try {
      if (editing) { await updateSupplier(editing._id, form); toast.success(t("Supplier updated")); }
      else { await createSupplier(form); toast.success(t("Supplier added")); }
      setShowForm(false);
      reload();
    } catch (err) { toast.error(err.response?.data?.message || t("Save failed")); }
    finally { setSaving(false); }
  };

  const handleToggle = async (s) => {
    try { await updateSupplier(s._id, { status: s.status === "Active" ? "Inactive" : "Active" }); reload(); }
    catch { toast.error(t("Failed to update")); }
  };

  const handleDelete = async (s) => {
    if (!window.confirm(t("Delete \"{name}\"?", { name: s.name }))) return;
    try { await deleteSupplier(s._id); toast.success(t("Supplier deleted")); reload(); }
    catch { toast.error(t("Failed to delete")); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => [s.name, s.phone, s.email, s.gstNumber].some((v) => (v || "").toLowerCase().includes(q)));
  }, [suppliers, search]);

  const actions = (s) => (
    <div className="ivt-acts">
      <button type="button" className="zc-btn ghost sm" onClick={() => openEdit(s)}>{t("Edit")}</button>
      <button type="button" className="zc-btn ghost sm" onClick={() => handleToggle(s)}>
        {s.status === "Active" ? t("Deactivate") : t("Activate")}
      </button>
      <button type="button" className="zc-btn danger sm" onClick={() => handleDelete(s)}>{t("Delete")}</button>
    </div>
  );
  const spent = (st) => (
    <>
      <b className="tnum">{st?.bills ? money(st.spent) : "—"}</b>
      {st?.bills ? <div className="ivt-hint">{tn(st.bills, "{n} bill", "{n} bills")}</div> : null}
    </>
  );

  if (loading) return <Loading />;
  if (error) return <ErrorBox onRetry={load} what={N_("suppliers")} />;

  return (
    <>
      <div className="ivt-fbar">
        <input className="zc-input search" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={t("Search suppliers")} aria-label={t("Search suppliers")} />
        <span className="ivt-sp" />
        <span className="ivt-hint">{tn(suppliers.length, "{n} supplier", "{n} suppliers")}</span>
        <button type="button" className="zc-btn pri" onClick={openNew}>＋ {t("Add supplier")}</button>
      </div>

      <div className="zc-card">
        {filtered.length === 0 ? (
          <EmptyState title={suppliers.length === 0 ? t("No suppliers added yet") : t("No suppliers match this search")}
            action={suppliers.length === 0 ? <button type="button" className="zc-btn pri" onClick={openNew}>＋ {t("Add supplier")}</button> : null} />
        ) : (
          <>
            <div className="ivt-tablewrap">
              <table className="zc-ledger" style={{ minWidth: 920 }}>
                <thead>
                  <tr><th>{t("Supplier")}</th><th>{t("Phone")}</th><th>{t("Buys")}</th><th className="num">{t("Purchased")}</th><th>{t("Last bill")}</th><th>{t("Status")}</th><th /></tr>
                </thead>
                <tbody>
                  {filtered.map((s) => {
                    const st = stats.get(s._id);
                    return (
                      <tr key={s._id}>
                        <td>
                          <div className="ivt-name"><b>{s.name}</b><small>{[s.email, s.gstNumber && `GST ${s.gstNumber}`].filter(Boolean).join(" · ") || "—"}</small></div>
                        </td>
                        <td style={{ color: "var(--text-2)" }}>{s.phone || "—"}</td>
                        <td style={{ color: "var(--text-2)", fontSize: 11.5, maxWidth: 260 }}>
                          {st?.items.length ? `${st.items.slice(0, 3).map((i) => localName(i)).join(", ")}${st.items.length > 3 ? ` +${st.items.length - 3}` : ""}` : "—"}
                        </td>
                        <td className="num">{spent(st)}</td>
                        <td style={{ color: "var(--text-2)" }}>{st?.last ? fmtDate(st.last) : "—"}</td>
                        <td><span className={`zc-tag ${s.status === "Active" ? "ready" : "stop"}`}><i />{t(s.status)}</span></td>
                        <td>{actions(s)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="ivt-cards">
              {filtered.map((s) => {
                const st = stats.get(s._id);
                return (
                  <div key={s._id} className="ivt-ocard">
                    <div className="top">
                      <div className="ivt-name" style={{ minWidth: 0 }}>
                        <b>{s.name}</b>
                        <small>{s.phone || "—"}{st?.items.length ? ` · ${tn(st.items.length, "{n} item", "{n} items")}` : ""}</small>
                      </div>
                      <div style={{ textAlign: "right", flex: "none" }}>{spent(st)}</div>
                    </div>
                    <div className="meta">
                      <span className={`zc-tag ${s.status === "Active" ? "ready" : "stop"}`}><i />{t(s.status)}</span>
                      <div style={{ marginLeft: "auto" }}>{actions(s)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {showForm && (
        <Modal
          title={editing ? t("Edit supplier") : t("Add supplier")}
          onClose={() => setShowForm(false)}
          footer={
            <>
              <button type="button" className="zc-btn" onClick={() => setShowForm(false)}>{t("Cancel")}</button>
              <button type="button" className="zc-btn pri" disabled={saving} onClick={handleSave}>
                {saving ? t("Saving…") : t("Save")}
              </button>
            </>
          }
        >
          <div style={{ display: "grid", gap: 14 }}>
            <div><label style={label}>{t("Name")}</label><input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="ivt-grid2" style={{ gap: 10 }}>
              <div><label style={label}>{t("Phone")}</label><input style={inp} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><label style={label}>{t("Email")}</label><input style={inp} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <div><label style={label}>{t("Address")}</label><input style={inp} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div><label style={label}>{t("GST number")}</label><input style={inp} value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} /></div>
            <div><label style={label}>{t("Notes")}</label><input style={inp} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
        </Modal>
      )}
    </>
  );
}
