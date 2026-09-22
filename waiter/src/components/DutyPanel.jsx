// src/components/DutyPanel.jsx — "My Duty" attendance/presence panel.
// Resumes an already-open session on mount (login/refresh/reconnect never
// creates a duplicate — see restaurant-server/services/attendanceService.js).
// Starting duty is always an explicit tap, never automatic on login.
import { useState, useEffect, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import GlassCard from "./ui/GlassCard.jsx";
import PrimaryButton from "./ui/PrimaryButton.jsx";
import { getMyDuty, startDuty, startBreak, endBreak, endDuty } from "../services/dutyService.js";
import { getSocket } from "../services/socketService.js";
import { GREEN, AMBER, RED, TEXT, TEXT_FAINT } from "../theme.js";

const HEARTBEAT_INTERVAL_MS = 30000;

const STATUS_META = {
  ONLINE:  { color: GREEN, label: "ONLINE", dot: "🟢" },
  BREAK:   { color: AMBER, label: "ON BREAK", dot: "🟡" },
  OFFLINE: { color: RED,   label: "OFF DUTY", dot: "🔴" },
};

const fmtDuration = (totalSeconds) => {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
};
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—");

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
  const [session, setSession] = useState(undefined); // undefined = loading, null = off duty
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const heartbeatRef = useRef(null);

  const refresh = useCallback(() => {
    getMyDuty().then(({ data }) => setSession(data.session || null)).catch(() => setSession(null));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Live ticking clock for the working/break timers — purely local display,
  // never written anywhere; the server value is re-synced via refresh().
  useEffect(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Heartbeat while a session is open, plus listening for this employee's
  // own attendance updates from other tabs/devices.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const sendHeartbeat = () => { if (session?.status === "OPEN") socket.emit("employee:attendance:heartbeat"); };
    heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    sendHeartbeat();

    const onUpdate = () => refresh();
    socket.on("employee:attendance:updated", onUpdate);

    return () => {
      clearInterval(heartbeatRef.current);
      socket.off("employee:attendance:updated", onUpdate);
    };
  }, [session?.status, refresh]);

  const act = async (action, fn) => {
    setBusy(true);
    try {
      const { data } = await fn();
      setSession(data.session);
      toast.success(
        action === "start" ? "Duty started" :
        action === "breakStart" ? "Break started" :
        action === "breakEnd" ? "Back on duty" : "Duty ended"
      );
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't update duty status");
    } finally {
      setBusy(false);
    }
  };

  if (session === undefined) return null; // loading — avoid a flash of "off duty"

  const status = session ? session.presenceStatus : "OFFLINE";
  const meta = STATUS_META[status];
  const { workingSeconds, breakSeconds } = liveElapsed(session, nowMs);

  return (
    <GlassCard style={{ padding: "18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: TEXT_FAINT, letterSpacing: 0.4 }}>MY DUTY</div>
        <div style={{ fontSize: 13, fontWeight: 800, color: meta.color }}>{meta.dot} {meta.label}</div>
      </div>

      {session ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <Stat label={status === "BREAK" ? "Break started" : "Started"}
                value={status === "BREAK"
                  ? fmtTime((session.breaks || []).find((b) => !b.endedAt)?.startedAt)
                  : fmtTime(session.loginAt)} />
          <Stat label="Working" value={fmtDuration(workingSeconds)} />
          {status === "BREAK" && <Stat label="Break duration" value={fmtDuration(breakSeconds)} />}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: TEXT_FAINT, marginBottom: 16 }}>
          You're not on duty. Start your shift to begin tracking attendance.
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        {!session && (
          <PrimaryButton variant="success" style={{ flex: 1 }} disabled={busy} onClick={() => act("start", startDuty)}>
            Start Duty
          </PrimaryButton>
        )}
        {session?.presenceStatus === "ONLINE" && (
          <>
            <PrimaryButton variant="outline" style={{ flex: 1 }} disabled={busy} onClick={() => act("breakStart", startBreak)}>
              Start Break
            </PrimaryButton>
            <PrimaryButton variant="danger" style={{ flex: 1 }} disabled={busy} onClick={() => act("end", endDuty)}>
              End Duty
            </PrimaryButton>
          </>
        )}
        {session?.presenceStatus === "BREAK" && (
          <PrimaryButton variant="solid" style={{ flex: 1 }} disabled={busy} onClick={() => act("breakEnd", endBreak)}>
            Resume Duty
          </PrimaryButton>
        )}
      </div>
    </GlassCard>
  );
}

const Stat = ({ label, value }) => (
  <div>
    <div style={{ fontSize: 17, fontWeight: 800, color: TEXT }}>{value}</div>
    <div style={{ fontSize: 10.5, color: TEXT_FAINT, marginTop: 2 }}>{label}</div>
  </div>
);
