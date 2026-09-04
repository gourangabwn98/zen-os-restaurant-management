import { NavLink } from "react-router-dom";
import { PINK, TEXT_FAINT, BORDER, NAV_HEIGHT } from "../theme.js";

const TABS = [
  { to: "/",        label: "Home",    icon: "🏠", end: true },
  { to: "/orders",  label: "Orders",  icon: "🧾" },
  { to: "/help",    label: "Help",    icon: "💬" },
  { to: "/profile", label: "Profile", icon: "👤" },
];

export default function BottomNav() {
  return (
    <nav style={{
      position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 40,
      height: NAV_HEIGHT, background: "#fff", borderTop: `1px solid ${BORDER}`,
      display: "flex", paddingBottom: "env(safe-area-inset-bottom)",
      boxShadow: "0 -4px 16px rgba(0,0,0,0.04)",
    }}>
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          style={({ isActive }) => ({
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: 2, textDecoration: "none",
            color: isActive ? PINK : TEXT_FAINT, fontSize: 10, fontWeight: 700,
          })}
        >
          <span style={{ fontSize: 19 }}>{t.icon}</span>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
