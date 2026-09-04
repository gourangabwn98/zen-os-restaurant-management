// src/utils/kitchenAlertSound.js
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated new-order alert tone for the Kitchen Display (KDS) — deliberately
// separate from utils/notificationSound.js (the generic admin bell chime),
// because this one needs to cut through a loud kitchen and be instantly,
// unambiguously "a new ticket just came in", not just "something happened".
//
// Pure Web Audio API oscillators — no bundled audio file, no new npm
// dependency, nothing to fetch over the network.
//
//   playNewOrderAlert()      → Ding → Ding → DING!   (~1.1s)
//   playUrgentOrderAlert()   → DING-DING-DING, pause, DING   (~1.4s)
//
// Browsers block audio until the page has seen a user gesture. We surface
// that via isAudioUnlocked()/unlockAudio() so the UI can show an
// "Enable Kitchen Sound" prompt exactly when needed, per the spec.
// ─────────────────────────────────────────────────────────────────────────────

let ctx = null;

const getCtx = () => {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
  }
  return ctx;
};

/** True once the AudioContext is actually able to produce sound. */
export const isAudioUnlocked = () => {
  const c = getCtx();
  return !!c && c.state === "running";
};

/** Call this from a click/tap handler to satisfy the browser's autoplay
 * gesture requirement. Safe to call repeatedly. */
export const unlockAudio = async () => {
  const c = getCtx();
  if (!c) return false;
  if (c.state === "suspended") {
    try { await c.resume(); } catch { /* still locked — caller can retry */ }
  }
  return c.state === "running";
};

// A single "ding": a short sine-wave bell-like tone with a quick attack and
// exponential decay (what makes it read as a "ding" rather than a flat beep).
const ding = (audioCtx, destination, { start, freq, duration, gain = 0.5 }) => {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(g).connect(destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
};

const buildChain = (audioCtx) => {
  // A touch of compression keeps the tone loud and consistent even on
  // small tablet speakers, without clipping — important for "loud enough
  // to hear over a busy kitchen" without sounding harsh.
  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.knee.value = 6;
  compressor.ratio.value = 8;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;
  compressor.connect(audioCtx.destination);
  return compressor;
};

/**
 * Ding → Ding → DING!  (~1.1s total)
 * Two quick, equal-pitch dings followed by a louder, higher, longer final
 * hit — an unmistakable "something new just arrived" pattern, short enough
 * to never feel like an alarm.
 */
export const playNewOrderAlert = () => {
  try {
    const audioCtx = getCtx();
    if (!audioCtx || audioCtx.state !== "running") return false;
    const out = buildChain(audioCtx);
    const t0 = audioCtx.currentTime;

    ding(audioCtx, out, { start: t0,        freq: 880,  duration: 0.22, gain: 0.55 });
    ding(audioCtx, out, { start: t0 + 0.28, freq: 880,  duration: 0.22, gain: 0.55 });
    ding(audioCtx, out, { start: t0 + 0.62, freq: 1175, duration: 0.42, gain: 0.75 });
    return true;
  } catch {
    return false; // sound is never allowed to break the KDS
  }
};

/**
 * DING-DING-DING → short pause → DING   (~1.4s total)
 * A faster, denser triple-hit opener (higher pitch, tighter spacing) makes
 * this read as "more urgent than usual" without becoming a continuous
 * alarm — it still ends and stays short.
 */
export const playUrgentOrderAlert = () => {
  try {
    const audioCtx = getCtx();
    if (!audioCtx || audioCtx.state !== "running") return false;
    const out = buildChain(audioCtx);
    const t0 = audioCtx.currentTime;

    ding(audioCtx, out, { start: t0,        freq: 1046, duration: 0.16, gain: 0.7 });
    ding(audioCtx, out, { start: t0 + 0.17, freq: 1046, duration: 0.16, gain: 0.7 });
    ding(audioCtx, out, { start: t0 + 0.34, freq: 1046, duration: 0.16, gain: 0.7 });
    // short pause, then one final, longer, higher hit
    ding(audioCtx, out, { start: t0 + 0.85, freq: 1318, duration: 0.5,  gain: 0.85 });
    return true;
  } catch {
    return false;
  }
};
