import { MenuSkeleton } from "./ui/Skeleton.jsx";
import Button from "./ui/Button.jsx";

export function Loader({ label = "Loading…", skeleton = false }) {
  if (skeleton) return <MenuSkeleton />;
  return (
    <div className="empty" role="status">
      <div className="spinner" />
      <p>{label}</p>
    </div>
  );
}

export function EmptyState({ icon = "🍽️", title = "Nothing here", sub, action }) {
  return (
    <div className="empty">
      <div className="big" aria-hidden="true">{icon}</div>
      <h4>{title}</h4>
      {sub && <p className="small">{sub}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message = "Something went wrong", onRetry }) {
  return (
    <div className="empty" role="alert">
      <div className="big" aria-hidden="true">📡</div>
      <h4>{message}</h4>
      <p className="small">Check your connection and try again.</p>
      {onRetry && <Button variant="ghost" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
