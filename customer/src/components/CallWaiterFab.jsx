import { useState } from "react";
import { useLocation } from "react-router-dom";
import Modal from "./ui/Modal.jsx";
import { getCounterDeskPhone } from "../services/waiterCallService.js";

/** Customer contact control. It is deliberately independent of cart/order
 * state and calls only the configured COUNTER DESK number. */
export default function CallWaiterFab() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  if (pathname === "/login") return null;

  const openCall = async () => {
    setOpen(true);
    if (phone || loading) return;
    setLoading(true); setError("");
    try {
      const { data } = await getCounterDeskPhone();
      setPhone(String(data?.phone || ""));
      if (!data?.phone) setError("The COUNTER DESK phone number is not configured.");
    } catch (err) {
      setError(err.response?.data?.message || "The COUNTER DESK phone number is not configured.");
    } finally { setLoading(false); }
  };
  const phoneLink = phone ? `tel:${phone}` : null;

  return (
    <>
      <button type="button" className="waiter-fab" onClick={openCall} aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 17h16M6 17a6 6 0 0 1 12 0M12 9V7M10 7h4" />
        </svg>
        <span>Call waiter</span>
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} label="Call waiter">
          <h3>Call waiter</h3>
          <p className="muted" style={{ margin: "4px 0 14px" }}>
            Call the restaurant's configured COUNTER DESK. You can call before or after placing an order.
          </p>
          {loading && <p className="muted small">Loading the COUNTER DESK number…</p>}
          {error && <p className="danger small" role="alert">{error}</p>}
          {!loading && phoneLink && <a href={phoneLink} className="btn btn-primary">📞 Call COUNTER DESK</a>}
          {!loading && error && <button type="button" className="btn btn-ghost" onClick={openCall}>Try again</button>}
        </Modal>
      )}
    </>
  );
}
