import { useState, useEffect, useCallback } from "react";
import { getMyActivity } from "../services/authService.js";
import { Loader, ErrorState } from "../components/StateViews.jsx";
import { ACCENT, GREEN, AMBER, RED, TEXT_MUTED, TEXT_FAINT, GLASS_BG, GLASS_BORDER, NAV_HEIGHT } from "../theme.js";
import { RANGE_PRESETS, toDateInput, formatDuration } from "../utils/dateRange.js";

const TODAY_STR = toDateInput(new Date());

export default function ActivityPage() {
  const [preset, setPreset] = useState("today");
  const [from, setFrom] = useState(() => RANGE_PRESETS[0].range().from);
  const [to, setTo]     = useState(() => RANGE_PRESETS[0].range().to);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    getMyActivity({ from, to })
      .then(({ data }) => setData(data))
      .catch(() => setError("Couldn't load activity"));
  }, [from, to]);

  useEffect(() => { setData(null); load(); }, [load]);

  const applyPreset = (key) => {
    setPreset(key);
    const r = RANGE_PRESETS.find((p) => p.key === key).range();
    setFrom(r.from); setTo(r.to);
  };
  const handleFrom = (v) => { setPreset(""); setFrom(v); if (to < v) setTo(v); };
  const handleTo   = (v) => { setPreset(""); setTo(v); if (from > v) setFrom(v); };

  const rangeLabel = RANGE_PRESETS.find((p) => p.key === preset)?.label ?? (from === to ? from : `${from} → ${to}`);

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div style={{ paddingBottom: NAV_HEIGHT + 30 }}>
      <div style={{ padding: "20px 16px 4px", fontSize: 25, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>Activity</div>
      <div style={{ padding: "4px 16px", fontSize: 12, color: TEXT_FAINT }}>Your orders, collection, and duty time — {rangeLabel}.</div>

      <div className="hide-scrollbar" style={{ display: "flex", gap: 6, overflowX: "auto", padding: "14px 16px 4px" }}>
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => applyPreset(p.key)}
            style={{
              flexShrink: 0, minHeight: 38, padding: "0 14px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
              border: preset === p.key ? "1px solid transparent" : `1px solid ${GLASS_BORDER}`,
              background: preset === p.key ? ACCENT : "rgba(255,255,255,0.06)",
              color: preset === p.key ? "#fff" : TEXT_MUTED,
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 16px 16px" }}>
        <input type="date" value={from} max={to} onChange={(e) => handleFrom(e.target.value)} style={dateInputStyle} />
        <span style={{ color: TEXT_FAINT, fontSize: 12 }}>to</span>
        <input type="date" value={to} min={from} max={TODAY_STR} onChange={(e) => handleTo(e.target.value)} style={dateInputStyle} />
      </div>

      {!data ? (
        <Loader label="Loading activity…" />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "0 16px 16px" }}>
            <StatTile label="My Orders" value={data.orders.ordersCount} />
            <StatTile label="My Collection" value={`₹${data.orders.collection}`} accent={GREEN} />
            <StatTile label="Online Timing" value={formatDuration(data.duty.workingSeconds)} />
            <StatTile label="Break Timing" value={formatDuration(data.duty.breakSeconds)} accent={AMBER} />
          </div>

          <Section title="Unpaid Orders" count={data.orders.unpaidCount}>
            {data.orders.unpaidOrders.length === 0
              ? <EmptyRow text="No unpaid orders in this range" />
              : data.orders.unpaidOrders.map((o) => (
                  <OrderLine key={o._id} order={o} tint={RED} dateField="confirmedAt" sub={o.tableNo ? `Table ${o.tableNo}` : o.orderType} />
                ))}
          </Section>

          <Section title="Cancelled Orders" count={data.orders.cancelledCount}>
            {data.orders.cancelledOrders.length === 0
              ? <EmptyRow text="No cancelled orders in this range" />
              : data.orders.cancelledOrders.map((o) => (
                  <OrderLine key={o._id} order={o} tint={TEXT_MUTED} dateField="cancelledAt" sub={o.cancelReason || (o.tableNo ? `Table ${o.tableNo}` : o.orderType)} />
                ))}
          </Section>
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, accent = ACCENT }) {
  return (
    <div style={{ background: GLASS_BG, border: `1px solid ${GLASS_BORDER}`, borderRadius: 16, padding: "16px 14px" }}>
      <div style={{ fontSize: 11, color: TEXT_FAINT, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, color: accent, marginTop: 5, fontVariantNumeric: "tabular-nums", letterSpacing: -0.3 }}>
        {value}
      </div>
    </div>
  );
}

function Section({ title, count, children }) {
  return (
    <div style={{ padding: "0 16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: TEXT_FAINT, textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: TEXT_MUTED, background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "1px 7px" }}>
          {count}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}

function EmptyRow({ text }) {
  return (
    <div style={{ padding: "16px", textAlign: "center", fontSize: 12.5, color: TEXT_FAINT, background: GLASS_BG, border: `1px solid ${GLASS_BORDER}`, borderRadius: 12 }}>
      {text}
    </div>
  );
}

function OrderLine({ order, tint, sub, dateField }) {
  const when = order[dateField];
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px",
      background: `${tint}14`, border: `1px solid ${tint}40`, borderRadius: 12,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, color: "#fff" }}>{order.orderId}</div>
        <div style={{ fontSize: 10.5, color: TEXT_FAINT, marginTop: 2 }}>
          {sub}{when ? ` · ${new Date(when).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
        </div>
      </div>
      <span style={{ fontWeight: 800, fontSize: 13.5, color: tint, flexShrink: 0 }}>₹{order.total}</span>
    </div>
  );
}

const dateInputStyle = {
  flex: 1, padding: "9px 11px", borderRadius: 10, border: `1px solid ${GLASS_BORDER}`,
  background: GLASS_BG, color: "#fff", fontSize: 12.5, fontFamily: "inherit",
};
