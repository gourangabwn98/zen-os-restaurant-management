// src/utils/voiceOrder.js
// ─────────────────────────────────────────────────────────────────────────────
// Turns a spoken order ("two chicken biryani and one cold coffee", "paneer
// tikka 2 plates, masala dosa") into menu suggestions. Pure functions — no
// browser APIs — so they're easy to reason about and test.
//
// Speech recognition mishears food names ("biriyani", "panner"), so matching
// is tolerant: word-by-word with small spelling differences allowed. Nothing
// is ever added to an order from here — the UI shows these as suggestions
// the waiter confirms.
// ─────────────────────────────────────────────────────────────────────────────

// Quantity words — English plus the romanized Hindi/Bengali numbers an
// English (India) recogniser often writes out as heard.
const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  couple: 2, pair: 2, dozen: 12, half: 1,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6,
  saat: 7, sat: 7, aath: 8, aat: 8, nau: 9, noy: 9, das: 10, dosh: 10, dui: 2, tin: 3, chhoy: 6,
  // homophones the recogniser produces for numbers
  won: 1, to: 2, too: 2, tu: 2, tree: 3, for: 4, fore: 4, ate: 8,
};
// Homophones only count as numbers at the start of an item ("to chicken").
const HOMOPHONES = new Set(["won", "to", "too", "tu", "tree", "for", "fore", "ate", "do", "a", "an", "sat", "che"]);

// Words that carry no item meaning.
const FILLER = new Set([
  "plate", "plates", "piece", "pieces", "pcs", "pc", "glass", "glasses", "cup", "cups", "bowl", "bowls",
  "portion", "portions", "order", "orders", "please", "pls", "give", "me", "i", "want", "we", "need",
  "add", "get", "us", "of", "x", "times", "nos", "no", "number", "the", "some", "with", "and", "also",
  "then", "plus", "aur", "ar", "ebong", "one's", "ones", "wala", "wali", "dena", "dijiye", "chahiye",
]);

const SEPARATORS = /\s*(?:,|;|\.|&|\band\b|\bplus\b|\baur\b|\bar\b|\bebong\b|\bthen\b|\balso\b|\bafter that\b)\s*/i;

export const normalize = (s) => String(s || "")
  .toLowerCase()
  .normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const toNumber = (tok, { atStart }) => {
  if (/^\d{1,2}$/.test(tok)) return Number(tok);
  if (tok in NUMBER_WORDS && (atStart || !HOMOPHONES.has(tok))) return NUMBER_WORDS[tok];
  return null;
};

/**
 * "2 chicken biryani and one cold coffee" →
 *   [{ qty: 2, phrase: "chicken biryani" }, { qty: 1, phrase: "cold coffee" }]
 * A number also starts a new item when there's no "and" between them
 * ("2 biryani 3 lassi"). A trailing number counts too ("lassi 2 glasses").
 */
export const parseSpokenOrder = (transcript) => {
  const out = [];
  for (const chunk of String(transcript || "").split(SEPARATORS)) {
    const tokens = normalize(chunk).split(" ").filter(Boolean);
    let cur = { qty: null, words: [] };
    const flush = () => {
      const words = cur.words.filter((w) => !FILLER.has(w));
      if (words.length) out.push({ qty: Math.min(99, Math.max(1, cur.qty ?? 1)), phrase: words.join(" ") });
      else if (cur.qty != null && out.length && out[out.length - 1].qtyFromDefault) {
        // "... lassi two" — a number after the item belongs to it.
        out[out.length - 1].qty = Math.min(99, cur.qty);
        out[out.length - 1].qtyFromDefault = false;
      }
      cur = { qty: null, words: [] };
    };
    tokens.forEach((tok) => {
      const n = toNumber(tok, { atStart: cur.qty == null && cur.words.every((w) => FILLER.has(w)) });
      if (n != null) {
        if (cur.words.length) {
          // Number after words: trailing qty for this item if it has none yet,
          // otherwise the start of the next item.
          if (cur.qty == null) { cur.qty = n; flush(); return; }
          flush();
        }
        cur.qty = n;
        return;
      }
      cur.words.push(tok);
    });
    const hadQty = cur.qty != null;
    flush();
    if (!hadQty && out.length) out[out.length - 1].qtyFromDefault = true;
  }
  return out.map(({ qty, phrase }) => ({ qty, phrase }));
};

// ── fuzzy matching ───────────────────────────────────────────────────────────
const editDistance = (a, b) => {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
};

// Spoken-form spellings → how menus usually spell them.
const SPELLING = { biriyani: "biryani", briyani: "biryani", panner: "paneer", panir: "paneer", momos: "momo", fries: "fry", chips: "fry" };
const canon = (w) => SPELLING[w] || (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);

const wordSimilarity = (a, b) => {
  a = canon(a); b = canon(b);
  if (a === b) return 1;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.85;
  const d = editDistance(a, b);
  const len = Math.max(a.length, b.length);
  if (d === 1 && len >= 4) return 0.8;
  if (d === 2 && len >= 6) return 0.6;
  return 0;
};

/** 0–1 similarity of a spoken phrase to a menu item name. */
export const scoreMatch = (phrase, name) => {
  const p = normalize(phrase).split(" ").filter(Boolean);
  const n = normalize(name).split(" ").filter(Boolean);
  if (!p.length || !n.length) return 0;
  const best = (words, others) => words.reduce((sum, w) => sum + Math.max(0, ...others.map((o) => wordSimilarity(w, o))), 0);
  // Dice-style: rewards covering the phrase AND the name, so "coffee"
  // prefers "Coffee" over "Cold Coffee Shake".
  const score = (best(p, n) + best(n, p)) / (p.length + n.length);
  const exact = normalize(phrase) === normalize(name) ? 0.05 : 0;
  return Math.min(1, score + exact);
};

const MIN_SCORE = 0.5;

/**
 * Suggestions for a transcript: one per spoken item, each with its best
 * matches (highest first). `matches` is empty when nothing is close enough —
 * the UI offers that phrase as a search instead.
 */
export const suggestFromTranscript = (transcript, menu, { limit = 3 } = {}) =>
  parseSpokenOrder(transcript).map(({ qty, phrase }) => {
    const matches = (menu || [])
      .map((item) => ({ item, score: scoreMatch(phrase, item.name) }))
      .filter((m) => m.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return { qty, phrase, matches };
  });
