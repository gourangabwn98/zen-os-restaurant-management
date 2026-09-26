import { useAppState } from "../context/AppState.jsx";

/** Table context chip. Dine-in only ever comes from a backend-verified QR
 * scan (useTableSession) — there is deliberately no "type your table
 * number" option. ✕ drops the table and the order becomes takeaway.
 * `compact`: the header already shows the table name, so only say "Dine-in".
 * `onClear` runs after the table is cleared (e.g. Cart resets order type). */
export default function TableBadge({ onClear, compact }) {
  const { table } = useAppState();

  if (!table.isDineIn) {
    return <span className="table-chip">🛍️ {compact ? "Takeaway · scan QR" : "Takeaway · scan table QR for dine-in"}</span>;
  }
  return (
    <span className="table-chip">
      <span className="live" />{compact ? "Dine-in" : `${table.tableLabel} · Dine-in`}
      <button
        type="button" className="x"
        onClick={() => { table.clearTable(); onClear?.(); }}
        title="Not your table? Order takeaway instead"
        aria-label="Not your table? Switch to takeaway"
      >✕</button>
    </span>
  );
}
