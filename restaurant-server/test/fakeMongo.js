// test/fakeMongo.js — NOT a test file (the runner globs *.test.js).
// ─────────────────────────────────────────────────────────────────────────────
// A small in-memory stand-in for the slice of Mongoose the delivery service
// uses, so test/delivery*.test.js can run the REAL service code (atomic
// conditional updates, unique indexes, transactions) with no database.
//
// Faithful where it matters for correctness tests:
//   • conditional updates are atomic (single-threaded JS: filter-check and
//     write happen in one synchronous step);
//   • unique indexes reject duplicates with { code: 11000 };
//   • transactions are SERIALIZED (a mutex) and ROLL BACK every collection on
//     throw — the observable behaviour of MongoDB's snapshot transactions for
//     conflicting writers (one commits, the retried other sees its result);
//   • `select: false` fields (DeliveryJob.otpCode) are hidden unless "+field".
// Supported operators: $in $nin $ne $gt $gte $lt $lte $exists $or $and,
// $expr {$lt:[ "$a", {$ifNull:["$b", n]} ]}; updates $set $inc $setOnInsert
// $push ($each/$slice) $pull ($in) $addToSet; aggregate $match + $group $sum.
// ─────────────────────────────────────────────────────────────────────────────

let seq = 0;
export const oid = () => (0x10000000 + ++seq).toString(16).padStart(24, "a");

const get = (doc, path) => path.split(".").reduce((v, k) => (v == null ? undefined : v[k]), doc);
const set = (doc, path, value) => {
  const ks = path.split(".");
  let cur = doc;
  for (const k of ks.slice(0, -1)) { if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {}; cur = cur[k]; }
  cur[ks[ks.length - 1]] = value;
};
const norm = (v) => (v instanceof Date ? v.getTime() : v != null && typeof v === "object" && v._id != null ? String(v._id) : v != null && typeof v === "object" && !Array.isArray(v) ? v : typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : v == null ? null : String(v));
const eq = (a, b) => {
  const na = norm(a), nb = norm(b);
  if (na == null || nb == null) return na == null && nb == null;
  if (typeof na === "object" || typeof nb === "object") return JSON.stringify(na) === JSON.stringify(nb);
  return String(na) === String(nb);
};
const cmp = (a, b) => { const x = norm(a), y = norm(b); return x < y ? -1 : x > y ? 1 : 0; };

const evalExpr = (doc, e) => {
  if (typeof e === "string" && e.startsWith("$")) return get(doc, e.slice(1));
  if (e && typeof e === "object" && !Array.isArray(e) && !(e instanceof Date)) {
    if ("$ifNull" in e) { const v = evalExpr(doc, e.$ifNull[0]); return v == null ? evalExpr(doc, e.$ifNull[1]) : v; }
    if ("$lt" in e) return cmp(evalExpr(doc, e.$lt[0]), evalExpr(doc, e.$lt[1])) < 0;
  }
  return e;
};

const isOps = (v) => v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && Object.keys(v).length && Object.keys(v).every((k) => k.startsWith("$"));

const matchValue = (actual, cond) => {
  if (isOps(cond)) {
    return Object.entries(cond).every(([op, v]) => {
      switch (op) {
        case "$in":  return Array.isArray(actual) ? actual.some((a) => v.some((x) => eq(a, x))) : v.some((x) => eq(actual, x));
        case "$nin": return !(Array.isArray(actual) ? actual.some((a) => v.some((x) => eq(a, x))) : v.some((x) => eq(actual, x)));
        case "$ne":  return Array.isArray(actual) ? !actual.some((a) => eq(a, v)) : !eq(actual, v);
        case "$gt":  return actual != null && cmp(actual, v) > 0;
        case "$gte": return actual != null && cmp(actual, v) >= 0;
        case "$lt":  return actual != null && cmp(actual, v) < 0;
        case "$lte": return actual != null && cmp(actual, v) <= 0;
        case "$exists": return (actual !== undefined) === !!v;
        default: throw new Error(`fakeMongo: unsupported operator ${op}`);
      }
    });
  }
  if (Array.isArray(actual) && !Array.isArray(cond)) return actual.some((a) => eq(a, cond));
  return eq(actual, cond);
};

export const matches = (doc, filter = {}) => Object.entries(filter).every(([k, v]) => {
  if (v === undefined) return true;
  if (k === "$or") return v.some((f) => matches(doc, f));
  if (k === "$and") return v.every((f) => matches(doc, f));
  if (k === "$expr") return !!evalExpr(doc, v);
  return matchValue(get(doc, k), v);
});

const clone = (v) => structuredClone(v);

const applyUpdate = (doc, update, { inserting = false } = {}) => {
  const plain = Object.keys(update).every((k) => !k.startsWith("$"));
  if (plain) { Object.assign(doc, clone(update)); return; }
  for (const [op, fields] of Object.entries(update)) {
    for (const [path, val] of Object.entries(fields)) {
      const cur = get(doc, path);
      switch (op) {
        case "$set": set(doc, path, clone(val)); break;
        case "$setOnInsert": if (inserting) set(doc, path, clone(val)); break;
        case "$inc": set(doc, path, (Number(cur) || 0) + val); break;
        case "$push": {
          const arr = Array.isArray(cur) ? cur : [];
          if (val && typeof val === "object" && "$each" in val) {
            arr.push(...clone(val.$each));
            if (val.$slice != null && val.$slice < 0) arr.splice(0, Math.max(0, arr.length + val.$slice));
          } else arr.push(clone(val));
          set(doc, path, arr);
          break;
        }
        case "$addToSet": { const arr = Array.isArray(cur) ? cur : []; if (!arr.some((a) => eq(a, val))) arr.push(clone(val)); set(doc, path, arr); break; }
        case "$pull": {
          const arr = Array.isArray(cur) ? cur : [];
          const drop = isOps(val) && val.$in ? (a) => val.$in.some((x) => eq(a, x)) : (a) => eq(a, val);
          set(doc, path, arr.filter((a) => !drop(a)));
          break;
        }
        default: throw new Error(`fakeMongo: unsupported update ${op}`);
      }
    }
  }
};

class Query {
  constructor(run) { this._run = run; this._sel = ""; this._sort = null; this._limit = 0; }
  select(s) { this._sel = typeof s === "string" ? s : ""; return this; }
  lean() { return this; }
  session() { return this; }
  sort(spec) { this._sort = spec; return this; }
  limit(n) { this._limit = n; return this; }
  populate() { return this; }
  exec() { return Promise.resolve().then(() => this._run(this)); }
  then(res, rej) { return this.exec().then(res, rej); }
  catch(rej) { return this.exec().catch(rej); }
}

// Undo log: every write made with { session } records how to reverse it.
const logUndo = (opts, entry) => { if (opts?.session?.__undo) opts.session.__undo.push(entry); };
// A write outside a transaction waits for any in-flight transaction to end,
// as a non-transactional MongoDB write does when it hits a document an open
// transaction has written (it can never observe or clobber uncommitted state).
let activeTx = null;
const waitTx = async (opts) => { if (activeTx && !opts?.session) await activeTx.catch(() => {}); };

export class FakeModel {
  constructor(name, { defaults = () => ({}), unique = [], hidden = [] } = {}) {
    Object.assign(this, { name, defaults, unique, hidden, docs: [] });
  }
  _out(doc, sel = "") {
    if (!doc) return null;
    const out = clone(doc);
    for (const h of this.hidden) if (!sel.includes(`+${h}`)) delete out[h];
    return out;
  }
  _checkUnique(doc, ignore) {
    for (const keys of this.unique) {
      const clash = this.docs.find((d) => d !== ignore && keys.every((k) => eq(get(d, k), get(doc, k))) && keys.every((k) => get(doc, k) != null));
      if (clash) throw Object.assign(new Error(`E11000 duplicate key ${this.name} ${keys}`), { code: 11000, keyPattern: Object.fromEntries(keys.map((k) => [k, 1])) });
    }
  }
  _insert(raw, opts) {
    const doc = { _id: oid(), ...this.defaults(), ...clone(raw), createdAt: raw.createdAt || new Date(), updatedAt: new Date() };
    this._checkUnique(doc, null);
    this.docs.push(doc);
    logUndo(opts, { model: this, id: doc._id, before: null });
    return doc;
  }
  _touch(doc, opts) { logUndo(opts, { model: this, id: doc._id, before: clone(doc) }); }
  _undo({ id, before }) {
    const i = this.docs.findIndex((d) => eq(d._id, id));
    if (before == null) { if (i >= 0) this.docs.splice(i, 1); }
    else if (i >= 0) this.docs[i] = before; else this.docs.push(before);
  }
  _sorted(list, spec) {
    if (!spec) return list;
    const [[k, dir]] = Object.entries(spec);
    return [...list].sort((a, b) => cmp(get(a, k), get(b, k)) * dir);
  }

  find(filter = {}) {
    return new Query((q) => {
      let list = this._sorted(this.docs.filter((d) => matches(d, filter)), q._sort);
      if (q._limit) list = list.slice(0, q._limit);
      return list.map((d) => this._out(d, q._sel));
    });
  }
  findOne(filter = {}) { return new Query((q) => this._out(this.docs.find((d) => matches(d, filter)), q._sel)); }
  findById(id) { return this.findOne({ _id: id }); }
  exists(filter) { return Promise.resolve(this.docs.some((d) => matches(d, filter)) ? { _id: 1 } : null); }
  countDocuments(filter = {}) { return Promise.resolve(this.docs.filter((d) => matches(d, filter)).length); }
  distinct(field, filter = {}) {
    const seen = new Map();
    for (const d of this.docs.filter((x) => matches(x, filter))) { const v = get(d, field); seen.set(String(v), v); }
    return Promise.resolve([...seen.values()]);
  }

  async create(input, opts) {
    await waitTx(opts);
    const many = Array.isArray(input);
    const out = (many ? input : [input]).map((r) => this._out(this._insert(r, opts)));
    return many ? out : out[0];
  }
  async insertMany(list) { await waitTx(); return list.map((r) => this._out(this._insert(r))); }

  findOneAndUpdate(filter, update, opts = {}) {
    return new Query(async (q) => {
      await waitTx(opts);
      let doc = this.docs.find((d) => matches(d, filter));
      if (!doc) {
        if (!opts.upsert) return null;
        const seed = Object.fromEntries(Object.entries(filter).filter(([k, v]) => !k.startsWith("$") && !isOps(v)));
        doc = { _id: oid(), ...this.defaults(), ...clone(seed), createdAt: new Date() };
        applyUpdate(doc, update, { inserting: true });
        this._checkUnique(doc, null);
        this.docs.push(doc);
        logUndo(opts, { model: this, id: doc._id, before: null });
        return this._out(doc, q._sel);
      }
      const before = clone(doc);
      this._touch(doc, opts);
      applyUpdate(doc, update);
      try { this._checkUnique(doc, doc); } catch (e) { Object.assign(doc, before); throw e; }
      doc.updatedAt = new Date();
      return this._out(opts.returnDocument === "after" || opts.new ? doc : before, q._sel);
    });
  }
  findByIdAndUpdate(id, update, opts) { return this.findOneAndUpdate({ _id: id }, update, opts); }

  async updateOne(filter, update, opts = {}) {
    await waitTx(opts);
    const doc = this.docs.find((d) => matches(d, filter));
    if (!doc) {
      if (!opts.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      const seed = Object.fromEntries(Object.entries(filter).filter(([k, v]) => !k.startsWith("$") && !isOps(v)));
      const fresh = { _id: oid(), ...this.defaults(), ...clone(seed), createdAt: new Date() };
      applyUpdate(fresh, update, { inserting: true });
      this._checkUnique(fresh, null);
      this.docs.push(fresh);
      logUndo(opts, { model: this, id: fresh._id, before: null });
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    this._touch(doc, opts);
    const before = JSON.stringify(doc);
    applyUpdate(doc, update);
    return { matchedCount: 1, modifiedCount: JSON.stringify(doc) === before ? 0 : 1, upsertedCount: 0 };
  }
  async updateMany(filter, update, opts) {
    await waitTx(opts);
    const hit = this.docs.filter((d) => matches(d, filter));
    hit.forEach((d) => { this._touch(d, opts); applyUpdate(d, update); });
    return { matchedCount: hit.length, modifiedCount: hit.length };
  }
  async aggregate(pipeline) {
    let rows = this.docs.map(clone);
    for (const stage of pipeline) {
      if (stage.$match) rows = rows.filter((d) => matches(d, stage.$match));
      else if (stage.$group) {
        const by = new Map();
        const key = stage.$group._id;
        for (const r of rows) {
          const k = typeof key === "string" ? get(r, key.slice(1)) : null;
          const ks = String(k);
          if (!by.has(ks)) by.set(ks, { _id: k, n: 0 });
          by.get(ks).n += 1;
        }
        rows = [...by.values()];
      } else throw new Error("fakeMongo: unsupported aggregate stage");
    }
    return rows;
  }
}

/** A db whose transactions are serialized and roll back (via the undo log) on throw. */
export const fakeDb = () => {
  let chain = Promise.resolve();
  return {
    // Like the driver, callers pass the SESSION object itself to each write
    // (not the callback argument) — so the undo log lives on the session.
    startSession: async () => {
      const session = {
        __undo: null,
        withTransaction: (fn) => {
          const run = chain.then(async () => {
            session.__undo = [];
            try { await fn(session); }
            catch (err) { for (const u of session.__undo.reverse()) u.model._undo(u); throw err; }
            finally { session.__undo = null; }
          });
          chain = run.catch(() => {});
          activeTx = chain;
          return run;
        },
        endSession: async () => {},
      };
      return session;
    },
  };
};
