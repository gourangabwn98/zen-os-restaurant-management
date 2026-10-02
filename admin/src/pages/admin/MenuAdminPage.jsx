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
//   categories               getCategories / createCategory / updateCategory / deleteCategory
//                            (Categories manager: view, add, edit/rename, delete empty)
//   scheduled visibility     updateMenuSchedule (PATCH /menu/schedule, bulk)
// Images go to Cloudinary through the backend, same as before.
//
// Scheduling is separate from availability: a customer sees an item only if
// it is Available AND its category's window AND its own window allow the
// current restaurant time (enforced server-side — this page just edits it).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import {
  getMenu, getCategories, createMenuItem, updateMenuItem, deleteMenuItem,
  createCategory, updateCategory, deleteCategory, updateMenuSchedule,
} from "../../services/menuService.js";
import PageHeader from "./shared/PageHeader.jsx";
import StatCard from "./shared/StatCard.jsx";
import Loader from "./shared/Loader.jsx";
import EmptyState from "./shared/EmptyState.jsx";
import ErrorState from "./shared/ErrorState.jsx";
import { t, tn, N_, fmtNum, localName } from "../../i18n/core.js";

// Stored values; labels go through t().
const TAGS = ["Veg", "Non Veg"];
const AVAIL_SEG = [N_("All"), N_("Available"), N_("Hidden")];
const EMPTY_FORM = {
  name: "", nameBn: "", price: "", originalPrice: "", description: "",
  category: "", tag: "Veg", isAvailable: true, rating: 4.0,
};
const normalizeCats = (data) => (data?.data || data || []).filter(Boolean);
const BULK_CONFIRM_AT = 5; // confirm bulk schedule changes touching this many entries or more

// "17:00" → "5:00 PM"
const fmt12 = (hhmm) => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || "");
  if (!m) return hhmm || "";
  const h = Number(m[1]);
  return `${fmtNum(((h + 11) % 12) + 1)}:${fmtNum(Number(m[2]), { minimumIntegerDigits: 2 })} ${h < 12 ? t("AM") : t("PM")}`;
};
const hasSchedule = (x) => x?.schedule?.enabled === true;
// Categories are referenced by their (English) name; show the Bengali one when set.
const catLabel = (cats, name) => localName(cats.find((c) => c.name === name) || name);
const schedLabel = (sc) => `${fmt12(sc.startTime)} – ${fmt12(sc.endTime)}${sc.endTime < sc.startTime ? ` (${t("overnight")})` : ""}`;
const schedError = (start, end) => {
  if (!start || !end) return t("Choose both a start and an end time");
  if (start === end) return t("Start and end time cannot be the same");
  return null;
};

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
    /* scheduled visibility */
    .menu-sched-badge {
      display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 500;
      padding: 1px 7px; border-radius: 6px; white-space: nowrap;
      color: var(--accent-ink); background: var(--violet-faint); border: 1px solid var(--violet-line);
    }
    .menu-sched-badge.off { color: var(--text-3); background: var(--card-2); border-color: var(--edge); }
    .menu-catpick { display: flex; flex-wrap: wrap; gap: 7px; }
    .menu-catchip {
      display: inline-flex; align-items: center; gap: 7px; padding: 6px 10px; border-radius: 10px; cursor: pointer;
      border: 1px solid var(--edge); background: var(--card-2); font-size: 12.5px; color: var(--text-1); user-select: none;
    }
    .menu-catchip.on { border-color: var(--violet-line); background: var(--violet-faint); }
    .menu-cb { width: 15px; height: 15px; accent-color: var(--accent-ink); cursor: pointer; flex: none; margin: 0; }
    .menu-sched-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
  `;
  document.head.appendChild(s);
}

const VegDot = ({ tag }) => {
  const veg = tag === "Veg";
  return (
    <span className="menu-veg" style={{ border: `1.5px solid ${veg ? "var(--ready)" : "var(--stop)"}` }} aria-label={veg ? t("Vegetarian") : t("Non-vegetarian")}>
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

// 🕒 5:00 PM – 11:00 PM  (dimmed with "off now" when outside its window)
const ScheduleBadge = ({ schedule, off }) => (
  <span className={`menu-sched-badge${off ? " off" : ""}`}
    title={off ? t("Outside its schedule — hidden from customers right now") : t("Visible to customers only in this window")}>
    🕒 {schedLabel(schedule)}{off ? ` · ${t("off now")}` : ""}
  </span>
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
        role="button" tabIndex={0} aria-label={t("Add photo")}
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
            <img src={preview} alt={t("preview")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <span style={{ position: "absolute", bottom: 6, right: 6, background: "var(--scrim)", color: "#fff", fontSize: 10, padding: "2px 7px", borderRadius: 6 }}>{t("Change")}</span>
          </>
        ) : (
          <div>
            <div style={{ color: "var(--accent-ink)", fontSize: 20, marginBottom: 4 }}>＋</div>
            <div style={{ fontSize: 11, color: "var(--text-2)", fontWeight: 500 }}>{t("Add photo")}</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{t("JPG or PNG, 1:1")}</div>
          </div>
        )}
      </div>
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => onFileChange(e.target.files[0] || null)} />
      {file && (
        <button type="button" onClick={() => onFileChange(null)}
          style={{ marginTop: 6, fontSize: 11, color: "var(--stop-ink)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          {t("Remove new image")}
        </button>
      )}
    </div>
  );
}

// ── category picker: choose / create / delete (feature preserved) ───────────
function CategoryPicker({ value, categories, onChange, onOpenCreate, onDeleteCategory }) {
  const [confirm, setConfirm] = useState(null);
  const selected = categories.find((c) => c.name === value) || null;

  const doDelete = async () => {
    try {
      await onDeleteCategory(confirm);
      toast.success(t("\"{name}\" deleted", { name: localName(confirm) }));
    } catch (e) {
      toast.error(e?.response?.data?.message || t("Failed to delete category"));
    } finally {
      setConfirm(null);
    }
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500 }}>{t("Category")} *</label>
        <button type="button" onClick={onOpenCreate} className="zc-btn ghost sm" style={{ padding: "3px 10px" }}>＋ {t("New")}</button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <select className="zc-select" style={{ flex: 1 }} value={value || ""} disabled={categories.length === 0}
          onChange={(e) => onChange(e.target.value)}>
          {categories.length === 0 ? (
            <option value="">{t("No categories — create one first")}</option>
          ) : (
            <>
              {!value && <option value="" disabled>{t("Select a category…")}</option>}
              {categories.map((c) => <option key={c._id} value={c.name}>{localName(c)}</option>)}
            </>
          )}
        </select>
        {selected && (
          <button type="button" className="zc-btn ghost sm" title={t("Delete \"{name}\"", { name: localName(selected) })}
            onClick={() => setConfirm(selected)}>✕</button>
        )}
      </div>

      {confirm && (
        <div className="zc-scrim" onClick={() => setConfirm(null)} style={{ zIndex: 1200 }}>
          <div className="zc-modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="mh"><div className="t">{t("Delete category?")}</div></div>
            <div className="mb" style={{ fontSize: 13, color: "var(--text-2)" }}>
              {t("Delete “{name}”? Only possible once no menu item uses it.", { name: localName(confirm) })}
            </div>
            <div className="mf">
              <button type="button" className="zc-btn" onClick={() => setConfirm(null)}>{t("Cancel")}</button>
              <button type="button" className="zc-btn danger" onClick={doDelete}>{t("Delete")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const isUrl = (s) => typeof s === "string" && /^https?:\/\//i.test(s);

// Category thumbnail — its uploaded image, else its emoji (older categories
// store one, e.g. "🍕"), else a generic glyph.
const CatThumb = ({ image, size = 38 }) => {
  const [broken, setBroken] = useState(false);
  const showImg = isUrl(image) && !broken;
  return (
    <span className="menu-thumb" style={{ width: size, height: size, fontSize: size * 0.48 }}>
      {showImg
        ? <img src={image} alt="" onError={() => setBroken(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 9 }} />
        : (image && !isUrl(image) ? image : "🗂️")}
    </span>
  );
};

// ── add / edit category modal ──────────────────────────────────────────────
// `category` null → create; otherwise edit (rename and/or change the image).
// A rename moves every item in the category along with it (server-side).
function CategoryModal({ category = null, onClose, onSaved }) {
  const isEdit = !!category?._id;
  const [name, setName] = useState(category?.name || "");
  const [nameBn, setNameBn] = useState(category?.nameBn || "");
  const [file, setFile] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [loading, setLoading] = useState(false);
  const currentImage = removeImage ? "" : (category?.image || "");
  const renaming = isEdit && name.trim() && name.trim() !== category.name;
  const itemCount = category?.itemCount ?? 0;

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !loading && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, loading]);

  const submit = async () => {
    if (!name.trim()) return toast.error(t("Category name is required"));
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      fd.append("nameBn", nameBn.trim());
      if (file) fd.append("image", file);
      else if (isEdit && removeImage) fd.append("removeImage", "true");
      if (isEdit) {
        const { data } = await updateCategory(category._id, fd);
        toast.success(data.renamedFrom
          ? `${t("Renamed to \"{name}\"", { name: data.category.name })}${data.itemsMoved ? ` · ${tn(data.itemsMoved, "{n} item moved", "{n} items moved")}` : ""}`
          : t("Category updated"));
        onSaved(data.category, { renamedFrom: data.renamedFrom });
      } else {
        const { data } = await createCategory(fd);
        toast.success(t("\"{name}\" created", { name: name.trim() }));
        onSaved(data?.data || data, { created: true });
      }
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || (isEdit ? t("Failed to update category") : t("Failed to create category")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="zc-scrim" onClick={() => !loading && onClose()} style={{ zIndex: 1100 }}>
      <div className="zc-modal" style={{ width: 420 }} role="dialog" aria-modal="true" aria-labelledby="cat-form-title"
        onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div style={{ flex: 1 }}>
            <div className="t" id="cat-form-title">{isEdit ? t("Edit category") : t("New category")}</div>
            <div className="s">{t("Groups items on the customer menu")}</div>
          </div>
          <button type="button" className="zc-x" onClick={onClose} disabled={loading} aria-label={t("Close")}>✕</button>
        </div>
        <div className="mb" style={{ display: "grid", gap: 14 }}>
          <div className="menu-field">
            <label htmlFor="cat-name">{t("Category name")} *</label>
            <input id="cat-name" className="zc-input" value={name} autoFocus maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder={t("e.g. Biryani, Desserts…")} />
            {renaming && itemCount > 0 && (
              <div className="hint">
                {tn(itemCount, "The {n} item in “{name}” will move to the new name.", "The {n} items in “{name}” will move to the new name.", { name: category.name })}
              </div>
            )}
          </div>
          <div className="menu-field">
            <label htmlFor="cat-name-bn">{t("Bengali name")} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>({t("optional")})</span></label>
            <input id="cat-name-bn" lang="bn" className="zc-input" value={nameBn} maxLength={40}
              onChange={(e) => setNameBn(e.target.value)} placeholder={t("e.g. বিরিয়ানি, মিষ্টি…")} />
            <div className="hint">{t("Shown when the admin panel is in Bengali. Customers and the kitchen still see the English name.")}</div>
          </div>
          <div className="menu-field">
            <label>{t("Category image")} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>({t("optional")})</span></label>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
              <ImageUploadBox currentUrl={isUrl(currentImage) ? currentImage : null} file={file} onFileChange={setFile} />
              {isEdit && !file && category.image && (
                <div style={{ display: "grid", gap: 6, fontSize: 11.5, color: "var(--text-3)" }}>
                  {!isUrl(category.image) && !removeImage && (
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {t("Current:")} <CatThumb image={category.image} size={30} />
                    </span>
                  )}
                  <button type="button" className="zc-btn ghost sm" onClick={() => setRemoveImage((v) => !v)}>
                    {removeImage ? t("Keep current image") : t("Remove image")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="mf">
          <button type="button" className="zc-btn" onClick={onClose} disabled={loading}>{t("Cancel")}</button>
          <button type="button" className="zc-btn pri" disabled={loading} onClick={submit}>
            {loading ? t("Saving…") : isEdit ? t("Save changes") : t("Create category")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── categories manager (header → "Categories") ─────────────────────────────
// View / add / edit / delete. "View items" filters the menu list to that
// category. Delete is only offered for empty categories (the server refuses
// otherwise, so no item is ever left without a category).
function CategoriesModal({ cats, items, onClose, onChanged, onView }) {
  const [q, setQ] = useState("");
  const [form, setForm] = useState(null);         // null | "create" | category
  const [confirmDel, setConfirmDel] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !form && !confirmDel && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, form, confirmDel]);

  // Live counts from the loaded items (they include hidden ones); falls back
  // to the server's itemCount before the items list has loaded.
  const counts = useMemo(() => {
    const m = new Map();
    for (const i of items) m.set(i.category, (m.get(i.category) || 0) + 1);
    return m;
  }, [items]);
  const countOf = (c) => (items.length ? counts.get(c.name) || 0 : c.itemCount || 0);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? cats.filter((c) => c.name.toLowerCase().includes(s) || (c.nameBn || "").toLowerCase().includes(s)) : cats;
  }, [cats, q]);

  const doDelete = async () => {
    setDeleting(true);
    try {
      await deleteCategory(confirmDel._id);
      toast.success(t("\"{name}\" deleted", { name: localName(confirmDel) }));
      onChanged({ deleted: confirmDel.name, deletedId: confirmDel._id });
      setConfirmDel(null);
    } catch (e) {
      toast.error(e?.response?.data?.message || t("Failed to delete category"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="zc-scrim" onClick={() => !form && !confirmDel && onClose()}>
        <div className="zc-modal" style={{ width: 680 }} role="dialog" aria-modal="true" aria-labelledby="cats-title"
          onClick={(e) => e.stopPropagation()}>
          <div className="mh">
            <div style={{ flex: 1 }}>
              <div className="t" id="cats-title">🗂️ {t("Categories")}</div>
              <div className="s">{tn(cats.length, "{n} category", "{n} categories")} · {t("add, rename, change images, or remove empty ones")}</div>
            </div>
            <button type="button" className="zc-x" onClick={onClose} aria-label={t("Close")}>✕</button>
          </div>

          <div className="mb" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input className="zc-input" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={t("Search categories")} aria-label={t("Search categories")} style={{ flex: "1 1 200px" }} />
              <button type="button" className="zc-btn pri" onClick={() => setForm("create")}>＋ {t("Add category")}</button>
            </div>

            {cats.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>
                {t("No categories yet — add one to start building the menu.")}
              </div>
            ) : shown.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>{t("No categories match.")}</div>
            ) : (
              <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                {shown.map((c) => {
                  const n = countOf(c);
                  return (
                    <div key={c._id} style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                      borderBottom: "1px solid var(--border)", flexWrap: "wrap",
                    }}>
                      <CatThumb image={c.image} />
                      <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text-1)", overflowWrap: "anywhere" }}>{localName(c)}{c.nameBn && <span style={{ fontWeight: 400, fontSize: 11.5, color: "var(--text-3)" }}> · {c.nameBn === localName(c) ? c.name : c.nameBn}</span>}</div>
                        <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <span>{tn(n, "{n} item", "{n} items")}</span>
                          {hasSchedule(c) && <ScheduleBadge schedule={c.schedule} />}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button type="button" className="zc-btn ghost sm" disabled={n === 0}
                          title={n === 0 ? t("No items in this category") : t("Show only {name} items", { name: localName(c) })}
                          onClick={() => onView(c.name)}>{t("View items")}</button>
                        <button type="button" className="zc-btn sm" onClick={() => setForm({ ...c, itemCount: n })}>{t("Edit")}</button>
                        <button type="button" className="zc-btn danger sm" disabled={n > 0}
                          title={n > 0 ? tn(n, "Move or delete its {n} item first", "Move or delete its {n} items first") : t("Delete {name}", { name: localName(c) })}
                          onClick={() => setConfirmDel(c)}>{t("Delete")}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>
              {t("Renaming moves the category’s items with it. A category can only be deleted once it has no items. Time windows are set under 🕒 Scheduled visibility.")}
            </div>
          </div>
        </div>
      </div>

      {form && (
        <CategoryModal
          category={form === "create" ? null : form}
          onClose={() => setForm(null)}
          onSaved={(saved, info) => onChanged({ saved, ...info })}
        />
      )}

      {confirmDel && (
        <div className="zc-scrim" onClick={() => !deleting && setConfirmDel(null)} style={{ zIndex: 1200 }}>
          <div className="zc-modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="mh"><div className="t">{t("Delete category?")}</div></div>
            <div className="mb" style={{ fontSize: 13, color: "var(--text-2)" }}>
              {t("Delete “{name}”? This can’t be undone.", { name: localName(confirmDel) })}
            </div>
            <div className="mf">
              <button type="button" className="zc-btn" disabled={deleting} onClick={() => setConfirmDel(null)}>{t("Cancel")}</button>
              <button type="button" className="zc-btn danger" disabled={deleting} onClick={doDelete}>
                {deleting ? t("Deleting…") : t("Delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
  const origSched = hasSchedule(item)
    ? { enabled: true, startTime: item.schedule.startTime, endTime: item.schedule.endTime }
    : { enabled: false, startTime: "", endTime: "" };
  const [sched, setSched] = useState(origSched);
  const schedChanged = sched.enabled !== origSched.enabled ||
    (sched.enabled && (sched.startTime !== origSched.startTime || sched.endTime !== origSched.endTime));
  const catSched = categories.find((c) => c.name === form.category && hasSchedule(c))?.schedule;

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
    if (!form.name.trim()) return toast.error(t("Item name is required"));
    if (form.price === "" || isNaN(Number(form.price))) return toast.error(t("Price must be a number"));
    if (!form.category) return toast.error(t("Category is required"));
    if (sched.enabled) {
      const err = schedError(sched.startTime, sched.endTime);
      if (err) return toast.error(err);
    }

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("name", form.name.trim());
      fd.append("nameBn", (form.nameBn || "").trim());
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
      } else {
        ({ data } = await createMenuItem(fd));
      }
      // Schedule is saved through its own validated endpoint (the item form
      // endpoint never touches it). The item is already saved at this point,
      // so a schedule failure is reported on its own, not as "not saved".
      let scheduleChanged = false;
      if (schedChanged) {
        try {
          const schedule = sched.enabled ? { startTime: sched.startTime, endTime: sched.endTime } : null;
          const { data: r } = await updateMenuSchedule({ itemIds: [data._id], schedule });
          data = { ...data, schedule: r.schedule };
          scheduleChanged = true;
        } catch (e) {
          toast.error(t("Item saved, but the schedule was not: {reason}", { reason: e?.response?.data?.message || t("request failed") }));
        }
      }
      toast.success(isEdit ? t("Item updated") : t("Item created"));
      onSaved(data, isEdit ? "edit" : "create", { scheduleChanged });
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || t("Failed to save item"));
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
              <div className="t">{isEdit ? t("Edit menu item") : t("New menu item")}</div>
              <div className="s">{t("Appears on the customer site as soon as it is available")}</div>
            </div>
            <button type="button" className="zc-x" onClick={onClose} aria-label={t("Close")}>✕</button>
          </div>

          <div className="mb">
            <div style={{ display: "flex", gap: 18, marginBottom: 20, flexWrap: "wrap" }}>
              <ImageUploadBox currentUrl={form.image} file={imgFile} onFileChange={setImgFile} />
              <div className="menu-fgrid" style={{ flex: 1, minWidth: 240, alignContent: "start" }}>
                <div className="menu-field full">
                  <label htmlFor="mi-name">{t("Item name")} *</label>
                  <input id="mi-name" className="zc-input" value={form.name}
                    onChange={(e) => set("name", e.target.value)} placeholder={t("e.g. Hyderabadi Dum Biryani")} />
                </div>
                <div className="menu-field full">
                  <label htmlFor="mi-name-bn">{t("Bengali name")} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>({t("optional")})</span></label>
                  <input id="mi-name-bn" lang="bn" className="zc-input" value={form.nameBn || ""}
                    onChange={(e) => set("nameBn", e.target.value)} placeholder={t("e.g. হায়দ্রাবাদি দম বিরিয়ানি")} />
                  <div className="hint">{t("Shown in the admin panel’s Bengali mode. Customers, bills and the kitchen ticket still use the English name.")}</div>
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
                  <label>{t("Food type")} *</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {TAGS.map((tg) => (
                      <button key={tg} type="button" onClick={() => set("tag", tg)}
                        className={`zc-btn${form.tag === tg ? (tg === "Veg" ? " good" : " danger") : ""}`}
                        style={{ flex: 1, justifyContent: "center" }}>
                        <VegDot tag={tg} />{tg === "Veg" ? t("Veg") : t("Non-veg")}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="menu-fgrid">
              <div className="menu-field">
                <label htmlFor="mi-price">{t("Price (₹)")} *</label>
                <input id="mi-price" type="number" min="0" className="zc-input" value={form.price}
                  onChange={(e) => set("price", e.target.value)} placeholder="420" />
                <div className="hint">{t("Shown as the item price")}</div>
              </div>
              <div className="menu-field">
                <label htmlFor="mi-oprice">{t("Original price (₹)")}</label>
                <input id="mi-oprice" type="number" min="0" className="zc-input" value={form.originalPrice}
                  onChange={(e) => set("originalPrice", e.target.value)} placeholder={t("Optional")} />
                <div className="hint">{t("Struck-through “was” price — leave empty if none")}</div>
              </div>
              <div className="menu-field">
                <label htmlFor="mi-rating">{t("Rating (1–5)")}</label>
                <input id="mi-rating" type="number" min="1" max="5" step="0.1" className="zc-input"
                  value={form.rating} onChange={(e) => set("rating", e.target.value)} />
              </div>
              <div className="menu-field full">
                <label htmlFor="mi-desc">{t("Description")}</label>
                <textarea id="mi-desc" rows={3} className="zc-textarea" value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder={t("Short description shown to customers…")} />
              </div>
              <div className="menu-field full">
                <label>{t("Availability")}</label>
                <div className={`menu-toggle-row${form.isAvailable ? " on" : ""}`}>
                  <Switch on={form.isAvailable} onClick={() => set("isAvailable", !form.isAvailable)}
                    label={t("Toggle availability")} />
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-1)" }}>
                    {form.isAvailable ? t("Available now") : t("Hidden")}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: "auto" }}>
                    {form.isAvailable ? t("Customers can order this item") : t("Stays in history, hidden from the menu")}
                  </span>
                </div>
              </div>
              <div className="menu-field full">
                <label>{t("Schedule")}</label>
                <div className={`menu-toggle-row${sched.enabled ? " on" : ""}`} style={{ flexWrap: "wrap" }}>
                  <Switch on={sched.enabled} label={t("Toggle schedule")}
                    onClick={() => setSched((p) => ({ ...p, enabled: !p.enabled }))} />
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-1)" }}>
                    {sched.enabled ? t("Only during") : t("All day")}
                  </span>
                  {sched.enabled ? (
                    <span style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
                      <input type="time" className="zc-input" aria-label={t("Schedule start time")} style={{ width: 130 }}
                        value={sched.startTime} onChange={(e) => setSched((p) => ({ ...p, startTime: e.target.value }))} />
                      <span style={{ color: "var(--text-3)" }}>→</span>
                      <input type="time" className="zc-input" aria-label={t("Schedule end time")} style={{ width: 130 }}
                        value={sched.endTime} onChange={(e) => setSched((p) => ({ ...p, endTime: e.target.value }))} />
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: "auto" }}>{t("No time restriction")}</span>
                  )}
                </div>
                <div className="hint">
                  {t("Customers see this item only inside the window (restaurant time; start included, end excluded — an end earlier than the start runs past midnight). Availability above still applies.")}
                  {catSched && <> {t("The {category} category is itself limited to {window} — the item must satisfy both.", { category: catLabel(categories, form.category), window: schedLabel(catSched) })}</>}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 14, padding: "10px 13px", background: "var(--card-2)", border: "1px solid var(--edge)", borderRadius: "var(--r-ctl)", fontSize: 11.5, color: "var(--text-3)" }}>
              📷 {t("Images upload to Cloudinary automatically. Max 5 MB · square images recommended.")}
            </div>
          </div>

          <div className="mf">
            <button type="button" className="zc-btn" onClick={onClose}>{t("Cancel")}</button>
            <button type="button" className="zc-btn pri" disabled={loading} onClick={submit}>
              {loading ? (isEdit ? t("Updating…") : t("Creating…")) : isEdit ? t("Update item") : t("Save item")}
            </button>
          </div>
        </div>
      </div>

      {showCat && <CategoryModal onClose={() => setShowCat(false)} onSaved={catCreated} />}
    </>
  );
}

// ── bulk scheduled-visibility modal ─────────────────────────────────────────
// Opened from the page header. Categories and items are both picked here;
// the item selection is shared with the checkboxes in the list, so ticking
// items there first and then opening this modal works too. One PATCH applies
// (or clears) the window on the whole selection.
function ScheduleModal({ cats, items, selCats, selItems, setSelCats, setSelItems, onApplied, onClose }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { schedule, text }
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !busy && !confirm && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy, confirm]);

  const nCats = selCats.size, nItems = selItems.size, total = nCats + nItems;
  const whatText = [nCats && tn(nCats, "{n} category", "{n} categories"), nItems && tn(nItems, "{n} item", "{n} items")]
    .filter(Boolean).join(` ${t("and")} `);

  const toggle = (setter) => (id) => setter((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleCat = toggle(setSelCats);
  const toggleItem = toggle(setSelItems);

  const shownItems = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => i.name?.toLowerCase().includes(s) || (i.nameBn || "").toLowerCase().includes(s) || i.category?.toLowerCase().includes(s)) : items;
  }, [items, q]);
  const shownIds = shownItems.map((i) => i._id);
  const allShownSelected = shownIds.length > 0 && shownIds.every((id) => selItems.has(id));

  const run = async (schedule) => {
    setBusy(true);
    try {
      const { data } = await updateMenuSchedule({ itemIds: [...selItems], categoryIds: [...selCats], schedule });
      toast.success(schedule
        ? t("Scheduled {what}: {window}", { what: whatText, window: schedLabel(data.schedule) })
        : t("Schedule cleared on {what}", { what: whatText }));
      setSelCats(new Set());
      setSelItems(new Set());
      onApplied();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || t("Failed to update schedule"));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const apply = () => {
    if (!total) return toast.error(t("Select at least one category or item"));
    const err = schedError(start, end);
    if (err) return toast.error(err);
    const schedule = { startTime: start, endTime: end };
    if (total >= BULK_CONFIRM_AT) {
      setConfirm({ schedule, text: t("Apply {window} to {what}?", { window: schedLabel(schedule), what: whatText }) });
    } else run(schedule);
  };
  const clear = () => {
    if (!total) return toast.error(t("Select at least one category or item"));
    setConfirm({ schedule: null, text: t("Remove the schedule from {what}? They go back to showing all day (availability still applies).", { what: whatText }) });
  };

  const sectionLabel = { fontSize: 11.5, color: "var(--text-2)", fontWeight: 600 };

  return (
    <>
      <div className="zc-scrim" onClick={() => !busy && onClose()}>
        <div className="zc-modal" style={{ width: 720 }} role="dialog" aria-modal="true" aria-labelledby="sched-modal-title"
          onClick={(e) => e.stopPropagation()}>
          <div className="mh">
            <div style={{ flex: 1 }}>
              <div className="t" id="sched-modal-title">🕒 {t("Scheduled visibility")}</div>
              <div className="s">{t("Show categories / items to customers only during a daily time window (restaurant time)")}</div>
            </div>
            <button type="button" className="zc-x" onClick={onClose} disabled={busy} aria-label={t("Close")}>✕</button>
          </div>

          <div className="mb" style={{ display: "grid", gap: 18 }}>
            {/* 1 — categories */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={sectionLabel}>{t("Categories")}</span>
                <button type="button" className="zc-btn ghost sm" disabled={!cats.length}
                  onClick={() => setSelCats(new Set(cats.map((c) => c._id)))}>{t("Select all")}</button>
                {nCats > 0 && <button type="button" className="zc-btn ghost sm" onClick={() => setSelCats(new Set())}>{t("Clear")}</button>}
              </div>
              {cats.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>{t("No categories yet.")}</div>
              ) : (
                <div className="menu-catpick">
                  {cats.map((c) => (
                    <label key={c._id} className={`menu-catchip${selCats.has(c._id) ? " on" : ""}`}>
                      <input type="checkbox" className="menu-cb" checked={selCats.has(c._id)} onChange={() => toggleCat(c._id)} />
                      {localName(c)}
                      {hasSchedule(c) && <ScheduleBadge schedule={c.schedule} />}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* 2 — items */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={sectionLabel}>{t("Items")}</span>
                <input className="zc-input" value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder={t("Search items or category")} aria-label={t("Search items to schedule")}
                  style={{ flex: "1 1 200px", maxWidth: 280, padding: "6px 10px", fontSize: 12.5 }} />
                <button type="button" className="zc-btn ghost sm" disabled={!shownIds.length || allShownSelected}
                  onClick={() => setSelItems((p) => new Set([...p, ...shownIds]))}>{t("Select all {n}", { n: shownIds.length })}</button>
                {nItems > 0 && <button type="button" className="zc-btn ghost sm" onClick={() => setSelItems(new Set())}>{t("Clear")}</button>}
              </div>
              <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
                {shownItems.length === 0 ? (
                  <div style={{ padding: 14, fontSize: 12, color: "var(--text-3)", textAlign: "center" }}>
                    {items.length === 0 ? t("No items yet.") : t("No items match.")}
                  </div>
                ) : shownItems.map((i) => (
                  <label key={i._id} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer",
                    borderBottom: "1px solid var(--border)", fontSize: 13,
                    background: selItems.has(i._id) ? "var(--card-2)" : undefined,
                  }}>
                    <input type="checkbox" className="menu-cb" checked={selItems.has(i._id)} onChange={() => toggleItem(i._id)} />
                    <VegDot tag={i.tag} />
                    <span style={{ fontWeight: 500, color: "var(--text-1)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{localName(i)}</span>
                    <span style={{ fontSize: 11.5, color: "var(--text-3)", whiteSpace: "nowrap" }}>{catLabel(cats, i.category)}</span>
                    <span style={{ marginLeft: "auto", flexShrink: 0 }}>
                      {hasSchedule(i) && <ScheduleBadge schedule={i.schedule} off={i.scheduledNow === false && i.isAvailable} />}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* 3 — window */}
            <div className="menu-sched-bar">
              <div className="menu-field">
                <label htmlFor="sch-start">{t("Start (visible from)")}</label>
                <input id="sch-start" type="time" className="zc-input" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="menu-field">
                <label htmlFor="sch-end">{t("End (hidden from)")}</label>
                <input id="sch-end" type="time" className="zc-input" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: -8 }}>
              {t("Start time is included, end time is not (10:00 → 12:00 shows at 11:59, hides at 12:00). An end earlier than the start runs past midnight (22:00 → 02:00). A category’s window hides all of its items; an item with its own window must satisfy both. Hidden (unavailable) items stay hidden regardless of schedule.")}
            </div>
          </div>

          <div className="mf" style={{ alignItems: "center" }}>
            <span style={{ fontSize: 12, color: total ? "var(--text-1)" : "var(--text-3)", marginRight: "auto" }}>
              {t("Selected:")} <b style={{ color: "var(--accent-ink)" }}>{fmtNum(total)}</b>{total ? ` (${whatText})` : ""}
            </span>
            <button type="button" className="zc-btn" disabled={busy || !total} onClick={clear}>{t("Clear schedule")}</button>
            <button type="button" className="zc-btn pri" disabled={busy || !total} onClick={apply}>
              {busy ? t("Saving…") : t("Apply schedule")}
            </button>
          </div>
        </div>
      </div>

      {confirm && (
        <div className="zc-scrim" onClick={() => !busy && setConfirm(null)} style={{ zIndex: 1200 }}>
          <div className="zc-modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="mh"><div className="t">{confirm.schedule ? t("Apply schedule?") : t("Clear schedule?")}</div></div>
            <div className="mb" style={{ fontSize: 13, color: "var(--text-2)" }}>{confirm.text}</div>
            <div className="mf">
              <button type="button" className="zc-btn" disabled={busy} onClick={() => setConfirm(null)}>{t("Cancel")}</button>
              <button type="button" className={`zc-btn ${confirm.schedule ? "pri" : "danger"}`} disabled={busy}
                onClick={() => run(confirm.schedule)}>{busy ? t("Saving…") : confirm.schedule ? t("Apply") : t("Clear schedule")}</button>
            </div>
          </div>
        </div>
      )}
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
  const [showCats, setShowCats] = useState(false);
  const [showSched, setShowSched] = useState(false);
  const [selItems, setSelItems] = useState(() => new Set()); // bulk-schedule selection (ids)
  const [selCats, setSelCats] = useState(() => new Set());
  const toggleItemSel = (id) => setSelItems((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

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

  const handleSaved = (saved, mode, { scheduleChanged } = {}) => {
    setItems((p) => (mode === "create" ? [saved, ...p] : p.map((i) => (i._id === saved._id ? saved : i))));
    loadCats();
    if (scheduleChanged) load(); // refresh the server-computed "off now" flags
  };

  const handleCategoryCreated = (newCat) => {
    if (newCat?._deleted) {
      const gone = cats.filter((c) => c.name === newCat.name).map((c) => c._id);
      setSelCats((p) => { const n = new Set(p); gone.forEach((id) => n.delete(id)); return n; });
      setCats((p) => p.filter((c) => c.name !== newCat.name));
      return;
    }
    setCats((p) => (p.some((c) => c.name === newCat?.name) ? p : [...p, newCat]));
  };


  // Categories manager saved/deleted something. A rename moved items on the
  // server, so reload both lists; keep the category filter pointing at the
  // same category (or reset it if that category is gone).
  const handleCategoriesChanged = ({ deleted, deletedId, renamedFrom, saved } = {}) => {
    if (deleted) {
      setSelCat((c) => (c === deleted ? "All" : c));
      if (deletedId) setSelCats((p) => { const n = new Set(p); n.delete(deletedId); return n; });
    }
    if (renamedFrom && saved?.name) setSelCat((c) => (c === renamedFrom ? saved.name : c));
    load();
  };

  const handleDelete = async (item) => {
    if (!window.confirm(t("Delete \"{name}\"? This cannot be undone.", { name: localName(item) }))) return;
    try {
      await deleteMenuItem(item._id);
      setItems((p) => p.filter((i) => i._id !== item._id));
      setSelItems((p) => { const n = new Set(p); n.delete(item._id); return n; });
      toast.success(t("Item deleted"));
    } catch (e) {
      toast.error(e?.response?.data?.message || t("Delete failed"));
    }
  };

  const toggleAvail = async (item) => {
    try {
      const { data } = await updateMenuItem(item._id, { isAvailable: !item.isAvailable });
      setItems((p) => p.map((i) => (i._id === data._id ? { ...data, scheduledNow: i.scheduledNow } : i)));
      toast.success(`${localName(data)} → ${data.isAvailable ? t("Available") : t("Hidden")}`);
    } catch (e) {
      toast.error(e?.response?.data?.message || t("Update failed"));
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (selCat !== "All" && i.category !== selCat) return false;
      if (avail === "Available" && !i.isAvailable) return false;
      if (avail === "Hidden" && i.isAvailable) return false;
      if (vegOnly && i.tag !== "Veg") return false;
      if (q && !i.name?.toLowerCase().includes(q) && !(i.nameBn || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, selCat, avail, vegOnly]);

  const availableCount = items.filter((i) => i.isAvailable).length;
  const hiddenCount = items.length - availableCount;
  const vegCount = items.filter((i) => i.tag === "Veg").length;
  const nonVegCount = items.filter((i) => i.tag === "Non Veg").length;
  const scheduledCount = items.filter(hasSchedule).length;
  const hasFilters = search || selCat !== "All" || avail !== "All" || vegOnly;
  const catByName = useMemo(() => new Map(cats.map((c) => [c.name, c])), [cats]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((i) => selItems.has(i._id));
  const someFilteredSelected = filtered.some((i) => selItems.has(i._id));
  const toggleAllFiltered = () => setSelItems((p) => {
    const n = new Set(p);
    if (allFilteredSelected) filtered.forEach((i) => n.delete(i._id));
    else filtered.forEach((i) => n.add(i._id));
    return n;
  });
  const clearFilters = () => { setSearch(""); setSelCat("All"); setAvail("All"); setVegOnly(false); };

  const STATS = [
    { label: t("Total items"), value: fmtNum(items.length), grad: true, sub: tn(cats.length, "{n} category", "{n} categories") },
    { label: t("Available"), value: fmtNum(availableCount), color: "var(--ready-ink)", sub: t("Live on the menu") },
    { label: t("Hidden"), value: fmtNum(hiddenCount), color: "var(--text-2)", sub: hiddenCount ? t("Off the menu") : t("None hidden") },
    { label: t("Scheduled"), value: fmtNum(scheduledCount), color: "var(--accent-ink)", sub: scheduledCount ? t("Time-limited items") : t("None scheduled") },
    { label: t("Vegetarian"), value: fmtNum(vegCount), color: "var(--ready-ink)", sub: items.length ? t("{pct}% of menu", { pct: Math.round((vegCount / items.length) * 100) }) : "—" },
    { label: t("Non-vegetarian"), value: fmtNum(nonVegCount), color: "var(--stop-ink)", sub: items.length ? t("{pct}% of menu", { pct: Math.round((nonVegCount / items.length) * 100) }) : "—" },
  ];

  return (
    <div>
      <PageHeader
        title={t("Menu items")}
        sub={`${tn(items.length, "{n} item", "{n} items")} · ${tn(cats.length, "{n} category", "{n} categories")}`}
        right={
          <>
            <button type="button" className="zc-btn" disabled={loading || error} onClick={() => setShowSched(true)}>
              🕒 {t("Scheduled visibility")}{selItems.size + selCats.size > 0 ? ` (${fmtNum(selItems.size + selCats.size)})` : ""}
            </button>
            <button type="button" className="zc-btn" disabled={loading || error} onClick={() => setShowCats(true)}>🗂️ {t("Categories")}</button>
            <button type="button" className="zc-btn pri" onClick={() => setModal("create")}>＋ {t("New item")}</button>
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
          placeholder={t("Search by item name")}
          aria-label={t("Search menu items")}
          style={{ flex: 1, minWidth: 220 }}
        />
        <div className="zc-seg" role="tablist" aria-label={t("Availability filter")}>
          {AVAIL_SEG.map((a) => (
            <button key={a} type="button" role="tab" aria-selected={avail === a}
              className={avail === a ? "on" : ""} onClick={() => setAvail(a)}>{t(a)}</button>
          ))}
        </div>
        <select className="zc-select" value={selCat} onChange={(e) => setSelCat(e.target.value)}
          aria-label={t("Category filter")} style={{ width: "auto" }}>
          <option value="All">{t("Category: All")}</option>
          {cats.map((c) => <option key={c._id} value={c.name}>{localName(c)}</option>)}
        </select>
        <button type="button" onClick={() => setVegOnly((v) => !v)}
          className={`zc-btn${vegOnly ? " good" : " ghost"}`} aria-pressed={vegOnly}>
          <VegDot tag="Veg" />{t("Veg only")}
        </button>
        <div style={{ flex: 1 }} />
        {hasFilters ? (
          <>
            <span style={{ fontSize: 12, color: "var(--text-2)" }}>
              <b style={{ color: "var(--accent-ink)" }}>{fmtNum(filtered.length)}</b> {t("of {n}", { n: items.length })}
            </span>
            <button type="button" className="zc-btn sm" onClick={clearFilters}>{t("Clear")} ✕</button>
          </>
        ) : (
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>{tn(items.length, "{n} item", "{n} items")}</span>
        )}
      </div>

      <div className="zc-card">
        <div className="zc-card-h">
          <span className="t">{t("Items")}</span>
          <span className="s">{loading ? t("loading…") : error ? t("unavailable") : t("{n} shown", { n: filtered.length })}</span>
        </div>

        {loading ? (
          <div style={{ padding: "16px 18px" }}><Loader rows={8} /></div>
        ) : error ? (
          <ErrorState title={t("Could not load the menu")}
            sub={t("The server did not respond. Check that the backend is running, then try again.")}
            onRetry={load} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 5h16M4 12h16M4 19h10" />
              </svg>
            }
            title={items.length === 0 ? t("No menu items yet") : t("No items match")}
            sub={items.length === 0
              ? t("Add your first dish or drink — it shows on the customer site as soon as it is available.")
              : t("Nothing matches these filters. Try clearing them.")}
            action={
              items.length === 0
                ? <button type="button" className="zc-btn pri" onClick={() => setModal("create")}>＋ {t("New item")}</button>
                : hasFilters ? <button type="button" className="zc-btn" onClick={clearFilters}>{t("Clear filters")}</button> : null
            }
          />
        ) : (
          <>
            {/* desktop / tablet ledger */}
            <div className="menu-ledger-wrap" style={{ overflowX: "auto", padding: "6px 10px 8px" }}>
              <table className="zc-ledger" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>
                      <input type="checkbox" className="menu-cb" aria-label={t("Select all shown items")}
                        checked={allFilteredSelected}
                        ref={(el) => { if (el) el.indeterminate = !allFilteredSelected && someFilteredSelected; }}
                        onChange={toggleAllFiltered} />
                    </th>
                    <th>{t("Item")}</th>
                    <th style={{ width: 130 }}>{t("Category")}</th>
                    <th className="num" style={{ width: 110 }}>{t("Price")}</th>
                    <th className="num" style={{ width: 84 }}>{t("Rating")}</th>
                    <th style={{ width: 132 }}>{t("Availability")}</th>
                    <th style={{ width: 96 }} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item._id} className="menu-click" onClick={() => setModal(item)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="menu-cb" aria-label={t("Select {name}", { name: localName(item) })}
                          checked={selItems.has(item._id)} onChange={() => toggleItemSel(item._id)} />
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                          <Thumb src={item.image} />
                          <VegDot tag={item.tag} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{localName(item)}</div>
                            {item.description && (
                              <div style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>
                                {item.description}
                              </div>
                            )}
                            {hasSchedule(item) && (
                              <div style={{ marginTop: 3 }}>
                                <ScheduleBadge schedule={item.schedule} off={item.scheduledNow === false && item.isAvailable} />
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="zc-tag done sq">{item.category ? localName(catByName.get(item.category) || item.category) : "—"}</span>
                        {hasSchedule(catByName.get(item.category)) && (
                          <div style={{ marginTop: 3 }}><ScheduleBadge schedule={catByName.get(item.category).schedule} /></div>
                        )}
                      </td>
                      <td className="num">
                        <span style={{ fontWeight: 600, color: "var(--text-1)" }}>₹{fmtNum(item.price)}</span>
                        {item.originalPrice ? (
                          <div style={{ fontSize: 11, color: "var(--text-3)", textDecoration: "line-through" }}>₹{fmtNum(item.originalPrice)}</div>
                        ) : null}
                      </td>
                      <td className="num" style={{ color: "var(--wait-ink)", fontWeight: 600 }}>
                        ★ {fmtNum(Number(item.rating || 0), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <Switch on={item.isAvailable} onClick={() => toggleAvail(item)}
                            label={t("Toggle {name} availability", { name: localName(item) })} />
                          <span className={`zc-tag ${item.isAvailable ? "ready" : "done"}`}>
                            <i />{item.isAvailable ? t("Available") : t("Hidden")}
                          </span>
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                          <button type="button" className="zc-btn ghost sm" title={t("Edit")} onClick={() => setModal(item)}
                            style={{ padding: "5px 8px" }}>✏️</button>
                          <button type="button" className="zc-btn danger sm" title={t("Delete")} onClick={() => handleDelete(item)}
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
                  <input type="checkbox" className="menu-cb" aria-label={t("Select {name}", { name: localName(item) })} style={{ marginTop: 3 }}
                    checked={selItems.has(item._id)} onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleItemSel(item._id)} />
                  <Thumb src={item.image} size={48} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <VegDot tag={item.tag} />
                      <span style={{ fontWeight: 600, color: "var(--text-1)", fontSize: 13 }}>{localName(item)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
                      {localName(catByName.get(item.category) || item.category)} · ★ {fmtNum(Number(item.rating || 0), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                    </div>
                    {hasSchedule(item) && (
                      <div style={{ marginTop: 4 }}>
                        <ScheduleBadge schedule={item.schedule} off={item.scheduledNow === false && item.isAvailable} />
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <span className="tnum" style={{ fontWeight: 700, color: "var(--text-1)" }}>₹{fmtNum(item.price)}</span>
                      {item.originalPrice ? (
                        <span className="tnum" style={{ fontSize: 11, color: "var(--text-3)", textDecoration: "line-through" }}>₹{fmtNum(item.originalPrice)}</span>
                      ) : null}
                      <span className={`zc-tag ${item.isAvailable ? "ready" : "done"}`}><i />{item.isAvailable ? t("Available") : t("Hidden")}</span>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 5 }} onClick={(e) => e.stopPropagation()}>
                        <Switch on={item.isAvailable} onClick={() => toggleAvail(item)} label={t("Toggle {name}", { name: localName(item) })} />
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

      {showCats && (
        <CategoriesModal
          cats={cats}
          items={items}
          onClose={() => setShowCats(false)}
          onChanged={handleCategoriesChanged}
          onView={(name) => { setSelCat(name); setAvail("All"); setShowCats(false); }}
        />
      )}

      {showSched && (
        <ScheduleModal
          cats={cats}
          items={items}
          selCats={selCats}
          selItems={selItems}
          setSelCats={setSelCats}
          setSelItems={setSelItems}
          onApplied={load}
          onClose={() => setShowSched(false)}
        />
      )}
    </div>
  );
}
