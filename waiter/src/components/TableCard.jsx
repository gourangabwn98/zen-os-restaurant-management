import { STATUS_META, PAYMENT_META, formatElapsed, elapsedKind, elapsedMinutes } from "../utils/tableSession.js";

const BORDER_NEUTRAL = "#1F2733";
const TEXT_MUTED = "#9AA4B2";
const TEXT_MAIN  = "#E8ECF2";
const FONT_HEAD = "'Bricolage Grotesque', sans-serif";
const FONT_BODY = "'IBM Plex Sans', sans-serif";
const FONT_MONO = "'IBM Plex Mono', monospace";

const ELAPSED_COLOR = { normal: TEXT_MUTED, wait: "#F5C565", stop: "#FF8A8A" };

// Simple line icons — no emoji, per the redesign brief.
const ClockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" />
  </svg>
);
const ReceiptIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" /><path d="M9 7h6M9 11h6" />
  </svg>
);
const PlusIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const Dot = ({ color }) => (
  <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
);

function PaymentPill({ state }) {
  if (!state) return null;
  const meta = PAYMENT_META[state];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", fontSize: 8.5, fontWeight: 700, letterSpacing: 0.2,
      color: meta.color, background: meta.bg, padding: "3px 7px", borderRadius: 999, whiteSpace: "nowrap", flexShrink: 0,
    }}>
      {meta.label}
    </span>
  );
}

/** Occupied-table card: whole card is a button that opens this table's
 * orders. `classified` is the output of utils/tableSession.js's
 * classifyTable() — status/payment/total are already resolved so this
 * component only renders, never re-derives, that state. */
export function OccupiedTableCard({ classified, active, onClick, style, className }) {
  const { table, orderCount, status, payment, total, placedAt } = classified;
  const meta = STATUS_META[status] || { label: status, color: TEXT_MUTED };
  const mins = elapsedMinutes(placedAt);
  const elapsed = formatElapsed(mins);
  const kind = elapsedKind(mins);

  const ariaLabel = `Table ${table.tableNo}, ${meta.label}, ${orderCount} order${orderCount === 1 ? "" : "s"}, ₹${total}${
    payment ? `, ${PAYMENT_META[payment].label}` : ""
  }`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`pressable ${className || ""}`.trim()}
      style={{
        display: "flex", flexDirection: "column", textAlign: "left", cursor: "pointer",
        width: "100%", padding: 0, minHeight: 44, overflow: "hidden",
        background: "#131820", border: `1.5px solid ${meta.color}59`, borderRadius: 18,
        boxShadow: active ? `0 0 0 2px ${meta.color}` : "none",
        fontFamily: FONT_BODY, color: TEXT_MAIN,
        ...style,
      }}
    >
      <div className="card-band" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: `${meta.color}1F` }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9.5, fontWeight: 700, color: meta.color, minWidth: 0 }}>
          <Dot color={meta.color} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta.label}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9.5, color: TEXT_MUTED, flexShrink: 0 }}>
          <ReceiptIcon /> {orderCount}
        </span>
      </div>

      <div className="card-mid" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div className="card-table-no" style={{ fontFamily: FONT_HEAD, fontWeight: 800, lineHeight: 1 }}>T{table.tableNo}</div>
          <div style={{ fontSize: 9.5, color: TEXT_MUTED, marginTop: 4, whiteSpace: "nowrap" }}>{table.seats} seats</div>
        </div>
        {elapsed && (
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3, color: ELAPSED_COLOR[kind] }}>
              <ClockIcon />
              <span style={{ fontFamily: FONT_MONO, fontWeight: 600, fontSize: 11.5, whiteSpace: "nowrap" }}>{elapsed}</span>
            </div>
            <div style={{ fontSize: 8.5, color: TEXT_MUTED, marginTop: 2, whiteSpace: "nowrap" }}>seated</div>
          </div>
        )}
      </div>

      <div className="card-foot" style={{ borderTop: `1px solid ${BORDER_NEUTRAL}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="card-amount" style={{ fontFamily: FONT_MONO, fontWeight: 600 }}>₹{total}</span>
        <PaymentPill state={payment} />
      </div>
    </button>
  );
}

/** Free-table card: the whole card starts a new order for this table —
 * the "+ Start order" affordance at the bottom is visual only (a <button>
 * can't nest another interactive control), the card itself carries the
 * click and the accessible name. */
export function FreeTableCard({ table, onClick, style, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Table ${table.tableNo}, Free, ${table.seats} seats`}
      className={`pressable card-free ${className || ""}`.trim()}
      style={{
        display: "flex", flexDirection: "column", textAlign: "left", cursor: "pointer",
        width: "100%", minHeight: 44, position: "relative",
        background: "#0F1319", border: "1.5px dashed #2A3340", borderRadius: 18,
        fontFamily: FONT_BODY, color: TEXT_MAIN,
        ...style,
      }}
    >
      <span style={{
        position: "absolute", top: 8, right: 8, fontSize: 8, fontWeight: 800, letterSpacing: 0.3,
        color: "#3DD68C", border: "1px solid rgba(61,214,140,.5)", borderRadius: 999, padding: "2px 6px",
      }}>
        FREE
      </span>

      <div className="card-table-no" style={{ fontFamily: FONT_HEAD, fontWeight: 800, lineHeight: 1, color: "rgba(232,236,242,0.55)" }}>
        T{table.tableNo}
      </div>
      <div style={{ fontSize: 9.5, color: TEXT_MUTED, marginTop: 4, marginBottom: 10, whiteSpace: "nowrap" }}>{table.seats} seats</div>

      <div style={{
        marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
        padding: "7px 6px", borderRadius: 10, border: `1px solid ${BORDER_NEUTRAL}`, background: "rgba(255,255,255,0.03)",
        fontSize: 10, fontWeight: 700, color: TEXT_MAIN, whiteSpace: "nowrap",
      }}>
        <PlusIcon /> Start order
      </div>
    </button>
  );
}
