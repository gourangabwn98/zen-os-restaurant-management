import { NavLink, useLocation } from "react-router-dom";
import Icon from "./ui/Icon.jsx";

// CUS-05 — four tabs, ONE active style for all of them (no special centre
// button). Offers live on Home now (CUS-03); /offers is still linked from there.
const TABS = [
  { to: "/",        label: "Home",    icon: "home", end: true },
  { to: "/menu",    label: "Menu",    icon: "menu" },
  { to: "/orders",  label: "Orders",  icon: "orders", match: (p) => p === "/orders" || p.startsWith("/order/") },
  { to: "/profile", label: "Profile", icon: "profile" },
];

export default function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <NavLink
          key={t.to} to={t.to} end={t.end}
          className={({ isActive }) => `tab${(t.match ? t.match(pathname) : isActive) ? " active" : ""}`}
        >
          <span className="tab-pill"><Icon name={t.icon} /></span>
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
