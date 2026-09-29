import { useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { getSocket } from "../services/socketService.js";
import { playNotificationSound } from "../utils/notificationSound.js";

/** New customer order (awaiting confirmation) → toast + sound (staff room
 * broadcast from the backend), same as the admin panel. Also warns when a
 * Placed order couldn't start preparing automatically. */
export function useOrderNotifications(enabled) {
  const bound = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    if (!socket || bound.current) return;
    bound.current = true;

    const onNewOrder = (payload) => {
      playNotificationSound();
      toast(`🔔 New order ${payload?.order?.orderId || ""}${payload?.order?.tableNo ? ` · Table ${payload.order.tableNo}` : ""} — needs confirmation`, { duration: 5000 });
    };
    const onCancelled = (payload) => {
      toast(`❌ Order ${payload?.order?.orderId || ""} cancelled`);
    };

    const onNeedsAttention = (payload) => {
      playNotificationSound();
      toast.error(`⚠️ Order ${payload?.order?.orderId || ""} couldn't start preparing — ${payload?.reason || "please check it"}`, { duration: 8000 });
    };

    socket.on("order:new", onNewOrder);
    socket.on("order:cancelled", onCancelled);
    socket.on("order:needs_attention", onNeedsAttention);

    return () => {
      socket.off("order:needs_attention", onNeedsAttention);
      socket.off("order:new", onNewOrder);
      socket.off("order:cancelled", onCancelled);
      bound.current = false;
    };
  }, [enabled]);
}
