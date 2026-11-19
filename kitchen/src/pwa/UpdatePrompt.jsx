// src/pwa/UpdatePrompt.jsx — "New version ready" bar, shown when a new deploy
// has been downloaded. Staff choose when to reload (never automatic).
import { useEffect, useState } from "react";
import { t } from "../i18n/index.jsx";
import { PWA_NEED_REFRESH, isUpdateWaiting, reloadToUpdate } from "./registerPwa.js";

export default function UpdatePrompt() {
  const [show, setShow] = useState(isUpdateWaiting);
  useEffect(() => {
    const on = () => setShow(true);
    window.addEventListener(PWA_NEED_REFRESH, on);
    return () => window.removeEventListener(PWA_NEED_REFRESH, on);
  }, []);
  if (!show) return null;
  return (
    <div role="status" style={S.bar}>
      <span style={S.text}>{t("A new version of the app is ready.")}</span>
      <button type="button" style={S.primary} onClick={reloadToUpdate}>{t("Reload")}</button>
      <button type="button" style={S.ghost} onClick={() => setShow(false)}>{t("Later")}</button>
    </div>
  );
}

// Fixed dark pill: readable over both light and dark themes.
const S = {
  bar: {
    position: "fixed", left: "50%", bottom: "calc(16px + env(safe-area-inset-bottom, 0px))", transform: "translateX(-50%)",
    zIndex: 10000, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center",
    maxWidth: "calc(100vw - 32px)", padding: "10px 12px 10px 16px", borderRadius: 14,
    background: "#16131f", color: "#f3f4f6", boxShadow: "0 8px 28px rgba(0,0,0,.35)", border: "1px solid rgba(255,255,255,.12)",
    fontSize: 14, fontWeight: 600,
  },
  text: { marginRight: 4 },
  primary: { border: 0, borderRadius: 10, padding: "8px 14px", background: "#2563EB", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" },
  ghost: { border: "1px solid rgba(255,255,255,.2)", borderRadius: 10, padding: "8px 12px", background: "transparent", color: "#d1d5db", fontWeight: 600, fontSize: 14, cursor: "pointer" },
};
