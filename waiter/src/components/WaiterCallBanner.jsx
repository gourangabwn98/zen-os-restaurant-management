import { useNavigate } from "react-router-dom";
import PrimaryButton from "./ui/PrimaryButton.jsx";
import { AMBER, GREEN, TEXT_MUTED, GLASS_BORDER, SHADOW_GLASS, BLUR, BG_SECONDARY } from "../theme.js";
import { t } from "../i18n/index.jsx";
import { tableLabel } from "../utils/diningArea.js";

const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Pinned above every screen while a customer's "Call waiter" is ringing this
 * waiter (hooks/useWaiterCalls.js). "On my way" tells the customer who's
 * coming; "Done" closes the call once the table is attended.
 */
export default function WaiterCallBanner({ calls, now, mine, onMyWay, done }) {
  const nav = useNavigate();
  if (!calls.length) return null;

  return (
    <div role="region" aria-label={t("Tables calling")} style={{
      position: "sticky", top: 0, zIndex: 50, padding: "10px 12px 4px",
      background: BG_SECONDARY, backdropFilter: BLUR,
    }}>
      {calls.map((c) => {
        const taken = c.status === "ACKNOWLEDGED" && mine.has(c._id);
        return (
          <div key={c._id} role="alert" style={{
            border: `1px solid ${taken ? GREEN : AMBER}`, borderRadius: 16, padding: "10px 12px", marginBottom: 8,
            background: taken ? "rgba(52,211,153,0.12)" : "rgba(251,191,36,0.12)", boxShadow: SHADOW_GLASS,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span aria-hidden="true" style={{ fontSize: 22 }}>🛎️</span>
              <button type="button" onClick={() => nav(`/order/${c.order}`)}
                style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: 0, padding: 0, color: "#fff", cursor: "pointer" }}>
                <div style={{ fontWeight: 800, fontSize: 15 }}>
                  {taken ? t("{table} — you're on the way", { table: tableLabel(c) }) : c.attempt === 2 ? t("{table} is calling again", { table: tableLabel(c) }) : t("{table} is calling", { table: tableLabel(c) })}
                </div>
                <div style={{ fontSize: 12, color: TEXT_MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.orderNumber ? t("Order {id}", { id: c.orderNumber }) : ""}{c.customerName ? ` · ${c.customerName}` : ""}
                </div>
              </button>
              {!taken && (
                <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800, color: AMBER }} aria-label={t("Time left")}>
                  {mmss(new Date(c.expiresAt).getTime() - now)}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {!taken && (
                <PrimaryButton onClick={() => onMyWay(c)} style={{ flex: 1, padding: "10px", fontSize: 13 }}>
                  {t("On my way")}
                </PrimaryButton>
              )}
              <PrimaryButton variant={taken ? "success" : "outline"} onClick={() => done(c)}
                style={{ flex: 1, padding: "10px", fontSize: 13, borderColor: GLASS_BORDER }}>
                {t("Done")} ✓
              </PrimaryButton>
            </div>
          </div>
        );
      })}
    </div>
  );
}
