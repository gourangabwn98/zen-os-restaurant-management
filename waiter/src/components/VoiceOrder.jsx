// src/components/VoiceOrder.jsx
// 🎤 next to the menu search in New Order: speak the order ("two chicken
// biryani and one cold coffee"), review what was understood, then add it to
// the cart. Nothing is added without the waiter confirming — speech
// recognition mishears, so every line can be corrected first. Mirrors the
// admin app's VoiceOrder, restyled for this app's bottom-sheet layout.
import { useEffect, useMemo, useState } from "react";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition.js";
import { suggestFromTranscript } from "../utils/voiceOrder.js";
import PrimaryButton from "./ui/PrimaryButton.jsx";
import QtyStepper from "./ui/QtyStepper.jsx";
import {
  ACCENT, ACCENT_SOFT, GLASS_BG, GLASS_BORDER, TEXT_MUTED, TEXT_FAINT, RED, NAV_HEIGHT,
} from "../theme.js";

export default function VoiceOrder({ menu, onAdd, onSearch }) {
  const { supported, listening, transcript, interim, error, start, stop, reset } = useSpeechRecognition({ lang: "en-IN" });
  const [open, setOpen] = useState(false);
  // The waiter's corrections (qty / picked item / include), kept per
  // transcript — a new utterance starts from fresh suggestions.
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

  const toAdd = useMemo(() => rows
    .filter((r) => r.include && r.pick)
    .map((r) => ({ item: r.matches.find((m) => m.item._id === r.pick)?.item, qty: r.qty }))
    .filter((x) => x.item), [rows]);
  const addCount = toAdd.reduce((s, x) => s + x.qty, 0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") { stop(); setOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, stop]);

  // Unsupported browser (Firefox, or the app not opened over https): no mic.
  if (!supported) return null;

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
    <>
      <button
        type="button" onClick={listening ? stop : listen}
        aria-pressed={listening}
        aria-label={listening ? "Stop listening" : "Speak the order"}
        title="Speak the order — e.g. “2 chicken biryani and 1 cold coffee”"
        style={{
          flexShrink: 0, width: 44, height: 44, borderRadius: 14, cursor: "pointer", fontSize: 18,
          border: `1px solid ${listening ? "rgba(248,113,113,0.6)" : GLASS_BORDER}`,
          background: listening ? "rgba(248,113,113,0.16)" : GLASS_BG, color: "#fff",
        }}
      >
        {listening ? "■" : "🎤"}
      </button>

      {open && (
        <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.55)" }}>
          <div
            role="dialog" aria-label="Voice order" onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute", left: 10, right: 10, bottom: NAV_HEIGHT + 8, maxHeight: "70vh", overflowY: "auto",
              background: "rgba(16,14,26,0.97)", backdropFilter: "blur(20px)", border: `1px solid ${GLASS_BORDER}`,
              borderRadius: 20, padding: 16, boxShadow: "0 16px 40px rgba(0,0,0,0.55)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
              <b style={{ flex: 1, fontSize: 15, color: "#fff" }}>🎤 Voice order</b>
              <button type="button" onClick={close} aria-label="Close" style={{
                border: "none", background: "none", color: TEXT_MUTED, fontSize: 18, cursor: "pointer",
              }}>✕</button>
            </div>

            {listening && (
              <div aria-live="polite" style={{ fontSize: 13.5, color: TEXT_MUTED, marginBottom: 10 }}>
                <span style={{ color: RED, fontWeight: 800 }}>● Listening…</span>{" "}
                {interim || transcript || "say e.g. “2 chicken biryani and 1 cold coffee”"}
              </div>
            )}
            {error && <div role="alert" style={{ fontSize: 12.5, color: RED, marginBottom: 10 }}>{error}</div>}

            {!listening && transcript && (
              <div style={{ fontSize: 12, color: TEXT_FAINT, marginBottom: 10 }}>Heard: “{transcript}”</div>
            )}

            {!listening && rows.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {rows.map((r) => (
                  <div key={r.key} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "10px", borderRadius: 14,
                    border: `1px solid ${r.include ? "rgba(59,130,246,0.45)" : GLASS_BORDER}`,
                    background: r.include ? ACCENT_SOFT : GLASS_BG,
                  }}>
                    {r.matches.length ? (
                      <>
                        <input type="checkbox" checked={r.include} aria-label={`Include ${r.phrase}`}
                          onChange={(e) => update(r.key, { include: e.target.checked })}
                          style={{ width: 18, height: 18, accentColor: ACCENT, flexShrink: 0 }} />
                        <select value={r.pick} aria-label={`Menu item for “${r.phrase}”`}
                          onChange={(e) => update(r.key, { pick: e.target.value, include: true })}
                          style={{
                            flex: 1, minWidth: 0, padding: "8px 6px", borderRadius: 10, fontSize: 13,
                            border: `1px solid ${GLASS_BORDER}`, background: GLASS_BG, color: "#fff",
                          }}>
                          {r.matches.map((m) => (
                            <option key={m.item._id} value={m.item._id} style={{ color: "#111" }}>
                              {m.item.name} · ₹{m.item.price}
                            </option>
                          ))}
                        </select>
                        <QtyStepper qty={r.qty} size="sm"
                          onDec={() => update(r.key, { qty: Math.max(1, r.qty - 1) })}
                          onInc={() => update(r.key, { qty: Math.min(99, r.qty + 1) })} />
                      </>
                    ) : (
                      <>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: TEXT_MUTED }}>
                          No menu match for “{r.phrase}”
                        </span>
                        <button type="button" onClick={() => { onSearch(r.phrase); close(); }} style={{
                          border: `1px solid ${GLASS_BORDER}`, background: GLASS_BG, color: ACCENT,
                          borderRadius: 10, padding: "7px 12px", fontWeight: 700, fontSize: 12.5, cursor: "pointer",
                        }}>Search</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!listening && transcript && rows.length === 0 && (
              <div style={{ fontSize: 13, color: TEXT_MUTED }}>Couldn&rsquo;t pick out any items — try again.</div>
            )}

            {!listening && (
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <PrimaryButton variant="outline" onClick={listen} style={{ padding: "12px 14px" }}>🎤 Again</PrimaryButton>
                <PrimaryButton onClick={addAll} disabled={!addCount} style={{ flex: 1, padding: "12px 14px" }}>
                  Add {addCount || ""} item{addCount === 1 ? "" : "s"}
                </PrimaryButton>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
