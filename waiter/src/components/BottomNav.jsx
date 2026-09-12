import { NavLink, useNavigate } from "react-router-dom";
import { ACCENT, ACCENT_GRADIENT, GLASS_BG, GLASS_BORDER, TEXT_FAINT, NAV_HEIGHT } from "../theme.js";

const TABS = [
  { to: "/tables",  label: "Tables",  icon: "🍽️", end: true },
  { to: "/orders",  label: "Orders",  icon: "🧾" },
  { to: "/profile", label: "Profile", icon: "👤" },
];

export default function BottomNav() {
  const nav = useNavigate();
  return (
    <>
      {/* Positioning wrapper centers to the same content column as the rest
          of the app on wide screens (position:fixed ignores app-shell's
          max-width, so without this the button would drift to the far
          right edge of the browser on desktop) — the button itself is
          absolutely placed at the wrapper's right edge. */}
      <div className="floating-bar" style={{
        position: "fixed", left: 14, right: 14, bottom: NAV_HEIGHT + 20, zIndex: 45, pointerEvents: "none",
      }}>
        <button
          onClick={() => nav("/new-order")}
          style={{
            position: "absolute", right: 0, bottom: 0, pointerEvents: "auto",
            width: 58, height: 58, borderRadius: "50%", border: "none",
            background: ACCENT_GRADIENT, color: "#fff", fontSize: 27, fontWeight: 700, cursor: "pointer",
            boxShadow: "0 10px 26px rgba(59,130,246,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
            animation: "pulseGlow 2.4s ease-in-out infinite",
          }}
          aria-label="New order"
          title="New order"
        >
          +
        </button>
      </div>
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
              textShadow: isActive ? "0 0 12px rgba(59,130,246,0.6)" : "none",
            })}
          >
            <span style={{ fontSize: 18 }}>{t.icon}</span>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
