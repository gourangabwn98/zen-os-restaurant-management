import { useNavigate } from "react-router-dom";
import { useAppState } from "../context/AppState.jsx";
import Icon from "./ui/Icon.jsx";

/** Floating "N items added · View cart" pill above the tab bar. */
export default function CartBar() {
  const nav = useNavigate();
  const { cart, orderEdit } = useAppState();
  // ORD-02: while changing an order the bar leads back to "Review changes".
  if (orderEdit.active) {
    return (
      <div className="cartbar">
        <button type="button" className="cartbar-btn" onClick={() => nav("/cart")}>
          <span style={{ minWidth: 0 }}>
            <b>Changing order #{orderEdit.meta.orderNo}</b>
            <small>{cart.itemCount} item{cart.itemCount === 1 ? "" : "s"} · ₹{cart.subtotal} + taxes</small>
          </span>
          <span className="cartbar-cta">Review changes <Icon name="chevron" /></span>
        </button>
      </div>
    );
  }
  if (cart.itemCount === 0) return null;

  return (
    <div className="cartbar">
      <button type="button" className="cartbar-btn" onClick={() => nav("/cart")}>
        <span style={{ minWidth: 0 }}>
          <b>{cart.itemCount} item{cart.itemCount === 1 ? "" : "s"} added</b>
          <small>₹{cart.subtotal} + taxes</small>
        </span>
        <span className="cartbar-cta">View cart <Icon name="chevron" /></span>
      </button>
    </div>
  );
}
