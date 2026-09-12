import { useState, useEffect } from "react";

/** True once the viewport matches `query` — used to switch between the
 * mobile list layout and the tablet/desktop card grid at the same
 * breakpoint the CSS grid (.menu-grid) already switches at. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = () => setMatches(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
