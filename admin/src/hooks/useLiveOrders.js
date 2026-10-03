// src/hooks/useLiveOrders.js
import { useEffect, useRef } from "react";
import { getSocket } from "../services/socketService.js";

// Staff-room events from the backend (restaurant-server/sockets/socket.js).
// "order:new" = a customer just placed an order; an edited order arrives as
// "order:status_changed".
const ORDER_EVENTS = [
  "order:new", "order:confirmed", "order:status_changed", "order:cancelled", "order:payment_changed",
  "order:needs_attention", "table:cleared", "table:freed",
];

/**
 * Re-reads a screen's data when an order event arrives (bursts collapse into
 * one call) and after the socket RECONNECTS — events sent while it was down
 * are never replayed, so a reconnect catches up instead of leaving a missed
 * order off the screen. `events: false` keeps only the reconnect catch-up
 * (for a screen that already applies each event itself). Listeners are
 * removed on unmount, so remounts/reconnects never stack handlers.
 */
export function useLiveOrders(reload, { events = true, debounceMs = 300 } = {}) {
  const ref = useRef(reload);
  useEffect(() => { ref.current = reload; }, [reload]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    let timer = null;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => ref.current?.(), debounceMs); };
    let connectedOnce = socket.connected;
    const onConnect = () => { if (connectedOnce) schedule(); connectedOnce = true; };
    if (events) ORDER_EVENTS.forEach((e) => socket.on(e, schedule));
    socket.on("connect", onConnect);
    // While the socket is down, re-read every 30 s so nothing waits for a refresh.
    const poll = setInterval(() => { if (!socket.connected) ref.current?.(); }, 30000);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      if (events) ORDER_EVENTS.forEach((e) => socket.off(e, schedule));
      socket.off("connect", onConnect);
    };
  }, [events, debounceMs]);
}
