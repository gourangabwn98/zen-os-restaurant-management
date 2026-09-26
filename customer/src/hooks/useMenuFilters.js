import { useState } from "react";

/** Search / diet / category selection shared between Home, Menu and
 * Offers, so switching tabs keeps what the customer typed or picked. */
export function useMenuFilters() {
  const [search, setSearch]     = useState("");
  const [diet, setDiet]         = useState("all"); // "all" | "veg" | "nonveg"
  const [category, setCategory] = useState("All");
  const reset = () => { setSearch(""); setDiet("all"); setCategory("All"); };
  return { search, setSearch, diet, setDiet, category, setCategory, reset };
}
