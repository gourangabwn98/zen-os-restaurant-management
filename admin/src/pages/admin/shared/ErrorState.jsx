// src/pages/admin/shared/ErrorState.jsx
// "An error says what to do next rather than apologising." Pair with a retry.
export default function ErrorState({
  title = "Could not load this",
  sub = "The server did not respond. Check your connection, then try again.",
  onRetry,
  retryLabel = "Try again",
}) {
  return (
    <div className="zc-empty">
      <div className="ic err">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l9 17H3z" />
          <path d="M12 10v4M12 17v.01" />
        </svg>
      </div>
      <h4>{title}</h4>
      {sub && <p>{sub}</p>}
      {onRetry && (
        <div style={{ marginTop: 16 }}>
          <button type="button" className="zc-btn" onClick={onRetry}>{retryLabel}</button>
        </div>
      )}
    </div>
  );
}
