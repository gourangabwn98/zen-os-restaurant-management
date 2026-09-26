import { Link } from "react-router-dom";
import { useAppState } from "../context/AppState.jsx";
import { useRestaurantProfile } from "../hooks/useRestaurantProfile.js";
import Icon from "./ui/Icon.jsx";
import TableBadge from "./TableBadge.jsx";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

/** Sticky app header: help/options, greeting + table context, favorites, cart. */
export default function Topbar() {
  const { auth, table, cart, favorites } = useAppState();
  const profile = useRestaurantProfile();
  const first = (auth.user?.name || "").split(" ")[0];

  return (
    <header className="topbar">
      <Link to="/help" className="icon-btn" aria-label="Help and support">
        <Icon name="bars" />
      </Link>

      <div className="hello">
        <small>Hi{first ? `, ${first}` : ""}! {greeting()} 👋</small>
        <h1>{table.isDineIn ? table.tableLabel : (profile?.restaurantName || "Fresh. Hot.")}</h1>
        <TableBadge compact />
      </div>

      <Link
        to="/favorites" className={`icon-btn${favorites.count > 0 ? " on" : ""}`}
        aria-label={`Favorites${favorites.count ? ` (${favorites.count})` : ""}`}
      >
        <Icon name="heart" />
      </Link>
      <Link to="/cart" className="icon-btn" aria-label={`Cart, ${cart.itemCount} item${cart.itemCount === 1 ? "" : "s"}`}>
        <Icon name="bag" />
        {cart.itemCount > 0 && <span className="count">{cart.itemCount}</span>}
      </Link>
    </header>
  );
}
