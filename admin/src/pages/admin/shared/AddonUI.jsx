// src/pages/admin/shared/AddonUI.jsx — KH-12 add-on UI (hint, lines, "extra?" picker).
import { useState } from "react";
import { t, localName, fmtNum } from "../../../i18n/core.js";
import { hasAddons, unitPrice, addonNames } from "./addons.js";

/** "+ 1 pc Chicken" lines under an item (order line or cart line). */
export function AddonLines({ item, line, style }) {
  const names = addonNames(item, line);
  if (!names.length) return null;
  return names.map((n) => (
    <div key={n} style={{ fontSize: 11, fontWeight: 600, color: "var(--live-ink)", ...style }}>+ {n}</div>
  ));
}

/** Menu card hint: "＋ Extras: 1 pc Chicken +₹40". */
export function AddonHint({ item }) {
  if (!hasAddons(item)) return null;
  return (
    <div style={{ fontSize: 10.5, color: "var(--live-ink)", marginTop: 3, lineHeight: 1.3 }}>
      ＋ {t("Extras")}: {item.addons.map((a) => `${a.name} +₹${fmtNum(a.price)}`).join(" · ")}
    </div>
  );
}

/** After tapping an item with add-ons: "Does the customer want an extra?" */
export function AddonPicker({ item, onCancel, onConfirm }) {
  const [picked, setPicked] = useState([]);
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <div className="zc-scrim" onClick={onCancel} style={{ zIndex: 1200 }}>
      <div className="zc-modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="mh">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t">{localName(item)} · ₹{fmtNum(item.price)}</div>
            <div className="s">{t("Does the customer want an extra?")}</div>
          </div>
          <button type="button" className="zc-x" onClick={onCancel} aria-label={t("Close")}>✕</button>
        </div>
        <div className="mb" style={{ display: "grid", gap: 8 }}>
          {item.addons.map((a) => {
            const on = picked.includes(String(a._id));
            return (
              <label key={a._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                border: `1px solid ${on ? "var(--violet-line)" : "var(--edge)"}`, background: on ? "var(--violet-weak)" : "var(--card-2)" }}>
                <input type="checkbox" checked={on} onChange={() => toggle(String(a._id))} />
                <span style={{ flex: 1, fontWeight: 600, color: "var(--text-1)" }}>{a.name}</span>
                <span style={{ fontWeight: 700, color: "var(--text-2)" }}>+₹{fmtNum(a.price)}</span>
              </label>
            );
          })}
        </div>
        <div className="mf">
          <button type="button" className="zc-btn" onClick={() => onConfirm([])}>{t("No extra")}</button>
          <button type="button" className="zc-btn pri" disabled={!picked.length} onClick={() => onConfirm(picked)}>
            {t("Add with extra")} · ₹{fmtNum(unitPrice(item, picked))}
          </button>
        </div>
      </div>
    </div>
  );
}
