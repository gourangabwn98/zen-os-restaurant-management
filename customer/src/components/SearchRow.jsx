import { useEffect, useState } from "react";
import Icon from "./ui/Icon.jsx";
import Sheet from "./ui/Sheet.jsx";
import Button from "./ui/Button.jsx";
import { VegDot } from "./ItemCard.jsx";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition.js";
import { parseSpokenOrder, normalize } from "../utils/voiceOrder.js";

// "I want two paneer tikka please" → "paneer tikka": the first spoken dish,
// without quantity/filler words, so the server-side search can match it.
const spokenToSearch = (text) => parseSpokenOrder(text)[0]?.phrase || normalize(text);

/** Search pill (with 🎤 voice search where the browser supports it) +
 * filter button; the filter button opens the veg/non-veg sheet. */
export default function SearchRow({ search, onSearch, diet, onDiet, autoFocus }) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const voice = useSpeechRecognition({ lang: "en-IN" });

  useEffect(() => {
    if (voice.transcript) onSearch(spokenToSearch(voice.transcript));
    // onSearch is a new function on every parent render — only react to speech.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.transcript]);

  return (
    <>
      <div className="search-row" style={voice.error ? { marginBottom: 6 } : undefined}>
        <label className="search">
          <Icon name="search" />
          <input
            type="search" value={voice.listening ? voice.interim : search} onChange={(e) => onSearch(e.target.value)}
            placeholder={voice.listening ? "Listening… say a dish name" : "Search your favourite dish…"}
            autoComplete="off" enterKeyHint="search"
            aria-label="Search menu" autoFocus={autoFocus} readOnly={voice.listening}
          />
          {search && !voice.listening && <button type="button" className="clear" onClick={() => onSearch("")} aria-label="Clear search">✕</button>}
          {voice.supported && (
            <button
              type="button" className={`mic${voice.listening ? " on" : ""}`}
              onClick={voice.listening ? voice.stop : voice.start}
              aria-pressed={voice.listening}
              aria-label={voice.listening ? "Stop listening" : "Search by voice"}
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
