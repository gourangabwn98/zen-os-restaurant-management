// src/pages/admin/menu/MenuBoard.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Layout of the Menu items page ("big-menu manager"):
//   status strip (clickable tiles)  ·  left rail: Menu times (timeline +
//   "Preview as a diner at…") and the selected time's categories (drag to
//   reorder, "Needs a home" cleanup)  ·  right: views + filters + search,
//   items grouped by category (menu time shown once per group), bulk bar.
// Purely presentational: MenuAdminPage owns the data (real API results) and
// passes every action in. No menu data is created here.
// ─────────────────────────────────────────────────────────────────────────────
import TimePicker from "../../../components/TimePicker.jsx";
import { useState } from "react";
import Loader from "../shared/Loader.jsx";
import EmptyState from "../shared/EmptyState.jsx";
import ErrorState from "../shared/ErrorState.jsx";
import { t, tn, fmtNum, localName } from "../../../i18n/core.js";
import { VegDot, ScheduleBadge, Thumb, CatThumb } from "./menuUI.jsx";
import { ITEM_FLAGS } from "./menuKit.js";
import {
  VIEWS, VIEW_CHIPS, hasSchedule, hasPhoto, isOutOfStock, scheduledAt, availState,
  timeLabel, daysLabel, datesLabel, fmtMinutes, hhmmOf, windowSegments, DAY_SHORT, hasExtraFilters,
} from "./menuKit.js";

const PREVIEW_PRESETS = [9 * 60, 13 * 60, 20 * 60]; // 9 AM, 1 PM, 8 PM

// ── status strip ────────────────────────────────────────────────────────────
export function StatusStrip({ tiles, view, onView }) {
  return (
    <div className="zc-card mb-strip" role="group" aria-label={t("Menu status")}>
      {tiles.map((x) => (
        <button key={x.key} type="button" className={view === x.key ? "on" : ""} aria-pressed={view === x.key}
          onClick={() => onView(view === x.key ? "all" : x.key)}>
          <span className="k">{x.label}</span>
          <span className="v" style={x.color ? { color: x.color } : undefined}>{fmtNum(x.value)}</span>
          <span className="d" title={x.sub}>{x.sub}</span>
        </button>
      ))}
    </div>
  );
}

// ── Menu times (left rail, top) ─────────────────────────────────────────────
const groupSub = (g) => {
  if (!g.schedule) return t("No time limit");
  const parts = [timeLabel(g.schedule), daysLabel(g.schedule)];
  const dl = datesLabel(g.schedule);
  if (dl) parts.push(dl);
  return parts.join(" · ");
};

export function MenuTimesCard({ groups, selected, onSelect, preview, setPreview, clock, onAdd, onEdit, disabled }) {
  const presetOn = (m) => preview && preview.day == null && preview.minutes === m;
  const isCustom = preview && !PREVIEW_PRESETS.includes(preview.minutes);

  return (
    <div className="zc-card">
      <div className="zc-card-h">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t">{t("Menu times")}</div>
          <div className="s">{t("Set meal times once; the menu follows the clock")}</div>
        </div>
        <button type="button" className="zc-btn ghost sm" disabled={disabled} onClick={onAdd}>＋ {t("Add")}</button>
      </div>
      <div className="zc-card-b" style={{ paddingTop: 12 }}>
        <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>{t("Preview as a diner at")}</div>
        <div className="mb-preview">
          <div className="zc-seg" role="group" aria-label={t("Preview time")}>
            <button type="button" className={!preview ? "on" : ""} aria-pressed={!preview} onClick={() => setPreview(null)}>
              {t("Now")}
            </button>
            {PREVIEW_PRESETS.map((p) => (
              <button key={p} type="button" className={presetOn(p) ? "on" : ""} aria-pressed={presetOn(p)}
                onClick={() => setPreview({ minutes: p, day: null })}>{fmtMinutes(p)}</button>
            ))}
          </div>
          <select className="zc-select mb-mini" aria-label={t("Preview day")}
            value={preview?.day ?? ""}
            onChange={(e) => setPreview({ minutes: preview?.minutes ?? clock.minutes, day: e.target.value === "" ? null : Number(e.target.value) })}>
            <option value="">{t("Today")}</option>
            {DAY_SHORT.map((d, i) => <option key={d} value={i}>{t(d)}</option>)}
          </select>
          <TimePicker ariaLabel={t("Preview at another time")} allowEmpty
            style={isCustom ? { outline: "1px solid var(--violet-line)", borderRadius: 8 } : undefined}
            value={preview ? hhmmOf(preview.minutes) : ""}
            onChange={(v) => {
              const m = /^(\d{2}):(\d{2})$/.exec(v);
              if (m) setPreview({ minutes: Number(m[1]) * 60 + Number(m[2]), day: preview?.day ?? null });
            }} />
        </div>

        <div className="mb-tl" aria-hidden="true">
          <div className="track" />
          {groups.filter((g) => g.schedule).flatMap((g, gi) =>
            windowSegments(g.schedule).map((sg, i) => (
              <div key={`${g.key}-${i}`} className="seg"
                style={{
                  left: `${sg.left}%`, width: `${sg.width}%`, background: g.color, opacity: g.live ? 0.95 : 0.3,
                  top: 10 + (gi % 3) * 5, height: 7,
                }} />
            )))}
          <div className="now" style={{ left: `${(clock.minutes / 1440) * 100}%` }}>
            <span>{preview ? `${preview.day != null ? `${t(DAY_SHORT[clock.weekday])} ` : ""}${fmtMinutes(clock.minutes)}` : `${t("Now")} ${fmtMinutes(clock.minutes)}`}</span>
          </div>
          <div className="ax"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span></div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
          {groups.map((g) => (
            <div key={g.key} className={`mb-win${selected === g.key ? " on" : ""}`}>
              <button type="button" className="mb-win-main" aria-pressed={selected === g.key} onClick={() => onSelect(g.key)}>
                <span className="sw" style={{ background: g.color }} />
                <span style={{ minWidth: 0 }}>
                  <b>{g.name}</b>
                  <small>
                    {groupSub(g)} · {g.cats.length
                      ? `${tn(g.cats.length, "{n} category", "{n} categories")}, ${tn(g.items, "{n} item", "{n} items")}`
                      : t("no categories yet")}
                  </small>
                </span>
                {g.live
                  ? <span className="zc-tag ready"><i />{t("Live")}</span>
                  : <span className="zc-tag done"><i />{t("Off")}</span>}
              </button>
              {g.mt && (
                <button type="button" className="zc-btn ghost sm mb-win-edit" disabled={disabled}
                  aria-label={t("Edit {name}", { name: g.name })} title={t("Edit")} onClick={() => onEdit(g.mt)}>✎</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── categories in the selected menu time (left rail, bottom) ────────────────
export function CategoryCard({
  group, countOf, selCat, onPickCat, onEditCat, onNewCat, onReorder, cleanup,
  onMerge, onDeleteCat, onReviewCat, onManage, onAssign, disabled,
}) {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const cats = group?.cats || [];

  const drop = (targetId) => {
    if (!drag || drag === targetId) return;
    const ids = cats.map((c) => c._id);
    const from = ids.indexOf(drag), to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    onReorder(ids);
  };

  return (
    <div className="zc-card">
      <div className="zc-card-h">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {group ? `${group.name} · ${t("categories")}` : t("Categories")}
          </div>
          <div className="s">{cats.length > 1 ? t("Drag to reorder · tap to show only its items") : t("Tap a category to show only its items")}</div>
        </div>
        <button type="button" className="zc-btn ghost sm" disabled={disabled} onClick={onNewCat}>＋ {t("Category")}</button>
      </div>
      <div className="zc-card-b" style={{ display: "flex", flexDirection: "column", gap: 5, paddingTop: 12 }}>
        {cats.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>
            {group?.mt ? t("No categories in this menu time yet.") : t("No categories here.")}
          </div>
        ) : cats.map((c) => (
          <div key={c._id || c.name}
            className={`mb-cat${selCat === c.name ? " on" : ""}${over === c._id && drag && drag !== c._id ? " drop" : ""}${drag === c._id ? " dragging" : ""}`}
            draggable={!disabled && cats.length > 1 && !!c._id}
            onDragStart={(e) => { setDrag(c._id); e.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(c._id); } }}
            onDragLeave={() => setOver((o) => (o === c._id ? null : o))}
            onDrop={(e) => { e.preventDefault(); drop(c._id); setDrag(null); setOver(null); }}
            onDragEnd={() => { setDrag(null); setOver(null); }}>
            {cats.length > 1 && <span className="grip" aria-hidden="true">⋮⋮</span>}
            <CatThumb image={c.image} icon={c.iconShown} size={24} />
            <button type="button" className="nm" aria-pressed={selCat === c.name}
              title={t("Show only {name} items", { name: localName(c) })}
              onClick={() => onPickCat(selCat === c.name ? "All" : c.name)}>
              {localName(c)}
              {c.kind === "SMART" && <span className="zc-tag vio sq" style={{ marginLeft: 6, fontSize: 9.5 }} title={c.smartSource === "flag" ? t("Built-in · items you mark") : t("Built-in · filled from real orders and ratings")}>{t("Auto")}</span>}
            </button>
            <span className="ct">{fmtNum(countOf(c))}</span>
            {c._id && (
              <button type="button" className="zc-btn ghost sm" style={{ padding: "3px 8px" }}
                title={t("Edit")} aria-label={t("Edit {name}", { name: localName(c) })} onClick={() => onEditCat(c)}>✎</button>
            )}
          </div>
        ))}
        {group?.mt && (
          <button type="button" className="zc-btn ghost sm" style={{ alignSelf: "flex-start", marginTop: 4 }}
            disabled={disabled} onClick={() => onAssign(group.mt)}>＋ {t("Put categories in {name}", { name: group.name })}</button>
        )}

        {cleanup.length > 0 && (
          <>
            <div style={{ fontSize: 11.5, color: "var(--wait-ink)", fontWeight: 600, margin: "12px 0 2px" }}>
              {t("Needs a home")} · {fmtNum(cleanup.length)}
            </div>
            {cleanup.map((x) => (
              <div key={x.cat._id} className="mb-cat fix">
                <span className="nm" style={{ cursor: "default", whiteSpace: "normal" }}>
                  {localName(x.cat)}
                  <span className="mb-fix-why">
                    {" · "}{tn(countOf(x.cat), "{n} item", "{n} items")}{" · "}
                    {x.kind === "duplicate" ? t("looks like “{name}”", { name: localName(x.into) })
                      : x.kind === "test" ? t("test category, live to diners") : t("no items")}
                  </span>
                </span>
                {x.kind === "duplicate" ? (
                  <button type="button" className="zc-btn ghost sm" disabled={disabled} onClick={() => onMerge(x.cat, x.into)}>
                    {t("Merge into {name}", { name: localName(x.into) })}
                  </button>
                ) : countOf(x.cat) === 0 ? (
                  <button type="button" className="zc-btn danger sm" disabled={disabled} onClick={() => onDeleteCat(x.cat)}>{t("Delete")}</button>
                ) : (
                  <button type="button" className="zc-btn ghost sm" onClick={() => onReviewCat(x.cat)}>{t("Review")}</button>
                )}
              </div>
            ))}
          </>
        )}
        <button type="button" className="zc-btn ghost sm" style={{ alignSelf: "flex-start", marginTop: 8 }}
          disabled={disabled} onClick={onManage}>🗂️ {t("Manage all categories")}</button>
      </div>
    </div>
  );
}

// ── availability: On | Sold out today | Off ─────────────────────────────────
function AvailSeg({ item, busy, onSet }) {
  const st = availState(item);
  const b = (key, label, cls) => (
    <button type="button" className={st === key ? cls : ""} aria-pressed={st === key}
      disabled={busy} onClick={() => st !== key && onSet(item, key)}>{label}</button>
  );
  return (
    <span className="mb-av" role="group" aria-label={t("Availability of {name}", { name: localName(item) })}>
      {b("on", t("On"), "on")}
      {b("soldout", t("Sold out today"), "so")}
      {b("off", t("Off"), "off")}
    </span>
  );
}

const DinerTags = ({ item, clock }) => (
  <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
    {ITEM_FLAGS.filter((f) => item[f.flag]).map((f) => <span key={f.flag} className="zc-tag live sq mb-dtag">{t(f.label)}</span>)}
    {(item.tags || []).map((x) => <span key={x} className="zc-tag vio mb-dtag">{x}</span>)}
    {isOutOfStock(item) && <span className="zc-tag stop sq"><i />{t("Out of stock")}</span>}
    {hasSchedule(item) && (
      <ScheduleBadge schedule={item.schedule} off={!clock && item.scheduledNow === false && item.isAvailable} />
    )}
    {!(item.tags || []).length && !ITEM_FLAGS.some((f) => item[f.flag]) && !isOutOfStock(item) && !hasSchedule(item) && (
      <span style={{ color: "var(--text-3)", fontSize: 11 }}>—</span>
    )}
  </span>
);

const Price = ({ item }) => (
  <>
    <span style={{ fontWeight: 600, color: "var(--text-1)" }}>₹{fmtNum(item.price)}</span>
    {item.originalPrice ? (
      <div style={{ fontSize: 11, color: "var(--text-3)", textDecoration: "line-through" }}>₹{fmtNum(item.originalPrice)}</div>
    ) : null}
  </>
);

function GroupHeader({ g, preview, open, onToggle, allSel, someSel, onSelAll, onEditCat }) {
  const tg = g.timeGroup;
  const at = preview ? fmtMinutes(preview.minutes) : null;
  return (
    <div className="mb-grp">
      <input type="checkbox" className="menu-cb" aria-label={t("Select all in {name}", { name: g.label })}
        checked={allSel} ref={(el) => { if (el) el.indeterminate = !allSel && someSel; }} onChange={onSelAll} />
      <button type="button" className="tg" aria-expanded={open} onClick={onToggle}>
        <span aria-hidden="true" style={{ width: 10, color: "var(--text-3)" }}>{open ? "▾" : "▸"}</span>{g.label}
      </button>
      <span className="mb-mtchip" style={{ borderColor: tg?.color || "var(--edge)" }}>
        {tg ? (tg.schedule ? `${tg.name} · ${timeLabel(tg.schedule)}` : tg.name) : t("All day")}
        {tg?.schedule?.days?.length ? ` · ${daysLabel(tg.schedule)}` : ""}
      </span>
      <span className="hint">
        {g.live
          ? (at ? t("showing at {time}", { time: at }) : t("showing to diners now"))
          : (at ? t("hidden at {time}", { time: at }) : t("hidden from diners now"))}
        {" · "}{tn(g.items.length, "{n} item", "{n} items")}
      </span>
      {g.cat?._id && (
        <button type="button" className="zc-btn ghost sm" style={{ marginLeft: "auto", padding: "3px 9px" }}
          onClick={onEditCat}>✎ {t("Category")}</button>
      )}
    </div>
  );
}

// ── views row: built-in chips + saved views + filters ───────────────────────
function ViewsRow({ counts, view, setView, saved, activeSaved, onApplySaved, onRemoveSaved, onSaveView,
  filters, setFilters, allTags, search, setSearch, totalItems }) {
  const [naming, setNaming] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const active = (k) => view === k && !activeSaved && !hasExtraFilters(filters);
  const nFilters = [filters.type, filters.tag, filters.minPrice, filters.maxPrice].filter((v) => v !== "").length;

  return (
    <>
      <div className="mb-views" role="group" aria-label={t("Views")}>
        {VIEW_CHIPS.filter((k) => k === "all" || k === "onMenu" || counts[k] > 0 || view === k).map((k) => (
          <button key={k} type="button" className={`mb-chip${active(k) ? " on" : ""}`} aria-pressed={active(k)}
            onClick={() => { setView(k); setFilters(null); }}>
            {t(VIEWS[k].label)}<span className="n">{fmtNum(counts[k] || 0)}</span>
          </button>
        ))}
        {saved.map((sv) => (
          <span key={sv.id} className={`mb-chip saved${activeSaved === sv.id ? " on" : ""}`}>
            <button type="button" aria-pressed={activeSaved === sv.id} onClick={() => onApplySaved(sv)}>
              {sv.name}<span className="n">{fmtNum(sv.count)}</span>
            </button>
            <button type="button" className="x" aria-label={t("Remove view {name}", { name: sv.name })}
              title={t("Remove this view")} onClick={() => onRemoveSaved(sv.id)}>✕</button>
          </span>
        ))}
        {naming == null ? (
          <button type="button" className="mb-chip dashed" onClick={() => setNaming("")}
            title={t("Save the current view and filters under a name")}>＋ {t("Save a view")}</button>
        ) : (
          <form className="mb-savename" onSubmit={(e) => { e.preventDefault(); if (naming.trim()) { onSaveView(naming.trim()); setNaming(null); } }}>
            <input className="zc-input" autoFocus value={naming} maxLength={30} placeholder={t("View name")}
              aria-label={t("View name")} onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setNaming(null)} />
            <button type="submit" className="zc-btn pri sm" disabled={!naming.trim()}>{t("Save")}</button>
            <button type="button" className="zc-btn ghost sm" onClick={() => setNaming(null)}>✕</button>
          </form>
        )}
        <button type="button" className={`mb-chip${nFilters ? " on-soft" : ""}`} aria-expanded={showFilters}
          onClick={() => setShowFilters((v) => !v)}>
          ⚲ {t("Filters")}{nFilters ? <span className="n">{fmtNum(nFilters)}</span> : null}
        </button>
        <input className="zc-input mb-search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={t("Search {n} items…", { n: totalItems })} aria-label={t("Search menu items")} />
      </div>
      {showFilters && (
        <div className="mb-filters">
          <label>{t("Type")}
            <select className="zc-select mb-mini" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
              <option value="">{t("Any")}</option>
              <option value="Veg">{t("Veg")}</option>
              <option value="Non Veg">{t("Non-veg")}</option>
            </select>
          </label>
          <label>{t("Diner tag")}
            <select className="zc-select mb-mini" value={filters.tag} onChange={(e) => setFilters({ ...filters, tag: e.target.value })}>
              <option value="">{t("Any")}</option>
              {allTags.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label>{t("Price from ₹")}
            <input type="number" min="0" className="zc-input mb-mini" style={{ width: 90 }} value={filters.minPrice}
              onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })} />
          </label>
          <label>{t("to ₹")}
            <input type="number" min="0" className="zc-input mb-mini" style={{ width: 90 }} value={filters.maxPrice}
              onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })} />
          </label>
          {nFilters > 0 && (
            <button type="button" className="zc-btn ghost sm" onClick={() => setFilters(null)}>{t("Clear filters")}</button>
          )}
        </div>
      )}
    </>
  );
}

// ── items panel (right) ─────────────────────────────────────────────────────
export function ItemsPanel({
  loading, error, onRetry, totalItems, groups, counts, view, setView, search, setSearch,
  saved, activeSaved, onApplySaved, onRemoveSaved, onSaveView, filters, setFilters, allTags,
  selCat, selCatLabel, clearCat, preview, clock, sel, toggleSel, setSelMany, collapsed, toggleGroup, setAllCollapsed,
  busyIds, onEdit, onDelete, onAvail, onEditCat, onNew, bulk, hasFilters, clearFilters,
}) {
  const shownCount = groups.reduce((s, g) => s + g.items.length, 0);
  const shownIds = groups.flatMap((g) => g.items.map((i) => i._id));
  const allShownSel = shownIds.length > 0 && shownIds.every((id) => sel.has(id));
  const anyCollapsed = groups.some((g) => collapsed.has(g.name));
  const previewClock = preview ? clock : null;

  const groupSel = (g) => {
    const ids = g.items.map((i) => i._id);
    const all = ids.length > 0 && ids.every((id) => sel.has(id));
    return { all, some: ids.some((id) => sel.has(id)), toggle: () => setSelMany(ids, !all) };
  };

  const timeOffNote = (item, g) =>
    item.isAvailable && !scheduledAt(item, g.cat, previewClock)
      ? <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}>{t("hidden by time")}</div>
      : null;

  return (
    <div className="zc-card" style={{ minWidth: 0 }}>
      <div className="zc-card-b">
        <ViewsRow counts={counts} view={view} setView={setView} saved={saved} activeSaved={activeSaved}
          onApplySaved={onApplySaved} onRemoveSaved={onRemoveSaved} onSaveView={onSaveView}
          filters={filters} setFilters={setFilters} allTags={allTags}
          search={search} setSearch={setSearch} totalItems={totalItems} />

        {(selCat !== "All" || hasFilters) && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10, fontSize: 12 }}>
            {selCat !== "All" && (
              <span className="zc-tag vio">
                {t("Category")}: {selCatLabel}
                <button type="button" onClick={clearCat} aria-label={t("Show all categories")}
                  style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", padding: 0, fontSize: 12 }}>✕</button>
              </span>
            )}
            <span style={{ color: "var(--text-2)" }}>
              <b style={{ color: "var(--accent-ink)" }}>{fmtNum(shownCount)}</b> {t("of {n}", { n: totalItems })}
            </span>
            <button type="button" className="zc-btn ghost sm" onClick={clearFilters}>{t("Clear filters")}</button>
          </div>
        )}

        {sel.size > 0 && (
          <div className="mb-bulk" role="region" aria-label={t("Bulk actions")}>
            <b style={{ color: "var(--accent-ink)" }}>{tn(sel.size, "{n} selected", "{n} selected")}</b>
            <button type="button" className="zc-btn good sm" disabled={bulk.busy} onClick={() => bulk.setState("on")}>{t("Turn on")}</button>
            <button type="button" className="zc-btn sm" disabled={bulk.busy} onClick={() => bulk.setState("soldout")}>{t("Sold out today")}</button>
            <button type="button" className="zc-btn sm" disabled={bulk.busy} onClick={() => bulk.setState("off")}>{t("Turn off")}</button>
            <button type="button" className="zc-btn sm" disabled={bulk.busy} onClick={bulk.edit}>✎ {t("Bulk edit…")}</button>
            <button type="button" className="zc-btn sm" disabled={bulk.busy} onClick={bulk.schedule}>🕒 {t("Own time window…")}</button>
            <span style={{ flex: 1 }} />
            {bulk.busy && <span style={{ color: "var(--text-3)" }}>{t("Saving…")}</span>}
            <button type="button" className="zc-btn ghost sm" disabled={bulk.busy} onClick={bulk.clear}>{t("Clear")} ✕</button>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ padding: "0 18px 16px" }}><Loader rows={8} /></div>
      ) : error ? (
        <ErrorState title={t("Could not load the menu")}
          sub={t("The server did not respond. Check that the backend is running, then try again.")}
          onRetry={onRetry} />
      ) : shownCount === 0 ? (
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 5h16M4 12h16M4 19h10" />
            </svg>
          }
          title={totalItems === 0 ? t("No menu items yet") : t("No items match")}
          sub={totalItems === 0
            ? t("Add your first dish or import a whole menu — it shows on the customer site as soon as it is available.")
            : selCat !== "All" && !hasFilters
              ? t("This category has no items yet.")
              : t("Nothing matches these filters. Try clearing them.")}
          action={totalItems === 0 || (selCat !== "All" && !hasFilters)
            ? <button type="button" className="zc-btn pri" onClick={onNew}>＋ {t("New item")}</button>
            : <button type="button" className="zc-btn" onClick={clearFilters}>{t("Clear filters")}</button>}
        />
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 18px 6px" }}>
            <button type="button" className="zc-btn ghost sm" onClick={() => setAllCollapsed(!anyCollapsed)}>
              {anyCollapsed ? t("Expand all") : t("Collapse all")}
            </button>
          </div>

          {/* tablet / desktop: grouped table */}
          <div className="mb-list-wide" style={{ overflowX: "auto", padding: "0 8px 10px" }}>
            <table className="mb-tbl" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ width: 30 }}>
                    <input type="checkbox" className="menu-cb" aria-label={t("Select all shown items")}
                      checked={allShownSel}
                      ref={(el) => { if (el) el.indeterminate = !allShownSel && shownIds.some((id) => sel.has(id)); }}
                      onChange={() => setSelMany(shownIds, !allShownSel)} />
                  </th>
                  <th>{t("Item")}</th>
                  <th className="num" style={{ width: 84 }}>{t("Price")}</th>
                  <th style={{ width: 180 }}>{t("Diner tags")}</th>
                  <th style={{ width: 236 }}>{t("Available")}</th>
                  <th style={{ width: 76 }} />
                </tr>
              </thead>
              {groups.map((g) => {
                const open = !collapsed.has(g.name);
                const gs = groupSel(g);
                return (
                  <tbody key={g.name}>
                    <tr className="grp">
                      <td colSpan={6}>
                        <GroupHeader g={g} preview={preview} open={open} onToggle={() => toggleGroup(g.name)}
                          allSel={gs.all} someSel={gs.some} onSelAll={gs.toggle} onEditCat={() => onEditCat(g.cat)} />
                      </td>
                    </tr>
                    {open && g.items.map((item) => (
                      <tr key={item._id} className="it" onClick={() => onEdit(item)}>
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" className="menu-cb" aria-label={t("Select {name}", { name: localName(item) })}
                            checked={sel.has(item._id)} onChange={() => toggleSel(item._id)} />
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                            <Thumb src={item.image} size={34} missing={!hasPhoto(item)} />
                            <VegDot tag={item.tag} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, color: item.isAvailable ? "var(--text-1)" : "var(--text-3)" }}>
                                {localName(item)}
                                {item.description && <span className="mb-note" title={item.description}>{item.description}</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="num"><Price item={item} /></td>
                        <td><DinerTags item={item} clock={previewClock} /></td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <AvailSeg item={item} busy={busyIds.has(item._id)} onSet={onAvail} />
                          {timeOffNote(item, g)}
                        </td>
                        <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                            <button type="button" className="zc-btn ghost sm" title={t("Edit")} aria-label={t("Edit {name}", { name: localName(item) })}
                              onClick={() => onEdit(item)} style={{ padding: "5px 8px" }}>✏️</button>
                            <button type="button" className="zc-btn danger sm" title={t("Delete")} aria-label={t("Delete {name}", { name: localName(item) })}
                              onClick={() => onDelete(item)} style={{ padding: "5px 8px" }}>🗑️</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>

          {/* phone: grouped cards */}
          <div className="mb-list-narrow" style={{ padding: "0 14px 10px" }}>
            {groups.map((g) => {
              const open = !collapsed.has(g.name);
              const gs = groupSel(g);
              return (
                <div key={g.name} style={{ marginBottom: 6 }}>
                  <div className="mb-mgrp" style={{ padding: 0 }}>
                    <GroupHeader g={g} preview={preview} open={open} onToggle={() => toggleGroup(g.name)}
                      allSel={gs.all} someSel={gs.some} onSelAll={gs.toggle} onEditCat={() => onEditCat(g.cat)} />
                  </div>
                  {open && g.items.map((item) => (
                    <div key={item._id} className="mb-mrow" onClick={() => onEdit(item)}>
                      <input type="checkbox" className="menu-cb" style={{ marginTop: 3 }}
                        aria-label={t("Select {name}", { name: localName(item) })}
                        checked={sel.has(item._id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleSel(item._id)} />
                      <Thumb src={item.image} size={44} missing={!hasPhoto(item)} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <VegDot tag={item.tag} />
                          <span style={{ fontWeight: 600, fontSize: 13, color: item.isAvailable ? "var(--text-1)" : "var(--text-3)", overflowWrap: "anywhere" }}>
                            {localName(item)}
                          </span>
                          <span className="tnum" style={{ marginLeft: "auto" }}><Price item={item} /></span>
                        </div>
                        {item.description && <div className="mb-note" style={{ marginLeft: 0, display: "block" }}>{item.description}</div>}
                        <div style={{ marginTop: 5 }}><DinerTags item={item} clock={previewClock} /></div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}
                          onClick={(e) => e.stopPropagation()}>
                          <AvailSeg item={item} busy={busyIds.has(item._id)} onSet={onAvail} />
                          <button type="button" className="zc-btn danger sm" style={{ padding: "4px 8px", marginLeft: "auto" }}
                            aria-label={t("Delete {name}", { name: localName(item) })} onClick={() => onDelete(item)}>🗑️</button>
                        </div>
                        {timeOffNote(item, g)}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
