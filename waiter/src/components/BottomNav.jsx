import { NavLink, useNavigate } from "react-router-dom";
import { ACCENT, ACCENT_GRADIENT, ACCENT_SOFT, GLASS_BG, GLASS_BORDER, TEXT_FAINT, NAV_HEIGHT, EASE_SNAP } from "../theme.js";

// Minimal line icons (stroke="currentColor") instead of emoji — emoji render
// inconsistently across OS/fonts and read as "default app", not the premium
// custom feel the rest of this theme goes for.
const TablesIcon = ({ size = 19 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="7" height="7" rx="1.5" /><rect x="14" y="4" width="7" height="7" rx="1.5" />
    <rect x="3" y="13" width="7" height="7" rx="1.5" /><rect x="14" y="13" width="7" height="7" rx="1.5" />
  </svg>
);
const OrdersIcon = ({ size = 19 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" />
    <path d="M9 8h6M9 12h6" />
  </svg>
);
const ProfileIcon = ({ size = 19 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="3.5" /><path d="M4.5 20c1.4-3.7 4.3-5.5 7.5-5.5s6.1 1.8 7.5 5.5" />
  </svg>
);
const ActivityIcon = ({ size = 19 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20V10M12 20V4M20 20v-6" />
  </svg>
);

const TABS = [
  { to: "/tables",   label: "Tables",   Icon: TablesIcon, end: true },
  { to: "/orders",   label: "Orders",   Icon: OrdersIcon },
  { to: "/profile",  label: "Profile",  Icon: ProfileIcon },
  { to: "/activity", label: "Activity", Icon: ActivityIcon },
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
            className="pressable"
            style={({ isActive }) => ({
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", gap: 4, textDecoration: "none",
              color: isActive ? ACCENT : TEXT_FAINT, fontSize: 10, fontWeight: 700,
              transition: `color .18s ${EASE_SNAP}`,
            })}
          >
            {({ isActive }) => (
              <>
                <span style={{
                  width: 34, height: 26, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
                  background: isActive ? ACCENT_SOFT : "transparent",
                  boxShadow: isActive ? "0 0 14px rgba(59,130,246,0.35)" : "none",
                  transition: `all .18s ${EASE_SNAP}`,
                }}>
                  <t.Icon />
                </span>
                {t.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
