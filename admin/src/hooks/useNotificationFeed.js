// src/hooks/useNotificationFeed.js — NTF-02 / NTF-03
// One subscription to the staff socket for every alert the POS shows; feeds
// both the toast (same look everywhere) and the notification panel. Mounted
// once, in AdminLayout — never per page, so no duplicate listeners/toasts.
import { useCallback, useEffect, useState } from "react";
import { getSocket } from "../services/socketService.js";
import { playNotificationSound } from "../utils/notificationSound.js";
import { EVENTS, describe, slim, loadFeed, saveFeed, addEntry, unreadCount } from "../notifications/model.js";

export function useNotificationFeed({ enabled, onToast }) {
  const [feed, setFeed] = useState(loadFeed);
  useEffect(() => { saveFeed(feed); }, [feed]);

  useEffect(() => {
    if (!enabled) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;
    const handlers = {};
    for (const event of EVENTS) {
      handlers[event] = (payload) => {
        const d = describe(event, payload || {});
        if (!d) return;
        const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: Date.now(), data: slim(event, payload || {}) };
        setFeed((f) => addEntry(f, entry));
        if (d.sound) playNotificationSound();
        if (d.toast) onToast?.(d);
      };
      socket.on(event, handlers[event]);
    }
    return () => { for (const event of EVENTS) socket.off(event, handlers[event]); };
  }, [enabled, onToast]);

  const markAllRead = useCallback(() => setFeed((f) => ({ ...f, seenAt: Date.now() })), []);
  const clear = useCallback(() => setFeed({ items: [], seenAt: Date.now() }), []);
  return { items: feed.items, seenAt: feed.seenAt, unread: unreadCount(feed), markAllRead, clear };
}
