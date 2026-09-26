import { useEffect, useState, useCallback } from "react";
import { useAppState } from "../context/AppState.jsx";
import { getMyOrders, getGuestOrderHistory } from "../services/orderService.js";

/** The customer's orders: GET /orders/my when logged in, otherwise the
 * guest orders this browser placed (fetched individually by stored token). */
export function useMyOrders() {
  const { auth } = useAppState();
  const [orders, setOrders] = useState(null);
  const [error, setError]   = useState(null);

  const load = useCallback(() => {
    setError(null);
    const fetcher = auth.isLoggedIn
      ? getMyOrders().then((r) => r.data)
      : getGuestOrderHistory();
    fetcher
      .then((list) => setOrders(Array.isArray(list) ? list : []))
      .catch(() => setError("Couldn't load your orders"));
  }, [auth.isLoggedIn]);

  useEffect(() => { load(); }, [load]);

  return { orders, error, reload: load };
}
