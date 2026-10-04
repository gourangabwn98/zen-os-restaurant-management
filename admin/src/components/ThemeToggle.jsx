// src/components/ThemeToggle.jsx
// Theme control for the AdminLayout sidebar: Light · Dark only (GLB-05 —
// the Auto/System option was removed; it changed the look mid-shift).
import { useTheme } from "../hooks/useTheme.js";
import { t, N_ } from "../i18n/core.js";

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
const OPTIONS = [
  { value: "light", label: N_("Light"), icon: SUN },
  { value: "dark", label: N_("Dark"), icon: MOON },
];

export default function ThemeToggle({ compact = false }) {
  const { mode, setMode } = useTheme();

  return (
    <div
      className="zc-seg"
      role="radiogroup"
      aria-label={t("Colour theme")}
      style={{ width: "100%", justifyContent: "space-between" }}
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={mode === o.value}
          title={t(`${o.label} theme`)}
          className={mode === o.value ? "on" : ""}
          onClick={() => setMode(o.value)}
          style={{ flex: 1, justifyContent: "center", padding: compact ? "6px 8px" : "6px 10px" }}
        >
          {o.icon}
          {!compact && <span>{t(o.label)}</span>}
        </button>
      ))}
    </div>
  );
}
