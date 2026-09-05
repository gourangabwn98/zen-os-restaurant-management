// src/pages/admin/shared/EmptyState.jsx
// "An empty screen is an invitation to act" — icon, one line of what goes here,
// and (optionally) the action that creates the first record.
export default function EmptyState({ icon, title = "Nothing here yet", sub, action }) {
  return (
    <div className="zc-empty">
      <div className="ic">
        {icon || (
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" />
            <path d="M9 8h6M9 12h6" />
          </svg>
        )}
      </div>
      <h4>{title}</h4>
      {sub && <p>{sub}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}
