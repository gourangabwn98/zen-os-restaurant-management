// src/components/DutyPanel.jsx — compact "My Duty" toggle, lives on the
// Tables page header (not Profile) so a waiter can clock in/out without
// leaving the screen they actually work from. Session/heartbeat/mutations
// all live in the app-level useDuty() hook (context/AppState.jsx) — this
// component is just the live timer + the toggle UI on top of it.
import { useState, useEffect } from "react";
import { useAppState } from "../context/AppState.jsx";
import { GREEN, AMBER, RED, EASE_SNAP } from "../theme.js";
import { formatDuration } from "../utils/dateRange.js";

const STATUS_META = {
  ONLINE:  { color: GREEN, label: "On duty" },
  BREAK:   { color: AMBER, label: "On break" },
  OFFLINE: { color: RED,   label: "Off duty" },
};

// Working/break seconds so far, computed client-side between server
// refetches so the timer ticks smoothly without polling every second.
const liveElapsed = (session, nowMs) => {
  if (!session) return { workingSeconds: 0, breakSeconds: 0 };
  const loginMs = new Date(session.loginAt).getTime();
  const totalBreakSeconds = session.totalBreakSeconds || 0;
  const openBreak = (session.breaks || []).find((b) => !b.endedAt);

  if (session.presenceStatus === "BREAK" && openBreak) {
    const breakStartMs = new Date(openBreak.startedAt).getTime();
    const workingSeconds = Math.max(0, Math.round((breakStartMs - loginMs) / 1000) - totalBreakSeconds);
    const breakSeconds = totalBreakSeconds + Math.max(0, Math.round((nowMs - breakStartMs) / 1000));
    return { workingSeconds, breakSeconds };
  }
  const workingSeconds = Math.max(0, Math.round((nowMs - loginMs) / 1000) - totalBreakSeconds);
  return { workingSeconds, breakSeconds: totalBreakSeconds };
};

export default function DutyPanel() {
  const { duty } = useAppState();
  const { session, busy, presenceStatus, start, startBreak, endBreak, end } = duty;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  if (session === undefined) return null; // loading — avoid a flash of "off duty"

  const meta = STATUS_META[presenceStatus];
  const { workingSeconds, breakSeconds } = liveElapsed(session, nowMs);
  const timeLabel = presenceStatus === "BREAK" ? formatDuration(breakSeconds) : session ? formatDuration(workingSeconds) : null;

  const handleToggle = () => {
    if (session) {
      if (!window.confirm("End your duty for today?")) return;
      end();
    } else {
      start();
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color, boxShadow: `0 0 8px ${meta.color}`, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 12.5, color: "#E8ECF2" }}>{meta.label}</div>
          {timeLabel && (
            <div style={{ fontSize: 10.5, color: "#9AA4B2", fontVariantNumeric: "tabular-nums" }}>
              {presenceStatus === "BREAK" ? "Break · " : "Working · "}{timeLabel}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {presenceStatus === "ONLINE" && (
          <button onClick={startBreak} disabled={busy} style={miniBtn}>Break</button>
        )}
        {presenceStatus === "BREAK" && (
          <button onClick={endBreak} disabled={busy} style={miniBtn}>Resume</button>
        )}
        <Switch on={!!session} disabled={busy} color={meta.color} onClick={handleToggle} />
      </div>
    </div>
  );
}

function Switch({ on, onClick, disabled, color }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-pressed={on} aria-label={on ? "End duty" : "Start duty"}
      style={{
        width: 46, height: 26, borderRadius: 999, border: "none", padding: 0, position: "relative", flexShrink: 0,
        background: on ? color : "rgba(255,255,255,0.16)", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1, transition: `background .2s ${EASE_SNAP}`,
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: on ? 23 : 3, width: 20, height: 20, borderRadius: "50%",
        background: "#fff", boxShadow: "0 2px 6px rgba(0,0,0,0.3)", transition: `left .2s ${EASE_SNAP}`,
      }} />
    </button>
  );
}

const miniBtn = {
  minHeight: 32, padding: "0 12px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.06)", color: "#E8ECF2", fontSize: 11.5, fontWeight: 700, cursor: "pointer",
};
