import { useEffect, useState, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import { getSocket } from "../services/socketService.js";
import { getMyCalls, acknowledgeCall, resolveCall } from "../services/waiterCallService.js";
import { playNotificationSound } from "../utils/notificationSound.js";
import { t } from "../i18n/index.jsx";

const LIVE = ["OPEN", "ACKNOWLEDGED"];

/**
 * Customers' "Call waiter" requests ringing THIS waiter. The server only
 * sends a call to the waiters it picked (the order's own waiter first, then
 * everyone on duty — restaurant-server/services/waiterCallService.js).
 * Returns { calls, mine, onMyWay, done }.
 */
export function useWaiterCalls(enabled) {
  const [calls, setCalls] = useState([]);
  const [now, setNow] = useState(Date.now());
  const mine = useRef(new Set()); // calls this device said "On my way" to

  const load = useCallback(() => {
    getMyCalls().then(({ data }) => setCalls(data?.calls || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) { setCalls([]); return; }
    load();
    const socket = getSocket();
    if (!socket) return;

    const onNew = ({ call } = {}) => {
      if (!call) return;
      playNotificationSound();
      toast(`🛎️ ${call.attempt === 2 ? t("Table {n} is calling again", { n: call.tableNo }) : t("Table {n} is calling", { n: call.tableNo })}`, { duration: 6000 });
      setCalls((p) => [...p.filter((c) => c._id !== call._id), call]);
    };
    const onUpdated = ({ call } = {}) => {
      if (!call) return; // (customer-shaped payloads carry `state`, not `call`)
      setCalls((p) => {
        const had = p.some((c) => c._id === call._id);
        if (!LIVE.includes(call.status)) return p.filter((c) => c._id !== call._id);
        // Someone else took it — let them have it.
        if (call.status === "ACKNOWLEDGED" && !mine.current.has(call._id)) {
          if (had && call.acknowledgedBy?.name) toast(t("{name} is taking table {n}", { name: call.acknowledgedBy.name, n: call.tableNo }));
          return p.filter((c) => c._id !== call._id);
        }
        return had ? p.map((c) => (c._id === call._id ? call : c)) : p;
      });
    };

    socket.on("waiter_call:new", onNew);
    socket.on("waiter_call:updated", onUpdated);
    socket.on("connect", load); // catch up after a reconnect
    return () => {
      socket.off("waiter_call:new", onNew);
      socket.off("waiter_call:updated", onUpdated);
      socket.off("connect", load);
    };
  }, [enabled, load]);

  // Drop calls whose timer ran out (the customer is escalated server-side).
  useEffect(() => {
    if (!calls.length) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [calls.length]);
  const live = calls.filter((c) => new Date(c.expiresAt).getTime() > now || mine.current.has(c._id));

  const onMyWay = async (call) => {
    try {
      mine.current.add(call._id);
      const { data } = await acknowledgeCall(call._id);
      setCalls((p) => p.map((c) => (c._id === call._id ? data.call : c)));
    } catch (err) {
      mine.current.delete(call._id);
      toast.error(err.response?.data?.message || t("Couldn't take this call"));
      setCalls((p) => p.filter((c) => c._id !== call._id));
    }
  };

  const done = async (call) => {
    try {
      await resolveCall(call._id);
      toast.success(t("Table {n} attended", { n: call.tableNo }));
    } catch (err) {
      toast.error(err.response?.data?.message || t("Couldn't close this call"));
    } finally {
      mine.current.delete(call._id);
      setCalls((p) => p.filter((c) => c._id !== call._id));
    }
  };

  return { calls: live, now, mine: mine.current, onMyWay, done };
}
