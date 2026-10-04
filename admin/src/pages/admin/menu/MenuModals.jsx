// src/pages/admin/menu/MenuModals.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Modals for the Menu items page's big-menu tools:
//   MenuTimeModal  — create / edit / delete a named Menu time and pick its categories
//   BulkEditModal  — move category, add/remove diner tags, change price by %
//   ImportModal    — menu photo / PDF, CSV, pasted text → one review list → Add;
//                    dish photos matched to existing items by file name
// All writes go through services/menuService.js; prices and windows are
// validated (and prices computed) server-side.
// ─────────────────────────────────────────────────────────────────────────────
import TimePicker from "../../../components/TimePicker.jsx";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { t, tn, fmtNum, localName } from "../../../i18n/core.js";
import {
  createMenuTime, updateMenuTime, deleteMenuTime, bulkEditMenu,
  readMenuImportText, readMenuImportFile, commitMenuImport, updateMenuItem,
} from "../../../services/menuService.js";
import { TagEditor } from "./menuUI.jsx";
import { DAY_SHORT, MT_COLOR_KEYS, mtColor, schedLabel, dupKey, runChunked, errMsg } from "./menuKit.js";

const useEscape = (fn, active = true) => {
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => e.key === "Escape" && fn();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fn, active]);
};

// ═══════════════════════════ Menu time ══════════════════════════════════════
export function MenuTimeModal({ menuTime, cats, groupNameOf, onClose, onSaved }) {
  const isEdit = !!menuTime?._id;
  const sc = menuTime?.schedule || {};
  const [name, setName] = useState(menuTime?.name || "");
  const [allDay, setAllDay] = useState(isEdit ? !sc.startTime && !sc.endTime : false);
  const [start, setStart] = useState(sc.startTime || "");
  const [end, setEnd] = useState(sc.endTime || "");
  const [days, setDays] = useState(() => new Set(sc.days || []));
  const [useDates, setUseDates] = useState(!!(sc.startDate || sc.endDate));
  const [startDate, setStartDate] = useState(sc.startDate || "");
  const [endDate, setEndDate] = useState(sc.endDate || "");
  const [color, setColor] = useState(menuTime?.color || "violet");
  const [catIds, setCatIds] = useState(() => new Set(cats.filter((c) => isEdit && String(c.menuTime) === String(menuTime._id)).map((c) => c._id)));
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  useEscape(onClose, !busy && !confirmDel);

  const toggleDay = (d) => setDays((p) => { const n = new Set(p); if (n.has(d)) n.delete(d); else n.add(d); return n; });
  const toggleCat = (id) => setCatIds((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const schedule = {
    startTime: allDay ? "" : start, endTime: allDay ? "" : end,
    days: [...days].sort((a, b) => a - b),
    startDate: useDates ? startDate : "", endDate: useDates ? endDate : "",
  };
  const preview = (allDay || (start && end)) ? schedLabel({ ...schedule, enabled: true }) : "";

  const save = async () => {
    if (!name.trim()) return toast.error(t("Give the menu time a name"));
    if (!allDay && (!start || !end)) return toast.error(t("Choose both a start and an end time"));
    if (!allDay && start === end) return toast.error(t("Start and end time cannot be the same"));
    if (allDay && !days.size && !(useDates && (startDate || endDate))) {
      return toast.error(t("An all-day menu time needs days or dates — otherwise use “All day”."));
    }
    setBusy(true);
    try {
      const body = { name: name.trim(), schedule, color, categoryIds: [...catIds] };
      const { data } = isEdit ? await updateMenuTime(menuTime._id, body) : await createMenuTime(body);
      toast.success(isEdit ? t("“{name}” updated", { name: data.name }) : t("“{name}” created", { name: data.name }));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errMsg(e, t("Could not save the menu time")));
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const { data } = await deleteMenuTime(menuTime._id);
      toast.success(data.categoriesFreed
        ? t("“{name}” deleted · {n} categories now show all day", { name: data.deleted, n: data.categoriesFreed })
        : t("“{name}” deleted", { name: data.deleted }));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errMsg(e, t("Could not delete the menu time")));
    } finally { setBusy(false); setConfirmDel(false); }
  };

  return (
    <div className="zc-scrim" onClick={() => !busy && onClose()}>
      <div className="zc-modal" style={{ width: 640 }} role="dialog" aria-modal="true" aria-labelledby="mt-title"
        onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div style={{ flex: 1 }}>
            <div className="t" id="mt-title">{isEdit ? t("Edit menu time") : t("New menu time")}</div>
            <div className="s">{t("Categories inside it show to diners only during this time (restaurant time)")}</div>
          </div>
          <button type="button" className="zc-x" onClick={onClose} disabled={busy} aria-label={t("Close")}>✕</button>
        </div>
        <div className="mb" style={{ display: "grid", gap: 16 }}>
          <div className="menu-field">
            <label htmlFor="mt-name">{t("Name")} *</label>
            <input id="mt-name" className="zc-input" value={name} maxLength={30} autoFocus
              placeholder={t("e.g. Breakfast, Lunch, Weekend fish special")} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="menu-field">
            <label>{t("Hours")}</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div className="zc-seg" role="group">
                <button type="button" className={!allDay ? "on" : ""} aria-pressed={!allDay} onClick={() => setAllDay(false)}>{t("Between")}</button>
                <button type="button" className={allDay ? "on" : ""} aria-pressed={allDay} onClick={() => setAllDay(true)}>{t("All day")}</button>
              </div>
              {!allDay && (
                <>
                  <TimePicker ariaLabel={t("Start time")} value={start} onChange={setStart} />
                  <span style={{ color: "var(--text-3)" }}>→</span>
                  <TimePicker ariaLabel={t("End time")} value={end} onChange={setEnd} />
                </>
              )}
            </div>
            <div className="hint">{t("Start included, end not. An end earlier than the start runs past midnight.")}</div>
          </div>

          <div className="menu-field">
            <label>{t("Days")} <span style={{ fontWeight: 400, color: "var(--text-3)" }}>({t("none picked = every day")})</span></label>
            <div className="mt-days">
              {DAY_SHORT.map((d, i) => (
                <button key={d} type="button" className={days.has(i) ? "on" : ""} aria-pressed={days.has(i)} onClick={() => toggleDay(i)}>{t(d)}</button>
              ))}
            </div>
          </div>

          <div className="menu-field">
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" className="menu-cb" checked={useDates} onChange={(e) => setUseDates(e.target.checked)} />
              {t("Only between dates (festival, season)")}
            </label>
            {useDates && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input type="date" className="zc-input" style={{ width: 160 }} aria-label={t("From date")} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                <span style={{ color: "var(--text-3)" }}>→</span>
                <input type="date" className="zc-input" style={{ width: 160 }} aria-label={t("To date")} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            )}
          </div>

          <div className="menu-field">
            <label>{t("Colour on the timeline")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              {MT_COLOR_KEYS.map((k) => (
                <button key={k} type="button" className={`mt-swatch${color === k ? " on" : ""}`} style={{ background: mtColor(k) }}
                  aria-label={k} aria-pressed={color === k} onClick={() => setColor(k)} />
              ))}
            </div>
          </div>

          <div className="menu-field">
            <label>{t("Categories in this menu time")} · {fmtNum(catIds.size)}</label>
            {cats.length === 0 ? (
              <div className="hint">{t("No categories yet.")}</div>
            ) : (
              <div className="menu-catpick" style={{ maxHeight: 190, overflowY: "auto" }}>
                {cats.map((c) => {
                  const now = groupNameOf(c);
                  const mine = isEdit && String(c.menuTime) === String(menuTime._id);
                  return (
                    <label key={c._id} className={`menu-catchip${catIds.has(c._id) ? " on" : ""}`}>
                      <input type="checkbox" className="menu-cb" checked={catIds.has(c._id)} onChange={() => toggleCat(c._id)} />
                      {localName(c)}
                      {!mine && now && <span style={{ fontSize: 10.5, color: "var(--text-3)" }}>· {now}</span>}
                    </label>
                  );
                })}
              </div>
            )}
            <div className="hint">{t("A category sits in one menu time. Ticking one from another menu time moves it here; unticking puts it back to All day.")}</div>
          </div>

          {preview && (
            <div style={{ fontSize: 12.5, padding: "10px 12px", borderRadius: 12, background: "var(--card-2)", border: "1px solid var(--edge)" }}>
              <span className="sw" style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: mtColor(color), marginRight: 8 }} />
              <b>{name.trim() || t("Untitled")}</b> · {preview}
            </div>
          )}
        </div>
        <div className="mf" style={{ alignItems: "center" }}>
          {isEdit && (confirmDel ? (
            <span style={{ marginRight: "auto", display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
              {t("Delete it? Its categories will show all day.")}
              <button type="button" className="zc-btn danger sm" disabled={busy} onClick={remove}>{t("Delete")}</button>
              <button type="button" className="zc-btn ghost sm" disabled={busy} onClick={() => setConfirmDel(false)}>{t("Cancel")}</button>
            </span>
          ) : (
            <button type="button" className="zc-btn danger" style={{ marginRight: "auto" }} disabled={busy} onClick={() => setConfirmDel(true)}>{t("Delete")}</button>
          ))}
          <button type="button" className="zc-btn" onClick={onClose} disabled={busy}>{t("Cancel")}</button>
          <button type="button" className="zc-btn pri" onClick={save} disabled={busy}>
            {busy ? t("Saving…") : isEdit ? t("Save changes") : t("Create menu time")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════ Bulk edit ══════════════════════════════════════
export function BulkEditModal({ items, cats, allTags, onClose, onDone }) {
  const [category, setCategory] = useState("");
  const [addTags, setAddTags] = useState([]);
  const [removeTags, setRemoveTags] = useState(() => new Set());
  const [pct, setPct] = useState("");
  const [busy, setBusy] = useState(false);
  useEscape(onClose, !busy);

  const presentTags = useMemo(() => {
    const m = new Map();
    for (const i of items) for (const x of i.tags || []) m.set(x.toLowerCase(), x);
    return [...m.values()].sort();
  }, [items]);
  const pctNum = pct === "" ? null : Number(pct);
  const pctOk = pctNum === null || (Number.isFinite(pctNum) && pctNum >= -90 && pctNum <= 500);
  const newPrice = (p) => Math.max(0, Math.round(Number(p || 0) * (1 + pctNum / 100)));
  const changes = !!category || addTags.length > 0 || removeTags.size > 0 || (pctNum !== null && pctNum !== 0);

  const apply = async () => {
    if (!pctOk) return toast.error(t("Price change must be between −90% and +500%"));
    setBusy(true);
    try {
      const body = { ids: items.map((i) => i._id) };
      if (category) body.category = category;
      if (addTags.length) body.addTags = addTags;
      if (removeTags.size) body.removeTags = [...removeTags];
      if (pctNum) body.pricePercent = pctNum;
      const { data } = await bulkEditMenu(body);
      toast.success(tn(data.updated, "{n} item updated", "{n} items updated"));
      onDone();
      onClose();
    } catch (e) {
      toast.error(errMsg(e, t("Bulk edit failed")));
    } finally { setBusy(false); }
  };

  return (
    <div className="zc-scrim" onClick={() => !busy && onClose()}>
      <div className="zc-modal" style={{ width: 560 }} role="dialog" aria-modal="true" aria-labelledby="be-title"
        onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div style={{ flex: 1 }}>
            <div className="t" id="be-title">✎ {t("Bulk edit")}</div>
            <div className="s">{tn(items.length, "{n} selected item", "{n} selected items")} · {t("only what you change is saved")}</div>
          </div>
          <button type="button" className="zc-x" onClick={onClose} disabled={busy} aria-label={t("Close")}>✕</button>
        </div>
        <div className="mb" style={{ display: "grid", gap: 16 }}>
          <div className="menu-field">
            <label htmlFor="be-cat">{t("Move to category")}</label>
            <select id="be-cat" className="zc-select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{t("Don’t change")}</option>
              {cats.map((c) => <option key={c._id} value={c.name}>{localName(c)}</option>)}
            </select>
            <div className="hint">{t("Items follow their new category’s menu time.")}</div>
          </div>
          <div className="menu-field">
            <label>{t("Add diner tags")}</label>
            <TagEditor value={addTags} onChange={setAddTags} suggestions={allTags} />
          </div>
          {presentTags.length > 0 && (
            <div className="menu-field">
              <label>{t("Remove diner tags")}</label>
              <div className="mt-days">
                {presentTags.map((x) => {
                  const on = removeTags.has(x);
                  return (
                    <button key={x} type="button" className={on ? "on" : ""} aria-pressed={on}
                      onClick={() => setRemoveTags((p) => { const n = new Set(p); if (n.has(x)) n.delete(x); else n.add(x); return n; })}>
                      {on ? "✕ " : ""}{x}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="menu-field">
            <label htmlFor="be-pct">{t("Change price by %")}</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input id="be-pct" type="number" step="1" min="-90" max="500" className="zc-input" style={{ width: 120 }}
                placeholder="10" value={pct} onChange={(e) => setPct(e.target.value)} />
              <span className="hint">{t("e.g. 10 = 10% dearer, −5 = 5% cheaper · rounded to whole rupees")}</span>
            </div>
            {pctNum ? (pctOk ? (
              <div style={{ fontSize: 12, color: "var(--text-2)", display: "grid", gap: 2, marginTop: 4 }}>
                {items.slice(0, 4).map((i) => (
                  <span key={i._id}>{localName(i)}: ₹{fmtNum(i.price)} → <b>₹{fmtNum(newPrice(i.price))}</b></span>
                ))}
                {items.length > 4 && <span className="hint">{t("…and {n} more", { n: items.length - 4 })}</span>}
              </div>
            ) : <div className="hint" style={{ color: "var(--stop-ink)" }}>{t("Price change must be between −90% and +500%")}</div>) : null}
          </div>
        </div>
        <div className="mf">
          <button type="button" className="zc-btn" onClick={onClose} disabled={busy}>{t("Cancel")}</button>
          <button type="button" className="zc-btn pri" onClick={apply} disabled={busy || !changes || !pctOk}>
            {busy ? t("Saving…") : tn(items.length, "Apply to {n} item", "Apply to {n} items")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════ Import ═════════════════════════════════════════
const SOURCES = [
  ["photo", "Menu photo / PDF"],
  ["sheet", "Excel / CSV"],
  ["paste", "Paste text"],
  ["dish", "Dish photos"],
];
const TEMPLATE_CSV = "Name,Price,Category,Type,Note,Tags\nVeg Thali,160,Lunch,Veg,,Bestseller\nKatla Fish Curry,130,Lunch,Non-veg,,Fish\nBegun Bhaja,80,Extras,Veg,4 pcs,\n";
const downloadTemplate = () => {
  const url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "menu-template.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const normName = (s) => String(s || "").toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9ঀ-৿]+/g, " ").trim();

/** Section name from the file → an existing category with the same (or near-same) name, else itself. */
const mapCategory = (section, cats) => {
  if (!section) return "";
  const exact = cats.find((c) => c.name.toLowerCase() === section.toLowerCase());
  if (exact) return exact.name;
  const k = dupKey(section);
  const near = k && cats.find((c) => dupKey(c.name) === k);
  return near ? near.name : section;
};

export function ImportModal({ cats, items, onClose, onImported }) {
  const [src, setSrc] = useState("photo");
  const [rows, setRows] = useState([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paste, setPaste] = useState("");
  const [files, setFiles] = useState([]);
  const fileRef = useRef(null);
  useEscape(onClose, !reading && !saving);

  const addRows = (data) => {
    const fresh = (data.rows || []).map((r, i) => ({
      key: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      include: true, name: r.name, price: r.price, tag: r.tag, tags: r.tags || [],
      description: r.description || "", section: r.sourceSection || "",
      category: mapCategory(r.category, cats), check: r.check || [],
    }));
    setRows((p) => [...p, ...fresh]);
    toast.success(tn(fresh.length, "{n} dish read", "{n} dishes read"));
  };

  const readFile = async (file) => {
    if (!file) return;
    setReading(true);
    try {
      if (src === "sheet") {
        if (/\.xlsx?$/i.test(file.name)) throw new Error(t("Excel files: open the file, choose File → Save as → CSV, then upload the .csv here."));
        const text = await file.text();
        addRows((await readMenuImportText(text, "csv")).data);
      } else {
        addRows((await readMenuImportFile(file)).data);
      }
      setFiles((p) => [...p, file.name]);
    } catch (e) {
      toast.error(e?.response ? errMsg(e, t("Could not read this file")) : e.message);
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const readPaste = async () => {
    if (!paste.trim()) return toast.error(t("Paste some menu text first"));
    setReading(true);
    try { addRows((await readMenuImportText(paste, "text")).data); setPaste(""); }
    catch (e) { toast.error(errMsg(e, t("Could not read this text"))); }
    finally { setReading(false); }
  };

  const setRow = (key, patch) => setRows((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const included = rows.filter((r) => r.include);
  const toCheck = included.filter((r) => r.check.length).length;
  const existingKeys = useMemo(() => new Set(items.map((i) => `${i.category.toLowerCase()}\u0000${i.name.toLowerCase()}`)), [items]);
  const already = (r) => existingKeys.has(`${String(r.category).toLowerCase()}\u0000${String(r.name).toLowerCase()}`);
  const mapping = useMemo(() => {
    const m = new Map();
    for (const r of rows) if (r.section) m.set(r.section, r.category);
    return [...m.entries()];
  }, [rows]);
  const catNames = new Set(cats.map((c) => c.name.toLowerCase()));

  const add = async () => {
    const send = included.filter((r) => !already(r));
    if (!send.length) return toast.error(t("Nothing new to add — every ticked dish is already on the menu"));
    const bad = send.find((r) => !String(r.name).trim() || !String(r.category).trim() || !(Number(r.price) >= 0) || r.price === "");
    if (bad) return toast.error(t("Every dish needs a name, a price and a category"));
    setSaving(true);
    try {
      const { data } = await commitMenuImport(send.map((r) => ({
        name: r.name, price: Number(r.price), category: r.category, tag: r.tag, description: r.description, tags: r.tags,
      })));
      toast.success([
        tn(data.created, "{n} dish added", "{n} dishes added"),
        data.categoriesCreated.length ? tn(data.categoriesCreated.length, "{n} new category", "{n} new categories") : "",
        data.skipped ? tn(data.skipped, "{n} already on the menu", "{n} already on the menu") : "",
      ].filter(Boolean).join(" · "));
      onImported();
      onClose();
    } catch (e) {
      toast.error(errMsg(e, t("Import failed — nothing was added")));
    } finally { setSaving(false); }
  };

  return (
    <div className="zc-scrim" onClick={() => !reading && !saving && onClose()}>
      <div className="zc-modal wide" style={{ width: 1000 }} role="dialog" aria-modal="true" aria-labelledby="imp-title"
        onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div style={{ flex: 1 }}>
            <div className="t" id="imp-title">{t("Import menu")}</div>
            <div className="s">{t("Any mix of sources · everything lands in one review list · nothing is saved until you press Add")}</div>
          </div>
          <button type="button" className="zc-x" onClick={onClose} disabled={reading || saving} aria-label={t("Close")}>✕</button>
        </div>
        <div className="mb" style={{ display: "grid", gap: 14 }}>
          <div className="zc-seg mi-tabs" role="tablist">
            {SOURCES.map(([k, l]) => (
              <button key={k} type="button" role="tab" className={src === k ? "on" : ""} aria-selected={src === k} onClick={() => setSrc(k)}>{t(l)}</button>
            ))}
          </div>

          {src === "dish" ? (
            <DishPhotos items={items} onUploaded={onImported} />
          ) : (
            <div className="mi-grid">
              <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
                {src === "paste" ? (
                  <>
                    <textarea className="zc-textarea" rows={10} value={paste} onChange={(e) => setPaste(e.target.value)}
                      style={{ fontFamily: "var(--mono, ui-monospace, monospace)", fontSize: 12 }}
                      placeholder={"LUNCH\nVeg Thali 160\nPosto Bora 110\nKatla Fish Curry - 130\n\nEXTRA\nMoong Dal 80"} />
                    <div className="hint" style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {t("Paste from WhatsApp, notes or an old bill book. A line without a price (like LUNCH) starts a category.")}
                    </div>
                    <button type="button" className="zc-btn pri" disabled={reading} onClick={readPaste}>{reading ? t("Reading…") : t("Read text")}</button>
                  </>
                ) : (
                  <>
                    <div className="mi-drop" role="button" tabIndex={0} onClick={() => !reading && fileRef.current?.click()}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}>
                      <span style={{ fontSize: 22 }}>{src === "sheet" ? "📊" : "📷"}</span>
                      <b style={{ color: "var(--text-1)" }}>{reading ? t("Reading…") : src === "sheet" ? t("Choose a CSV file") : t("Choose a menu photo or PDF")}</b>
                      <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                        {src === "sheet" ? t("First row = headings (Name, Price, Category, Type, Note)") : t("JPG, PNG, WEBP or PDF · one page at a time works best")}
                      </span>
                    </div>
                    <input ref={fileRef} type="file" style={{ display: "none" }}
                      accept={src === "sheet" ? ".csv,text/csv,.xlsx,.xls" : "image/jpeg,image/png,image/webp,application/pdf"}
                      onChange={(e) => readFile(e.target.files?.[0])} />
                    {files.length > 0 && (
                      <div style={{ fontSize: 11.5, color: "var(--text-2)" }}>
                        {t("Read:")} {files.join(", ")}
                        <button type="button" className="zc-btn ghost sm" style={{ marginTop: 6, width: "100%" }} disabled={reading}
                          onClick={() => fileRef.current?.click()}>＋ {t("Add another file")}</button>
                      </div>
                    )}
                    {src === "sheet" ? (
                      <button type="button" className="zc-btn ghost sm" onClick={downloadTemplate}>⬇ {t("Download menu template (CSV)")}</button>
                    ) : (
                      <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                        {t("The photo is read on your own server — a sharp, straight-on photo reads best. Check flagged rows before adding.")}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div style={{ minWidth: 0 }}>
                {rows.length === 0 ? (
                  <div style={{ height: "100%", minHeight: 220, display: "grid", placeItems: "center", textAlign: "center", border: "1px dashed var(--edge)", borderRadius: 12, padding: 20, fontSize: 12.5, color: "var(--text-3)" }}>
                    {t("Dishes you read appear here to check before anything is saved.")}
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="zc-tag ready"><i />{tn(included.length - toCheck, "{n} read clearly", "{n} read clearly")}</span>
                      {toCheck > 0 && <span className="zc-tag wait"><i />{tn(toCheck, "{n} to check", "{n} to check")}</span>}
                      {mapping.length > 0 && (
                        <span className="zc-tag vio" style={{ whiteSpace: "normal" }}>
                          {t("Sections → your categories:")} {mapping.map(([s, c]) => `${s} → ${c}${catNames.has(String(c).toLowerCase()) ? "" : ` (${t("new")})`}`).join(" · ")}
                        </span>
                      )}
                      <button type="button" className="zc-btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => setRows([])}>{t("Clear list")}</button>
                    </div>
                    <div className="mi-review">
                      <datalist id="mi-cats">{cats.map((c) => <option key={c._id} value={c.name} />)}</datalist>
                      <table>
                        <thead>
                          <tr>
                            <th style={{ width: 28 }} />
                            <th>{t("Dish")}</th>
                            <th style={{ width: 84 }}>{t("Price")}</th>
                            <th style={{ width: 104 }}>{t("Type")}</th>
                            <th style={{ width: 140 }}>{t("Category")}</th>
                            <th>{t("Note")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => {
                            const dup = already(r);
                            return (
                              <tr key={r.key} className={!r.include || dup ? "skip" : r.check.length ? "chk" : ""}>
                                <td><input type="checkbox" className="menu-cb" checked={r.include && !dup} disabled={dup}
                                  aria-label={t("Include {name}", { name: r.name })} onChange={(e) => setRow(r.key, { include: e.target.checked })} /></td>
                                <td>
                                  <input className="zc-input" value={r.name} aria-label={t("Dish name")} onChange={(e) => setRow(r.key, { name: e.target.value })} />
                                  {dup && <div className="mi-why" style={{ color: "var(--text-3)" }}>{t("Already on the menu — will be skipped")}</div>}
                                  {r.check.map((c) => <div key={c} className="mi-why">⚠ {t(c)}</div>)}
                                </td>
                                <td><input className="zc-input" type="number" min="0" value={r.price} aria-label={t("Price")} onChange={(e) => setRow(r.key, { price: e.target.value })} /></td>
                                <td>
                                  <select className="zc-select" value={r.tag} aria-label={t("Type")} onChange={(e) => setRow(r.key, { tag: e.target.value })}>
                                    <option value="Veg">{t("Veg")}</option>
                                    <option value="Non Veg">{t("Non-veg")}</option>
                                  </select>
                                </td>
                                <td><input className="zc-input" list="mi-cats" value={r.category} aria-label={t("Category")} onChange={(e) => setRow(r.key, { category: e.target.value })} /></td>
                                <td><input className="zc-input" value={r.description} aria-label={t("Note")} onChange={(e) => setRow(r.key, { description: e.target.value })} /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8 }}>
                      {t("Fish, prawn, chicken, mutton and egg dishes are marked Non-veg automatically — check the Type column. Notes like “30 min” and “3 pcs” are kept.")}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        {src !== "dish" && (
          <div className="mf" style={{ alignItems: "center" }}>
            <span style={{ marginRight: "auto", fontSize: 12, color: "var(--text-3)" }}>{t("New categories are created for sections that don’t exist yet.")}</span>
            <button type="button" className="zc-btn" onClick={onClose} disabled={saving}>{t("Cancel")}</button>
            <button type="button" className="zc-btn good" disabled={saving || reading || !included.length} onClick={add}>
              {saving ? t("Adding…") : tn(included.filter((r) => !already(r)).length, "Add {n} dish", "Add {n} dishes")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Dish photos in bulk: matched to existing items by file name
// ("katla-kalia.jpg" → Katla Kalia), unmatched ones picked by hand.
function DishPhotos({ items, onUploaded }) {
  const [list, setList] = useState([]); // { key, file, url, itemId }
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const ref = useRef(null);
  const urls = useRef([]);
  const byName = useMemo(() => new Map(items.map((i) => [normName(i.name), i._id])), [items]);
  const sorted = useMemo(() => [...items].sort((a, b) => a.name.localeCompare(b.name)), [items]);
  const revokeAll = () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current = []; };
  useEffect(() => revokeAll, []);

  const pick = (fileList) => {
    revokeAll();
    const next = [...fileList].filter((f) => /^image\//.test(f.type)).map((f, i) => ({
      key: `${f.name}-${i}-${f.size}`, file: f, url: URL.createObjectURL(f),
      itemId: byName.get(normName(f.name)) || "", tooBig: f.size > 5 * 1024 * 1024,
    }));
    urls.current = next.map((x) => x.url);
    setList(next);
    setDone(0);
  };
  const matched = list.filter((x) => x.itemId && !x.tooBig);
  const upload = async () => {
    setBusy(true);
    setDone(0);
    const { ok, failed } = await runChunked(matched, async (x) => {
      const fd = new FormData();
      fd.append("image", x.file);
      const r = await updateMenuItem(x.itemId, fd);
      setDone((d) => d + 1);
      return r;
    }, 3);
    setBusy(false);
    if (ok.length) { toast.success(tn(ok.length, "{n} photo added", "{n} photos added")); onUploaded(); }
    if (failed) toast.error(tn(failed, "{n} photo could not be uploaded", "{n} photos could not be uploaded"));
    else { revokeAll(); setList([]); }
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="mi-drop" role="button" tabIndex={0} onClick={() => !busy && ref.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && ref.current?.click()}>
        <span style={{ fontSize: 22 }}>🖼️</span>
        <b style={{ color: "var(--text-1)" }}>{t("Choose dish photos (many at once)")}</b>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("Name each file after the dish — katla-kalia.jpg → Katla Kalia. Max 5 MB each.")}</span>
      </div>
      <input ref={ref} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => pick(e.target.files || [])} />
      {list.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="zc-tag ready"><i />{tn(list.filter((x) => x.itemId).length, "{n} matched by file name", "{n} matched by file name")}</span>
            {list.some((x) => !x.itemId) && <span className="zc-tag wait"><i />{tn(list.filter((x) => !x.itemId).length, "{n} to match by hand", "{n} to match by hand")}</span>}
          </div>
          <div className="mi-review">
            <table>
              <tbody>
                {list.map((x) => (
                  <tr key={x.key} className={!x.itemId || x.tooBig ? "chk" : ""}>
                    <td style={{ width: 52 }}><img src={x.url} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 8 }} /></td>
                    <td style={{ fontSize: 11.5, color: "var(--text-2)", wordBreak: "break-all" }}>
                      {x.file.name}
                      {x.tooBig && <div className="mi-why">⚠ {t("Larger than 5 MB — make it smaller first")}</div>}
                    </td>
                    <td style={{ width: 260 }}>
                      <select className="zc-select" value={x.itemId} aria-label={t("Dish for {name}", { name: x.file.name })}
                        onChange={(e) => setList((p) => p.map((y) => (y.key === x.key ? { ...y, itemId: e.target.value } : y)))}>
                        <option value="">{t("— pick the dish —")}</option>
                        {sorted.map((i) => <option key={i._id} value={i._id}>{localName(i)}{i.image ? " ✓" : ""}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
            {busy && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{fmtNum(done)} / {fmtNum(matched.length)}</span>}
            <button type="button" className="zc-btn good" disabled={busy || !matched.length} onClick={upload}>
              {busy ? t("Uploading…") : tn(matched.length, "Upload {n} photo", "Upload {n} photos")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
