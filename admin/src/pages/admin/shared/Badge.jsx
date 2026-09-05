// src/pages/admin/shared/Badge.jsx
// Status pill in the Zen OS visual language: a leading dot + label, coloured by
// one of five semantic "kinds" (wait / live / ready / done / stop) plus a
// neutral violet (vio) for order-type tags.
//
// Back-compat: callers may still pass `map` (an inline {label:{bg,color}}
// lookup) and `format` (label -> display string); when `map` matches it wins,
// so screens not yet migrated render exactly as before.
import { statusKind } from "./statusKind.js";

export default function Badge({ label, type, kind, map, format, dot = true }) {
  const raw = label ?? type ?? "";
  const text = format ? format(raw) : raw;

  // legacy inline-map path — keep old screens pixel-identical
  const legacy = map && (map[raw] || map[type]);
  if (legacy) {
    return (
      <span style={{
        background: legacy.bg, color: legacy.color,
        padding: "3px 10px", borderRadius: 20, fontSize: 11,
        fontWeight: 600, whiteSpace: "nowrap",
      }}>
        {text}
      </span>
    );
  }

  const k = kind || statusKind(raw);
  return (
    <span className={`zc-tag ${k}${k === "vio" ? " sq" : ""}`}>
      {dot && k !== "vio" && <i />}
      {text}
    </span>
  );
}
