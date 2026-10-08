import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppState } from "../context/AppState.jsx";
import { useMyOrders } from "../hooks/useMyOrders.js";
import Modal from "./ui/Modal.jsx";
import WaiterCallCard from "./WaiterCallCard.jsx";

// Same rule as the server: a waiter can be called while the order is on the
// table (restaurant-server/services/waiterCallService.js decides the rest).
const CALLABLE = ["PENDING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY", "DELIVERED"];
// Screens with no chrome, or their own pay/checkout flow.
const HIDDEN_ON = (p) => p === "/cart" || p === "/login";

/** CUS-06 / CUS-07 — the ONE Call waiter control: same floating button, same
 * place, size and icon on every screen (the order page included, where it is
 * bound to that order), opening a centered dialog. A call belongs to an order
 * — WaiterCallCard runs it (who is rung, countdowns, retry, the restaurant's
 * phone as last resort); with no order yet the dialog explains what to do. */
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

  // On an order's page, call for THAT order; elsewhere, the latest live one.
  const pageOrderId = pathname.startsWith("/order/") ? pathname.slice("/order/".length) : null;
  const callable = useMemo(() => {
    const live = (orders || []).filter((o) => o.orderType === "DINE_IN" && CALLABLE.includes(o.status));
    if (pageOrderId) return live.find((o) => String(o._id) === pageOrderId) || null;
    return live.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  }, [orders, pageOrderId]);

  if (HIDDEN_ON(pathname)) return null;
  if (pageOrderId ? !callable : (!table.isDineIn && !callable)) return null;

  return (
    <>
      <button type="button" className="waiter-fab" onClick={() => { reload(); setOpen(true); }} aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 17h16M6 17a6 6 0 0 1 12 0M12 9V7M10 7h4" />
        </svg>
        <span>Call waiter</span>
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} label="Call waiter">
          <h3>Call waiter</h3>
          {callable ? (
            <>
              <p className="muted small" style={{ margin: "0 0 4px" }}>
                For your order #{callable.orderId}{callable.tableNo ? ` · ${callable.tableName || `Table ${callable.tableNo}`}` : ""}
              </p>
              <WaiterCallCard
                orderId={callable._id}
                reason={callable.status === "DELIVERED"
                  ? "Ready to pay, or need anything? A waiter will come to your table."
                  : "Need anything? A waiter will come to your table."}
              />
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: "4px 0 14px" }}>
                Place your order first — then you can call your waiter from here, and they'll come straight to your table.
              </p>
              <button type="button" className="btn btn-primary" onClick={() => { setOpen(false); nav("/menu"); }}>Browse the menu</button>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
