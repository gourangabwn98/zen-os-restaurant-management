// src/pages/admin/menu/menuUI.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Small presentational pieces shared by the Menu items board and its modals,
// plus the page-scoped stylesheet. Theme tokens only (tokens.css) — light and
// dark safe. Helpers without JSX live in menuKit.js.
// ─────────────────────────────────────────────────────────────────────────────
import CategoryIcon from "../../../components/CategoryIcon.jsx";
import { useState } from "react";
import { t } from "../../../i18n/core.js";
import { isUrl, schedLabel } from "./menuKit.js";

if (typeof document !== "undefined" && !document.getElementById("menu-styles")) {
  const s = document.createElement("style");
  s.id = "menu-styles";
  s.textContent = `
    .menu-thumb {
      width: 40px; height: 40px; border-radius: 9px; flex: none; overflow: hidden;
      background: linear-gradient(150deg, var(--violet-mid), var(--violet-faint));
      border: 1px solid var(--edge); display: grid; place-items: center; font-size: 18px;
    }
    .menu-thumb.none { background: transparent; border: 1px dashed var(--wait-line); color: var(--wait-ink); font-size: 15px; }
    .menu-veg { width: 14px; height: 14px; border-radius: 3px; display: inline-grid; place-items: center; flex: none; }
    .menu-veg i { width: 6px; height: 6px; border-radius: 50%; display: block; }
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

    /* ── board layout (status strip · left rail · grouped list) ── */
    .mb-strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); margin-bottom: 16px; overflow: hidden; }
    .mb-strip button {
      font-family: inherit; text-align: left; background: transparent; border: 0; cursor: pointer;
      border-left: 1px solid var(--edge); padding: 14px 18px; display: flex; flex-direction: column; gap: 2px;
      color: var(--text-1); min-width: 0; transition: var(--theme-transition);
    }
    .mb-strip button:first-child { border-left: 0; }
    .mb-strip button:hover { background: var(--violet-faint); }
    .mb-strip button.on { background: var(--violet-weak); box-shadow: inset 0 -2px 0 var(--violet); }
    .mb-strip .k { font-size: 11.5px; color: var(--text-2); font-weight: 500; }
    .mb-strip .v { font-size: 24px; font-weight: 700; letter-spacing: -.03em; line-height: 1.15; font-variant-numeric: tabular-nums; }
    .mb-strip .d { font-size: 11px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    @media (max-width: 900px) {
      .mb-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .mb-strip button:nth-child(4) { border-left: 0; }
      .mb-strip button:nth-child(n+4) { border-top: 1px solid var(--edge); }
    }
    @media (max-width: 520px) {
      .mb-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .mb-strip button { padding: 11px 13px; }
      .mb-strip button:nth-child(4) { border-left: 1px solid var(--edge); }
      .mb-strip button:nth-child(odd) { border-left: 0; }
      .mb-strip button:nth-child(n+3) { border-top: 1px solid var(--edge); }
      .mb-strip button:last-child { grid-column: 1 / -1; }
      .mb-strip .v { font-size: 20px; }
    }

    .mb-body { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 16px; align-items: start; }
    .mb-left { display: flex; flex-direction: column; gap: 16px; min-width: 0; position: sticky; top: 12px; }
    @media (max-width: 1180px) {
      .mb-body { grid-template-columns: minmax(0, 1fr); }
      .mb-left { position: static; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; }
    }
    @media (max-width: 760px) { .mb-left { grid-template-columns: minmax(0, 1fr); } }

    .mb-preview { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
    .mb-preview .zc-seg { flex-wrap: wrap; }
    .mb-preview .zc-seg button { padding: 5px 10px; font-size: 11.5px; }
    .mb-tl { position: relative; height: 50px; margin: 16px 2px 4px; }
    .mb-tl .track { position: absolute; left: 0; right: 0; top: 14px; height: 10px; border-radius: 99px; background: var(--card-2); border: 1px solid var(--edge); }
    .mb-tl .seg { position: absolute; top: 14px; height: 10px; border-radius: 99px; transition: opacity .15s ease; }
    .mb-tl .now { position: absolute; top: 4px; height: 30px; width: 2px; background: var(--text-1); border-radius: 2px; }
    .mb-tl .now span { position: absolute; top: -15px; transform: translateX(-50%); font-size: 10px; font-weight: 700; white-space: nowrap; color: var(--text-1); }
    .mb-tl .ax { position: absolute; left: 0; right: 0; top: 32px; display: flex; justify-content: space-between; font-size: 10px; color: var(--text-3); }

    .mb-win {
      display: flex; align-items: center; gap: 4px; border-radius: var(--r-row);
      border: 1px solid transparent; background: transparent;
    }
    .mb-win:hover { background: var(--violet-faint); }
    .mb-win.on { background: var(--violet-weak); border-color: var(--violet-mid); }
    .mb-win-main {
      flex: 1; min-width: 0; display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: 10px; align-items: center;
      text-align: left; padding: 9px 4px 9px 10px; cursor: pointer; border: 0; background: transparent;
      font-family: inherit; color: var(--text-1);
    }
    .mb-win-edit { padding: 3px 8px; margin-right: 6px; }
    .mb-win .sw { width: 12px; height: 12px; border-radius: 4px; }
    .mb-win b { display: block; font-size: 12.5px; font-weight: 600; }
    .mb-win small { display: block; font-size: 11px; color: var(--text-3); }
    .mb-mini { padding: 5px 9px; font-size: 11.5px; width: auto; }

    .mb-cat {
      display: flex; align-items: center; gap: 9px; padding: 6px 8px; border-radius: var(--r-row);
      background: var(--card-2); border: 1px solid transparent; font-size: 12.5px; min-width: 0;
    }
    .mb-cat.on { border-color: var(--violet-mid); background: var(--violet-faint); }
    .mb-cat.empty, .mb-cat.fix { border: 1px dashed var(--wait-line); flex-wrap: wrap; }
    .mb-cat.drop { box-shadow: inset 0 2px 0 var(--violet); }
    .mb-cat.dragging { opacity: .45; }
    .mb-cat[draggable="true"] { cursor: grab; }
    .mb-cat .grip { color: var(--text-3); font-size: 11px; letter-spacing: -2px; user-select: none; }
    .mb-fix-why { color: var(--text-3); font-size: 11px; }
    .mb-cat .nm { flex: 1; min-width: 0; background: none; border: 0; padding: 0; text-align: left; cursor: pointer;
      font-family: inherit; font-size: 12.5px; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mb-cat .ct { font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }

    .mb-views { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .mb-chip {
      font-family: inherit; font-size: 11.5px; font-weight: 500; padding: 5px 11px; border-radius: 99px; cursor: pointer;
      border: 1px solid var(--edge); background: var(--card-2); color: var(--text-2); white-space: nowrap;
      display: inline-flex; align-items: center; gap: 5px; transition: var(--theme-transition);
    }
    .mb-chip:hover { color: var(--text-1); border-color: var(--edge-hi); }
    .mb-chip.on { color: #fff; font-weight: 600; border-color: transparent; background: var(--grad-btn); box-shadow: 0 4px 12px -4px var(--violet-glow); }
    .mb-chip .n { opacity: .72; font-variant-numeric: tabular-nums; }
    .mb-chip.dashed { border-style: dashed; background: transparent; }
    .mb-chip.on-soft { color: var(--accent-ink); border-color: var(--violet-mid); background: var(--violet-faint); }
    .mb-chip.saved { padding: 0; gap: 0; }
    .mb-chip.saved button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer;
      padding: 5px 4px 5px 11px; display: inline-flex; gap: 5px; align-items: center; }
    .mb-chip.saved .x { padding: 5px 9px 5px 4px; opacity: .55; font-size: 10px; }
    .mb-chip.saved .x:hover { opacity: 1; }
    .mb-savename { display: inline-flex; gap: 5px; align-items: center; }
    .mb-savename .zc-input { width: 150px; padding: 5px 9px; font-size: 11.5px; }
    .mb-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-top: 10px; padding: 10px 12px;
      border: 1px solid var(--edge); border-radius: var(--r-ctl); background: var(--card-2); }
    .mb-filters label { display: grid; gap: 4px; font-size: 11px; color: var(--text-3); font-weight: 500; }
    .mb-dtag { font-size: 10.5px; padding: 1px 8px; }
    .mb-mtchip { display: inline-flex; align-items: center; border: 1px solid; border-radius: 99px; padding: 1px 9px;
      font-size: 11px; font-weight: 600; color: var(--text-1); white-space: nowrap; }
    .mb-search { flex: 1 1 220px; max-width: 320px; margin-left: auto; }
    @media (max-width: 760px) { .mb-search { max-width: none; margin-left: 0; flex-basis: 100%; } }

    .mb-bulk {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 9px 12px; margin-top: 12px;
      border-radius: var(--r-ctl); border: 1px solid var(--violet-mid); background: var(--violet-faint); font-size: 12.5px;
    }

    .mb-tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .mb-tbl thead th {
      text-align: left; font-weight: 600; font-size: 10.5px; color: var(--text-3); letter-spacing: .08em;
      text-transform: uppercase; padding: 8px 10px; border-bottom: 1px solid var(--edge); white-space: nowrap;
    }
    .mb-tbl td { padding: 8px 10px; border-bottom: 1px solid var(--edge); vertical-align: middle; color: var(--text-1); }
    .mb-tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
    .mb-tbl tbody tr.it:hover td { background: var(--raise); }
    .mb-tbl tbody tr.it { cursor: pointer; }
    .mb-tbl tr.grp td { background: var(--card-2); padding: 0; }
    .mb-grp {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap; width: 100%; padding: 9px 10px;
      font-size: 12.5px; color: var(--text-2);
    }
    .mb-grp .tg { background: none; border: 0; padding: 0; cursor: pointer; font-family: inherit; color: var(--text-1);
      font-weight: 700; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; }
    .mb-grp .hint { font-size: 11.5px; color: var(--text-3); }
    .mb-note { font-size: 11px; font-weight: 500; color: var(--wait-ink); margin-left: 7px; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; max-width: 260px; display: inline-block; vertical-align: bottom; }

    .mb-av { display: inline-flex; padding: 2px; border-radius: 9px; border: 1px solid var(--edge); background: var(--card-2); }
    .mb-av button { font-family: inherit; border: 0; background: transparent; border-radius: 7px; padding: 3px 8px;
      font-size: 11.5px; font-weight: 500; color: var(--text-3); cursor: pointer; white-space: nowrap; }
    .mb-av button.on { background: var(--ready-fill); color: var(--ready-ink); font-weight: 600; }
    .mb-av button.so { background: var(--wait-fill); color: var(--wait-ink); font-weight: 600; }
    .mb-av button.off { background: var(--done-fill); color: var(--done-ink); font-weight: 600; }
    .mb-av button:disabled { cursor: progress; }

    /* modals: menu time · bulk edit · import */
    .mt-days { display: flex; flex-wrap: wrap; gap: 6px; }
    .mt-days button, .mt-swatch {
      font-family: inherit; font-size: 12px; padding: 6px 10px; border-radius: 9px; cursor: pointer;
      border: 1px solid var(--edge); background: var(--card-2); color: var(--text-2);
    }
    .mt-days button.on { color: #fff; border-color: transparent; background: var(--grad-btn); font-weight: 600; }
    .mt-swatch { width: 28px; height: 28px; padding: 0; border-radius: 50%; border: 2px solid transparent; }
    .mt-swatch.on { border-color: var(--text-1); box-shadow: 0 0 0 2px var(--card); }
    .mi-tabs { display: flex; flex-wrap: wrap; }
    .mi-grid { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 16px; }
    @media (max-width: 760px) { .mi-grid { grid-template-columns: minmax(0, 1fr); } }
    .mi-drop {
      border: 1.5px dashed var(--violet-mid); border-radius: 14px; padding: 18px 14px; text-align: center; cursor: pointer;
      background: var(--violet-faint); color: var(--text-2); font-size: 12.5px; display: grid; gap: 6px; place-items: center;
    }
    .mi-drop:hover { border-color: var(--violet); }
    .mi-review { max-height: 420px; overflow: auto; border: 1px solid var(--edge); border-radius: 12px; }
    .mi-review table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .mi-review th { position: sticky; top: 0; background: var(--card-2); z-index: 1; text-align: left; font-size: 10.5px;
      color: var(--text-3); text-transform: uppercase; letter-spacing: .06em; padding: 7px 8px; border-bottom: 1px solid var(--edge); }
    .mi-review td { padding: 5px 6px; border-bottom: 1px solid var(--edge); vertical-align: middle; }
    .mi-review tr.chk td { background: var(--wait-fill); }
    .mi-review tr.skip td { opacity: .45; }
    .mi-review .zc-input, .mi-review .zc-select { padding: 4px 7px; font-size: 12px; border-radius: 8px; }
    .mi-why { font-size: 10.5px; color: var(--wait-ink); margin-top: 2px; }
    .tag-editor { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 8px; border-radius: var(--r-ctl);
      border: 1px solid var(--edge); background: var(--card-2); min-height: 40px; }
    .tag-editor input { flex: 1 1 120px; min-width: 100px; border: 0; background: transparent; color: var(--text-1);
      font: inherit; font-size: 12.5px; outline: none; padding: 3px 2px; }
    .tag-editor .zc-tag button { background: none; border: 0; color: inherit; cursor: pointer; padding: 0 0 0 4px; font-size: 10px; }
    .tag-sugg { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
    .tag-sugg button { font-family: inherit; font-size: 11px; padding: 2px 9px; border-radius: 99px; cursor: pointer;
      border: 1px dashed var(--edge-hi); background: transparent; color: var(--text-2); }

    .mb-list-wide { display: block; }
    .mb-list-narrow { display: none; }
    @media (max-width: 760px) {
      .mb-list-wide { display: none; }
      .mb-list-narrow { display: block; }
    }
    .mb-mgrp { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 4px 6px; border-bottom: 1px solid var(--edge); }
    .mb-mrow { display: flex; gap: 11px; align-items: flex-start; padding: 11px 4px; border-bottom: 1px solid var(--edge); cursor: pointer; }
  `;
  document.head.appendChild(s);
}

export const VegDot = ({ tag }) => {
  const veg = tag === "Veg";
  return (
    <span className="menu-veg" style={{ border: `1.5px solid ${veg ? "var(--ready)" : "var(--stop)"}` }}
      role="img" aria-label={veg ? t("Vegetarian") : t("Non-vegetarian")}>
      <i style={{ background: veg ? "var(--ready)" : "var(--stop)" }} />
    </span>
  );
};

export const Switch = ({ on, onClick, label }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick}
    className={`menu-switch${on ? " on" : ""}`} style={{ border: 0, cursor: "pointer" }}>
    <i />
  </button>
);

// 🕒 5:00 PM – 11:00 PM  (dimmed with "off now" when outside its window)
export const ScheduleBadge = ({ schedule, off }) => (
  <span className={`menu-sched-badge${off ? " off" : ""}`}
    title={off ? t("Outside its schedule — hidden from customers right now") : t("Visible to customers only in this window")}>
    🕒 {schedLabel(schedule)}{off ? ` · ${t("off now")}` : ""}
  </span>
);

// Item thumbnail — the Cloudinary image, or a glyph fallback (also on load error).
// `missing` marks "no photo" the way the reference does (dashed, amber).
export const Thumb = ({ src, size = 40, missing = false }) => {
  const [broken, setBroken] = useState(false);
  const ok = isUrl(src) && !broken;
  return (
    <span className={`menu-thumb${!ok && missing ? " none" : ""}`} style={{ width: size, height: size }}
      title={!ok && missing ? t("No photo") : undefined}>
      {ok
        ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 9 }} />
        : missing ? "＋" : "🍽️"}
    </span>
  );
};

// Category thumbnail — its uploaded image, else its emoji (older categories
// store one, e.g. "🍕"), else a generic glyph.
export const CatThumb = ({ image, icon, size = 38 }) => {
  const [broken, setBroken] = useState(false);
  const showImg = isUrl(image) && !broken;
  return (
    <span className="menu-thumb" style={{ width: size, height: size, fontSize: size * 0.48 }}>
      {showImg
        ? <img src={image} alt="" loading="lazy" onError={() => setBroken(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 9 }} />
        : icon ? <CategoryIcon name={icon} size={Math.round(size * 0.62)} />
          : (image && !isUrl(image) ? image : "🗂️")}
    </span>
  );
};

// Diner tags ("Fish", "Spicy", "Bestseller") — type and press Enter or comma.
// `suggestions` = tags already used on the menu, offered as one-tap chips.
const SUGGESTED_TAGS = ["Bestseller", "Spicy", "Fish", "Prawn", "Chef's special", "New"];
export function TagEditor({ value, onChange, suggestions = [], label, max = 10 }) {
  const [draft, setDraft] = useState("");
  const has = (x) => value.some((v) => v.toLowerCase() === x.toLowerCase());
  const add = (raw) => {
    const x = raw.trim().replace(/\s+/g, " ").slice(0, 24);
    if (!x || has(x) || value.length >= max) return;
    onChange([...value, x]);
  };
  const commit = () => { draft.split(",").forEach(add); setDraft(""); };
  const offer = [...new Set([...suggestions, ...SUGGESTED_TAGS])].filter((x) => !has(x)).slice(0, 10);
  return (
    <div>
      <div className="tag-editor">
        {value.map((x) => (
          <span key={x} className="zc-tag vio">
            {x}
            <button type="button" aria-label={t("Remove tag {name}", { name: x })}
              onClick={() => onChange(value.filter((v) => v !== x))}>✕</button>
          </span>
        ))}
        <input value={draft} aria-label={label || t("Add a tag")} maxLength={24}
          placeholder={value.length ? "" : t("Type a tag and press Enter")}
          onChange={(e) => { if (e.target.value.endsWith(",")) { add(e.target.value.slice(0, -1)); setDraft(""); } else setDraft(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={commit} />
      </div>
      {offer.length > 0 && value.length < max && (
        <div className="tag-sugg">
          {offer.map((x) => <button key={x} type="button" onClick={() => add(x)}>＋ {x}</button>)}
        </div>
      )}
    </div>
  );
}
