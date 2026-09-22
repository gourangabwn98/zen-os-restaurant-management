// src/components/DutyPanel.jsx — "My Duty" attendance/presence panel.
// Resumes an already-open session on mount (login/refresh/reconnect never
// creates a duplicate — see restaurant-server/services/attendanceService.js).
// Starting duty is always an explicit tap, never automatic on login.
import { useState, useEffect, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import { getMyDuty, startDuty, startBreak, endBreak, endDuty } from "../services/dutyService.js";
import { getSocket } from "../services/socketService.js";
import { CARD, BORDER, TEXT_MUTED, GREEN, AMBER, RED } from "../theme.js";

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

const btnStyle = (bg, color) => ({
  flex: 1, padding: "12px 10px", borderRadius: 10, border: "none",
  background: bg, color, fontWeight: 800, fontSize: 13, cursor: "pointer",
});

export default function DutyPanel() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = off duty
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const heartbeatRef = useRef(null);

  const refresh = useCallback(() => {
    getMyDuty().then(({ data }) => setSession(data.session || null)).catch(() => setSession(null));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

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

  const act = async (fn, label) => {
    setBusy(true);
    try {
      const { data } = await fn();
      setSession(data.session);
      toast.success(label);
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't update duty status");
    } finally {
      setBusy(false);
    }
  };

  if (session === undefined) return null;

  const status = session ? session.presenceStatus : "OFFLINE";
  const meta = STATUS_META[status];
  const { workingSeconds, breakSeconds } = liveElapsed(session, nowMs);

  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>My Duty</div>
        <div style={{ fontSize: 13, fontWeight: 800, color: meta.color }}>{meta.dot} {meta.label}</div>
      </div>

      {session ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div style={{ textAlign: "center", padding: "12px 8px", background: "#0f1218", borderRadius: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              {status === "BREAK" ? fmtTime((session.breaks || []).find((b) => !b.endedAt)?.startedAt) : fmtTime(session.loginAt)}
            </div>
            <div style={{ fontSize: 10.5, color: TEXT_MUTED, marginTop: 4 }}>{status === "BREAK" ? "Break started" : "Started"}</div>
          </div>
          <div style={{ textAlign: "center", padding: "12px 8px", background: "#0f1218", borderRadius: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{fmtDuration(workingSeconds)}</div>
            <div style={{ fontSize: 10.5, color: TEXT_MUTED, marginTop: 4 }}>Working</div>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: TEXT_MUTED, marginBottom: 16 }}>
          You're not on duty. Start your shift to begin tracking attendance.
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        {!session && (
          <button style={btnStyle(GREEN, "#0b0d12")} disabled={busy} onClick={() => act(startDuty, "Duty started")}>
            Start Duty
          </button>
        )}
        {session?.presenceStatus === "ONLINE" && (
          <>
            <button style={btnStyle("#0f1218", AMBER)} disabled={busy} onClick={() => act(startBreak, "Break started")}>
              Start Break
            </button>
            <button style={btnStyle("#0f1218", RED)} disabled={busy} onClick={() => act(endDuty, "Duty ended")}>
              End Duty
            </button>
          </>
        )}
        {session?.presenceStatus === "BREAK" && (
          <button style={btnStyle(GREEN, "#0b0d12")} disabled={busy} onClick={() => act(endBreak, "Back on duty")}>
            Resume Duty
          </button>
        )}
      </div>
    </div>
  );
}
