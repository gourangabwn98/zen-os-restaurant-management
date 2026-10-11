// "Cash + Online" — the bill paid partly in cash, partly online. Typing one
// amount fills the other with the rest of the bill; Settle stays off until
// both are more than ₹0 and add up to the total exactly (the server checks
// the same again before recording anything).
import { useState } from "react";
import PrimaryButton from "./ui/PrimaryButton.jsx";
import { GREEN, RED, TEXT_MUTED, GLASS_BORDER, GLASS_BG } from "../theme.js";
import { t } from "../i18n/index.jsx";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const paise = (n) => Math.round(Number(n) * 100);

export default function SplitPayFields({ total, busy, onConfirm, onCancel }) {
  const [cash, setCash] = useState("");
  const [online, setOnline] = useState("");
  const ok = paise(cash) > 0 && paise(online) > 0 && paise(cash) + paise(online) === paise(total);

  const type = (which, v) => {
    const rest = v === "" ? "" : String(Math.max(0, r2(Number(total) - Number(v))));
    if (which === "cash") { setCash(v); setOnline(rest); } else { setOnline(v); setCash(rest); }
  };
  const box = (which, label, value) => (
    <label style={{ flex: 1, display: "grid", gap: 4, fontSize: 11.5, color: TEXT_MUTED, fontWeight: 600 }}>
      {label}
      <input type="number" min="0" step="0.01" inputMode="decimal" value={value} placeholder="0"
        autoFocus={which === "cash"} onChange={(e) => type(which, e.target.value)}
        style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, fontSize: 15, fontWeight: 700,
          border: `1px solid ${GLASS_BORDER}`, background: GLASS_BG, color: "inherit", font: "inherit" }} />
    </label>
  );

  return (
    <div style={{ display: "grid", gap: 8, padding: 10, borderRadius: 12, border: `1px solid ${GLASS_BORDER}` }}>
      <div style={{ fontSize: 12.5, fontWeight: 800 }}>{t("Cash + Online")} · ₹{r2(total)}</div>
      <div style={{ display: "flex", gap: 8 }}>
        {box("cash", t("Cash amount"), cash)}
        {box("online", t("Online amount"), online)}
      </div>
      <div role="status" style={{ fontSize: 11.5, fontWeight: 700, color: ok ? GREEN : RED }}>
        {cash === "" && online === "" ? t("Enter how much came in cash — the rest is online.")
          : ok ? `✓ ${t("Adds up to the bill")}`
          : t("Must add up to ₹{total}, both more than ₹0", { total: r2(total) })}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={busy} onClick={onCancel}
          style={{ flex: 1, padding: 10, borderRadius: 10, border: `1px solid ${GLASS_BORDER}`, background: "transparent", color: "inherit", font: "inherit", fontSize: 12.5, fontWeight: 700 }}>
          {t("Cancel")}
        </button>
        <PrimaryButton disabled={busy || !ok} variant="success" onClick={() => onConfirm({ cash: r2(cash), online: r2(online) })}
          style={{ flex: 2, padding: 10, fontSize: 12.5 }}>
          {t("Settle · Cash ₹{cash} + Online ₹{online}", { cash: r2(cash), online: r2(online) })}
        </PrimaryButton>
      </div>
    </div>
  );
}
