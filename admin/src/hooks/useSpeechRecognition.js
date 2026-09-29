// src/hooks/useSpeechRecognition.js
// Thin wrapper over the browser's Web Speech API (no dependency, nothing
// sent to our server — but note Chrome/Edge do the recognition in the
// browser vendor's cloud, so the audio goes to Google/Microsoft). Works in
// Chrome and Edge; the page must be served over HTTPS (or localhost).
// Firefox and some others have no support — `supported` is false there and
// the mic button is shown disabled with an explanation.
import { useCallback, useEffect, useRef, useState } from "react";

const Recognition = typeof window !== "undefined"
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

const ERROR_TEXT = {
  "not-allowed": "Microphone access was blocked — allow it in the browser's site settings.",
  "service-not-allowed": "Microphone access was blocked — allow it in the browser's site settings.",
  "no-speech": "Didn't hear anything — try again and speak after the beep.",
  "audio-capture": "No microphone found.",
  network: "Speech recognition needs an internet connection.",
};

/**
 * @returns {{ supported, listening, transcript, interim, error, start, stop, reset }}
 * `transcript` is the final text of the last session; `interim` the live
 * partial text while speaking.
 */
export function useSpeechRecognition({ lang = "en-IN" } = {}) {
  const rec = useRef(null);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");

  useEffect(() => () => rec.current?.abort(), []);

  const start = useCallback(() => {
    if (!Recognition) return;
    rec.current?.abort();
    const r = new Recognition();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false; // one utterance per tap — stops on a pause
    r.maxAlternatives = 1;
    let finalText = "";
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += `${t} `;
        else live += t;
      }
      setInterim(live);
      if (finalText) setTranscript(finalText.trim());
    };
    r.onerror = (e) => { if (e.error !== "aborted") setError(ERROR_TEXT[e.error] || `Speech recognition error: ${e.error}`); };
    r.onend = () => { setListening(false); setInterim(""); };
    setError(""); setTranscript(""); setInterim("");
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setError("Couldn't start the microphone — try again.");
    }
  }, [lang]);

  const stop = useCallback(() => rec.current?.stop(), []);
  const reset = useCallback(() => { setTranscript(""); setInterim(""); setError(""); }, []);

  return { supported: !!Recognition, listening, transcript, interim, error, start, stop, reset };
}
