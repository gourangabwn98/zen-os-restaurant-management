// src/components/AddonPicker.jsx — KH-12
// After tapping an item that has add-ons: "Does the customer want an extra?"
// Tick any number of add-ons (or none) → the line is added with them. The
// price shown is a preview; the server prices the line itself.
import { useState } from "react";
import PrimaryButton from "./ui/PrimaryButton.jsx";
import { ACCENT, TEXT_MUTED, TEXT_FAINT, GLASS_BORDER, GLASS_BG } from "../theme.js";
import { t, localName } from "../i18n/index.jsx";
import { unitPrice } from "../utils/addons.js";

export default function AddonPicker({ item, onCancel, onConfirm }) {
  const [picked, setPicked] = useState([]);
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const price = unitPrice(item, picked);

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
            const on = picked.includes(String(a._id));
            return (
              <button key={a._id} type="button" onClick={() => toggle(String(a._id))} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "13px 14px",
                borderRadius: 12, cursor: "pointer", fontSize: 14, fontWeight: 700, textAlign: "left",
                border: `1.5px solid ${on ? "rgba(59,130,246,0.6)" : GLASS_BORDER}`,
                background: on ? "rgba(59,130,246,0.15)" : GLASS_BG, color: "#fff",
              }}>
                <span>{on ? "☑" : "☐"} {a.name}</span>
                <span style={{ color: on ? ACCENT : TEXT_FAINT }}>+₹{a.price}</span>
              </button>
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
