import { useEffect, useState, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import {
  getInventoryItems, createInventoryItem, updateInventoryItem,
  deleteInventoryItem, adjustInventoryItem, getSuppliers,
} from "../../../services/inventoryService.js";
import {
  Modal, TableShell, TableFooter, Toolbar, Search, Seg, Spacer, Count,
  Loading, ErrorBox, LevelBadge,
} from "./invUI.jsx";
import { inp, label, levelInk, money, num } from "./invKit.js";
import ImportPurchaseModal from "./ImportPurchaseModal.jsx";
import { t, tn, N_, fmtNum, localName } from "../../../i18n/core.js";
import { unitLabel } from "../../../utils/units.js";

const UNITS = ["g", "kg", "ml", "l", "pcs", "dozen", "packet", "box"];
const LEVEL_SEG = [["All", N_("All")], ["OK", N_("Healthy")], ["LOW", N_("Low")], ["CRITICAL", N_("Critical")], ["OUT_OF_STOCK", N_("Out")]];
const PER_PAGE = 12;
const emptyItem = { name: "", nameBn: "", unit: "kg", category: "", reorderLevel: 0, criticalLevel: 0, costPrice: 0, supplier: "", isBatchTracked: false, notes: "" };

export default function StockItemsTab() {
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("All");
  const [level, setLevel] = useState("All");
  const [page, setPage] = useState(1);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyItem);
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const [adjustTarget, setAdjustTarget] = useState(null);
  const [adjustForm, setAdjustForm] = useState({ newStock: "", type: "MANUAL_ADJUSTMENT", reason: "" });
  const [adjusting, setAdjusting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [itemsRes, supRes] = await Promise.all([getInventoryItems(), getSuppliers()]);
      setItems(itemsRes.data?.items || []);
      setSuppliers(supRes.data?.suppliers || []);
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(),
    [items],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (cat !== "All" && i.category !== cat) return false;
      if (level !== "All" && i.stockLevel !== level) return false;
      if (q && !i.name.toLowerCase().includes(q) && !(i.nameBn || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, cat, level]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);
  const resetPage = () => setPage(1);

  const openNew = () => { setEditing(null); setForm(emptyItem); setShowForm(true); };
  const openEdit = (item) => {
    setEditing(item);
    setForm({
      name: item.name, nameBn: item.nameBn || "", unit: item.unit, category: item.category || "",
      reorderLevel: item.reorderLevel, criticalLevel: item.criticalLevel,
      costPrice: item.costPrice, supplier: item.supplier?._id || "",
      isBatchTracked: item.isBatchTracked, notes: item.notes || "",
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error(t("Item name is required"));
    setSaving(true);
    try {
      const payload = { ...form, supplier: form.supplier || null };
      if (editing) { await updateInventoryItem(editing._id, payload); toast.success(t("Item updated")); }
      else { await createInventoryItem(payload); toast.success(t("Item created — add stock via a Purchase")); }
      setShowForm(false);
      load();
    } catch (err) { toast.error(err.response?.data?.message || t("Save failed")); }
    finally { setSaving(false); }
  };

  const handleDeactivate = async (item) => {
    if (!window.confirm(t("Deactivate \"{name}\"? History is preserved.", { name: localName(item) }))) return;
    try { await deleteInventoryItem(item._id); toast.success(t("Item deactivated")); load(); }
    catch { toast.error(t("Failed to deactivate")); }
  };

  const openAdjust = (item, type) => {
    setAdjustTarget(item);
    setAdjustForm({ newStock: item.currentStock, type, reason: "" });
  };

  const handleAdjust = async () => {
    if (adjustForm.newStock === "" || Number(adjustForm.newStock) < 0) return toast.error(t("Enter a valid stock value"));
    setAdjusting(true);
    try {
      await adjustInventoryItem(adjustTarget._id, {
        newStock: Number(adjustForm.newStock), type: adjustForm.type, reason: adjustForm.reason,
      });
      toast.success(t("Stock updated"));
      setAdjustTarget(null);
      load();
    } catch (err) { toast.error(err.response?.data?.message || t("Adjustment failed")); }
    finally { setAdjusting(false); }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorBox onRetry={load} what={N_("stock items")} />;

  const diff = Number(adjustForm.newStock || 0) - (adjustTarget?.currentStock || 0);

  return (
    <div>
      <Toolbar>
        <Search value={search} onChange={(v) => { setSearch(v); resetPage(); }} placeholder={t("Search stock items")} />
        <select className="zc-select" value={cat} aria-label={t("Category filter")}
          onChange={(e) => { setCat(e.target.value); resetPage(); }} style={{ width: "auto" }}>
          <option value="All">{t("Category: All")}</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <Seg options={LEVEL_SEG} value={level} onChange={(v) => { setLevel(v); resetPage(); }} ariaLabel={t("Stock status filter")} />
        <Spacer />
        <Count>{tn(items.length, "{shown} of {n} item", "{shown} of {n} items", { shown: filtered.length })}</Count>
        <button type="button" className="zc-btn" onClick={() => setShowImport(true)}>⇪ {t("Import Purchase")}</button>
        <button type="button" className="zc-btn pri" onClick={openNew}>＋ {t("Add stock item")}</button>
      </Toolbar>

      <TableShell
        headers={[N_("Item"), N_("Category"), N_("In stock"), N_("Reorder at"), N_("Unit cost"), N_("Value"), N_("Status"), ""]}
        minWidth={860}
        isEmpty={filtered.length === 0}
        emptyIcon="📦"
        emptyText={items.length === 0 ? t("No stock items yet — add one to start tracking") : t("No items match these filters")}
        footer={<TableFooter page={safePage} pages={totalPages} total={filtered.length} perPage={PER_PAGE} onPage={setPage} unit={N_("items")} />}
      >
        {paged.map((item) => (
          <tr key={item._id} className={["OUT_OF_STOCK", "CRITICAL"].includes(item.stockLevel) ? "invp-hl" : undefined}>
            <td>
              <div style={{ fontWeight: 600, color: "var(--text-1)" }}>
                {localName(item)}
                {item.status === "Inactive" && <span style={{ fontSize: 10.5, color: "var(--text-3)", marginLeft: 6 }}>({t("inactive")})</span>}
              </div>
              {item.supplier?.name && <div style={{ fontSize: 11, color: "var(--text-3)" }}>{item.supplier.name}</div>}
            </td>
            <td>{item.category ? <span className="zc-tag done sq">{item.category}</span> : <span style={{ color: "var(--text-3)" }}>—</span>}</td>
            <td className="num" style={{ fontWeight: 700, color: levelInk(item.stockLevel) }}>{num(item.currentStock)} {unitLabel(item.unit)}</td>
            <td className="num" style={{ color: "var(--text-3)" }}>{num(item.reorderLevel)} {unitLabel(item.unit)}</td>
            <td className="num" style={{ color: "var(--text-2)" }}>{money(item.costPrice)}</td>
            <td className="money">{money(Number(item.currentStock || 0) * Number(item.costPrice || 0))}</td>
            <td><LevelBadge level={item.stockLevel} /></td>
            <td>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button type="button" className="zc-btn ghost sm" onClick={() => openEdit(item)}>{t("Edit")}</button>
                <button type="button" className="zc-btn ghost sm" onClick={() => openAdjust(item, "MANUAL_ADJUSTMENT")}>{t("Adjust")}</button>
                <button type="button" className="zc-btn ghost sm" onClick={() => openAdjust(item, "PHYSICAL_COUNT")}>{t("Count")}</button>
                {item.status === "Active" && (
                  <button type="button" className="zc-btn danger sm" onClick={() => handleDeactivate(item)}>{t("Deactivate")}</button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </TableShell>

      {showForm && (
        <Modal
          title={editing ? t("Edit stock item") : t("Add stock item")}
          onClose={() => setShowForm(false)}
          footer={
            <>
              <button type="button" className="zc-btn" onClick={() => setShowForm(false)}>{t("Cancel")}</button>
              <button type="button" className="zc-btn pri" disabled={saving} onClick={handleSave}>
                {saving ? t("Saving…") : editing ? t("Save changes") : t("Create item")}
              </button>
            </>
          }
        >
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label style={label}>{t("Item name")}</label>
              <input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("e.g. Basmati Rice")} />
            </div>
            <div>
              <label style={label}>{t("Bengali name")} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>({t("optional")})</span></label>
              <input style={inp} lang="bn" value={form.nameBn} onChange={(e) => setForm({ ...form, nameBn: e.target.value })} placeholder={t("e.g. বাসমতি চাল")} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={label}>{t("Unit")}</label>
                <select style={inp} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                  {UNITS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                </select>
              </div>
              <div>
                <label style={label}>{t("Category")}</label>
                <input style={inp} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder={t("e.g. Grains")} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={label}>{t("Reorder level ({unit})", { unit: unitLabel(form.unit) || t("unit") })}</label>
                <input type="number" style={inp} value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} />
              </div>
              <div>
                <label style={label}>{t("Critical level ({unit})", { unit: unitLabel(form.unit) || t("unit") })}</label>
                <input type="number" style={inp} value={form.criticalLevel} onChange={(e) => setForm({ ...form, criticalLevel: e.target.value })} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={label}>{t("Cost price per {unit} (₹)", { unit: unitLabel(form.unit) || t("unit") })}</label>
                <input type="number" style={inp} value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} />
              </div>
              <div>
                <label style={label}>{t("Default supplier")}</label>
                <select style={inp} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })}>
                  <option value="">— {t("none")} —</option>
                  {suppliers.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-2)" }}>
              <input type="checkbox" checked={form.isBatchTracked} onChange={(e) => setForm({ ...form, isBatchTracked: e.target.checked })} />
              {t("Track batches / expiry dates for this item")}
            </label>
            <div>
              <label style={label}>{t("Notes")}</label>
              <input style={inp} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {!editing && (
              <div style={{ fontSize: 11.5, color: "var(--text-3)", background: "var(--card-2)", border: "1px solid var(--edge)", padding: "10px 13px", borderRadius: "var(--r-ctl)" }}>
                {t("New items start at 0 stock — record a Purchase afterwards to bring stock in.")}
              </div>
            )}
          </div>
        </Modal>
      )}

      {adjustTarget && (
        <Modal
          title={adjustForm.type === "PHYSICAL_COUNT" ? t("Physical stock count") : t("Adjust stock")}
          sub={t("{name} — currently {qty}", { name: localName(adjustTarget), qty: `${num(adjustTarget.currentStock)} ${unitLabel(adjustTarget.unit)}` })}
          onClose={() => setAdjustTarget(null)}
          width={420}
          footer={
            <>
              <button type="button" className="zc-btn" onClick={() => setAdjustTarget(null)}>{t("Cancel")}</button>
              <button type="button" className="zc-btn pri" disabled={adjusting} onClick={handleAdjust}>
                {adjusting ? t("Saving…") : t("Confirm")}
              </button>
            </>
          }
        >
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label style={label}>{adjustForm.type === "PHYSICAL_COUNT" ? t("Counted quantity") : t("New stock value")} ({unitLabel(adjustTarget.unit)})</label>
              <input type="number" style={inp} value={adjustForm.newStock} onChange={(e) => setAdjustForm({ ...adjustForm, newStock: e.target.value })} />
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
                {t("Logged difference:")} <b style={{ color: diff >= 0 ? "var(--ready-ink)" : "var(--stop-ink)" }}>{diff >= 0 ? "+" : ""}{fmtNum(diff, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {unitLabel(adjustTarget.unit)}</b>
              </div>
            </div>
            <div>
              <label style={label}>{t("Reason")}</label>
              <input style={inp} value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                placeholder={adjustForm.type === "PHYSICAL_COUNT" ? t("e.g. Monthly count") : t("e.g. Correcting entry error")} />
            </div>
          </div>
        </Modal>
      )}

      {showImport && (
        <ImportPurchaseModal
          inventoryItems={items}
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}
    </div>
  );
}
