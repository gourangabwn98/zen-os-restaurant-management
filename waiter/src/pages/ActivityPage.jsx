import { useState, useEffect, useCallback } from "react";
import { getMyActivity } from "../services/authService.js";
import { getMyDutyHistory } from "../services/dutyService.js";
import { getSocket } from "../services/socketService.js";
import { Loader, ErrorState } from "../components/StateViews.jsx";
import { ACCENT, GREEN, AMBER, RED, TEXT_MUTED, TEXT_FAINT, GLASS_BG, GLASS_BORDER, NAV_HEIGHT } from "../theme.js";
import { RANGE_PRESETS, toDateInput, formatDuration } from "../utils/dateRange.js";
import { t } from "../i18n/index.jsx";

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
      .catch(() => setError(t("Couldn't load activity")));
  }, [from, to]);

  useEffect(() => { setData(null); load(); }, [load]);

  // My duty history — every ON/OFF and who did it (me or an admin). Re-read
  // live on any duty change and after a reconnect; the server is the truth.
  const [dutyLog, setDutyLog] = useState(null);
  const loadDutyLog = useCallback(() => {
    getMyDutyHistory({ from, to, limit: 200 })
      .then(({ data }) => setDutyLog(data))
      .catch(() => setDutyLog((d) => d || { records: [], summary: null, failed: true }));
  }, [from, to]);
  useEffect(() => { setDutyLog(null); loadDutyLog(); }, [loadDutyLog]);
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    socket.on("employee:attendance:updated", loadDutyLog);
    socket.on("connect", loadDutyLog);
    return () => { socket.off("employee:attendance:updated", loadDutyLog); socket.off("connect", loadDutyLog); };
  }, [loadDutyLog]);

  const applyPreset = (key) => {
    setPreset(key);
    const r = RANGE_PRESETS.find((p) => p.key === key).range();
    setFrom(r.from); setTo(r.to);
  };
  const handleFrom = (v) => { setPreset(""); setFrom(v); if (to < v) setTo(v); };
  const handleTo   = (v) => { setPreset(""); setTo(v); if (from > v) setFrom(v); };

  const presetLabel = RANGE_PRESETS.find((p) => p.key === preset)?.label;
  const rangeLabel = presetLabel ? t(presetLabel) : (from === to ? from : `${from} → ${to}`);

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div style={{ paddingBottom: NAV_HEIGHT + 30 }}>
      <div style={{ padding: "20px 16px 4px", fontSize: 25, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>{t("Activity")}</div>
      <div style={{ padding: "4px 16px", fontSize: 12, color: TEXT_FAINT }}>{t("Your orders, collection, and duty time — {range}.", { range: rangeLabel })}</div>

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
            {t(p.label)}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 16px 16px" }}>
        <input type="date" value={from} max={to} onChange={(e) => handleFrom(e.target.value)} style={dateInputStyle} />
        <span style={{ color: TEXT_FAINT, fontSize: 12 }}>{t("to")}</span>
        <input type="date" value={to} min={from} max={TODAY_STR} onChange={(e) => handleTo(e.target.value)} style={dateInputStyle} />
      </div>

      {!data ? (
        <Loader label={t("Loading activity…")} />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "0 16px 16px" }}>
            <StatTile label={t("My orders")} value={data.orders.ordersCount} />
            <StatTile label={t("My collection")} value={`₹${data.orders.collection}`} accent={GREEN} />
            <StatTile label={t("Time on duty")} value={formatDuration(data.duty.workingSeconds)} />
            <StatTile label={t("Break time")} value={formatDuration(data.duty.breakSeconds)} accent={AMBER} />
          </div>

          <Section title={t("My duty history")} count={dutyLog?.summary?.total ?? "…"}>
            {!dutyLog ? <EmptyRow text={t("Loading…")} />
              : dutyLog.failed ? <EmptyRow text={t("Couldn't load duty history")} />
              : dutyLog.records.length === 0 ? <EmptyRow text={t("No duty changes in this range")} />
              : (
                <>
                  <div style={{ fontSize: 11.5, color: TEXT_MUTED, padding: "0 2px" }}>
                    {t("On duty {on} · Off duty {off} · By you {self} · By admin {admin}", {
                      on: dutyLog.summary.onDuty, off: dutyLog.summary.offDuty, self: dutyLog.summary.bySelf, admin: dutyLog.summary.byAdmin,
                    })}
                  </div>
                  {dutyLog.records.map((r) => <DutyLine key={r._id} record={r} showDate={from !== to} />)}
                </>
              )}
          </Section>

          <Section title={t("Unpaid orders")} count={data.orders.unpaidCount}>
            {data.orders.unpaidOrders.length === 0
              ? <EmptyRow text={t("No unpaid orders in this range")} />
              : data.orders.unpaidOrders.map((o) => (
                  <OrderLine key={o._id} order={o} tint={RED} dateField="confirmedAt" sub={o.tableNo ? t("Table {n}", { n: o.tableNo }) : t(o.orderType)} />
                ))}
          </Section>

          <Section title={t("Cancelled orders")} count={data.orders.cancelledCount}>
            {data.orders.cancelledOrders.length === 0
              ? <EmptyRow text={t("No cancelled orders in this range")} />
              : data.orders.cancelledOrders.map((o) => (
                  <OrderLine key={o._id} order={o} tint={TEXT_MUTED} dateField="cancelledAt" sub={o.cancelReason || (o.tableNo ? t("Table {n}", { n: o.tableNo }) : t(o.orderType))} />
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

function DutyLine({ record, showDate }) {
  const on = record.action === "ON_DUTY";
  const tint = on ? GREEN : TEXT_MUTED;
  const when = new Date(record.at).toLocaleString([], showDate
    ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" });
  const by = record.source === "SELF"
    ? t("By you")
    : t("By {name} (Admin)", { name: record.changedBy?.name || t("Admin") });
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px",
      background: `${tint}14`, border: `1px solid ${tint}40`, borderRadius: 12,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, color: on ? GREEN : "#fff" }}>{on ? t("ON DUTY") : t("OFF DUTY")}</div>
        <div style={{ fontSize: 10.5, color: record.source === "SELF" ? TEXT_FAINT : AMBER, marginTop: 2 }}>{by}</div>
      </div>
      <span style={{ fontWeight: 700, fontSize: 12.5, color: TEXT_MUTED, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{when}</span>
    </div>
  );
}

const dateInputStyle = {
  flex: 1, padding: "9px 11px", borderRadius: 10, border: `1px solid ${GLASS_BORDER}`,
  background: GLASS_BG, color: "#fff", fontSize: 12.5, fontFamily: "inherit",
};
