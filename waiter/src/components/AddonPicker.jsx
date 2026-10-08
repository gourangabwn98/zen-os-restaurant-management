// src/components/AddonPicker.jsx — KH-12
// After tapping an item that has add-ons: "Does the customer want an extra?"
// − / + per add-on (2 × chicken is fine), or none → the line is added with
// them. `picked` repeats an id once per piece. The price shown is a preview;
// the server prices the line itself.
import { useState } from "react";
import PrimaryButton from "./ui/PrimaryButton.jsx";
import { ACCENT, TEXT_MUTED, TEXT_FAINT, GLASS_BORDER, GLASS_BG } from "../theme.js";
import { t, localName } from "../i18n/index.jsx";
import { unitPrice, countIds, ADDON_QTY_MAX } from "../utils/addons.js";

export default function AddonPicker({ item, onCancel, onConfirm }) {
  const [picked, setPicked] = useState([]);
  const counts = countIds(picked);
  const step = (id, delta) => setPicked((p) => {
    if (delta > 0) return (counts.get(id) || 0) >= ADDON_QTY_MAX ? p : [...p, id];
    const i = p.lastIndexOf(id);
    return i < 0 ? p : [...p.slice(0, i), ...p.slice(i + 1)];
  });
  const price = unitPrice(item, picked);
  const stepBtn = (on) => ({
    width: 34, height: 34, borderRadius: 10, border: `1px solid ${on ? "rgba(59,130,246,0.6)" : GLASS_BORDER}`,
    background: on ? "rgba(59,130,246,0.25)" : "transparent", color: "#fff", fontSize: 18, fontWeight: 800, cursor: "pointer",
  });

  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 120, display: "flex", alignItems: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 560, margin: "0 auto", background: "#0C0A14", border: `1px solid ${GLASS_BORDER}`,
        borderBottom: "none", borderRadius: "20px 20px 0 0", padding: "16px 16px calc(16px + env(safe-area-inset-bottom))",
      }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: "#fff" }}>{localName(item)} · ₹{item.price}</div>
        <div style={{ fontSize: 12.5, color: TEXT_MUTED, marginTop: 4 }}>{t("Does the customer want an extra?")}</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
          {item.addons.map((a) => {
            const id = String(a._id);
            const n = counts.get(id) || 0;
            const on = n > 0;
            return (
              <div key={a._id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px 8px 14px",
                borderRadius: 12, fontSize: 14, fontWeight: 700,
                border: `1.5px solid ${on ? "rgba(59,130,246,0.6)" : GLASS_BORDER}`,
                background: on ? "rgba(59,130,246,0.15)" : GLASS_BG, color: "#fff",
              }}>
                <button type="button" onClick={() => step(id, 1)} style={{ flex: 1, minWidth: 0, background: "none", border: "none", color: "#fff", font: "inherit", textAlign: "left", cursor: "pointer", padding: "5px 0" }}>
                  {a.name} <span style={{ color: on ? ACCENT : TEXT_FAINT }}>+₹{a.price}</span>
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button type="button" aria-label={`− ${a.name}`} disabled={!on} onClick={() => step(id, -1)} style={{ ...stepBtn(on), opacity: on ? 1 : 0.35 }}>−</button>
                  <span style={{ minWidth: 18, textAlign: "center" }}>{n}</span>
                  <button type="button" aria-label={`+ ${a.name}`} disabled={n >= ADDON_QTY_MAX} onClick={() => step(id, 1)} style={{ ...stepBtn(on), opacity: n >= ADDON_QTY_MAX ? 0.35 : 1 }}>+</button>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <PrimaryButton variant="outline" onClick={() => onConfirm([])} style={{ flex: 1 }}>{t("No extra")}</PrimaryButton>
          <PrimaryButton disabled={!picked.length} onClick={() => onConfirm(picked)} style={{ flex: 1 }}>
            {t("Add with extra")} · ₹{price}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

/** Small hint under a menu item: "Extras: 1 pc Chicken +₹40 · Egg +₹15". */
export function AddonHint({ item }) {
  if (!item?.addons?.length) return null;
  return (
    <div style={{ fontSize: 11, color: "#93C5FD", marginTop: 3 }}>
      ＋ {t("Extras")}: {item.addons.map((a) => `${a.name} +₹${a.price}`).join(" · ")}
    </div>
  );
}
