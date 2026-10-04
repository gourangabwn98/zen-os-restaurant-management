import { useEffect, useRef } from "react";

/** Centered dialog (CUS-07). Scrim tap and Escape close it; body scroll is
 * locked while open; focus moves into the dialog and back on close. */
export default function Modal({ onClose, children, label, footer }) {
  const boxRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const prevFocus = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    boxRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      prevFocus?.focus?.();
    };
  }, []);

  return (
    <div className="modal-wrap" onClick={onClose}>
      <section
        className="modal" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={boxRef}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </section>
    </div>
  );
}
