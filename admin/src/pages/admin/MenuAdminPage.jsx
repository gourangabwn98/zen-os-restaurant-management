// src/pages/admin/MenuAdminPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Zen OS "Menu items" — migrated to the shared design system
// (design-reference/zen-os-design-reference.html → "Menu items" / "Add menu
// item"). Visual language only: every API call, field, and rule is unchanged.
//
//   list / search / filter   getMenu({ includeUnavailable: true })
//   add / edit               createMenuItem / updateMenuItem  (multipart)
//   delete                   deleteMenuItem
//   availability toggle      updateMenuItem(id, { isAvailable })
//   categories               getCategories / createCategory / deleteCategory
// Images go to Cloudinary through the backend, same as before.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import {
  getMenu, getCategories, createMenuItem, updateMenuItem, deleteMenuItem,
  createCategory, deleteCategory,
} from "../../services/menuService.js";
import PageHeader from "./shared/PageHeader.jsx";
import StatCard from "./shared/StatCard.jsx";
import Loader from "./shared/Loader.jsx";
import EmptyState from "./shared/EmptyState.jsx";
import ErrorState from "./shared/ErrorState.jsx";

const TAGS = ["Veg", "Non Veg"];
const AVAIL_SEG = ["All", "Available", "Hidden"];
const EMPTY_FORM = {
  name: "", price: "", originalPrice: "", description: "",
  category: "", tag: "Veg", isAvailable: true, rating: 4.0,
};
const normalizeCats = (data) => (data?.data || data || []).filter(Boolean);

// ── page-scoped styles (tokens only — light / dark safe) ─────────────────────
if (typeof document !== "undefined" && !document.getElementById("menu-styles")) {
  const s = document.createElement("style");
  s.id = "menu-styles";
  s.textContent = `
    .menu-filters { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
    .menu-thumb {
      width: 40px; height: 40px; border-radius: 9px; flex: none; overflow: hidden;
      background: linear-gradient(150deg, var(--violet-mid), var(--violet-faint));
      border: 1px solid var(--edge); display: grid; place-items: center; font-size: 18px;
    }
    .menu-veg { width: 14px; height: 14px; border-radius: 3px; display: inline-grid; place-items: center; flex: none; }
    .menu-veg i { width: 6px; height: 6px; border-radius: 50%; display: block; }
    .zc-ledger tbody tr.menu-click { cursor: pointer; }
    .menu-cards { display: none; }
    @media (max-width: 900px) {
      .menu-ledger-wrap { display: none; }
      .menu-cards { display: block; }
    }
    .menu-mcard {
      border: 1px solid var(--edge); border-radius: var(--r-row); background: var(--grad-panel);
      padding: 12px 13px; margin-bottom: 8px; display: flex; gap: 11px; align-items: flex-start;
    }
    /* form */
    .menu-fgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    @media (max-width: 520px) { .menu-fgrid { grid-template-columns: 1fr; } }
    .menu-field { display: grid; gap: 6px; min-width: 0; }
    .menu-field.full { grid-column: 1 / -1; }
    .menu-field > label { font-size: 11.5px; color: var(--text-2); font-weight: 500; }
    .menu-field .hint { font-size: 10.5px; color: var(--text-3); }
    .menu-toggle-row {
      display: flex; gap: 10px; align-items: center; padding: 11px 14px; border-radius: 12px;
      border: 1px solid var(--edge); background: var(--card-2);
    }
    .menu-toggle-row.on { border-color: var(--ready-line); background: var(--ready-fill); }
    .menu-switch { width: 34px; height: 19px; border-radius: 20px; position: relative; flex: none; background: var(--edge-hi); transition: background .15s ease; }
    .menu-switch.on { background: var(--ready); box-shadow: 0 0 14px -2px var(--ready); }
    .menu-switch i { position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%; background: #fff; transition: left .15s ease; }
    .menu-switch.on i { left: 17px; }
    .menu-drop {
      width: 100%; border-radius: var(--r-ctl); border: 1px solid var(--edge);
      background: var(--card-2); overflow: hidden;
    }
    .menu-dropitem {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 9px 12px; cursor: pointer; font-size: 12.5px; color: var(--text-2);
      border-bottom: 1px solid var(--edge); transition: background .12s ease;
    }
    .menu-dropitem:last-child { border-bottom: 0; }
    .menu-dropitem:hover { background: var(--raise); }
    .menu-dropitem.on { background: var(--violet-weak); color: var(--accent-ink); font-weight: 600; }
    .menu-dropitem button { background: none; border: 0; cursor: pointer; color: var(--text-3); font-size: 13px; padding: 0 4px; line-height: 1; }
    .menu-dropitem button:hover { color: var(--stop-ink); }
  `;
  document.head.appendChild(s);
}

const VegDot = ({ tag }) => {
  const veg = tag === "Veg";
  return (
    <span className="menu-veg" style={{ border: `1.5px solid ${veg ? "var(--ready)" : "var(--stop)"}` }} aria-label={veg ? "Vegetarian" : "Non-vegetarian"}>
      <i style={{ background: veg ? "var(--ready)" : "var(--stop)" }} />
    </span>
  );
};

const Switch = ({ on, onClick, label }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick}
    className={`menu-switch${on ? " on" : ""}`} style={{ border: 0, cursor: "pointer" }}>
    <i />
  </button>
);

// Item thumbnail — the Cloudinary image, or a glyph fallback (also on load error)
const Thumb = ({ src, size = 40 }) => {
  const [broken, setBroken] = useState(false);
  const ok = typeof src === "string" && src.startsWith("http") && !broken;
  return (
    <span className="menu-thumb" style={{ width: size, height: size }}>
      {ok
        ? <img src={src} alt="" onError={() => setBroken(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 9 }} />
        : "🍽️"}
    </span>
  );
};

// ── image upload box (dashed drop target — matches reference) ────────────────
function ImageUploadBox({ currentUrl, file, onFileChange }) {
  const ref = useRef(null);
  const objUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (objUrl) URL.revokeObjectURL(objUrl); }, [objUrl]);
  const preview = objUrl || currentUrl || null;

  return (
    <div>
      <div
        onClick={() => ref.current?.click()}
        role="button" tabIndex={0} aria-label="Add photo"
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), ref.current?.click())}
        style={{
          width: 142, height: 142, borderRadius: 16, flex: "none", display: "grid", placeItems: "center",
          textAlign: "center", cursor: "pointer", overflow: "hidden", position: "relative",
          border: `1.5px dashed ${file || currentUrl ? "var(--violet-line)" : "var(--violet-mid)"}`,
          background: preview ? "var(--card-2)" : "var(--violet-faint)",
        }}
      >
        {preview ? (
          <>
            <img src={preview} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <span style={{ position: "absolute", bottom: 6, right: 6, background: "var(--scrim)", color: "#fff", fontSize: 10, padding: "2px 7px", borderRadius: 6 }}>Change</span>
          </>
        ) : (
          <div>
            <div style={{ color: "var(--accent-ink)", fontSize: 20, marginBottom: 4 }}>＋</div>
            <div style={{ fontSize: 11, color: "var(--text-2)", fontWeight: 500 }}>Add photo</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>JPG or PNG, 1:1</div>
          </div>
        )}
      </div>
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => onFileChange(e.target.files[0] || null)} />
      {file && (
        <button type="button" onClick={() => onFileChange(null)}
          style={{ marginTop: 6, fontSize: 11, color: "var(--stop-ink)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          Remove new image
        </button>
      )}
    </div>
  );
}

// ── category picker: choose / create / delete (feature preserved) ───────────
function CategoryPicker({ value, categories, onChange, onOpenCreate, onDeleteCategory }) {
  const [confirm, setConfirm] = useState(null);

  const doDelete = async () => {
    try {
      await onDeleteCategory(confirm);
      toast.success(`"${confirm.name}" deleted`);
    } catch {
      toast.error("Failed to delete category");
    } finally {
      setConfirm(null);
    }
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500 }}>Category *</label>
        <button type="button" onClick={onOpenCreate} className="zc-btn ghost sm" style={{ padding: "3px 10px" }}>＋ New</button>
      </div>
      <div className="menu-drop">
        {categories.length === 0 ? (
          <div style={{ padding: "10px 12px", fontSize: 12.5, color: "var(--text-3)" }}>No categories — create one first</div>
        ) : (
          categories.map((c) => (
            <div key={c._id} className={`menu-dropitem${value === c.name ? " on" : ""}`} onClick={() => onChange(c.name)}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {value === c.name && <span style={{ fontSize: 9 }}>●</span>}{c.name}
              </span>
              <button type="button" title={`Delete "${c.name}"`}
                onClick={(e) => { e.stopPropagation(); setConfirm(c); }}>✕</button>
            </div>
          ))
        )}
      </div>

      {confirm && (
        <div className="zc-scrim" onClick={() => setConfirm(null)} style={{ zIndex: 1200 }}>
          <div className="zc-modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="mh"><div className="t">Delete category?</div></div>
            <div className="mb" style={{ fontSize: 13, color: "var(--text-2)" }}>
              Delete <strong style={{ color: "var(--text-1)" }}>&ldquo;{confirm.name}&rdquo;</strong>? Menu items in this
              category are not deleted.
            </div>
            <div className="mf">
              <button type="button" className="zc-btn" onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className="zc-btn danger" onClick={doDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── create-category modal ──────────────────────────────────────────────────
function CategoryModal({ onClose, onSaved }) {
  const [name, setName] = useState("");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    if (!name.trim()) return toast.error("Category name is required");
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      if (file) fd.append("image", file);
      const { data } = await createCategory(fd);
      toast.success(`"${name.trim()}" created`);
      onSaved(data?.data || data);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to create category");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="zc-scrim" onClick={onClose} style={{ zIndex: 1100 }}>
      <div className="zc-modal" style={{ width: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div style={{ flex: 1 }}>
            <div className="t">New category</div>
            <div className="s">Groups items on the customer menu</div>
          </div>
          <button type="button" className="zc-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="mb" style={{ display: "grid", gap: 14 }}>
          <div className="menu-field">
            <label htmlFor="cat-name">Category name *</label>
            <input id="cat-name" className="zc-input" value={name} autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="e.g. Biryani, Desserts…" />
          </div>
          <div className="menu-field">
            <label>Category image <span style={{ color: "var(--text-3)", fontWeight: 400 }}>(optional)</span></label>
            <ImageUploadBox currentUrl={null} file={file} onFileChange={setFile} />
          </div>
        </div>
        <div className="mf">
          <button type="button" className="zc-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="zc-btn pri" disabled={loading} onClick={submit}>
            {loading ? "Creating…" : "Create category"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── add / edit menu item modal ─────────────────────────────────────────────
function ItemModal({ item, categories, onClose, onSaved, onCategoryCreated }) {
  const isEdit = !!item?._id;
  const [form, setForm] = useState(
    isEdit
      ? { ...EMPTY_FORM, ...item, price: item.price ?? "", originalPrice: item.originalPrice || "" }
      : { ...EMPTY_FORM, category: categories[0]?.name || "" },
  );
  const [imgFile, setImgFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showCat, setShowCat] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !showCat && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, showCat]);

  const deleteCat = async (cat) => {
    await deleteCategory(cat._id);
    onCategoryCreated({ name: cat.name, _deleted: true });
    if (form.category === cat.name) set("category", "");
  };

  const catCreated = (newCat) => {
    const name = typeof newCat === "string" ? newCat : newCat?.name;
    onCategoryCreated(newCat);
    if (name) set("category", name);
    setShowCat(false);
  };

  const submit = async () => {
    if (!form.name.trim()) return toast.error("Item name is required");
    if (form.price === "" || isNaN(Number(form.price))) return toast.error("Price must be a number");
    if (!form.category) return toast.error("Category is required");

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("name", form.name.trim());
      fd.append("price", form.price);
      fd.append("category", form.category);
      fd.append("tag", form.tag);
      fd.append("isAvailable", form.isAvailable);
      fd.append("rating", form.rating || 4);
      if (form.originalPrice) fd.append("originalPrice", form.originalPrice);
      if (form.description) fd.append("description", form.description);
      if (imgFile) fd.append("image", imgFile);

      let data;
      if (isEdit) {
        ({ data } = await updateMenuItem(item._id, fd));
        toast.success("Item updated");
        onSaved(data, "edit");
      } else {
        ({ data } = await createMenuItem(fd));
        toast.success("Item created");
        onSaved(data, "create");
      }
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to save item");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="zc-scrim" onClick={onClose}>
        <div className="zc-modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
          <div className="mh">
            <div style={{ flex: 1 }}>
              <div className="t">{isEdit ? "Edit menu item" : "New menu item"}</div>
              <div className="s">Appears on the customer site as soon as it is available</div>
            </div>
            <button type="button" className="zc-x" onClick={onClose} aria-label="Close">✕</button>
          </div>

          <div className="mb">
            <div style={{ display: "flex", gap: 18, marginBottom: 20, flexWrap: "wrap" }}>
              <ImageUploadBox currentUrl={form.image} file={imgFile} onFileChange={setImgFile} />
              <div className="menu-fgrid" style={{ flex: 1, minWidth: 240, alignContent: "start" }}>
                <div className="menu-field full">
                  <label htmlFor="mi-name">Item name *</label>
                  <input id="mi-name" className="zc-input" value={form.name}
                    onChange={(e) => set("name", e.target.value)} placeholder="e.g. Hyderabadi Dum Biryani" />
                </div>
                <div className="menu-field full">
                  <CategoryPicker
                    value={form.category}
                    categories={categories}
                    onChange={(v) => set("category", v)}
                    onOpenCreate={() => setShowCat(true)}
                    onDeleteCategory={deleteCat}
                  />
                </div>
                <div className="menu-field full">
                  <label>Food type *</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {TAGS.map((t) => (
                      <button key={t} type="button" onClick={() => set("tag", t)}
                        className={`zc-btn${form.tag === t ? (t === "Veg" ? " good" : " danger") : ""}`}
                        style={{ flex: 1, justifyContent: "center" }}>
                        <VegDot tag={t} />{t === "Veg" ? "Veg" : "Non-veg"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="menu-fgrid">
              <div className="menu-field">
                <label htmlFor="mi-price">Price (₹) *</label>
                <input id="mi-price" type="number" min="0" className="zc-input" value={form.price}
                  onChange={(e) => set("price", e.target.value)} placeholder="420" />
                <div className="hint">Shown as the item price</div>
              </div>
              <div className="menu-field">
                <label htmlFor="mi-oprice">Original price (₹)</label>
                <input id="mi-oprice" type="number" min="0" className="zc-input" value={form.originalPrice}
                  onChange={(e) => set("originalPrice", e.target.value)} placeholder="Optional" />
                <div className="hint">Struck-through &ldquo;was&rdquo; price — leave empty if none</div>
              </div>
              <div className="menu-field">
                <label htmlFor="mi-rating">Rating (1–5)</label>
                <input id="mi-rating" type="number" min="1" max="5" step="0.1" className="zc-input"
                  value={form.rating} onChange={(e) => set("rating", e.target.value)} />
              </div>
              <div className="menu-field full">
                <label htmlFor="mi-desc">Description</label>
                <textarea id="mi-desc" rows={3} className="zc-textarea" value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Short description shown to customers…" />
              </div>
              <div className="menu-field full">
                <label>Availability</label>
                <div className={`menu-toggle-row${form.isAvailable ? " on" : ""}`}>
                  <Switch on={form.isAvailable} onClick={() => set("isAvailable", !form.isAvailable)}
                    label="Toggle availability" />
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-1)" }}>
                    {form.isAvailable ? "Available now" : "Hidden"}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: "auto" }}>
                    {form.isAvailable ? "Customers can order this item" : "Stays in history, hidden from the menu"}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 14, padding: "10px 13px", background: "var(--card-2)", border: "1px solid var(--edge)", borderRadius: "var(--r-ctl)", fontSize: 11.5, color: "var(--text-3)" }}>
              📷 Images upload to Cloudinary automatically. Max 5 MB · square images recommended.
            </div>
          </div>

          <div className="mf">
            <button type="button" className="zc-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="zc-btn pri" disabled={loading} onClick={submit}>
              {loading ? (isEdit ? "Updating…" : "Creating…") : isEdit ? "Update item" : "Save item"}
            </button>
          </div>
        </div>
      </div>

      {showCat && <CategoryModal onClose={() => setShowCat(false)} onSaved={catCreated} />}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
export default function MenuAdminPage() {
  const [items, setItems] = useState([]);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [search, setSearch] = useState("");
  const [selCat, setSelCat] = useState("All");
  const [avail, setAvail] = useState("All");
  const [vegOnly, setVegOnly] = useState(false);

  const [modal, setModal] = useState(null); // "create" | item | null
  const [showCat, setShowCat] = useState(false);

  const loadCats = useCallback(
    () => getCategories().then((r) => setCats(normalizeCats(r.data))).catch(() => {}),
    [],
  );

  const load = useCallback(() => {
    Promise.all([getMenu({ includeUnavailable: true }), getCategories()])
      .then(([m, c]) => {
        setItems(Array.isArray(m.data) ? m.data : []);
        setCats(normalizeCats(c.data));
        setError(false);
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleSaved = (saved, mode) => {
    setItems((p) => (mode === "create" ? [saved, ...p] : p.map((i) => (i._id === saved._id ? saved : i))));
    loadCats();
  };

  const handleCategoryCreated = (newCat) => {
    if (newCat?._deleted) {
      setCats((p) => p.filter((c) => c.name !== newCat.name));
      return;
    }
    setCats((p) => (p.some((c) => c.name === newCat?.name) ? p : [...p, newCat]));
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    try {
      await deleteMenuItem(item._id);
      setItems((p) => p.filter((i) => i._id !== item._id));
      toast.success("Item deleted");
    } catch (e) {
      toast.error(e?.response?.data?.message || "Delete failed");
    }
  };

  const toggleAvail = async (item) => {
    try {
      const { data } = await updateMenuItem(item._id, { isAvailable: !item.isAvailable });
      setItems((p) => p.map((i) => (i._id === data._id ? data : i)));
      toast.success(`${data.name} → ${data.isAvailable ? "Available" : "Hidden"}`);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Update failed");
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (selCat !== "All" && i.category !== selCat) return false;
      if (avail === "Available" && !i.isAvailable) return false;
      if (avail === "Hidden" && i.isAvailable) return false;
      if (vegOnly && i.tag !== "Veg") return false;
      if (q && !i.name?.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, selCat, avail, vegOnly]);

  const availableCount = items.filter((i) => i.isAvailable).length;
  const hiddenCount = items.length - availableCount;
  const vegCount = items.filter((i) => i.tag === "Veg").length;
  const nonVegCount = items.filter((i) => i.tag === "Non Veg").length;
  const hasFilters = search || selCat !== "All" || avail !== "All" || vegOnly;
  const clearFilters = () => { setSearch(""); setSelCat("All"); setAvail("All"); setVegOnly(false); };

  const STATS = [
    { label: "Total items", value: items.length, grad: true, sub: `${cats.length} categor${cats.length === 1 ? "y" : "ies"}` },
    { label: "Available", value: availableCount, color: "var(--ready-ink)", sub: "Live on the menu" },
    { label: "Hidden", value: hiddenCount, color: "var(--text-2)", sub: hiddenCount ? "Off the menu" : "None hidden" },
    { label: "Vegetarian", value: vegCount, color: "var(--ready-ink)", sub: items.length ? `${Math.round((vegCount / items.length) * 100)}% of menu` : "—" },
    { label: "Non-vegetarian", value: nonVegCount, color: "var(--stop-ink)", sub: items.length ? `${Math.round((nonVegCount / items.length) * 100)}% of menu` : "—" },
  ];

  return (
    <div>
      <PageHeader
        title="Menu items"
        sub={`${items.length} item${items.length === 1 ? "" : "s"} across ${cats.length} categor${cats.length === 1 ? "y" : "ies"}`}
        right={
          <>
            <button type="button" className="zc-btn" onClick={() => setShowCat(true)}>＋ New category</button>
            <button type="button" className="zc-btn pri" onClick={() => setModal("create")}>＋ New item</button>
          </>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
        {STATS.map((b, i) => <StatCard key={i} {...b} />)}
      </div>

      <div className="menu-filters">
        <input
          className="zc-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by item name"
          aria-label="Search menu items"
          style={{ flex: 1, minWidth: 220 }}
        />
        <div className="zc-seg" role="tablist" aria-label="Availability filter">
          {AVAIL_SEG.map((a) => (
            <button key={a} type="button" role="tab" aria-selected={avail === a}
              className={avail === a ? "on" : ""} onClick={() => setAvail(a)}>{a}</button>
          ))}
        </div>
        <select className="zc-select" value={selCat} onChange={(e) => setSelCat(e.target.value)}
          aria-label="Category filter" style={{ width: "auto" }}>
          <option value="All">Category: All</option>
          {cats.map((c) => <option key={c._id} value={c.name}>{c.name}</option>)}
        </select>
        <button type="button" onClick={() => setVegOnly((v) => !v)}
          className={`zc-btn${vegOnly ? " good" : " ghost"}`} aria-pressed={vegOnly}>
          <VegDot tag="Veg" />Veg only
        </button>
        <div style={{ flex: 1 }} />
        {hasFilters ? (
          <>
            <span style={{ fontSize: 12, color: "var(--text-2)" }}>
              <b style={{ color: "var(--accent-ink)" }}>{filtered.length}</b> of {items.length}
            </span>
            <button type="button" className="zc-btn sm" onClick={clearFilters}>Clear ✕</button>
          </>
        ) : (
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>{items.length} item{items.length === 1 ? "" : "s"}</span>
        )}
      </div>

      <div className="zc-card">
        <div className="zc-card-h">
          <span className="t">Items</span>
          <span className="s">{loading ? "loading…" : error ? "unavailable" : `${filtered.length} shown`}</span>
        </div>

        {loading ? (
          <div style={{ padding: "16px 18px" }}><Loader rows={8} /></div>
        ) : error ? (
          <ErrorState title="Could not load the menu"
            sub="The server did not respond. Check that the backend is running, then try again."
            onRetry={load} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 5h16M4 12h16M4 19h10" />
              </svg>
            }
            title={items.length === 0 ? "No menu items yet" : "No items match"}
            sub={items.length === 0
              ? "Add your first dish or drink — it shows on the customer site as soon as it is available."
              : "Nothing matches these filters. Try clearing them."}
            action={
              items.length === 0
                ? <button type="button" className="zc-btn pri" onClick={() => setModal("create")}>＋ New item</button>
                : hasFilters ? <button type="button" className="zc-btn" onClick={clearFilters}>Clear filters</button> : null
            }
          />
        ) : (
          <>
            {/* desktop / tablet ledger */}
            <div className="menu-ledger-wrap" style={{ overflowX: "auto", padding: "6px 10px 8px" }}>
              <table className="zc-ledger" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style={{ width: 130 }}>Category</th>
                    <th className="num" style={{ width: 110 }}>Price</th>
                    <th className="num" style={{ width: 84 }}>Rating</th>
                    <th style={{ width: 132 }}>Availability</th>
                    <th style={{ width: 96 }} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item._id} className="menu-click" onClick={() => setModal(item)}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                          <Thumb src={item.image} />
                          <VegDot tag={item.tag} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{item.name}</div>
                            {item.description && (
                              <div style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>
                                {item.description}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td><span className="zc-tag done sq">{item.category || "—"}</span></td>
                      <td className="num">
                        <span style={{ fontWeight: 600, color: "var(--text-1)" }}>₹{item.price}</span>
                        {item.originalPrice ? (
                          <div style={{ fontSize: 11, color: "var(--text-3)", textDecoration: "line-through" }}>₹{item.originalPrice}</div>
                        ) : null}
                      </td>
                      <td className="num" style={{ color: "var(--wait-ink)", fontWeight: 600 }}>
                        ★ {Number(item.rating || 0).toFixed(1)}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <Switch on={item.isAvailable} onClick={() => toggleAvail(item)}
                            label={`Toggle ${item.name} availability`} />
                          <span className={`zc-tag ${item.isAvailable ? "ready" : "done"}`}>
                            <i />{item.isAvailable ? "Available" : "Hidden"}
                          </span>
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                          <button type="button" className="zc-btn ghost sm" title="Edit" onClick={() => setModal(item)}
                            style={{ padding: "5px 8px" }}>✏️</button>
                          <button type="button" className="zc-btn danger sm" title="Delete" onClick={() => handleDelete(item)}
                            style={{ padding: "5px 8px" }}>🗑️</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* mobile cards */}
            <div className="menu-cards" style={{ padding: "10px 12px 4px" }}>
              {filtered.map((item) => (
                <div key={item._id} className="menu-mcard" onClick={() => setModal(item)}>
                  <Thumb src={item.image} size={48} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <VegDot tag={item.tag} />
                      <span style={{ fontWeight: 600, color: "var(--text-1)", fontSize: 13 }}>{item.name}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
                      {item.category} · ★ {Number(item.rating || 0).toFixed(1)}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <span className="tnum" style={{ fontWeight: 700, color: "var(--text-1)" }}>₹{item.price}</span>
                      {item.originalPrice ? (
                        <span className="tnum" style={{ fontSize: 11, color: "var(--text-3)", textDecoration: "line-through" }}>₹{item.originalPrice}</span>
                      ) : null}
                      <span className={`zc-tag ${item.isAvailable ? "ready" : "done"}`}><i />{item.isAvailable ? "Available" : "Hidden"}</span>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 5 }} onClick={(e) => e.stopPropagation()}>
                        <Switch on={item.isAvailable} onClick={() => toggleAvail(item)} label={`Toggle ${item.name}`} />
                        <button type="button" className="zc-btn danger sm" style={{ padding: "4px 8px" }} onClick={() => handleDelete(item)}>🗑️</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {modal && (
        <ItemModal
          item={modal === "create" ? null : modal}
          categories={cats}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
          onCategoryCreated={handleCategoryCreated}
        />
      )}

      {showCat && (
        <CategoryModal
          onClose={() => setShowCat(false)}
          onSaved={(newCat) => { handleCategoryCreated(newCat); setShowCat(false); }}
        />
      )}
    </div>
  );
}
