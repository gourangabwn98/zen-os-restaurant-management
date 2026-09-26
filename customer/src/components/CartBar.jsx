import { useNavigate } from "react-router-dom";
import { useAppState } from "../context/AppState.jsx";
import Icon from "./ui/Icon.jsx";

/** Floating "N items added · View cart" pill above the tab bar. */
export default function CartBar() {
  const nav = useNavigate();
  const { cart } = useAppState();
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
