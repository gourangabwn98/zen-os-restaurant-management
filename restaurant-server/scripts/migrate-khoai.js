// scripts/migrate-khoai.js
// ─────────────────────────────────────────────────────────────────────────────
// Hotel KHOAI change round — one-off data steps for EXISTING records.
// Safe by construction:
//   • DRY RUN by default — prints what it would change. Add --apply to write.
//   • Idempotent — only touches documents that still need the step.
//   • Never deletes anything; historical orders / bills keep every field.
//
//   node scripts/migrate-khoai.js            # report only
//   node scripts/migrate-khoai.js --apply    # write the safe backfills
//   node scripts/migrate-khoai.js --apply --rebrand   # also rename an old
//        "AD's Cafe"-style restaurant name to BRAND_NAME (GLB-02)
//   node scripts/migrate-khoai.js --apply --fix-qr    # rebuild stale table QR
//        links with the CURRENT customer URL, keeping each table's token
//
// Steps
//   BIL-02  orders without billStatus: COMPLETED → SETTLED, others → OPEN
//   MNU-0x  built-in smart categories (also done at server start)
//   EMP-02  staffPolicy.paidLeavePerMonth still at the old default (1) → 4
//   GLB-02  report (and with --rebrand fix) an old restaurant name; the LOGO
//           can only be replaced by uploading it in Admin → Profile
//   TBL-01  report (and with --fix-qr fix) QR codes that don't open today's
//           customer app
// ─────────────────────────────────────────────────────────────────────────────
import "../config/env.js";
import * as QRCode from "qrcode";
import { getDB } from "../config/db.js";
import { getModels } from "../config/getModels.js";
import { ensureSmartCategories } from "../services/smartCategoryService.js";
import { BRAND_NAME } from "../utils/brand.js";
import { customerBaseUrl, tableQrUrl, isQrStale } from "../utils/qrLink.js";

const APPLY = process.argv.includes("--apply");
const REBRAND = process.argv.includes("--rebrand");
const FIX_QR = process.argv.includes("--fix-qr");
const OLD_BRAND = /\b(ad'?s|adda|adds)\s*cafe\b|eddie'?s/i;

const log = (...a) => console.log(...a);
const step = (id, title) => log(`\n── ${id} · ${title}`);

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");
  const conn = await getDB(process.env.MONGO_URI);
  const models = getModels(conn);
  const { Order, RestaurantProfile, Table } = models;
  log(APPLY ? "APPLY mode — changes will be written." : "DRY RUN — nothing is written (add --apply).");

  step("BIL-02", "bill status on existing orders");
  const legacyCompleted = await Order.countDocuments({ billStatus: { $exists: false }, status: "COMPLETED" });
  const legacyOther = await Order.countDocuments({ billStatus: { $exists: false }, status: { $ne: "COMPLETED" } });
  log(`  completed orders → SETTLED: ${legacyCompleted}`);
  log(`  other orders     → OPEN:    ${legacyOther}`);
  if (APPLY) {
    const a = await Order.updateMany({ billStatus: { $exists: false }, status: "COMPLETED" }, { $set: { billStatus: "SETTLED" } });
    const b = await Order.updateMany({ billStatus: { $exists: false }, status: { $ne: "COMPLETED" } }, { $set: { billStatus: "OPEN" } });
    log(`  written: ${a.modifiedCount} settled, ${b.modifiedCount} open`);
  }

  step("MNU-03/04/05/07", "built-in smart categories");
  if (APPLY) { await ensureSmartCategories({ models, force: true }); log("  ensured"); }
  else log("  will be ensured (also happens automatically at server start)");

  step("EMP-02", "monthly leave allowance");
  const prof = await RestaurantProfile.findOne().lean();
  const perMonth = prof?.staffPolicy?.paidLeavePerMonth;
  log(`  current paidLeavePerMonth: ${perMonth ?? "(not set → 4)"}`);
  if (perMonth === 1) {
    log("  still the old default (1) → 4 per the tracker");
    if (APPLY) await RestaurantProfile.updateOne({ _id: prof._id }, { $set: { "staffPolicy.paidLeavePerMonth": 4 } });
  }

  step("GLB-02", "restaurant name / logo in the database");
  if (!prof) log("  no restaurant profile yet");
  else {
    log(`  restaurantName: "${prof.restaurantName}"  upiPayeeName: "${prof.upiPayeeName || ""}"`);
    log(`  logo: ${prof.logo || "(none)"}`);
    const oldName = OLD_BRAND.test(prof.restaurantName || "") || OLD_BRAND.test(prof.upiPayeeName || "");
    if (oldName) {
      log(`  ⚠ old branding found${REBRAND ? "" : " — run with --apply --rebrand to rename it to \"" + BRAND_NAME + "\""}`);
      if (APPLY && REBRAND) {
        const set = {};
        if (OLD_BRAND.test(prof.restaurantName || "")) set.restaurantName = BRAND_NAME;
        if (OLD_BRAND.test(prof.upiPayeeName || "")) set.upiPayeeName = BRAND_NAME;
        await RestaurantProfile.updateOne({ _id: prof._id }, { $set: set });
        log(`  renamed: ${JSON.stringify(set)}`);
      }
    }
    log("  ⚠ the logo can only be replaced by uploading the Hotel KHOAI logo in Admin → Profile (bills print it).");
  }

  step("TBL-01", "table QR links");
  const base = customerBaseUrl();
  if (!base) log("  ⚠ CUSTOMER_FRONTEND_URL is not set — no QR can be generated until it is");
  else {
    const tables = await Table.find().lean();
    const stale = tables.filter((t) => isQrStale(t, base));
    log(`  customer app: ${base}`);
    log(`  ${stale.length} of ${tables.length} table QR codes don't open it: ${stale.map((t) => t.tableNo).join(", ") || "—"}`);
    if (stale.length && APPLY && FIX_QR) {
      for (const t of stale) {
        const token = t.qrToken || (await import("crypto")).randomBytes(9).toString("hex");
        const url = tableQrUrl(base, t.tableNo, token);
        const qrCode = await QRCode.toDataURL(url, { width: 300, margin: 2, color: { dark: "#1a1a2e", light: "#ffffff" }, errorCorrectionLevel: "H" });
        await Table.updateOne({ _id: t._id }, { $set: { qrUrl: url, qrCode, qrToken: token } });
      }
      log(`  rebuilt ${stale.length} — reprint those table QR stickers`);
    }
  }

  log("\nDone.");
  await conn.close();
};

main().catch((err) => { console.error(err); process.exit(1); });
