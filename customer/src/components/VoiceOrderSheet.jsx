import { useMemo, useState } from "react";
import Sheet from "./ui/Sheet.jsx";
import Button from "./ui/Button.jsx";
import QtyStepper from "./ui/QtyStepper.jsx";
import { suggestFromTranscript } from "../utils/voiceOrder.js";

/** Review sheet for a spoken order ("2 chicken biryani and 1 cold coffee"):
 * one line per dish heard, each with its best menu match, qty and a tick.
 * Nothing reaches the cart until the customer taps Add — speech recognition
 * mishears, so every line can be corrected first (same flow as the waiter
 * and admin apps). Prices are display-only; the server re-prices the order. */
export default function VoiceOrderSheet({ transcript, menu, onAdd, onSearch, onRetry, onClose }) {
  const suggestions = useMemo(() => suggestFromTranscript(transcript, menu), [transcript, menu]);
  const [edits, setEdits] = useState({}); // key → { qty, pick, include }

  const rows = suggestions.map((s, i) => {
    const key = `${i}-${s.phrase}`;
    return {
      key, phrase: s.phrase, qty: s.qty, matches: s.matches,
      pick: s.matches[0]?.item._id || "", include: s.matches.length > 0,
      ...edits[key],
    };
  });
  const update = (key, patch) => setEdits((e) => ({ ...e, [key]: { ...e[key], ...patch } }));

  const toAdd = rows
    .filter((r) => r.include && r.pick)
    .map((r) => ({ item: r.matches.find((m) => m.item._id === r.pick)?.item, qty: r.qty }))
    .filter((x) => x.item);
  const count = toAdd.reduce((s, x) => s + x.qty, 0);
  const total = toAdd.reduce((s, x) => s + x.item.price * x.qty, 0);

  return (
    <Sheet
      onClose={onClose} label="Voice order"
      footer={
        <div className="btn-row">
          <Button variant="ghost" className="btn-sm" onClick={onRetry}>🎤 Again</Button>
          <Button disabled={!count} onClick={() => onAdd(toAdd)}>
            {count ? `Add ${count} item${count === 1 ? "" : "s"} · ₹${total}` : "Add to cart"}
          </Button>
        </div>
      }
    >
      <h3>Your voice order</h3>
      <p className="muted small" style={{ margin: "-6px 0 14px" }}>Heard: “{transcript}”</p>

      <div className="vo-list">
        {rows.map((r) => (
          <div key={r.key} className={`vo-row${r.include ? " on" : ""}`}>
            {r.matches.length ? (
              <>
                <input
                  type="checkbox" checked={r.include} aria-label={`Include ${r.phrase}`}
                  onChange={(e) => update(r.key, { include: e.target.checked })}
                />
                <select
                  value={r.pick} aria-label={`Dish for “${r.phrase}”`}
                  onChange={(e) => update(r.key, { pick: e.target.value, include: true })}
                >
                  {r.matches.map((m) => (
                    <option key={m.item._id} value={m.item._id}>{m.item.name} · ₹{m.item.price}</option>
                  ))}
                </select>
                <QtyStepper
                  qty={r.qty} label={`Quantity of ${r.phrase}`}
                  onDec={() => update(r.key, { qty: Math.max(1, r.qty - 1) })}
                  onInc={() => update(r.key, { qty: Math.min(99, r.qty + 1) })}
                />
              </>
            ) : (
              <>
                <span className="vo-miss">No dish found for “{r.phrase}”</span>
                <button type="button" className="chip" onClick={() => onSearch(r.phrase)}>Search</button>
              </>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
