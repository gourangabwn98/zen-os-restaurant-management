// src/pages/admin/MenuAdminPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Menu items — layout follows the "big-menu manager" reference (status strip,
// Menu times + categories rail, items grouped by category with the time window
// shown once per group, view chips, bulk bar); look comes from the Zen OS
// design system (tokens.css / surfaces.css). Every API call, field, and rule
// is unchanged:
//
//   list / search / filter   getMenu({ includeUnavailable: true })  (+ client filters)
//   add / edit               createMenuItem / updateMenuItem  (multipart)
//   delete                   deleteMenuItem
//   availability On / Off    updateMenuItem(id, { isAvailable })  (also in bulk)
//   categories               getCategories / createCategory / updateCategory / deleteCategory
//   restaurant timezone      getRestaurantProfile (for the timeline's "now")
// Images go to Cloudinary through the backend, same as before.
//
// A customer sees an item when it is Available AND its category's time window
// (if the category has one — Menu times) allows the current restaurant time.
// Menu items have no time schedule of their own (enforced server-side).
// Layout pieces live in ./menu/ (MenuBoard.jsx, menuUI.jsx, menuKit.js).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import {
  getMenu, getCategories, createMenuItem, updateMenuItem, deleteMenuItem,
  createCategory, updateCategory, deleteCategory,
  getMenuTimes, setMenuAvailability, reorderCategories, mergeCategory,
} from "../../services/menuService.js";
import { getRestaurantProfile } from "../../services/adminService.js";
import { useAuth } from "../../hooks/useAuth.js";
import { isManager } from "../../utils/access.js";
import PageHeader from "./shared/PageHeader.jsx";
import Loader from "./shared/Loader.jsx";
import { t, tn, fmtNum, localName } from "../../i18n/core.js";
import { invalidate } from "../../services/cache.js";
import { VegDot, Switch, ScheduleBadge, CatThumb, TagEditor } from "./menu/menuUI.jsx";
import CategoryIcon from "../../components/CategoryIcon.jsx";
import {
  isUrl, hasSchedule, schedLabel, fmt12, fmtMinutes, isSoldOut,
  clockInTimezone, previewClock, isScheduleActive, buildTimeGroups, findCleanup,
  VIEWS, VIEW_KEYS, EMPTY_FILTERS, hasExtraFilters, matchesFilters, matchesSearch,
  loadSavedViews, storeSavedViews, errMsg,
  ITEM_FLAGS, isSmartCat, manualCats, memberNames, CATEGORY_ICON_KEYS,
} from "./menu/menuKit.js";
import { StatusStrip, MenuTimesCard, CategoryCard, ItemsPanel, CategoryList } from "./menu/MenuBoard.jsx";
import { MenuTimeModal, BulkEditModal, ImportModal } from "./menu/MenuModals.jsx";

// Stored values; labels go through t().
const TAGS = ["Veg", "Non Veg"];
const EMPTY_FORM = {
  name: "", nameBn: "", price: "", originalPrice: "", description: "",
  category: "", tag: "Veg", isAvailable: true, rating: 4.0, tags: [], addons: [],
  categories: [], isTodaysSpecial: false, isChefsPick: false, isFastAvailable: false,
};
// Item counts per category name, across every category an item is listed in.
const countMembers = (items, cats) => {
  const m = new Map();
  for (const i of items) for (const n of memberNames(i, cats)) m.set(n, (m.get(n) || 0) + 1);
  return m;
};
const normalizeCats = (data) => (data?.data || data || []).filter(Boolean);
const BULK_CONFIRM_AT = 5; // confirm bulk schedule changes touching this many entries or more
// Categories are referenced by their (English) name; show the Bengali one when set.
const catLabel = (cats, name) => localName(cats.find((c) => c.name === name) || name);

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
function CategoryPicker({ value, categories: allCategories, onChange, onOpenCreate, onDeleteCategory }) {
  // The primary category is always one the restaurant made (MNU-01); built-in
  // ones fill themselves (flags below / real orders).
  const categories = manualCats(allCategories);
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
  const [icon, setIcon] = useState(category?.icon || "");
  const [notShareable, setNotShareable] = useState(!!category?.notShareable); // KH-05
  const smart = isSmartCat(category);
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
      fd.append("icon", icon);
      if (!smart) fd.append("notShareable", String(notShareable));
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
            <input id="cat-name" className="zc-input" value={name} autoFocus={!smart} maxLength={40} disabled={smart}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder={t("e.g. Biryani, Desserts…")} />
            {smart && (
              <div className="hint">
                {category.smartSource === "flag"
                  ? t("Built-in category — its name is fixed. Items appear here when you switch on “{flag}” in the item form.", { flag: t(ITEM_FLAGS.find((f) => f.flag === category.smartFlag)?.label || "") })
                  : t("Built-in category — its name is fixed. It fills itself from real orders and customer ratings, and stays hidden from customers until there is data.")}
              </div>
            )}
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
            <label>{t("Icon")}</label>
            <div role="radiogroup" aria-label={t("Icon")} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button type="button" role="radio" aria-checked={!icon} className={`zc-btn sm${!icon ? " pri" : " ghost"}`}
                onClick={() => setIcon("")} title={t("Picked from the name")}>{t("Automatic")}</button>
              {CATEGORY_ICON_KEYS.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={icon === k} aria-label={k}
                  className={`zc-btn sm${icon === k ? " pri" : " ghost"}`} style={{ padding: 6 }} onClick={() => setIcon(k)}>
                  <CategoryIcon name={k} size={20} />
                </button>
              ))}
            </div>
            <div className="hint">{t("Shown on the customer menu when the category has no photo.")}</div>
          </div>
          {!smart && (
            <div className="menu-field">
              <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" className="menu-cb" checked={notShareable} onChange={(e) => setNotShareable(e.target.checked)} />
                {t("Not shareable")}
              </label>
              <div className="hint">
                {t("Its items show a red “{name} not shareable” note on the menu and order screens.", { name: name.trim() || t("Category") })}
              </div>
            </div>
          )}
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
// `simple` (the simple Menu page): the same list as the page's left side —
// real categories only (no built-ins), "All items" first, each with the
// number of items whose own category it is; rows are name · count · Edit · Delete.
function CategoriesModal({ cats: allCats, items, onClose, onChanged, onView, simple = false }) {
  // Simple: real categories = category records that aren't built-ins, PLUS
  // names items use that have no record yet (an imported menu writes only the
  // name on each item). Those get a record the first time they're edited.
  const cats = useMemo(() => {
    if (!simple) return allCats;
    const manual = allCats.filter((c) => !isSmartCat(c));
    const known = new Set(allCats.map((c) => c.name.toLowerCase()));
    const extra = [...new Set(items.map((i) => i.category).filter(Boolean))]
      .filter((n) => !known.has(n.toLowerCase())).sort()
      .map((name) => ({ name, nameBn: "", noRecord: true }));
    return [...manual, ...extra];
  }, [allCats, items, simple]);
  const [opening, setOpening] = useState(null); // name whose record is being created
  const openEdit = async (c, n) => {
    if (!c.noRecord) return setForm({ ...c, itemCount: n });
    setOpening(c.name);
    try {
      const { data } = await createCategory({ name: c.name });
      const doc = data?.category || data;
      onChanged({});
      setForm({ ...doc, itemCount: n });
    } catch (e) {
      toast.error(e?.response?.data?.message || t("Couldn't open this category"));
    } finally { setOpening(null); }
  };
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
  const counts = useMemo(() => countMembers(items, cats), [items, cats]);
  const ownCounts = useMemo(() => {
    const m = new Map();
    for (const i of items) if (i.category) m.set(i.category, (m.get(i.category) || 0) + 1);
    return m;
  }, [items]);
  // Data-driven built-ins: the server's count (it knows the real orders).
  const countOf = (c) => (simple
    ? ownCounts.get(c.name) || 0
    : items.length && !(isSmartCat(c) && !c.smartFlag) ? counts.get(c.name) || 0 : c.itemCount || 0);

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
      {simple && (
        <style>{`
          .mc-row { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-bottom: 1px solid var(--border); }
          .mc-row:last-child { border-bottom: 0; }
          .mc-all { background: var(--violet-faint); }
          .mc-name { flex: 1; min-width: 0; text-align: left; background: none; border: 0; padding: 4px 0; cursor: pointer;
            font: inherit; font-size: 13.5px; font-weight: 600; color: var(--text-1);
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .mc-name:hover:not(:disabled) { color: var(--accent-ink); text-decoration: underline; }
          .mc-name:disabled { cursor: default; color: var(--text-2); }
          .mc-all .mc-name { color: var(--accent-ink); }
          .mc-ct { min-width: 34px; text-align: right; font-size: 13px; font-weight: 700; color: var(--text-2); margin-right: 6px; }
          @media (max-width: 520px) { .mc-row { flex-wrap: wrap; } .mc-name { flex-basis: calc(100% - 50px); } }
        `}</style>
      )}
      <div className="zc-scrim" onClick={() => !form && !confirmDel && onClose()}>
        <div className="zc-modal" style={{ width: simple ? 520 : 680 }} role="dialog" aria-modal="true" aria-labelledby="cats-title"
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
                {simple && !q.trim() && (
                  <div className="mc-row mc-all">
                    <button type="button" className="mc-name" onClick={() => onView("All")}>{t("All items")}</button>
                    <span className="mc-ct tnum">{fmtNum(items.length)}</span>
                  </div>
                )}
                {shown.map((c) => {
                  const n = countOf(c);
                  if (simple) return (
                    <div key={c._id || c.name} className="mc-row">
                      <button type="button" className="mc-name" disabled={n === 0} title={n === 0 ? t("No items in this category") : t("Show only {name} items", { name: localName(c) })}
                        onClick={() => onView(c.name)}>{localName(c)}</button>
                      <span className="mc-ct tnum">{fmtNum(n)}</span>
                      <button type="button" className="zc-btn sm" disabled={opening === c.name} onClick={() => openEdit(c, n)}>
                        {opening === c.name ? t("Opening…") : `✎ ${t("Edit")}`}
                      </button>
                      <button type="button" className="zc-btn danger sm" disabled={n > 0 || c.noRecord}
                        title={n > 0 ? tn(n, "Move or delete its {n} item first", "Move or delete its {n} items first") : t("Delete {name}", { name: localName(c) })}
                        onClick={() => setConfirmDel(c)}>{t("Delete")}</button>
                    </div>
                  );
                  return (
                    <div key={c._id} style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                      borderBottom: "1px solid var(--border)", flexWrap: "wrap",
                    }}>
                      <CatThumb image={c.image} icon={c.iconShown} />
                      <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text-1)", overflowWrap: "anywhere" }}>{localName(c)}{c.nameBn && <span style={{ fontWeight: 400, fontSize: 11.5, color: "var(--text-3)" }}> · {c.nameBn === localName(c) ? c.name : c.nameBn}</span>}</div>
                        <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <span>{tn(n, "{n} item", "{n} items")}</span>
                          {isSmartCat(c) && <span className="zc-tag vio sq">{c.smartFlag ? t("Built-in · items you mark") : t("Built-in · from real orders and ratings")}</span>}
                          {hasSchedule(c) && <ScheduleBadge schedule={c.schedule} />}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button type="button" className="zc-btn ghost sm" disabled={n === 0}
                          title={n === 0 ? t("No items in this category") : t("Show only {name} items", { name: localName(c) })}
                          onClick={() => onView(c.name)}>{t("View items")}</button>
                        <button type="button" className="zc-btn sm" onClick={() => setForm({ ...c, itemCount: n })}>{t("Edit")}</button>
                        {!isSmartCat(c) && (
                          <button type="button" className="zc-btn danger sm" disabled={n > 0}
                            title={n > 0 ? tn(n, "Move or delete its {n} item first", "Move or delete its {n} items first") : t("Delete {name}", { name: localName(c) })}
                            onClick={() => setConfirmDel(c)}>{t("Delete")}</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>
              {simple
                ? t("Renaming moves the category’s items with it. A category can only be deleted once it has no items.")
                : t("Renaming moves the category’s items with it. A category can only be deleted once it has no items. Time windows come from its Menu time.")}
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
// KH-12 — add-on rows (name + ₹ price) for one menu item.
function AddonsEditor({ value, onChange }) {
  const update = (i, k, v) => onChange(value.map((a, j) => (j === i ? { ...a, [k]: v } : a)));
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {value.map((a, i) => (
        <div key={a._id || i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input className="zc-input" style={{ flex: 1 }} maxLength={60} value={a.name}
            placeholder={t("e.g. 1 pc Chicken")} onChange={(e) => update(i, "name", e.target.value)} aria-label={t("Add-on name")} />
          <input className="zc-input" style={{ width: 96 }} type="number" min={0} inputMode="decimal" value={a.price}
            placeholder="₹" onChange={(e) => update(i, "price", e.target.value)} aria-label={t("Add-on price")} />
          <button type="button" className="zc-btn sm ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}
            aria-label={t("Remove add-on")}>✕</button>
        </div>
      ))}
      {value.length < 10 && (
        <button type="button" className="zc-btn sm ghost" style={{ justifySelf: "start" }}
          onClick={() => onChange([...value, { name: "", price: "" }])}>＋ {t("Add an add-on")}</button>
      )}
    </div>
  );
}

function ItemModal({ item, categories, allTags = [], onClose, onSaved, onCategoryCreated }) {
  const isEdit = !!item?._id;
  const [form, setForm] = useState(
    isEdit
      ? { ...EMPTY_FORM, ...item, price: item.price ?? "", originalPrice: item.originalPrice || "", tags: item.tags || [], categories: item.categories || [],
          addons: (item.addons || []).map((a) => ({ _id: a._id, name: a.name, price: String(a.price) })) } // KH-12
      : { ...EMPTY_FORM, category: manualCats(categories)[0]?.name || "" },
  );
  const soldOut = isEdit && isSoldOut(item);
  const [imgFile, setImgFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showCat, setShowCat] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  // Menu items have no time schedule of their own; only the category's
  // window (if any) can hide the item — shown read-only below.
  const catSched = categories.find((c) => c.name === form.category && hasSchedule(c))?.schedule;
  const extraChoices = manualCats(categories).filter((c) => c.name !== form.category);
  const toggleExtra = (name) => set("categories", form.categories.includes(name)
    ? form.categories.filter((n) => n !== name) : [...form.categories, name]);
  // Data-driven built-ins this item is in right now (server-computed, read-only).
  const autoIn = isEdit ? categories.filter((c) => isSmartCat(c) && !c.smartFlag && (item.categoryList || []).includes(c.name)) : [];

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
    // KH-12: add-ons — every row needs a name and a price (empty rows are dropped).
    const addonRows = (form.addons || []).filter((a) => a.name.trim() || String(a.price).trim());
    if (addonRows.some((a) => !a.name.trim() || a.price === "" || isNaN(Number(a.price)) || Number(a.price) < 0))
      return toast.error(t("Every add-on needs a name and a price"));

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("name", form.name.trim());
      fd.append("nameBn", (form.nameBn || "").trim());
      fd.append("price", form.price);
      fd.append("category", form.category);
      fd.append("categories", JSON.stringify((form.categories || []).filter((n) => n !== form.category)));
      for (const f of ITEM_FLAGS) fd.append(f.flag, form[f.flag] ? "true" : "false");
      fd.append("tag", form.tag);
      // Only when changed: sending it clears "Sold out today" on the server.
      if (!isEdit || form.isAvailable !== item.isAvailable) fd.append("isAvailable", form.isAvailable);
      fd.append("rating", form.rating || 4);
      fd.append("tags", JSON.stringify(form.tags || []));
      {
        // KH-12: only sent when the list changed (ids of kept add-ons go back).
        const toSend = addonRows.map((a) => ({ ...(a._id && { _id: a._id }), name: a.name.trim(), price: Number(a.price) }));
        const before = JSON.stringify((isEdit ? item.addons || [] : []).map((a) => ({ _id: a._id, name: a.name, price: Number(a.price) })));
        if (JSON.stringify(toSend) !== before) fd.append("addons", JSON.stringify(toSend));
      }
      if (form.originalPrice) fd.append("originalPrice", form.originalPrice);
      if (form.description) fd.append("description", form.description);
      if (imgFile) fd.append("image", imgFile);

      let data;
      if (isEdit) {
        ({ data } = await updateMenuItem(item._id, fd));
      } else {
        ({ data } = await createMenuItem(fd));
      }
      toast.success(isEdit ? t("Item updated") : t("Item created"));
      onSaved(data, isEdit ? "edit" : "create");
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
                <label>{t("Also show in")} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>({t("optional")})</span></label>
                {extraChoices.length === 0 ? (
                  <div className="hint">{t("Create more categories to list this item in several places.")}</div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {extraChoices.map((c) => {
                      const on = form.categories.includes(c.name);
                      return (
                        <button key={c._id || c.name} type="button" aria-pressed={on}
                          className={`zc-btn sm${on ? " pri" : " ghost"}`} onClick={() => toggleExtra(c.name)}>
                          {on ? "✓ " : ""}{localName(c)}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="hint">{t("The same item — one price, one stock, one on/off switch — listed in more than one category.")}</div>
              </div>
              <div className="menu-field full">
                <label>{t("Special lists")}</label>
                <div style={{ display: "grid", gap: 6 }}>
                  {ITEM_FLAGS.map((f) => (
                    <div key={f.flag} className={`menu-toggle-row${form[f.flag] ? " on" : ""}`}>
                      <Switch on={!!form[f.flag]} onClick={() => set(f.flag, !form[f.flag])} label={t(f.label)} />
                      <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-1)" }}>{t(f.label)}</span>
                      <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: "auto" }}>{t(f.hint)}</span>
                    </div>
                  ))}
                </div>
                {autoIn.length > 0 && (
                  <div className="hint">{t("Also listed automatically in: {list}", { list: autoIn.map((c) => localName(c)).join(", ") })}</div>
                )}
              </div>
              <div className="menu-field full">
                <label>{t("Diner tags")} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>({t("optional")})</span></label>
                <TagEditor value={form.tags || []} onChange={(v) => set("tags", v)} suggestions={allTags} />
                <div className="hint">{t("Fish, Spicy, Bestseller… shown on the menu list and usable as filters. Veg / Non-veg stays above.")}</div>
              </div>
              <div className="menu-field full">
                <label>{t("Add-ons")} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>({t("optional")})</span></label>
                <AddonsEditor value={form.addons || []} onChange={(v) => set("addons", v)} />
                <div className="hint">{t("Extras the waiter can add, e.g. “1 pc Chicken” ₹40 — the price is added per item.")}</div>
              </div>
              <div className="menu-field full">
                <label>{t("Availability")}</label>
                <div className={`menu-toggle-row${form.isAvailable ? " on" : ""}`}>
                  <Switch on={form.isAvailable} onClick={() => set("isAvailable", !form.isAvailable)}
                    label={t("Toggle availability")} />
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-1)" }}>
                    {form.isAvailable ? t("Available now")
                      : soldOut ? t("Sold out today") : t("Hidden")}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: "auto" }}>
                    {form.isAvailable ? t("Customers can order this item")
                      : soldOut
                        ? t("Comes back on by itself when the business day ends")
                        : t("Stays in history, hidden from the menu")}
                  </span>
                </div>
              </div>
              {catSched && (
                <div className="menu-field full">
                  <div className="hint">
                    🕒 {t("The {category} category is shown only {window} — this item follows it.", { category: catLabel(categories, form.category), window: schedLabel(catSched) })}
                  </div>
                </div>
              )}
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

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
const toggleIn = (set, id) => {
  const n = new Set(set);
  if (n.has(id)) n.delete(id); else n.add(id);
  return n;
};

// Every login gets the simple page: categories on the left, items on the
// right, search only (no views / saved views / filters / bulk tick boxes, no
// Menu-times column). The fuller board is still built when this is false.
const SIMPLE_MENU_PAGE = true;

export default function MenuAdminPage() {
  const simple = SIMPLE_MENU_PAGE;
  // Menu times stay with the admin (header button); categories: admin + manager.
  const canSetUp = !isManager(useAuth().user);
  const [showMenuTimes, setShowMenuTimes] = useState(false);
  const [items, setItems] = useState([]);
  const [cats, setCats] = useState([]);
  const [menuTimes, setMenuTimes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [dayEnd, setDayEnd] = useState("03:00");
  const [nowClock, setNowClock] = useState(() => clockInTimezone("Asia/Kolkata"));

  const [search, setSearch] = useState("");
  const [view, setView] = useState("all");
  const [filters, setFiltersRaw] = useState(EMPTY_FILTERS);
  const [saved, setSaved] = useState(loadSavedViews);
  const [activeSaved, setActiveSaved] = useState(null);
  const [selCat, setSelCat] = useState("All");
  const [selGroup, setSelGroup] = useState(null);
  const [preview, setPreview] = useState(null); // null = now (server flags); else { minutes, day }
  const [collapsed, setCollapsed] = useState(() => new Set());

  const [modal, setModal] = useState(null); // "create" | item | null
  const [catForm, setCatForm] = useState(null); // "create" | category | null
  const [confirmDelCat, setConfirmDelCat] = useState(null);
  const [deletingCat, setDeletingCat] = useState(false);
  const [mergeAsk, setMergeAsk] = useState(null); // { from, into }
  const [merging, setMerging] = useState(false);
  const [showCats, setShowCats] = useState(false);
  const [mtForm, setMtForm] = useState(null); // "create" | menuTime | null
  const [showBulk, setShowBulk] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selItems, setSelItems] = useState(() => new Set()); // list selection — bulk bar + modals
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const loadCats = useCallback(
    () => getCategories().then((r) => setCats(normalizeCats(r.data))).catch(() => {}),
    [],
  );

  const load = useCallback(() => {
    Promise.all([
      getMenu({ includeUnavailable: true }),
      getCategories(),
      getMenuTimes().catch(() => ({ data: [] })), // an older server without menu times still shows the menu
    ])
      .then(([m, c, mt]) => {
        setItems(Array.isArray(m.data) ? m.data : []);
        setCats(normalizeCats(c.data));
        setMenuTimes(Array.isArray(mt.data) ? mt.data : []);
        setError(false);
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  // Restaurant timezone → the timeline's "now", Live/Off; business day end → "Sold out today".
  useEffect(() => {
    getRestaurantProfile()
      .then((r) => {
        const p = r.data?.data || r.data;
        if (p?.timezone) setTimezone(p.timezone);
        if (p?.businessDayEndsAt) setDayEnd(p.businessDayEndsAt);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const tick = () => setNowClock(clockInTimezone(timezone));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [timezone]);

  // ── derived from the real lists ───────────────────────────────────────────
  const clock = useMemo(() => previewClock(nowClock, preview), [nowClock, preview]);
  const catByName = useMemo(() => new Map(cats.map((c) => [c.name, c])), [cats]);
  // MNU-01/03–07: an item counts in every category it is listed in.
  const countByCat = useMemo(() => countMembers(items, cats), [items, cats]);
  const countOf = useCallback(
    (c) => (items.length && !(isSmartCat(c) && !c.smartFlag) ? countByCat.get(c.name) || 0 : c.itemCount || 0),
    [items.length, countByCat],
  );
  const cleanup = useMemo(() => findCleanup(cats, countOf), [cats, countOf]);
  const cleanupNames = useMemo(
    () => new Set(cleanup.filter((x) => x.kind !== "empty").map((x) => x.cat.name)),
    [cleanup],
  );
  const viewCtx = useMemo(
    () => ({ catOf: (i) => catByName.get(i.category), clock: preview ? clock : null, cleanup: cleanupNames }),
    [catByName, preview, clock, cleanupNames],
  );

  const counts = useMemo(() => {
    const c = {};
    for (const k of VIEW_KEYS) c[k] = 0;
    for (const i of items) for (const k of VIEW_KEYS) if (VIEWS[k].test(i, viewCtx)) c[k]++;
    return c;
  }, [items, viewCtx]);

  const timeGroups = useMemo(
    () => buildTimeGroups({ menuTimes, cats, countOf, clock }),
    [menuTimes, cats, countOf, clock],
  );
  const groupOfCat = useMemo(() => {
    const m = new Map();
    for (const g of timeGroups) for (const c of g.cats) m.set(c.name, g);
    return m;
  }, [timeGroups]);
  const activeGroup = timeGroups.find((g) => g.key === selGroup) || timeGroups[0] || null;
  const allTags = useMemo(() => {
    const m = new Map();
    for (const i of items) for (const x of i.tags || []) if (!m.has(x.toLowerCase())) m.set(x.toLowerCase(), x);
    return [...m.values()].sort((a, b) => a.localeCompare(b));
  }, [items]);

  // Left list on the simple page: the categories the items are really in
  // (each item's own category) — not built-in automatic ones or empty ones.
  // Saved category order first, then any name with no category record.
  const itemCats = useMemo(() => {
    const n = new Map();
    for (const i of items) if (i.category) n.set(i.category, (n.get(i.category) || 0) + 1);
    const order = [...cats.map((c) => c.name).filter((x) => n.has(x)), ...[...n.keys()].filter((x) => !catByName.has(x)).sort()];
    return order.map((name) => ({ name, count: n.get(name), label: catByName.has(name) ? localName(catByName.get(name)) : name }));
  }, [items, cats, catByName]);

  const q = search.trim().toLowerCase();
  // Manager's page: search + category only — a view or saved filter left in
  // this browser (e.g. "Over ₹200") must never hide items there.
  const effView = simple ? "all" : view;
  const effFilters = simple ? EMPTY_FILTERS : filters;
  const groups = useMemo(() => {
    const test = VIEWS[effView]?.test || VIEWS.all.test;
    const byCat = new Map();
    for (const i of items) {
      if (selCat !== "All" && (simple ? i.category !== selCat : !memberNames(i, cats).has(selCat))) continue;
      if (!test(i, viewCtx)) continue;
      if (!matchesFilters(i, effFilters)) continue;
      const cat = catByName.get(i.category);
      if (!matchesSearch(i, q, cat?.nameBn)) continue;
      // One category picked → its items under it (extra / built-in members too).
      const key = selCat !== "All" ? selCat : i.category;
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key).push(i);
    }
    // Category order = the server's (drag) order; items whose category
    // document is missing go last under their stored category name.
    const order = [...cats.map((c) => c.name), ...[...byCat.keys()].filter((n) => !catByName.has(n)).sort()];
    return order.filter((n) => byCat.has(n)).map((name) => {
      const cat = catByName.get(name);
      return {
        name, cat, label: cat ? localName(cat) : name || t("No category"),
        items: byCat.get(name), timeGroup: groupOfCat.get(name) || null,
        live: isScheduleActive(cat?.schedule, clock),
      };
    });
  }, [items, cats, catByName, selCat, simple, effView, viewCtx, effFilters, q, clock, groupOfCat]);

  const savedWithCounts = useMemo(() => saved.map((sv) => {
    const test = VIEWS[sv.view]?.test || VIEWS.all.test;
    const f = { ...EMPTY_FILTERS, ...sv.filters };
    return { ...sv, count: items.filter((i) => test(i, viewCtx) && matchesFilters(i, f)).length };
  }), [saved, items, viewCtx]);

  const hasFilters = !!q || effView !== "all" || hasExtraFilters(effFilters);
  const setFilters = (f) => { setFiltersRaw(f || EMPTY_FILTERS); setActiveSaved(null); };
  const pickView = (v) => { setView(v); setActiveSaved(null); };
  const clearFilters = () => { setSearch(""); setView("all"); setSelCat("All"); setFiltersRaw(EMPTY_FILTERS); setActiveSaved(null); };
  const applySaved = (sv) => {
    if (activeSaved === sv.id) return clearFilters();
    setView(sv.view || "all");
    setFiltersRaw({ ...EMPTY_FILTERS, ...sv.filters });
    setActiveSaved(sv.id);
  };
  const saveView = (name) => {
    const sv = { id: `v${Date.now()}`, name, view, filters };
    const next = [...saved, sv];
    setSaved(next);
    storeSavedViews(next);
    setActiveSaved(sv.id);
    toast.success(t("View “{name}” saved", { name }));
  };
  const removeSaved = (id) => {
    const next = saved.filter((s) => s.id !== id);
    setSaved(next);
    storeSavedViews(next);
    if (activeSaved === id) clearFilters();
  };

  const atText = preview ? t("at {time}", { time: fmtMinutes(clock.minutes) }) : t("right now");
  const tiles = [
    { key: "onMenu", label: t("On the menu now"), value: counts.onMenu, color: "var(--ready-ink)", sub: atText },
    // Manager's simple page: one plain "Hidden" count instead of "Hidden by time".
    simple
      ? { key: "hidden", label: t("Hidden"), value: counts.hidden, sub: t("customers can't see these now") }
      : { key: "byTime", label: t("Hidden by time"), value: counts.byTime, sub: t("outside their menu time") },
    { key: "soldOut", label: t("Sold out today"), value: counts.soldOut, color: counts.soldOut ? "var(--wait-ink)" : undefined,
      sub: t("back at {time}", { time: fmt12(dayEnd) }) },
    { key: "noPhoto", label: t("No photo"), value: counts.noPhoto, color: counts.noPhoto ? "var(--wait-ink)" : "var(--ready-ink)",
      sub: counts.noPhoto ? t("diners order less without one") : t("every item has one") },
    !simple && { key: "cleanup", label: t("Needs cleanup"), value: cleanup.length, color: cleanup.length ? "var(--stop-ink)" : "var(--ready-ink)",
      sub: cleanup.length ? t("duplicate, test or empty categories") : t("all tidy") },
  ].filter(Boolean);

  // ── actions (all through the API) ─────────────────────────────────────────
  const handleSaved = (saved, mode) => {
    setItems((p) => (mode === "create" ? [saved, ...p] : p.map((i) => (i._id === saved._id ? { ...i, ...saved } : i))));
    loadCats();
    if (mode === "create") load(); // refresh server-computed flags (scheduledNow, stock)
  };

  const handleCategoryCreated = (newCat) => {
    invalidate("order:categories");
    if (newCat?._deleted) {
      setCats((p) => p.filter((c) => c.name !== newCat.name));
      return;
    }
    setCats((p) => (p.some((c) => c.name === newCat?.name) ? p : [...p, newCat]));
  };

  // A category was saved/deleted/merged. A rename or merge moved items on the
  // server, so reload both lists; keep the category filter pointing at the
  // same category (or reset it if that category is gone).
  const handleCategoriesChanged = ({ deleted, renamedFrom, saved } = {}) => {
    invalidate("order:");
    if (deleted) {
      setSelCat((c) => (c === deleted ? "All" : c));
    }
    if (renamedFrom && saved?.name) setSelCat((c) => (c === renamedFrom ? saved.name : c));
    load();
  };

  const doDeleteCat = async () => {
    setDeletingCat(true);
    try {
      await deleteCategory(confirmDelCat._id);
      toast.success(t("\"{name}\" deleted", { name: localName(confirmDelCat) }));
      handleCategoriesChanged({ deleted: confirmDelCat.name, deletedId: confirmDelCat._id });
      setConfirmDelCat(null);
    } catch (e) {
      toast.error(errMsg(e, t("Failed to delete category")));
    } finally {
      setDeletingCat(false);
    }
  };

  const doMerge = async () => {
    const { from, into } = mergeAsk;
    setMerging(true);
    try {
      const { data } = await mergeCategory(from._id, into._id);
      toast.success(t("{n} items moved into {into} · “{from}” removed", { n: data.itemsMoved, into: data.into, from: data.from }));
      handleCategoriesChanged({ deleted: from.name, deletedId: from._id });
      setMergeAsk(null);
    } catch (e) {
      toast.error(errMsg(e, t("Could not merge the categories")));
    } finally {
      setMerging(false);
    }
  };

  // Drag order inside one menu time → the full category order on the server.
  const reorderGroup = async (groupIds) => {
    const inGroup = new Set(groupIds);
    const queue = [...groupIds];
    const next = cats.map((c) => (inGroup.has(c._id) ? queue.shift() : c._id));
    const byId = new Map(cats.map((c) => [c._id, c]));
    const prev = cats;
    setCats(next.map((id) => byId.get(id)));
    try {
      await reorderCategories(next);
      invalidate("order:categories");
    } catch (e) {
      setCats(prev);
      toast.error(errMsg(e, t("Could not save the new order")));
      loadCats();
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(t("Delete \"{name}\"? This cannot be undone.", { name: localName(item) }))) return;
    try {
      await deleteMenuItem(item._id);
      setItems((p) => p.filter((i) => i._id !== item._id));
      setSelItems((p) => { const n = new Set(p); n.delete(item._id); return n; });
      loadCats();
      toast.success(t("Item deleted"));
    } catch (e) {
      toast.error(errMsg(e, t("Delete failed")));
    }
  };

  const applyAvail = (ids, data) => {
    const set = new Set(ids);
    setItems((p) => p.map((i) => (set.has(i._id) ? { ...i, isAvailable: data.isAvailable, soldOutUntil: data.soldOutUntil } : i)));
  };
  const availToast = (state, what) => (state === "soldout"
    ? t("{what} sold out today · back on at {time}", { what, time: fmt12(dayEnd) })
    : state === "on" ? t("{what} → on the menu", { what }) : t("{what} → turned off", { what }));

  const setAvailable = async (item, state) => {
    setBusyIds((p) => new Set(p).add(item._id));
    try {
      const { data } = await setMenuAvailability([item._id], state);
      applyAvail([item._id], data);
      toast.success(availToast(state, localName(item)));
    } catch (e) {
      toast.error(errMsg(e, t("Update failed")));
    } finally {
      setBusyIds((p) => { const n = new Set(p); n.delete(item._id); return n; });
    }
  };

  const bulkSetState = async (state) => {
    const ids = [...selItems];
    setBulkBusy(true);
    try {
      const { data } = await setMenuAvailability(ids, state);
      applyAvail(ids, data);
      toast.success(availToast(state, tn(ids.length, "{n} item", "{n} items")));
      setSelItems(new Set());
    } catch (e) {
      toast.error(errMsg(e, t("Update failed")));
    } finally {
      setBulkBusy(false);
    }
  };

  const setSelMany = (ids, on) => setSelItems((p) => {
    const n = new Set(p);
    ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
    return n;
  });
  const toggleGroup = (name) => setCollapsed((p) => toggleIn(p, name));
  const setAllCollapsed = (all) => setCollapsed(all ? new Set(groups.map((g) => g.name)) : new Set());
  const editCat = (c) => c?._id && setCatForm({ ...c, itemCount: countOf(c) });
  const openBulk = () => (selItems.size
    ? setShowBulk(true)
    : toast(t("Tick the items to change in the list first (or a whole category with its box), then Bulk edit.")));
  const onTile = (k) => { pickView(k); setFiltersRaw(EMPTY_FILTERS); };

  const ready = !loading && !error;

  return (
    <div>
      <PageHeader
        title={t("Menu items")}
        sub={`${tn(items.length, "{n} item", "{n} items")} · ${tn(cats.length, "{n} category", "{n} categories")}${simple ? "" : ` · ${tn(menuTimes.length, "{n} menu time", "{n} menu times")}`}`}
        right={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {simple && canSetUp && (
              <button type="button" className="zc-btn" disabled={!ready} onClick={() => setShowMenuTimes(true)}>🕒 {t("Menu times")}</button>
            )}
            <button type="button" className="zc-btn" disabled={!ready} onClick={() => setShowImport(true)}>⇪ {t("Import menu")}</button>
            {/* Admin and manager: add / edit / delete categories in one window. */}
            {simple && (
              <button type="button" className="zc-btn" disabled={!ready} onClick={() => setShowCats(true)}>🗂 {t("Category")}</button>
            )}
            {!simple && (
              <button type="button" className="zc-btn" disabled={!ready} onClick={openBulk}>
                ✎ {t("Bulk edit")}{selItems.size ? ` (${fmtNum(selItems.size)})` : ""}
              </button>
            )}
            <button type="button" className="zc-btn pri" onClick={() => setModal("create")}>＋ {t("New item")}</button>
          </div>
        }
      />

      <StatusStrip tiles={tiles} view={activeSaved || hasExtraFilters(filters) ? null : view} onView={simple ? null : onTile} />

      <div className={`mb-body${simple ? " mb-simple" : ""}`}>
        {simple && (loading ? (
          <div className="zc-card"><div className="zc-card-b"><Loader rows={5} /></div></div>
        ) : !error && (
          <CategoryList list={itemCats} totalItems={items.length} selCat={selCat} onPick={setSelCat} />
        ))}
        {!simple && <div className="mb-left">
          {loading ? (
            <div className="zc-card"><div className="zc-card-b"><Loader rows={5} /></div></div>
          ) : !error && (
            <>
              <MenuTimesCard groups={timeGroups} selected={activeGroup?.key} onSelect={setSelGroup}
                preview={preview} setPreview={setPreview} clock={clock}
                onAdd={() => setMtForm("create")} onEdit={setMtForm} disabled={!ready} />
              <CategoryCard
                group={activeGroup} countOf={countOf} selCat={selCat}
                onPickCat={(name) => setSelCat(name)} onEditCat={editCat} onNewCat={() => setCatForm("create")}
                onReorder={reorderGroup} cleanup={cleanup}
                onMerge={(from, into) => setMergeAsk({ from, into })} onDeleteCat={setConfirmDelCat}
                onReviewCat={(c) => { setSelCat(c.name); pickView("all"); }}
                onManage={() => setShowCats(true)} onAssign={setMtForm} disabled={!ready} />
            </>
          )}
        </div>}

        <ItemsPanel
          loading={loading} error={error} onRetry={load} totalItems={items.length}
          groups={groups} counts={counts} view={view} setView={pickView}
          search={search} setSearch={setSearch}
          saved={savedWithCounts} activeSaved={activeSaved} onApplySaved={applySaved}
          onRemoveSaved={removeSaved} onSaveView={saveView}
          filters={filters} setFilters={setFilters} allTags={allTags}
          selCat={selCat} selCatLabel={catLabel(cats, selCat)} clearCat={() => setSelCat("All")}
          preview={preview} clock={clock}
          sel={selItems} toggleSel={(id) => setSelItems((p) => toggleIn(p, id))} setSelMany={setSelMany}
          collapsed={q ? new Set() : collapsed} toggleGroup={toggleGroup} setAllCollapsed={setAllCollapsed}
          busyIds={busyIds} onEdit={setModal} onDelete={handleDelete} onAvail={setAvailable} onEditCat={editCat}
          onNew={() => setModal("create")}
          bulk={{
            busy: bulkBusy, setState: bulkSetState, edit: () => setShowBulk(true),
            clear: () => setSelItems(new Set()),
          }}
          hasFilters={hasFilters} clearFilters={clearFilters}
          simple={simple}
        />
      </div>

      {modal && (
        <ItemModal
          item={modal === "create" ? null : modal}
          categories={cats}
          allTags={allTags}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
          onCategoryCreated={handleCategoryCreated}
        />
      )}

      {catForm && (
        <CategoryModal
          category={catForm === "create" ? null : catForm}
          onClose={() => setCatForm(null)}
          onSaved={(saved, info) => handleCategoriesChanged({ saved, ...info })}
        />
      )}

      {confirmDelCat && (
        <div className="zc-scrim" onClick={() => !deletingCat && setConfirmDelCat(null)} style={{ zIndex: 1200 }}>
          <div className="zc-modal" style={{ width: 380 }} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="mh"><div className="t">{t("Delete category?")}</div></div>
            <div className="mb" style={{ fontSize: 13, color: "var(--text-2)" }}>
              {t("Delete “{name}”? This can’t be undone.", { name: localName(confirmDelCat) })}
            </div>
            <div className="mf">
              <button type="button" className="zc-btn" disabled={deletingCat} onClick={() => setConfirmDelCat(null)}>{t("Cancel")}</button>
              <button type="button" className="zc-btn danger" disabled={deletingCat} onClick={doDeleteCat}>
                {deletingCat ? t("Deleting…") : t("Delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {mergeAsk && (
        <div className="zc-scrim" onClick={() => !merging && setMergeAsk(null)} style={{ zIndex: 1200 }}>
          <div className="zc-modal" style={{ width: 420 }} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="mh"><div className="t">{t("Merge categories?")}</div></div>
            <div className="mb" style={{ fontSize: 13, color: "var(--text-2)" }}>
              {t("Move the {n} items in “{from}” into “{into}”, then remove “{from}”. The items keep their prices, photos and tags.", {
                n: countOf(mergeAsk.from), from: localName(mergeAsk.from), into: localName(mergeAsk.into),
              })}
            </div>
            <div className="mf">
              <button type="button" className="zc-btn" disabled={merging} onClick={() => setMergeAsk(null)}>{t("Cancel")}</button>
              <button type="button" className="zc-btn pri" disabled={merging} onClick={doMerge}>
                {merging ? t("Merging…") : t("Merge into {name}", { name: localName(mergeAsk.into) })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Simple page: Menu times live behind a header button (admin only). */}
      {showMenuTimes && (
        <div className="zc-scrim" onClick={() => setShowMenuTimes(false)} style={{ zIndex: 1100 }}>
          <div className="zc-modal" style={{ width: 460 }} role="dialog" aria-modal="true" aria-label={t("Menu times")} onClick={(e) => e.stopPropagation()}>
            <div className="mh">
              <div className="t" style={{ flex: 1 }}>{t("Menu times")}</div>
              <button type="button" className="zc-x" onClick={() => setShowMenuTimes(false)} aria-label={t("Close")}>✕</button>
            </div>
            <div className="mb">
              <MenuTimesCard groups={timeGroups} selected={activeGroup?.key} onSelect={setSelGroup}
                preview={preview} setPreview={setPreview} clock={clock}
                // the form opens on its own layer — close this window first
                onAdd={() => { setShowMenuTimes(false); setMtForm("create"); }}
                onEdit={(mt) => { setShowMenuTimes(false); setMtForm(mt); }} disabled={!ready} />
            </div>
          </div>
        </div>
      )}

      {showCats && (
        <CategoriesModal
          cats={cats}
          items={items}
          onClose={() => setShowCats(false)}
          onChanged={handleCategoriesChanged}
          onView={(name) => { setSelCat(name); pickView("all"); setShowCats(false); }}
          simple={simple}
        />
      )}


      {mtForm && (
        <MenuTimeModal
          menuTime={mtForm === "create" ? null : mtForm}
          cats={cats}
          groupNameOf={(c) => groupOfCat.get(c.name)?.name}
          onClose={() => setMtForm(null)}
          onSaved={() => { invalidate("order:"); load(); }}
        />
      )}

      {showBulk && (
        <BulkEditModal
          items={items.filter((i) => selItems.has(i._id))}
          cats={cats}
          allTags={allTags}
          onClose={() => setShowBulk(false)}
          onDone={() => { setSelItems(new Set()); invalidate("order:"); load(); }}
        />
      )}

      {showImport && (
        <ImportModal
          cats={cats}
          items={items}
          onClose={() => setShowImport(false)}
          onImported={() => { invalidate("order:"); load(); }}
        />
      )}
    </div>
  );
}
