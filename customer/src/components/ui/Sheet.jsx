import { useEffect, useRef } from "react";

/** Bottom sheet (reference ".sheet"): scrim tap, Escape and a downward
 * swipe from the top of the content all close it; body scroll is locked
 * while it's open. `footer` stays pinned under the scrollable body. */
export default function Sheet({ onClose, children, footer, label }) {
  const bodyRef = useRef(null);
  const startY = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const onTouchStart = (e) => {
    startY.current = (bodyRef.current?.scrollTop || 0) <= 0 ? e.touches[0].clientY : null;
  };
  const onTouchEnd = (e) => {
    if (startY.current != null && e.changedTouches[0].clientY - startY.current > 90) onClose();
    startY.current = null;
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section
        className="sheet" role="dialog" aria-modal="true" aria-label={label}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-body" ref={bodyRef}>{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </section>
    </>
  );
}
