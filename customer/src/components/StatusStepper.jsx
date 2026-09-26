import { STAGES, STATUS_MESSAGE } from "../utils/orderStatus.js";

/** 5-step live tracker (reference ".track"). COMPLETED shows every step
 * done; CANCELLED shows a message instead of the rail. */
export default function StatusStepper({ status, footer }) {
  if (status === "CANCELLED") {
    return <p className="muted small" style={{ marginTop: 10 }}>{STATUS_MESSAGE.CANCELLED}</p>;
  }

  const last = STAGES.length - 1;
  const found = STAGES.findIndex((s) => s.key === status);
  const idx = status === "COMPLETED" ? last : Math.max(0, found);
  const allDone = status === "COMPLETED" || status === "DELIVERED";

  return (
    <>
      <div className="track" role="list" aria-label="Order progress">
        <span className="fill" style={{ width: `${(idx / last) * 80}%` }} />
        {STAGES.map((s, i) => {
          const state = i < idx || (i === idx && allDone) ? "done" : i === idx ? "now" : "";
          return (
            <div key={s.key} className={`stp ${state}`} role="listitem" aria-current={state === "now" ? "step" : undefined}>
              <i aria-hidden="true">{s.icon}</i>{s.label}
            </div>
          );
        })}
      </div>
      <div className="eta">
        <span><b>{STATUS_MESSAGE[status]}</b></span>
        {footer && <span>{footer}</span>}
      </div>
    </>
  );
}
