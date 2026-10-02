// src/services/cache.js
// Tiny in-memory cache for data that the order screens re-read constantly
// but that rarely changes (menu, categories, restaurant profile). "New order"
// used to refetch all three every time it opened; now the first open (or the
// Orders page prefetch) fills this, later opens are instant, and entries
// expire after `ttl` ms or when invalidate() is called (e.g. on the server's
// "menu:updated" socket event). In-flight requests are shared.
const store = new Map(); // key -> { at, promise }

export const cached = (key, ttl, load) => {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;
  const promise = load().catch((err) => { store.delete(key); throw err; });
  store.set(key, { at: Date.now(), promise });
  return promise;
};

export const invalidate = (prefix = "") => {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
};
