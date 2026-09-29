// src/pages/admin/shared/VoiceOrder.jsx
// 🎤 next to the menu search in "New order" / "Add items": speak the order
// ("two chicken biryani and one cold coffee"), review what was understood,
// then add it. Nothing is added without the admin confirming — speech
// recognition mishears, so every line can be corrected first.
import { useEffect, useMemo, useState } from "react";
import { useSpeechRecognition } from "../../../hooks/useSpeechRecognition.js";
import { suggestFromTranscript } from "../../../utils/voiceOrder.js";

export default function VoiceOrder({ menu, onAdd, onSearch }) {
  const { supported, listening, transcript, interim, error, start, stop, reset } = useSpeechRecognition({ lang: "en-IN" });
  const [open, setOpen] = useState(false);
  // The admin's corrections (qty / picked item / include), kept per transcript
  // — a new utterance starts from fresh suggestions.
  const [edits, setEdits] = useState({ transcript: "", byKey: {} });

  const rows = useMemo(() => {
    if (!transcript) return [];
    const byKey = edits.transcript === transcript ? edits.byKey : {};
    return suggestFromTranscript(transcript, menu).map((s, i) => {
      const key = `${i}-${s.phrase}`;
      return {
        key, phrase: s.phrase, qty: s.qty, matches: s.matches,
        pick: s.matches[0]?.item._id || "", include: s.matches.length > 0,
        ...byKey[key],
      };
    });
  }, [transcript, menu, edits]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") { stop(); setOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, stop]);

  const toAdd = useMemo(() => rows
    .filter((r) => r.include && r.pick)
    .map((r) => ({ item: r.matches.find((m) => m.item._id === r.pick)?.item, qty: r.qty }))
    .filter((x) => x.item), [rows]);

  if (!supported) {
    return (
      <button type="button" className="zc-btn ghost sm" disabled
        title="Voice ordering needs Chrome or Edge (and the site opened over https)">🎤</button>
    );
  }

  const listen = () => { reset(); setOpen(true); start(); };
  const close = () => { stop(); setOpen(false); };
  const update = (key, patch) => setEdits((e) => {
    const byKey = e.transcript === transcript ? e.byKey : {};
    return { transcript, byKey: { ...byKey, [key]: { ...byKey[key], ...patch } } };
  });
  const addAll = () => {
    if (!toAdd.length) return;
    onAdd(toAdd);
    close();
  };

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button type="button" onClick={listening ? stop : listen}
        className={`zc-btn sm${listening ? " danger" : ""}`}
        aria-pressed={listening}
        aria-label={listening ? "Stop listening" : "Speak the order"}
        title={listening ? "Stop listening" : "Speak the order — e.g. “2 chicken biryani and 1 cold coffee”"}
        style={{ minWidth: 38, justifyContent: "center", ...(listening ? { boxShadow: "0 0 0 4px var(--stop-fill)" } : null) }}>
        {listening ? "■" : "🎤"}
      </button>

      {open && (
        <div role="dialog" aria-label="Voice order" style={{
          position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 1300, width: 420, maxWidth: "88vw",
          background: "var(--surface)", border: "1px solid var(--edge-hi)", borderRadius: 14,
          boxShadow: "var(--shadow-pop)", padding: 14,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <b style={{ fontSize: 13, color: "var(--text-1)", flex: 1 }}>🎤 Voice order</b>
            <button type="button" className="zc-x" onClick={close} aria-label="Close">✕</button>
          </div>

          {listening && (
            <div aria-live="polite" style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 8 }}>
              <span style={{ color: "var(--stop-ink)", fontWeight: 700 }}>● Listening…</span>{" "}
              {interim || transcript || "say e.g. “2 chicken biryani and 1 cold coffee”"}
            </div>
          )}
          {error && <div role="alert" style={{ fontSize: 12, color: "var(--stop-ink)", marginBottom: 8 }}>{error}</div>}

          {!listening && transcript && (
            <div style={{ fontSize: 11.5, color: "var(--text-3)", marginBottom: 10 }}>Heard: “{transcript}”</div>
          )}

          {!listening && rows.length > 0 && (
            <div style={{ display: "grid", gap: 8, maxHeight: 300, overflowY: "auto" }}>
              {rows.map((r) => (
                <div key={r.key} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10,
                  border: "1px solid var(--edge)", background: r.include ? "var(--violet-faint)" : "var(--card-2)",
                }}>
                  {r.matches.length ? (
                    <>
                      <input type="checkbox" checked={r.include} aria-label={`Include ${r.phrase}`}
                        onChange={(e) => update(r.key, { include: e.target.checked })} />
                      <button type="button" className="zc-btn sm" aria-label="Less" disabled={r.qty <= 1}
                        onClick={() => update(r.key, { qty: r.qty - 1 })}>−</button>
                      <span className="tnum" style={{ minWidth: 18, textAlign: "center", fontWeight: 700 }}>{r.qty}</span>
                      <button type="button" className="zc-btn sm" aria-label="More" disabled={r.qty >= 99}
                        onClick={() => update(r.key, { qty: r.qty + 1 })}>＋</button>
                      <select className="zc-select" value={r.pick} aria-label={`Menu item for “${r.phrase}”`}
                        onChange={(e) => update(r.key, { pick: e.target.value, include: true })}
                        style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                        {r.matches.map((m) => (
                          <option key={m.item._id} value={m.item._id}>{m.item.name} · ₹{m.item.price}</option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--text-2)" }}>
                        No menu match for “{r.phrase}”
                      </span>
                      <button type="button" className="zc-btn ghost sm" onClick={() => { onSearch(r.phrase); close(); }}>Search</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {!listening && transcript && rows.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>Couldn&rsquo;t pick out any items — try again.</div>
          )}

          {!listening && (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" className="zc-btn" onClick={listen}>🎤 Speak again</button>
              <button type="button" className="zc-btn pri" style={{ flex: 1, justifyContent: "center" }}
                disabled={!toAdd.length} onClick={addAll}>
                Add {toAdd.reduce((s, x) => s + x.qty, 0) || ""} item{toAdd.reduce((s, x) => s + x.qty, 0) === 1 ? "" : "s"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
