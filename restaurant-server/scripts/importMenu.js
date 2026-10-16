// scripts/importMenu.js
// ─────────────────────────────────────────────────────────────────────────────
// Loads the ZenOS menu file (a mongoexport-style JSON array of menu items)
// into the menuitems collection.
//
//   node scripts/importMenu.js <file.json> --dry-run      # report only (do this first)
//   node scripts/importMenu.js <file.json>                # back up, then import
//   node scripts/importMenu.js <file.json> --remove-old   # delete old items instead of switching them off
//   node scripts/importMenu.js <file.json> --remove-empty-categories
//                                                         # also delete old categories left with no items
//
// Rules
//   • Match: by _id when the row has one, otherwise (and when that _id isn't
//     in the database) by itemId. A row matching nothing is created and Mongo
//     gives it an _id. {"$oid"} / {"$date"} values are converted.
//   • Old items not in the file (e.g. the second "Paneer Masala", "Omlet")
//     are NEVER deleted by default: they get isAvailable=false.
//     --remove-old deletes them (past orders keep their own name/price copy).
//   • Before writing, the whole collection is copied to
//     menuitems_backup_<timestamp> and saved to backups/menuitems-<timestamp>.json.
//   • Safe to run twice: a second run finds every row already matching and
//     changes nothing (0 created / 0 updated / 0 deactivated).
//   • Every row is validated against the MenuItem model before anything is
//     written; one bad row stops the whole import.
//   • Item `schedule` values in the file are NOT imported: menu items have no
//     schedule of their own here (services/menuScheduleService.js) — set the
//     time on the category / a Menu time instead.
//   • A configured section (utils/menuSections.js) without a Category doc gets
//     one; the old extra `categories` list is unset on every item.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { MENU_SECTIONS } from "../utils/menuSections.js";
import { normalizeAddons } from "../utils/menuAddons.js";

const { ObjectId } = mongoose.Types;

// Fields the file owns. Everything else on a document (soldOutUntil, recipe
// links, isFastAvailable …) is left alone. `schedule` deliberately absent.
export const IMPORT_FIELDS = [
  "itemId", "name", "nameBn", "price", "originalPrice", "description", "category", "subcategory",
  "categoryImage", "tag", "foodType", "size", "image", "isAvailable", "rating", "tags",
  "isChefsPick", "isTodaysSpecial", "isMostPopular", "addons",
];

/** {"$oid": "…"} → ObjectId, {"$date": "…"} → Date, recursively. */
export const fromExtendedJson = (v) => {
  if (Array.isArray(v)) return v.map(fromExtendedJson);
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === "$oid") return new ObjectId(v.$oid);
    if (keys.length === 1 && keys[0] === "$date") {
      const d = v.$date;
      return new Date(typeof d === "object" && d?.$numberLong ? Number(d.$numberLong) : d);
    }
    return Object.fromEntries(keys.map((k) => [k, fromExtendedJson(v[k])]));
  }
  return v;
};

const str = (v) => String(v ?? "").trim();

/** One file row → the fields to write (plus its _id when it has one). Throws naming the row. */
export const normalizeRow = (raw, index) => {
  const where = `Row ${index + 1}${raw?.itemId ? ` (${raw.itemId})` : ""}`;
  if (!raw || typeof raw !== "object") throw new Error(`${where}: not an object`);
  const out = {};
  for (const f of IMPORT_FIELDS) if (raw[f] !== undefined) out[f] = raw[f];
  out.itemId = str(raw.itemId) || undefined;
  out.name = str(raw.name);
  out.category = str(raw.category);
  out.subcategory = str(raw.subcategory);
  out.size = str(raw.size);
  if (!out.name) throw new Error(`${where}: name is required`);
  if (!out.category) throw new Error(`${where}: category is required`);
  if (!MENU_SECTIONS.includes(out.category)) throw new Error(`${where}: "${out.category}" is not a section in utils/menuSections.js`);
  const price = Number(raw.price);
  if (!Number.isFinite(price) || price < 0) throw new Error(`${where}: price must be a number >= 0`);
  out.price = price;
  out.originalPrice = Number(raw.originalPrice) || 0;
  try { out.addons = normalizeAddons(raw.addons ?? []); }
  catch (e) { throw new Error(`${where}: ${e.message}`); }
  out.tags = Array.isArray(raw.tags) ? raw.tags.map(str).filter(Boolean) : [];
  out.isAvailable = raw.isAvailable !== false;
  out.rating = Number.isFinite(Number(raw.rating)) ? Number(raw.rating) : 4;
  for (const f of ["isChefsPick", "isTodaysSpecial", "isMostPopular"]) out[f] = raw[f] === true;
  const _id = raw._id instanceof ObjectId ? raw._id : raw._id ? new ObjectId(String(raw._id)) : undefined;
  return { _id, fields: out };
};

const addonsComparable = (list = []) => (list || []).map((a) => ({ name: a.name, price: Number(a.price), type: a.type || "" }));
const comparable = (doc) => {
  const o = {};
  for (const f of IMPORT_FIELDS) {
    if (f === "addons") o.addons = addonsComparable(doc.addons);
    else if (f === "tags") o.tags = [...(doc.tags || [])];
    else o[f] = doc[f] ?? (["nameBn", "description", "subcategory", "size", "categoryImage", "image", "foodType"].includes(f) ? "" : null);
  }
  return JSON.stringify(o);
};

/**
 * Pure: file rows + current documents → what the import would do.
 * @param rows      raw file rows ($oid/$date already converted)
 * @param existing  current MenuItem docs (lean)
 * @returns {{ create: object[], update: { _id, set, from }[], unchanged: number,
 *             deactivate: object[], soldOutKept: string[], categoryChanges: Map<string,string> }}
 */
export const planMenuImport = ({ rows, existing, now = new Date(), removeOld = false }) => {
  if (!Array.isArray(rows) || !rows.length) throw new Error("The menu file has no items");
  const clean = rows.map(normalizeRow);
  const seenIds = new Set(), seenCodes = new Set();
  for (const { _id, fields } of clean) {
    if (_id) { if (seenIds.has(String(_id))) throw new Error(`_id ${_id} appears twice in the file`); seenIds.add(String(_id)); }
    if (fields.itemId) { if (seenCodes.has(fields.itemId)) throw new Error(`itemId ${fields.itemId} appears twice in the file`); seenCodes.add(fields.itemId); }
  }

  const byId = new Map(existing.map((d) => [String(d._id), d]));
  const byCode = new Map(existing.filter((d) => d.itemId).map((d) => [d.itemId, d]));
  const matched = new Set();
  const create = [], update = [], soldOutKept = [];
  const categoryChanges = new Map(); // old category → new section, for the report
  let unchanged = 0;

  for (const { _id, fields } of clean) {
    const doc = (_id && byId.get(String(_id))) || (fields.itemId && byCode.get(fields.itemId)) || null;
    if (doc && matched.has(String(doc._id))) throw new Error(`${fields.itemId || fields.name}: matches an item another row already matched`);
    if (!doc) {
      create.push({ ...(_id && { _id }), ...fields });
      continue;
    }
    matched.add(String(doc._id));
    const set = { ...fields };
    // Keep add-on ids where the name is the same, so a cart that picked one still works.
    set.addons = set.addons.map((a) => {
      const prev = (doc.addons || []).find((p) => p.name?.toLowerCase() === a.name.toLowerCase());
      return prev?._id ? { ...a, _id: prev._id } : a;
    });
    // "Sold out today" set on the floor wins until the business day ends.
    if (doc.soldOutUntil && new Date(doc.soldOutUntil) > now) {
      set.isAvailable = doc.isAvailable;
      soldOutKept.push(fields.itemId || fields.name);
    }
    if (doc.category && doc.category !== set.category) categoryChanges.set(doc.category, set.category);
    const needsUnset = doc.categories !== undefined; // the removed extra-categories field
    if (comparable(doc) === comparable(set) && !needsUnset) { unchanged++; continue; }
    update.push({ _id: doc._id, set, from: doc });
  }

  const leftovers = existing.filter((d) => !matched.has(String(d._id)));
  const deactivate = removeOld ? leftovers : leftovers.filter((d) => d.isAvailable !== false);
  return { create, update, unchanged, deactivate, leftovers, soldOutKept, categoryChanges };
};

/** Bulk operations for a plan (exported for the idempotency test). */
export const planToOps = (plan, { removeOld = false } = {}) => [
  ...plan.create.map((doc) => ({ insertOne: { document: doc } })),
  ...plan.update.map((u) => ({ updateOne: { filter: { _id: u._id }, update: { $set: u.set, $unset: { categories: "" } } } })),
  ...plan.deactivate.map((d) => (removeOld
    ? { deleteOne: { filter: { _id: d._id } } }
    : { updateOne: { filter: { _id: d._id }, update: { $set: { isAvailable: false, soldOutUntil: null } } } })),
];

const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, "-").slice(0, 19);

const main = async () => {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const DRY = args.includes("--dry-run");
  const REMOVE_OLD = args.includes("--remove-old");
  const REMOVE_EMPTY_CATS = args.includes("--remove-empty-categories");
  if (!file) throw new Error("Usage: node scripts/importMenu.js <menu.json> [--dry-run] [--remove-old] [--remove-empty-categories]");

  await import("../config/env.js");
  const { getDB } = await import("../config/db.js");
  const { getModels } = await import("../config/getModels.js");
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");

  const rows = fromExtendedJson(JSON.parse(fs.readFileSync(path.resolve(file), "utf8")));
  const conn = await getDB(process.env.MONGO_URI);
  const models = getModels(conn);
  const { MenuItem, Category } = models;

  const existing = await MenuItem.collection.find({}).toArray(); // raw: includes removed fields (categories, schedule)
  const plan = planMenuImport({ rows, existing, removeOld: REMOVE_OLD });

  // Validate every row against the model before anything is written.
  const problems = [];
  for (const doc of [...plan.create, ...plan.update.map((u) => ({ _id: u._id, ...u.set }))]) {
    try { await new MenuItem(doc).validate(); }
    catch (e) { problems.push(`${doc.itemId || doc.name}: ${e.message}`); }
  }
  if (problems.length) throw new Error(`Invalid rows — nothing written:\n  ${problems.join("\n  ")}`);

  const cats = await Category.find().select("name kind").lean();
  const catNames = new Set(cats.map((c) => c.name));
  const missingSections = MENU_SECTIONS.filter((n) => !catNames.has(n));
  // After the import every matched/created item is in its file section; old
  // items keep their category unless they are deleted.
  const usedAfter = new Set([...MENU_SECTIONS, ...(REMOVE_OLD ? [] : plan.leftovers.map((d) => d.category))]);
  const emptyOldCats = cats.filter((c) => c.kind !== "SMART" && !MENU_SECTIONS.includes(c.name) && !usedAfter.has(c.name));

  console.log(`${DRY ? "DRY RUN — nothing is written." : "IMPORT"}  file: ${file}  (${rows.length} rows, ${existing.length} items in the database)`);
  console.log(`  create:      ${plan.create.length}`);
  console.log(`  update:      ${plan.update.length}`);
  console.log(`  unchanged:   ${plan.unchanged}`);
  console.log(`  ${REMOVE_OLD ? "delete:     " : "deactivate: "} ${plan.deactivate.length}${plan.leftovers.length > plan.deactivate.length ? `  (+${plan.leftovers.length - plan.deactivate.length} old item(s) already off)` : ""}`);
  for (const d of plan.deactivate.slice(0, 40)) console.log(`      - ${d.name}  [${d.category}]`);
  if (plan.deactivate.length > 40) console.log(`      … and ${plan.deactivate.length - 40} more`);
  if (plan.soldOutKept.length) console.log(`  kept "Sold out today" on: ${plan.soldOutKept.join(", ")}`);
  if (plan.categoryChanges.size) {
    console.log("  old category → new section (seen on updated items):");
    for (const [a, b] of plan.categoryChanges) console.log(`      ${a} → ${b}`);
  }
  if (missingSections.length) console.log(`  sections to add as categories: ${missingSections.join(", ")}`);
  if (emptyOldCats.length) {
    console.log(`  old categories left with no items: ${emptyOldCats.map((c) => c.name).join(", ")}`);
    console.log(REMOVE_EMPTY_CATS ? "      → will be deleted" : "      (kept; add --remove-empty-categories to delete them)");
  }
  const withSchedule = rows.filter((r) => r.schedule?.enabled).length;
  if (withSchedule) console.log(`  note: ${withSchedule} rows carry an item schedule — not imported (items follow their category's time).`);

  if (DRY) { await conn.close(); return; }

  // ── Backup: a copy collection AND a JSON file ──────────────────────────────
  const ts = stamp();
  const backupName = `menuitems_backup_${ts.replace(/-/g, "")}`;
  if (existing.length) {
    await MenuItem.collection.aggregate([{ $match: {} }, { $out: backupName }]).toArray();
    const dir = path.resolve("backups");
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `menuitems-${ts}.json`);
    fs.writeFileSync(out, mongoose.mongo.BSON.EJSON.stringify(existing, null, 2, { relaxed: false }));
    console.log(`  backup: collection ${backupName} + ${out}`);
  }

  await MenuItem.createIndexes(); // itemId unique (sparse), category+subcategory
  const ops = planToOps(plan, { removeOld: REMOVE_OLD });
  if (ops.length) {
    const r = await MenuItem.bulkWrite(ops, { ordered: true });
    console.log(`  written: ${r.insertedCount} created, ${r.modifiedCount} updated, ${r.deletedCount} deleted`);
  } else console.log("  nothing to change");
  // The removed `categories` field, on any item the plan didn't touch.
  await MenuItem.collection.updateMany({ categories: { $exists: true } }, { $unset: { categories: "" } });

  const last = await Category.findOne().sort({ sortOrder: -1 }).select("sortOrder").lean();
  let next = (last?.sortOrder ?? -1) + 1;
  for (const name of missingSections) {
    try { await Category.create({ name, sortOrder: next++ }); console.log(`  category added: ${name}`); }
    catch (e) { if (e?.code === 11000) console.log(`  category "${name}" exists in another letter case — rename it to "${name}" in Admin → Categories`); else throw e; }
  }
  if (REMOVE_EMPTY_CATS && emptyOldCats.length) {
    const del = await Category.deleteMany({ _id: { $in: emptyOldCats.map((c) => c._id) }, kind: { $ne: "SMART" } });
    console.log(`  old categories deleted: ${del.deletedCount}`);
  }
  await conn.close();
  console.log("Done.");
};

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => { console.error(`\n✗ ${err.message}`); process.exit(1); });
}
