// src/hooks/useDuty.js — app-level duty/attendance state. Lives in
// AppStateProvider (not a per-page component) so the heartbeat keeps firing
// no matter which screen is open. The heartbeat only refreshes "last seen" —
// a missed heartbeat (phone asleep, app in the background, network down)
// never ends duty any more; only "End duty" or an admin does. On every
// reconnect / attendance event the session is re-read from the server, so a
// change made by an admin while offline shows up. Also the single source of
// truth other pages read `onDuty` from to gate order-taking actions
// (the backend enforces this too — see attendanceService.assertOnDuty —
// this is purely for not letting a waiter build a whole order and only
// then find out they're blocked).
import { useState, useEffect, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import { getMyDuty, startDuty, startBreak, endBreak, endDuty } from "../services/dutyService.js";
import { getSocket } from "../services/socketService.js";
import { t } from "../i18n/index.jsx";

const HEARTBEAT_INTERVAL_MS = 30000;

export function useDuty(isLoggedIn) {
  const [session, setSession] = useState(undefined); // undefined = loading, null = off duty
  const [busy, setBusy] = useState(false);
  const heartbeatRef = useRef(null);

  const refresh = useCallback(() => {
    if (!isLoggedIn) { setSession(null); return; }
    // A failed read (offline) keeps the last known state — it must never
    // make an on-duty waiter look OFF. Only the first load falls back to null.
    getMyDuty().then(({ data }) => setSession(data.session || null)).catch(() => setSession((s) => (s === undefined ? null : s)));
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
    socket.on("connect", onUpdate); // reconnect: pick up anything missed
    // Back from background / screen lock: re-read (never change) the state.
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(heartbeatRef.current);
      socket.off("employee:attendance:updated", onUpdate);
      socket.off("connect", onUpdate);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isLoggedIn, session?.status, refresh]);

  const act = useCallback(async (fn, successMsg) => {
    setBusy(true);
    try {
      const { data } = await fn();
      setSession(data.session);
      toast.success(t(successMsg));
      return true;
    } catch (err) {
      toast.error(err.response?.data?.message || t("Couldn't update duty status"));
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
