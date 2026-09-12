import { NavLink } from "react-router-dom";
import { ACCENT, GLASS_BG, GLASS_BORDER, TEXT_FAINT, NAV_HEIGHT } from "../theme.js";

const TABS = [
  { to: "/",        label: "Home",    icon: "🏠", end: true },
  { to: "/orders",  label: "Orders",  icon: "🧾" },
  { to: "/help",    label: "Help",    icon: "💬" },
  { to: "/profile", label: "Profile", icon: "👤" },
];

export default function BottomNav() {
  return (
    <nav
      className="floating-bar"
      style={{
        position: "fixed", left: 14, right: 14, bottom: 14, zIndex: 40,
        height: NAV_HEIGHT - 14, background: GLASS_BG, border: `1px solid ${GLASS_BORDER}`,
        borderRadius: 22, display: "flex", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
        marginBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          style={({ isActive }) => ({
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: 3, textDecoration: "none",
            color: isActive ? ACCENT : TEXT_FAINT, fontSize: 10, fontWeight: 700,
            textShadow: isActive ? "0 0 12px rgba(255,138,0,0.6)" : "none",
          })}
        >
          <span style={{ fontSize: 18 }}>{t.icon}</span>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
