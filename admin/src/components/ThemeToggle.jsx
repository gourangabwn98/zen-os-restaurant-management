// src/components/ThemeToggle.jsx
// 3-way theme control for the AdminLayout sidebar footer.
// Light · Dark · Auto (follow OS). "Auto" must stay reachable so a user who
// once picked light/dark can go back to OS-following.
import { useTheme } from "../hooks/useTheme.js";

const SUN = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4" />
  </svg>
);
const MOON = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);
const AUTO = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

const OPTIONS = [
  { value: "light", label: "Light", icon: SUN },
  { value: "dark", label: "Dark", icon: MOON },
  { value: "system", label: "Auto", icon: AUTO },
];

export default function ThemeToggle({ compact = false }) {
  const { mode, setMode } = useTheme();

  return (
    <div
      className="zc-seg"
      role="radiogroup"
      aria-label="Colour theme"
      style={{ width: "100%", justifyContent: "space-between" }}
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={mode === o.value}
          title={o.value === "system" ? "Follow device setting" : `${o.label} theme`}
          className={mode === o.value ? "on" : ""}
          onClick={() => setMode(o.value)}
          style={{ flex: 1, justifyContent: "center", padding: compact ? "6px 8px" : "6px 10px" }}
        >
          {o.icon}
          {!compact && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}
