import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppState } from "../context/AppState.jsx";
import { useMyOrders } from "../hooks/useMyOrders.js";
import Sheet from "./ui/Sheet.jsx";
import WaiterCallCard from "./WaiterCallCard.jsx";

// Same rule as the order page: a waiter can be called while the order is on
// the table (restaurant-server/services/waiterCallService.js decides the rest).
const CALLABLE = ["PENDING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY", "DELIVERED"];
// Screens that already have their own call / pay controls, or no chrome.
const HIDDEN_ON = (p) => p === "/cart" || p === "/login" || p.startsWith("/order/");

/** Floating "Call waiter" (bottom-right, above the cart bar and tab bar).
 * Shown to dine-in customers. A call belongs to an order — the existing
 * WaiterCallCard runs it (who is rung, countdowns, retry, the restaurant's
 * phone as last resort); with no order yet it explains what to do. */
export default function CallWaiterFab() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const { table } = useAppState();
  const { orders, reload } = useMyOrders();
  const [open, setOpen] = useState(false);

  // A new order (placed in the cart) shows up when the customer comes back.
  // Throttled: a guest's history is one request per stored order.
  const lastLoad = useRef(null); // null = first render (useMyOrders already loads)
  useEffect(() => {
    const now = Date.now();
    if (lastLoad.current === null) { lastLoad.current = now; return; }
    if (now - lastLoad.current < 15000) return;
    lastLoad.current = now;
    reload();
  }, [pathname, reload]);

  const callable = useMemo(() => (orders || [])
    .filter((o) => o.orderType === "DINE_IN" && CALLABLE.includes(o.status))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null, [orders]);

  if (HIDDEN_ON(pathname) || (!table.isDineIn && !callable)) return null;

  return (
    <>
      <button type="button" className="waiter-fab" onClick={() => { reload(); setOpen(true); }} aria-haspopup="dialog">
        <span aria-hidden="true">🛎️</span>
        <span>Call waiter</span>
      </button>

      {open && (
        <Sheet onClose={() => setOpen(false)} label="Call waiter">
          <h3>Call waiter</h3>
          {callable ? (
            <>
              <p className="muted small" style={{ margin: "0 0 4px" }}>
                For your order #{callable.orderId}{callable.tableNo ? ` · Table ${callable.tableNo}` : ""}
              </p>
              <WaiterCallCard orderId={callable._id} reason="Need anything? A waiter will come to your table." />
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: "4px 0 14px" }}>
                Place your order first — then you can call your waiter from here, and they'll come straight to your table.
              </p>
              <button type="button" className="btn btn-primary" onClick={() => { setOpen(false); nav("/menu"); }}>Browse the menu</button>
            </>
          )}
        </Sheet>
      )}
    </>
  );
}
