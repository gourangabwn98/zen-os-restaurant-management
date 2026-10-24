// MANUAL ONLY. No startup hook, no legacy changes, no historical backfill.
// Does NOT load .env or use MONGO_URI. An explicit setup URI and database
// confirmation prevent accidentally targeting the application's production DB.
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import { getInventoryV3Models, V3_STORAGE_VERSION } from "../config/inventoryV3Models.js";

export const parseSetupArgs = (args) => {
  const allowed = new Set(["--apply", "--dry-run", "--database", "--help"]);
  let database = "";
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error(`Unknown argument: ${args[i]}`);
    if (args[i] === "--database") {
      database = args[++i];
      if (!database || !/^[A-Za-z0-9_-]+$/.test(database)) throw new Error("Supply an explicit database name");
    }
  }
  if (args.includes("--apply") && args.includes("--dry-run")) throw new Error("Choose --apply or --dry-run");
  return { apply: args.includes("--apply"), help: args.includes("--help"), database };
};

export const setupStorage = async ({ conn, apply = false, log = console.log }) => {
  const models = getInventoryV3Models(conn);
  const settings = await models.InventoryV3Settings.findById("default").lean();
  if ((settings?.storageVersion || 0) > V3_STORAGE_VERSION) throw new Error("Database has a newer V3 storage version");
  for (const Model of Object.values(models)) {
    const name = Model.collection.collectionName;
    const exists = await conn.db.listCollections({ name }, { nameOnly: true }).hasNext();
    log(`${apply ? "APPLY" : "DRY RUN"} ${name}: ${exists ? "exists" : "create collection"}; ensure ${Model.schema.indexes().length} declared indexes`);
    if (!apply) continue;
    if (!exists) {
      try { await conn.db.createCollection(name); }
      catch (err) { if (err.code !== 48) throw err; } // another manual run created it
    }
    // createIndex is idempotent; never syncIndexes/dropIndex. An incompatible
    // existing index fails visibly and must be investigated, not replaced.
    for (const [keys, options] of Model.schema.indexes()) await conn.db.collection(name).createIndex(keys, options);
  }
  if (apply && !settings) {
    await models.InventoryV3Settings.updateOne({ _id: "default" }, {
      $setOnInsert: { enabled: false, storageVersion: V3_STORAGE_VERSION, foodCostTargetBps: 3500, countIntervalDays: 4, autoOrderMode: "OFF", revision: 0 },
    }, { upsert: true, runValidators: true });
  } else if (apply && settings.storageVersion !== V3_STORAGE_VERSION) {
    await models.InventoryV3Settings.updateOne({ _id: "default", storageVersion: settings.storageVersion }, { $set: { storageVersion: V3_STORAGE_VERSION } });
  }
  log(apply ? "V3 storage ready; existing runtime enabled setting preserved. No legacy data changed." : "No writes performed. Runtime settings will default OFF on first setup.");
};
const main = async () => {
  const args = parseSetupArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Set INVENTORY_V3_SETUP_URI explicitly. Run: node scripts/setup-inventory-v3.js --database <name> [--dry-run | --apply]. Default: dry-run.");
    return;
  }
  if (!args.database || !process.env.INVENTORY_V3_SETUP_URI) throw new Error("Explicit --database and INVENTORY_V3_SETUP_URI are required");
  const conn = await mongoose.createConnection(process.env.INVENTORY_V3_SETUP_URI, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 10000 }).asPromise();
  try {
    if (conn.name !== args.database) throw new Error("Connected database does not match --database; no changes made");
    await setupStorage({ conn, apply: args.apply });
  } finally { await conn.close(); }
};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // Driver errors can contain host/connection details. Never print the URI.
    console.error(`V3 setup failed (${err.code || err.name}). Check database confirmation, connectivity and index compatibility.`);
    process.exitCode = 1;
  });
}
