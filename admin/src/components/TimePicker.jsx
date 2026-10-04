// src/components/TimePicker.jsx — GLB-07: one time picker for every admin
// screen. The native <input type="time"> looks and behaves differently per
// browser and OS (24h on one device, 12h with a spinner on another, an empty
// box on some phones), so every time field uses this instead: hour · minute ·
// AM/PM, the same everywhere, in the restaurant's 12-hour habit.
//
// Value in/out is always "HH:MM" (24h) — the format every API already takes —
// or "" when `allowEmpty` and nothing is picked.
import { t, fmtNum } from "../i18n/core.js";

const parse = (v) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v || ""));
  if (!m) return null;
  const h24 = Number(m[1]);
  return { h12: h24 % 12 || 12, min: Number(m[2]), pm: h24 >= 12 };
};
const build = ({ h12, min, pm }) => {
  const h24 = (h12 % 12) + (pm ? 12 : 0);
  return `${String(h24).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
};
const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const pad2 = (n) => fmtNum(n, { minimumIntegerDigits: 2 });

export default function TimePicker({ value, onChange, id, ariaLabel, allowEmpty = false, disabled = false, step = 5, style }) {
  const cur = parse(value);
  // Every `step` minutes, plus the current minute when it isn't on the grid
  // (an existing 10:07 stays 10:07 instead of being silently rounded).
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  if (cur && !minutes.includes(cur.min)) minutes.push(cur.min);
  minutes.sort((a, b) => a - b);

  const base = cur || { h12: 12, min: 0, pm: false };
  const set = (patch) => onChange(build({ ...base, ...patch }));
  const label = ariaLabel || t("Time");

  return (
    <span role="group" aria-label={label} id={id}
      style={{ display: "inline-flex", gap: 4, alignItems: "center", ...style }}>
      <select className="zc-select" aria-label={`${label} · ${t("hour")}`} disabled={disabled}
        value={cur ? cur.h12 : ""} onChange={(e) => (e.target.value === "" ? onChange("") : set({ h12: Number(e.target.value) }))}
        style={{ width: "auto", minWidth: 58 }}>
        {(allowEmpty || !cur) && <option value="">--</option>}
        {HOURS.map((h) => <option key={h} value={h}>{fmtNum(h)}</option>)}
      </select>
      <span aria-hidden="true" style={{ color: "var(--text-3)" }}>:</span>
      <select className="zc-select" aria-label={`${label} · ${t("minute")}`} disabled={disabled}
        value={cur ? cur.min : ""} onChange={(e) => set({ min: Number(e.target.value) })}
        style={{ width: "auto", minWidth: 58 }}>
        {!cur && <option value="">--</option>}
        {minutes.map((m) => <option key={m} value={m}>{pad2(m)}</option>)}
      </select>
      <select className="zc-select" aria-label={`${label} · ${t("AM / PM")}`} disabled={disabled}
        value={cur ? (cur.pm ? "PM" : "AM") : ""} onChange={(e) => set({ pm: e.target.value === "PM" })}
        style={{ width: "auto", minWidth: 62 }}>
        {!cur && <option value="">--</option>}
        <option value="AM">{t("AM")}</option>
        <option value="PM">{t("PM")}</option>
      </select>
    </span>
  );
}
