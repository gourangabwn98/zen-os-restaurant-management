// src/components/LanguageToggle.jsx
// English / বাংলা switch for the admin app (sidebar + login screen).
// Each option is written in its own language so it's findable whichever
// language is currently on.
import { useLang } from "../hooks/useLang.js";
import { t } from "../i18n/core.js";

const OPTIONS = [
  { value: "en", label: "English", short: "EN" },
  { value: "bn", label: "বাংলা", short: "বাং" },
];

export default function LanguageToggle({ compact = false, style }) {
  const { lang, setLang } = useLang();
  return (
    <div className="zc-seg" role="radiogroup" aria-label={t("Language")} style={{ width: "100%", justifyContent: "space-between", ...style }}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          lang={o.value}
          aria-checked={lang === o.value}
          className={lang === o.value ? "on" : ""}
          onClick={() => setLang(o.value)}
          style={{ flex: 1, justifyContent: "center", padding: compact ? "6px 8px" : "6px 10px" }}
        >
          {compact ? o.short : o.label}
        </button>
      ))}
    </div>
  );
}
