import { useEffect, useRef } from "react";
import { getSocket } from "../services/socketService.js";

// Staff-room order events from the backend (sockets/socket.js) — the same
// ones the admin panel uses. "order:new" = a customer just placed an order;
// an edited order arrives as "order:status_changed".
const ORDER_EVENTS = [
  "order:new", "order:confirmed", "order:status_changed", "order:cancelled", "order:payment_changed",
  "order:needs_attention", "table:cleared", "table:freed",
];

/**
 * Keeps a screen live: calls `reload` when any order event arrives AND after
 * the socket reconnects (events sent while it was down are never replayed, so
 * a reconnect re-reads instead of leaving a missed order off the screen).
 * Bursts collapse into one reload; listeners are removed on unmount, so a
 * remount or reconnect can never stack duplicate handlers.
 */
export function useLiveOrders(reload, { debounceMs = 300 } = {}) {
  const ref = useRef(reload);
  useEffect(() => { ref.current = reload; }, [reload]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    let timer = null;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => ref.current?.(), debounceMs); };
    let connectedOnce = socket.connected;
    const onConnect = () => { if (connectedOnce) schedule(); connectedOnce = true; };
    ORDER_EVENTS.forEach((e) => socket.on(e, schedule));
    socket.on("connect", onConnect);
    return () => {
      clearTimeout(timer);
      ORDER_EVENTS.forEach((e) => socket.off(e, schedule));
      socket.off("connect", onConnect);
    };
  }, [debounceMs]);
}
