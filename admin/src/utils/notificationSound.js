// src/utils/notificationSound.js
// Generates a short two-tone chime with the Web Audio API — no binary audio
// asset to ship/host, and it works the instant this module is imported.
let ctx = null;

const getCtx = () => {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
  }
  return ctx;
};

const tone = (audioCtx, freq, startTime, duration) => {
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.28, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
};

/** Plays a short "new order" chime. Browsers require a prior user gesture
 * before audio can play — safe to call anytime; it just no-ops if blocked. */
export const playNotificationSound = () => {
  try {
    const audioCtx = getCtx();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") audioCtx.resume();
    const now = audioCtx.currentTime;
    tone(audioCtx, 880, now, 0.18);
    tone(audioCtx, 1180, now + 0.16, 0.22);
  } catch {
    /* audio isn't critical — never let it break the app */
  }
};
