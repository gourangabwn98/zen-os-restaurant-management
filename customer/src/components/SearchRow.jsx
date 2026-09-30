import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import Icon from "./ui/Icon.jsx";
import Sheet from "./ui/Sheet.jsx";
import Button from "./ui/Button.jsx";
import { VegDot } from "./ItemCard.jsx";
import VoiceOrderSheet from "./VoiceOrderSheet.jsx";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition.js";
import { parseSpokenOrder, normalize, suggestFromTranscript } from "../utils/voiceOrder.js";
import { getMenu } from "../services/menuService.js";
import { isOutOfStock } from "../hooks/useMenu.js";
import { useAppState } from "../context/AppState.jsx";

// "I want two paneer tikka please" → "paneer tikka": the first spoken dish,
// without quantity/filler words, so the server-side search can match it.
const spokenToSearch = (text) => parseSpokenOrder(text)[0]?.phrase || normalize(text);

/** Search pill (with 🎤 voice ordering where the browser supports it) +
 * filter button; the filter button opens the veg/non-veg sheet.
 * Voice: if what was said matches menu dishes ("2 chicken biryani and 1
 * cold coffee") a review sheet lets the customer add them all to the cart;
 * otherwise the spoken dish name becomes the search. */
export default function SearchRow({ search, onSearch, diet, onDiet, autoFocus }) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { cart } = useAppState();
  const voice = useSpeechRecognition({ lang: "en-IN" });
  // Whole, unfiltered menu to match speech against (the page's own list may
  // already be narrowed by a search). null = not loaded yet.
  const [voiceMenu, setVoiceMenu] = useState(null);
  const [review, setReview] = useState(""); // transcript shown in the review sheet
  const handled = useRef("");

  const startVoice = () => {
    setReview("");
    handled.current = "";
    getMenu()
      .then(({ data }) => setVoiceMenu((Array.isArray(data) ? data : []).filter((it) => !isOutOfStock(it))))
      .catch(() => setVoiceMenu((m) => m ?? []));
    voice.start();
  };

  useEffect(() => {
    const text = voice.transcript;
    if (!text || handled.current === text || voiceMenu === null) return;
    handled.current = text;
    if (suggestFromTranscript(text, voiceMenu).some((s) => s.matches.length)) setReview(text);
    else onSearch(spokenToSearch(text));
    // onSearch is a new function on every parent render — only react to speech.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.transcript, voiceMenu]);

  const addVoiceOrder = (lines) => {
    lines.forEach(({ item, qty }) => cart.addItem(item, qty));
    const n = lines.reduce((s, l) => s + l.qty, 0);
    toast.success(`${n} item${n === 1 ? "" : "s"} added to cart`);
    setReview("");
  };

  return (
    <>
      <div className="search-row" style={voice.error ? { marginBottom: 6 } : undefined}>
        <label className="search">
          <Icon name="search" />
          <input
            type="search" value={voice.listening ? voice.interim : search} onChange={(e) => onSearch(e.target.value)}
            placeholder={voice.listening ? "Listening… e.g. “2 biryani and 1 coffee”" : "Search your favourite dish…"}
            autoComplete="off" enterKeyHint="search"
            aria-label="Search menu" autoFocus={autoFocus} readOnly={voice.listening}
          />
          {search && !voice.listening && <button type="button" className="clear" onClick={() => onSearch("")} aria-label="Clear search">✕</button>}
          {voice.supported && (
            <button
              type="button" className={`mic${voice.listening ? " on" : ""}`}
              onClick={voice.listening ? voice.stop : startVoice}
              aria-pressed={voice.listening}
              aria-label={voice.listening ? "Stop listening" : "Order or search by voice"}
            >
              <Icon name={voice.listening ? "stop" : "mic"} />
            </button>
          )}
        </label>
        <button
          type="button" className={`icon-btn${diet !== "all" ? " filter-on" : ""}`}
          onClick={() => setFiltersOpen(true)}
          aria-label={diet === "all" ? "Filters" : `Filters (${diet === "veg" ? "Veg only" : "Non-veg only"})`}
        >
          <Icon name="filter" />
        </button>
      </div>
      {voice.error && <p role="alert" className="small danger" style={{ margin: "0 0 14px 8px" }}>{voice.error}</p>}

      {review && voiceMenu && (
        <VoiceOrderSheet
          transcript={review} menu={voiceMenu}
          onAdd={addVoiceOrder}
          onSearch={(q) => { setReview(""); onSearch(q); }}
          onRetry={startVoice}
          onClose={() => setReview("")}
        />
      )}
      {filtersOpen && (
        <Sheet onClose={() => setFiltersOpen(false)} label="Filters">
          <h3>Filters</h3>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={diet === "veg"} onClick={() => onDiet(diet === "veg" ? "all" : "veg")}>
              <VegDot veg />Veg only
            </button>
            <button type="button" className="chip" aria-pressed={diet === "nonveg"} onClick={() => onDiet(diet === "nonveg" ? "all" : "nonveg")}>
              <VegDot veg={false} />Non-veg only
            </button>
          </div>
          <Button style={{ marginTop: 18 }} onClick={() => setFiltersOpen(false)}>Show results</Button>
        </Sheet>
      )}
    </>
  );
}
