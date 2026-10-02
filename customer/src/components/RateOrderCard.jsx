import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import Button from "./ui/Button.jsx";
import { getReviewState, submitReview } from "../services/reviewService.js";

const SKIP_KEY = "sohoj_review_skipped";
const skipped = (id) => { try { return (JSON.parse(localStorage.getItem(SKIP_KEY)) || []).includes(id); } catch { return false; } };
const markSkipped = (id) => {
  try {
    const list = JSON.parse(localStorage.getItem(SKIP_KEY)) || [];
    localStorage.setItem(SKIP_KEY, JSON.stringify([...list, id].slice(-50)));
  } catch { /* storage disabled */ }
};

function StarRow({ label, value, onChange }) {
  return (
    <div className="rate-row">
      <span>{label}</span>
      <span className="rate-stars" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            type="button" key={n} role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? "s" : ""}`}
            className={n <= value ? "on" : ""} onClick={() => onChange(value === n ? 0 : n)}
          >★</button>
        ))}
      </span>
    </div>
  );
}

/**
 * "How was your meal?" — shown once an order is PAID. Two star rows and quick
 * tags, comment optional, Skip always there. The server decides which chef /
 * waiter each rating belongs to (restaurant-server/services/reviewService.js).
 */
export default function RateOrderCard({ orderId }) {
  const [state, setState] = useState(null);
  const [food, setFood] = useState(0);
  const [service, setService] = useState(0);
  const [tags, setTags] = useState({ FOOD: [], SERVICE: [] });
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [hidden, setHidden] = useState(() => skipped(orderId));

  useEffect(() => {
    let off = false;
    getReviewState(orderId).then(({ data }) => { if (!off) setState(data); }).catch(() => {});
    return () => { off = true; };
  }, [orderId]);

  if (hidden || !state?.canRate) return null;
  if (state.rated || done) {
    return (
      <div className="card">
        <div className="card-title">Thank you for your rating 🙏</div>
        <p className="muted small" style={{ margin: 0 }}>It goes straight to the team who looked after you.</p>
      </div>
    );
  }

  const toggle = (kind, tag) => setTags((cur) => ({
    ...cur, [kind]: cur[kind].includes(tag) ? cur[kind].filter((x) => x !== tag) : [...cur[kind], tag],
  }));
  const kindTags = (kind, rating) => {
    if (!rating) return [];
    const set = state.tags?.[kind] || { good: [], bad: [] };
    return rating >= 4 ? set.good : rating <= 2 ? set.bad : [...set.good, ...set.bad];
  };

  const send = async () => {
    if (!food && !service) { toast.error("Tap the stars to rate"); return; }
    setBusy(true);
    try {
      await submitReview(orderId, {
        food: food ? { rating: food, tags: tags.FOOD } : null,
        service: service ? { rating: service, tags: tags.SERVICE } : null,
        comment,
      });
      setDone(true);
    } catch (err) {
      if (err.response?.status === 409) setDone(true);
      else toast.error(err.response?.data?.message || "Couldn't send your rating");
    } finally { setBusy(false); }
  };

  return (
    <div className="card rate-card">
      <div className="card-title">How was your meal?</div>
      <StarRow label={state.chefName ? `Food by ${state.chefName}` : "Food"} value={food} onChange={setFood} />
      {kindTags("FOOD", food).length > 0 && (
        <div className="chips rate-tags">
          {kindTags("FOOD", food).map((tg) => (
            <button type="button" key={tg} className="chip" aria-pressed={tags.FOOD.includes(tg)} onClick={() => toggle("FOOD", tg)}>{tg}</button>
          ))}
        </div>
      )}
      <StarRow label={state.waiterName ? `Service by ${state.waiterName}` : "Service"} value={service} onChange={setService} />
      {kindTags("SERVICE", service).length > 0 && (
        <div className="chips rate-tags">
          {kindTags("SERVICE", service).map((tg) => (
            <button type="button" key={tg} className="chip" aria-pressed={tags.SERVICE.includes(tg)} onClick={() => toggle("SERVICE", tg)}>{tg}</button>
          ))}
        </div>
      )}
      <textarea
        className="input" rows={2} maxLength={500} placeholder="Anything to add? (optional)"
        value={comment} onChange={(e) => setComment(e.target.value)} style={{ marginTop: 12, resize: "vertical" }}
      />
      <Button style={{ marginTop: 12 }} onClick={send} disabled={busy || (!food && !service)}>
        {busy ? "Sending…" : "Send rating"}
      </Button>
      <button type="button" className="link-btn rate-skip" onClick={() => { markSkipped(orderId); setHidden(true); }}>Skip</button>
    </div>
  );
}
