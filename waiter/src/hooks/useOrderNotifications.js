import { useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { getSocket } from "../services/socketService.js";
import { playNotificationSound } from "../utils/notificationSound.js";

/** New customer order → PENDING_CONFIRMATION → this waiter gets a toast +
 * sound (staff room broadcast from the backend), same as the admin panel. */
export function useOrderNotifications(enabled) {
  const bound = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    if (!socket || bound.current) return;
    bound.current = true;

    const onNewOrder = (payload) => {
      playNotificationSound();
      toast(`🔔 New order ${payload?.order?.orderId || ""} — needs confirmation`, { duration: 5000 });
    };
    const onCancelled = (payload) => {
      toast(`❌ Order ${payload?.order?.orderId || ""} cancelled`);
    };

    socket.on("order:new", onNewOrder);
    socket.on("order:cancelled", onCancelled);

    return () => {
      socket.off("order:new", onNewOrder);
      socket.off("order:cancelled", onCancelled);
      bound.current = false;
    };
  }, [enabled]);
}
