import { NavLink, useLocation } from "react-router-dom";
import Icon from "./ui/Icon.jsx";

const TABS = [
  { to: "/",        label: "Home",    icon: "home", end: true },
  { to: "/menu",    label: "Menu",    icon: "menu" },
  { to: "/orders",  label: "Orders",  icon: "orders", center: true },
  { to: "/offers",  label: "Offers",  icon: "offers" },
  { to: "/profile", label: "Profile", icon: "profile" },
];

// /order/:id belongs to the Orders tab.
const isOrdersPath = (p) => p === "/orders" || p.startsWith("/order/");

export default function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <NavLink
          key={t.to} to={t.to} end={t.end}
          className={({ isActive }) => {
            const active = t.center ? isOrdersPath(pathname) || isActive : isActive;
            return `tab${t.center ? " center" : ""}${active ? " active" : ""}`;
          }}
        >
          {t.center ? (
            <span className="fab"><Icon name={t.icon} /><span>{t.label}</span></span>
          ) : (
            <><Icon name={t.icon} /><span>{t.label}</span></>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
