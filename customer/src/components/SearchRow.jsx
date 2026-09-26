import { useState } from "react";
import Icon from "./ui/Icon.jsx";
import Sheet from "./ui/Sheet.jsx";
import Button from "./ui/Button.jsx";
import { VegDot } from "./ItemCard.jsx";

/** Search pill + filter button; the filter button opens the veg/non-veg sheet. */
export default function SearchRow({ search, onSearch, diet, onDiet, autoFocus }) {
  const [filtersOpen, setFiltersOpen] = useState(false);

  return (
    <>
      <div className="search-row">
        <label className="search">
          <Icon name="search" />
          <input
            type="search" value={search} onChange={(e) => onSearch(e.target.value)}
            placeholder="Search your favourite dish…" autoComplete="off" enterKeyHint="search"
            aria-label="Search menu" autoFocus={autoFocus}
          />
          {search && <button type="button" className="clear" onClick={() => onSearch("")} aria-label="Clear search">✕</button>}
        </label>
        <button
          type="button" className={`icon-btn${diet !== "all" ? " filter-on" : ""}`}
          onClick={() => setFiltersOpen(true)}
          aria-label={diet === "all" ? "Filters" : `Filters (${diet === "veg" ? "Veg only" : "Non-veg only"})`}
        >
          <Icon name="filter" />
        </button>
      </div>

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
