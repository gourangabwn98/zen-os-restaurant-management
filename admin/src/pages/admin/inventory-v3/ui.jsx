import { useEffect, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { t } from "../../../i18n/core.js";
export function Button({ children, ghost = false, ...props }) { return <button type="button" className={`zc-btn ${ghost ? "ghost" : "pri"}`} {...props}>{children}</button>; }
export function Card({ title, aside, children, className = "" }) { return <section className={`iv3-card ${className}`}><header><h3>{t(title)}</h3>{aside}</header>{children}</section>; }
export function Empty({ children = "No records yet" }) { return <p className="iv3-empty">{t(children)}</p>; }
export function Table({ headers, children }) { return <div className="iv3-table-wrap"><table><thead><tr>{headers.map((h, i) => <th key={i}>{t(h)}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
export function Chip({ children, tone = "grey" }) { return <span className={`iv3-chip ${tone}`}>{t(children)}</span>; }
export function Field({ label, children, ...props }) { return <label className="iv3-field"><span>{t(label)}</span>{children || <input className="zc-input" {...props} />}</label>; }
export function Select({ label, value, onChange, options, required = false }) { return <Field label={label}><select className="zc-input" value={value} required={required} onChange={(e) => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select></Field>; }
export function Dialog({ title, onClose, children, busy }) {
  const ref = useRef(null), titleId = useId();
  useEffect(() => {
    const previous = document.activeElement, node = ref.current, oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node.querySelector("input,select,button,textarea")?.focus();
    const key = (e) => {
      if (e.key === "Escape" && !busy) onClose();
      if (e.key !== "Tab") return;
      const focusable = [...node.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]")];
      const first = focusable[0], last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    node.addEventListener("keydown", key);
    return () => { document.body.style.overflow = oldOverflow; node.removeEventListener("keydown", key); previous?.focus(); };
  }, [onClose, busy]);
  return createPortal(<div className="iv3 iv3-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}><section className="iv3-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}><header><h2 id={titleId}>{t(title)}</h2><button type="button" className="zc-btn ghost" aria-label="Close" disabled={busy} onClick={onClose}>×</button></header>{children}</section></div>, document.body);
}
