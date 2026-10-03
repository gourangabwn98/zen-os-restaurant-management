// middleware/sanitizeInput.js
// ─────────────────────────────────────────────────────────────────────────────
// Blocks MongoDB operator injection. express.json() turns
//   { "phone": { "$ne": null } }
// into a real object, and many handlers pass body fields straight into a
// filter (User.findOne({ phone })) — which would then match ANY user. This
// drops every key that starts with "$" from req.body, at any depth, before a
// route sees it. No client of this API sends such keys legitimately.
//
// Query strings need nothing: Express 5's default "simple" query parser never
// builds nested objects (?phone[$ne]=1 stays the literal key "phone[$ne]").
// ─────────────────────────────────────────────────────────────────────────────

/** Removes "$…" keys in place; returns how many were removed. */
export const stripOperators = (value, depth = 0) => {
  if (!value || typeof value !== "object" || depth > 20) return 0;
  let removed = 0;
  if (Array.isArray(value)) {
    for (const v of value) removed += stripOperators(v, depth + 1);
    return removed;
  }
  for (const key of Object.keys(value)) {
    if (key.startsWith("$")) { delete value[key]; removed += 1; }
    else removed += stripOperators(value[key], depth + 1);
  }
  return removed;
};

export const sanitizeInput = (req, _res, next) => {
  if (req.body && typeof req.body === "object") stripOperators(req.body);
  next();
};
