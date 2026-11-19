// src/offline/OfflineBanner.jsx — top bar shown while the backend can't be
// reached ("No internet" / "Can't reach the server", and the time of the saved
// data on screen), then "Back online" with a Refresh button for live data.
import { useEffect, useState } from "react";
import { t } from "../i18n/index.jsx";
import { getConnectivity, subscribeConnectivity } from "./connectivity.js";

const BACK_ONLINE_MS = 8000;
const fmtClock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export default function OfflineBanner() {
  const [conn, setConn] = useState(getConnectivity);
  const [backOnline, setBackOnline] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let prev = getConnectivity();
    return subscribeConnectivity((next) => {
      if (prev.status !== "online" && next.status === "online") setBackOnline(true);
      if (next.status !== "online") setBackOnline(false);
      if (prev.status !== next.status) setDismissed(false);
      prev = next;
      setConn(next);
    });
  }, []);

  useEffect(() => {
    if (!backOnline) return undefined;
    const id = setTimeout(() => setBackOnline(false), BACK_ONLINE_MS);
    return () => clearTimeout(id);
  }, [backOnline]);

  if (dismissed) return null;

  if (conn.status !== "online") {
    return (
      <div role="status" aria-live="polite" style={{ ...S.bar, background: "#7c2d12" }}>
        <span style={S.text}>
          <b>{conn.status === "offline" ? t("No internet connection.") : t("Can't reach the server.")}</b>{" "}
          {conn.savedAt != null && t("Showing data saved at {time}.", { time: fmtClock(conn.savedAt) }) + " "}
          {t("Changes can't be saved until the connection is back.")}
        </span>
        <button type="button" aria-label={t("Dismiss")} style={S.close} onClick={() => setDismissed(true)}>×</button>
      </div>
    );
  }
  if (backOnline) {
    return (
      <div role="status" aria-live="polite" style={{ ...S.bar, background: "#14532d" }}>
        <span style={S.text}><b>{t("Back online.")}</b></span>
        {conn.usedSavedData && (
          <button type="button" style={S.action} onClick={() => window.location.reload()}>{t("Refresh")}</button>
        )}
        <button type="button" aria-label={t("Dismiss")} style={S.close} onClick={() => setDismissed(true)}>×</button>
      </div>
    );
  }
  return null;
}

// Fixed bar over the top of the page: an exceptional state, so it may cover
// the header briefly; × hides it until the connection state changes.
const S = {
  bar: {
    position: "fixed", top: 0, left: 0, right: 0, zIndex: 10001,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
    padding: "calc(6px + env(safe-area-inset-top, 0px)) 12px 6px", color: "#fff",
    fontSize: 13, lineHeight: 1.35, boxShadow: "0 2px 10px rgba(0,0,0,.25)",
  },
  text: { textAlign: "center" },
  action: { border: "1px solid rgba(255,255,255,.6)", borderRadius: 8, padding: "3px 10px", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" },
  close: { border: 0, background: "transparent", color: "#fff", fontSize: 20, lineHeight: 1, padding: "0 4px", cursor: "pointer", opacity: 0.85 },
};
