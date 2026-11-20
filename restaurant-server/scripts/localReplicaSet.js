// scripts/localReplicaSet.js — Offline Edition: turn the MongoDB on THIS PC
// into a single-node replica set (orders, stock and KOT writes are
// transactions, which need one). Safe to run any number of times.
//
//   node scripts/localReplicaSet.js                 (127.0.0.1:27017, set "rs0")
//   node scripts/localReplicaSet.js --port 27018 --name rs0
//   node scripts/localReplicaSet.js --check         (report only, change nothing)
//
// Precondition: mongod is running with `replication.replSetName` equal to
// --name in mongod.cfg (see docs/offline-edition/11-local-setup-and-recovery.md).
// Refuses anything but the loopback address: it must never touch a cloud or
// another machine's database. Uses mongoose (already a dependency).
import mongoose from "mongoose";

const args = process.argv.slice(2);
const arg = (flag, fallback) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const port = Number(arg("--port", "27017"));
const setName = arg("--name", "rs0");
const checkOnly = args.includes("--check");

if (!Number.isInteger(port) || port <= 0 || port >= 65536) { console.error(`Invalid --port ${port}`); process.exit(2); }
if (!/^[A-Za-z0-9_-]{1,64}$/.test(setName)) { console.error(`Invalid --name ${setName}`); process.exit(2); }

const host = `127.0.0.1:${port}`;
// directConnection: talk to this one mongod even before a set exists.
const conn = await mongoose.createConnection(`mongodb://${host}/admin?directConnection=true`, { serverSelectionTimeoutMS: 5000 }).asPromise()
  .catch((err) => { console.error(`❌ Cannot reach MongoDB at ${host}: ${err.message}\n   Is the MongoDB service running?`); process.exit(1); });
const admin = conn.db.admin();

const status = async () => {
  try { return { initiated: true, s: await admin.command({ replSetGetStatus: 1 }) }; }
  catch (err) {
    if (err.codeName === "NotYetInitialized" || err.code === 94) return { initiated: false };
    if (err.codeName === "NoReplicationEnabled" || err.code === 76) return { notReplSet: true, message: err.message };
    throw err;
  }
};

const waitForPrimary = async (ms = 30000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const hello = await admin.command({ hello: 1 });
    if (hello.isWritablePrimary) return hello;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("timed out waiting for this node to become primary");
};

let exitCode = 0;
try {
  const st = await status();
  if (st.notReplSet) {
    console.error(`❌ mongod at ${host} was not started as a replica set.\n   Add to mongod.cfg:\n     replication:\n       replSetName: ${setName}\n   then restart the MongoDB service and run this again.`);
    exitCode = 1;
  } else if (st.initiated) {
    const me = st.s.members.find((m) => m.self);
    console.log(`✅ Replica set "${st.s.set}" already initialised — this node is ${me?.stateStr || "unknown"}.`);
    if (st.s.set !== setName) { console.warn(`⚠️  Set name is "${st.s.set}", not "${setName}" — use replicaSet=${st.s.set} in MONGO_URI.`); }
  } else if (checkOnly) {
    console.log(`ℹ️  mongod at ${host} is ready for a replica set but not initialised yet (run without --check).`);
    exitCode = 1;
  } else {
    await admin.command({ replSetInitiate: { _id: setName, members: [{ _id: 0, host }] } });
    await waitForPrimary();
    console.log(`✅ Replica set "${setName}" initialised on ${host} — this node is PRIMARY.`);
  }
  if (exitCode === 0) console.log(`   MONGO_URI=mongodb://${host}/zen_local?replicaSet=${setName}`);
} catch (err) {
  console.error(`❌ ${err.message}`);
  exitCode = 1;
} finally {
  await conn.close();
}
process.exit(exitCode);
