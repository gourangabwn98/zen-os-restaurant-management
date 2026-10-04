// src/pages/admin/inventory/SuppliersTab.jsx — Inventory → Suppliers.
// "Buys" = what the supplier supplies (INV-12: stock items and/or typed
// names), else the stock items naming them as default; "Purchased" = the
// stored totalCost of every purchase recorded against them; "Owed" = their
// unpaid credit bills (INV-06). INV-13 re-order preference and INV-14 payment
// terms are stored on the supplier; the terms pick Record Purchase's default.
import { useEffect, useState, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import { getSuppliers, createSupplier, updateSupplier, deleteSupplier, getPurchases } from "../../../services/inventoryService.js";
import { Modal, Loading, ErrorBox } from "./invUI.jsx";
import { inp, label, money, fmtDate } from "./invKit.js";
import EmptyState from "../shared/EmptyState.jsx";
import { t, tn, N_, localName } from "../../../i18n/core.js";

const emptySupplier = {
  name: "", phone: "", email: "", address: "", gstNumber: "", notes: "",
  suppliedItems: [], autoOrderPreference: "ASK_FIRST", creditPreference: "UPFRONT", creditTerms: "",
};
// restaurant-server/utils/inventoryConstants.js AUTO_ORDER_PREFERENCES / CREDIT_PREFERENCES
const AUTO_ORDER = [
  { id: "ASK_FIRST", label: N_("Ask me first"), hint: N_("Show me a re-order list to check before anything is sent") },
  { id: "ONE_TAP", label: N_("One tap"), hint: N_("A ready re-order I send with one tap") },
  { id: "SEND_LINK", label: N_("Send link"), hint: N_("Send the supplier a WhatsApp list to confirm") },
];
const CREDIT = [
  { id: "GIVES_CREDIT", label: N_("Gives credit") },
  { id: "UPFRONT", label: N_("Pay on delivery") },
  { id: "OTHER", label: N_("Other terms") },
];
const suppliedName = (x) => (x.inventoryItem ? localName(x.inventoryItem) : x.name);

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
      if (p.payable?.to === "SUPPLIER" && !p.payable.settledAt) s.owed = (s.owed || 0) + Number(p.payable.amount || 0);
    });
    return m;
  }, [items, purchases]);

  const openNew = () => { setEditing(null); setForm(emptySupplier); setShowForm(true); };
  const openEdit = (s) => {
    setEditing(s);
    setForm({
      name: s.name, phone: s.phone || "", email: s.email || "", address: s.address || "", gstNumber: s.gstNumber || "", notes: s.notes || "",
      suppliedItems: (s.suppliedItems || []).map((x) => ({ inventoryItem: x.inventoryItem?._id || x.inventoryItem || null, name: x.name || "", label: suppliedName(x) })),
      autoOrderPreference: s.autoOrderPreference || "ASK_FIRST", creditPreference: s.creditPreference || "UPFRONT", creditTerms: s.creditTerms || "",
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error(t("Supplier name is required"));
    setSaving(true);
    try {
      const body = { ...form, suppliedItems: form.suppliedItems.map(({ inventoryItem, name }) => ({ inventoryItem, name })) };
      if (editing) { await updateSupplier(editing._id, body); toast.success(t("Supplier updated")); }
      else { await createSupplier(body); toast.success(t("Supplier added")); }
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

  const buysText = (s, st) => {
    const names = (s.suppliedItems || []).length ? s.suppliedItems.map(suppliedName) : (st?.items || []).map((i) => localName(i));
    return names.length ? `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}` : "—";
  };
  const [supDraft, setSupDraft] = useState("");
  const addSupplied = (entry) => setForm((f) => {
    const key = (x) => x.inventoryItem || `n:${(x.name || "").toLowerCase()}`;
    if (f.suppliedItems.some((x) => key(x) === key(entry))) return f;
    return { ...f, suppliedItems: [...f.suppliedItems, entry] };
  });
  const addTyped = () => {
    const v = supDraft.trim();
    if (!v) return;
    const match = items.find((i) => i.name.toLowerCase() === v.toLowerCase() || (i.nameBn || "") === v);
    addSupplied(match ? { inventoryItem: match._id, name: "", label: localName(match) } : { inventoryItem: null, name: v, label: v });
    setSupDraft("");
  };

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
                          {buysText(s, st)}
                        </td>
                        <td className="num">{spent(st)}{st?.owed ? <div className="ivt-hint" style={{ color: "var(--wait-ink)" }}>{t("owed {amount}", { amount: money(st.owed) })}</div> : null}</td>
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
            <div>
              <label style={label}>{t("Items they supply")}</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input style={inp} list="sup-stock-items" value={supDraft} placeholder={t("Type or pick an item, then Add")}
                  onChange={(e) => setSupDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }} />
                <button type="button" className="zc-btn" onClick={addTyped}>{t("Add")}</button>
              </div>
              <datalist id="sup-stock-items">
                {items.filter((i) => i.status === "Active").map((i) => <option key={i._id} value={i.name} />)}
              </datalist>
              {form.suppliedItems.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {form.suppliedItems.map((x, i) => (
                    <span key={`${x.inventoryItem || x.name}-${i}`} className="zc-tag vio sq" style={{ gap: 6 }}>
                      {x.label || x.name}{!x.inventoryItem && <small style={{ opacity: 0.7 }}> · {t("not stocked")}</small>}
                      <button type="button" aria-label={t("Remove {name}", { name: x.label || x.name })} style={{ background: "none", border: 0, cursor: "pointer", color: "inherit", padding: 0 }}
                        onClick={() => setForm((f) => ({ ...f, suppliedItems: f.suppliedItems.filter((_, j) => j !== i) }))}>✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <span style={label}>{t("When stock runs low")}</span>
              <div className="ivt-opts" role="radiogroup" aria-label={t("When stock runs low")}>
                {AUTO_ORDER.map((o) => (
                  <button key={o.id} type="button" role="radio" aria-checked={form.autoOrderPreference === o.id}
                    className={form.autoOrderPreference === o.id ? "on" : ""} onClick={() => setForm({ ...form, autoOrderPreference: o.id })}>{t(o.label)}</button>
                ))}
              </div>
              <div className="ivt-hint" style={{ marginTop: 5 }}>{t(AUTO_ORDER.find((o) => o.id === form.autoOrderPreference)?.hint || "")}</div>
            </div>
            <div>
              <span style={label}>{t("Payment terms")}</span>
              <div className="ivt-opts" role="radiogroup" aria-label={t("Payment terms")}>
                {CREDIT.map((o) => (
                  <button key={o.id} type="button" role="radio" aria-checked={form.creditPreference === o.id}
                    className={form.creditPreference === o.id ? "on" : ""} onClick={() => setForm({ ...form, creditPreference: o.id })}>{t(o.label)}</button>
                ))}
              </div>
              <input style={{ ...inp, marginTop: 8 }} maxLength={200} value={form.creditTerms}
                placeholder={t("e.g. pay within 15 days")} aria-label={t("Payment terms details")}
                onChange={(e) => setForm({ ...form, creditTerms: e.target.value })} />
              <div className="ivt-hint" style={{ marginTop: 5 }}>{form.creditPreference === "GIVES_CREDIT" ? t("Record Purchase starts on Credit for this supplier.") : t("Record Purchase starts on Paid for this supplier.")}</div>
            </div>
            <div><label style={label}>{t("Notes")}</label><input style={inp} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
        </Modal>
      )}
    </>
  );
}
