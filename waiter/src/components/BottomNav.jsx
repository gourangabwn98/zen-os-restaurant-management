import { NavLink, useNavigate } from "react-router-dom";
import { BLUE, TEXT_FAINT, BORDER, NAV_HEIGHT } from "../theme.js";

const TABS = [
  { to: "/tables",  label: "Tables",  icon: "🍽️", end: true },
  { to: "/orders",  label: "Orders",  icon: "🧾" },
  { to: "/profile", label: "Profile", icon: "👤" },
];

export default function BottomNav() {
  const nav = useNavigate();
  return (
    <>
      <button
        onClick={() => nav("/new-order")}
        style={{
          position: "fixed", right: 18, bottom: NAV_HEIGHT + 16, zIndex: 45,
          width: 56, height: 56, borderRadius: "50%", border: "none",
          background: BLUE, color: "#fff", fontSize: 26, fontWeight: 700, cursor: "pointer",
          boxShadow: "0 8px 20px rgba(37,99,235,0.4)", display: "flex", alignItems: "center", justifyContent: "center",
        }}
        title="New order"
      >
        +
      </button>
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
              color: isActive ? BLUE : TEXT_FAINT, fontSize: 10, fontWeight: 700,
            })}
          >
            <span style={{ fontSize: 19 }}>{t.icon}</span>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
