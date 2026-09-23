// src/hooks/useDuty.js — app-level duty/attendance state. Lives in
// AppStateProvider (not a per-page component) so the heartbeat keeps firing
// no matter which screen is open — it used to live only on the Tables page's
// DutyPanel, which meant the heartbeat (and thus the session) went silent
// the moment a waiter navigated to Orders/New Order/Order Detail for more
// than the 5-minute stale-session grace period. Also the single source of
// truth other pages read `onDuty` from to gate order-taking actions
// (the backend enforces this too — see attendanceService.assertOnDuty —
// this is purely for not letting a waiter build a whole order and only
// then find out they're blocked).
import { useState, useEffect, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import { getMyDuty, startDuty, startBreak, endBreak, endDuty } from "../services/dutyService.js";
import { getSocket } from "../services/socketService.js";

const HEARTBEAT_INTERVAL_MS = 30000;

export function useDuty(isLoggedIn) {
  const [session, setSession] = useState(undefined); // undefined = loading, null = off duty
  const [busy, setBusy] = useState(false);
  const heartbeatRef = useRef(null);

  const refresh = useCallback(() => {
    if (!isLoggedIn) { setSession(null); return; }
    getMyDuty().then(({ data }) => setSession(data.session || null)).catch(() => setSession(null));
  }, [isLoggedIn]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!isLoggedIn) return;
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
  }, [isLoggedIn, session?.status, refresh]);

  const act = useCallback(async (fn, successMsg) => {
    setBusy(true);
    try {
      const { data } = await fn();
      setSession(data.session);
      toast.success(successMsg);
      return true;
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't update duty status");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const presenceStatus = session ? session.presenceStatus : "OFFLINE";

  return {
    session, busy, presenceStatus,
    onDuty: presenceStatus === "ONLINE",
    start:      () => act(startDuty,  "Duty started"),
    startBreak: () => act(startBreak, "Break started"),
    endBreak:   () => act(endBreak,   "Back on duty"),
    end:        () => act(endDuty,    "Duty ended"),
  };
}
