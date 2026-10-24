# Inventory V3 — delivery and operations

## Current milestone: P1–P5 implemented on the feature branch

Branch: `feature/inventory-v3`, created from the checked-out `dev` at `a05525f`.
The actual deployed SHA has not been verified. Compare Render's `/api/health`
`commit` and Vercel's deployment commit before selecting a production release.

The branch adds:

- `utils/inventoryV3Calculations.js`: exact decimal arithmetic with integer-paise
  results, shared by future V3 read/write services and previews.
- `config/inventoryV3Models.js`: twelve companion schemas, registered on the
  existing restaurant DB connection only when explicitly needed. No changes to
  legacy schemas, model registration, response shapes or stock transactions.
- Versioned capability/settings and workspace/mutation endpoints, using existing auth and RBAC.
- A manual, dry-run-by-default storage/index setup script.
- Flagged Inventory V3 UI with all six reference tabs and server-calculated money.
- Calculation, schema, feature-gate, settings concurrency and setup tests.

P1 through P5 are implemented, but V3 remains off by default. The legacy
Inventory page is intact and selected whenever either feature switch is off.
No new dependency, migration, setup against MongoDB, or deployment was run.

## Feature switches and API contract

`INVENTORY_V3_ENABLED` is the backend outer gate. Only literal `true` enables it;
missing, `false`, and other strings mean Off. The runtime settings document must
also have `enabled: true` and the exact supported `storageVersion: 1`.

The admin app uses Vite. Set `VITE_INVENTORY_V3=true` only when ready to serve the
new page; missing or any other value keeps the old page. Runtime availability is checked
on initial load, focus and periodically. A build variable alone is not an instant
rollback mechanism. Future V3 mutations must re-check runtime availability on the
server, not trust the browser.

All V3 routes are new and mounted ahead of the legacy `/api/admin/inventory`
router. No existing response shape or endpoint was changed:

| Method | Path | Existing permission | Behavior |
| --- | --- | --- | --- |
| GET | `/api/admin/inventory/v3/capabilities` | Staff | Off by default; no V3 collection access when backend switch is Off; `Cache-Control: no-store`; fails closed on read error |
| GET | `/api/admin/inventory/v3/settings` | Admin | Defaults if missing; explicit `storageReady`; fixed DTO |
| PATCH | `/api/admin/inventory/v3/settings` | Admin | Allowlisted fields and required current revision; no upsert; conflict if stale/unprepared; can disable when backend switch is Off |
| GET | `/api/admin/inventory/v3/workspace?month=YYYY-MM` | Admin/Manager | Inventory, suppliers, counts, recipes and book projections; financial detail is admin-only |
| POST/PATCH | `/items` and `/items/:id`, `/suppliers` and `/suppliers/:id` | Admin/Manager | Opening stock plus ledger, stock settings and supplier preferences |
| POST | `/purchases/preview`, `/purchases`, `/purchases/:id/settlements` | Staff / Admin+Manager for settlement | Server preview, transactionally recorded purchase, one-time payable settlement |
| POST | `/financial-entries`, `/financial-entries/:id/reversals` | Admin | Expenses, income, drawings, recurrence, allocations and immutable reversals |
| POST | `/counts`, `/counts/:id/approve`, `/wastage` | Employee / Admin+Manager approval / Staff | Count submission, stale-safe approval, known waste/free meal |
| POST | `/recipes/preview`, `/recipes` | Admin/Manager | Server cost preview and recipe upsert, including custom ingredients |
| POST | `/book-confirmations`, `/receipts` | Admin/Manager / Staff | Confirm a no-purchase day; upload bill photo as proof with no OCR |
| PUT/PATCH | `/book-expectations/gas`, `/recurring-rules/:id` | Admin | Set gas interval and stop a recurring rule |

Example PATCH body (revision comes from GET, never hard-code it):

```json
{"revision": 0, "enabled": false, "foodCostTargetBps": 3500, "countIntervalDays": 4, "autoOrderMode": "OFF"}
```

`storageVersion` is not client-editable. A manager cannot read or change the
settings endpoint or acquire financial access through capabilities. No auth
middleware or existing role definition was changed.

## Money and coverage contract

- New API/storage amounts: non-negative safe integer paise, except explicitly
  signed calculation inputs/results (profit, adjustment, reversal projection).
- Quantities and sub-paisa unit rates: decimal strings, maximum six decimals.
  Exact BigInt products/ratios; half-away-from-zero at a money boundary.
- Existing unit definitions and aliases remain authoritative. Incompatible units
  fail rather than guessing conversions. A line's rate is per `stockUnit`.
- Line totals round once, purchase totals sum those rounded lines. Missing costs
  are null, distinct from an explicitly known zero. Legacy adapters must convert
  existing sentinel zero/missing costs to null when zero means "not entered".
- Percentages are basis points: 3500 = 35%. Target colour compares unrounded ratios.
- Food COGS uses opening valuation + purchases + signed valuation adjustments −
  closing valuation. Callers must supply the same valuation basis and covered
  interval. Negative inferred use is incomplete, not a negative expense.
- Count reconciliation uses matching items/intervals and separates recorded known
  waste/free meals from unexplained shortage. `reversalQty` is a separate positive
  inflow; do not also net it out of the `recipeQty` deduction input.
- The P4 service must reject stale count observations, save unchanged counts,
  and commit approval and stock movements in one transaction.
- Days remaining is an observation-based estimate. Zero consumption, no observation
  days or incomplete evidence yields null. Overall days cannot sum different units;
  the eventual overview must use a documented value-weighted basis or item coverage.
- Dish running-cost allocation follows the reference: price × operating costs /
  actual revenue. MRP-based period profit is an estimate where realised prices or
  discounts differ. It is not a second set of booked revenue figures.
- Minimum target price rounds UP, so the target is actually met (₹62 / 35% gives
  ₹177.15; rounding to a ₹5 increment gives ₹180).
- Salary expense uses the existing final salary `breakdown.gross` once. Advances
  are cash movements, not additional operating expense. An empty payment list is
  not proof payroll is complete; the books service must check expected employees.
- Drawings, capital spending, supplier settlement and advances are not operating
  costs. Depreciation/amortisation, interest and tax follow EBITDA.
- Annual/equipment allocations preserve all paise; remainder goes to earliest
  periods. Input basis, residual, start and periods must be explicitly configured.
- Recurring occurrences have stable IDs. A matched entered bill supersedes the
  scheduled amount. Reversals are projected with a negative sign by the service;
  stored financial-entry amounts remain positive and reference the original.
- Actual revenue must use the existing paid/non-cancelled Order eligibility and
  consistent date boundaries. Do not subtract excluded cancellations again as
  write-offs. No new write-off inference or billing recalculation is implemented.
- All new money totals/previews must use this server module. UI code only formats
  returned values with ₹ and `en-IN` grouping. Old page arithmetic is untouched.

## Manual storage setup (not a deploy hook)

All new schemas have `autoCreate: false` and `autoIndex: false`. The setup script
creates only V3 companion collections and declared indexes. It never drops an
index, calls `syncIndexes`, changes legacy documents, or backfills history. It
marks storage ready only after index creation succeeds. Re-running preserves
existing runtime settings. Index conflicts fail and require investigation.

No setup is necessary to deploy P1 with the gate Off.

When ready, run first against a dedicated staging database. Start in the repo root:

```powershell
Set-Location restaurant-server
# Set INVENTORY_V3_SETUP_URI securely in this shell to the intended MongoDB URI.
# The script deliberately does not load .env or fall back to MONGO_URI.
node scripts/setup-inventory-v3.js --database <exact-database-name> --dry-run
```

Check the database name and planned companion collections/indexes, then manually:

```powershell
node scripts/setup-inventory-v3.js --database <exact-database-name> --apply
node scripts/setup-inventory-v3.js --database <exact-database-name> --dry-run
```

Use the real database name in place of `<exact-database-name>`; the script refuses
a connection whose selected database differs. Omitting both mode flags is dry-run.
The script requires explicit `INVENTORY_V3_SETUP_URI`, never prints it, and refuses
to downgrade a newer storage version. It sets the first runtime flag to false.
Database permissions must permit creating these collections/indexes for apply.
This command has not been executed against a database by the coding agent.

## Verification commands

From the repo root, with existing lockfile dependencies installed:

```powershell
Set-Location restaurant-server
npm.cmd run test:inventory-v3
node --check server.js
node scripts/setup-inventory-v3.js --help
$tests = @('inventory.test.js','inventoryLogic.test.js','inventoryDeduction.test.js','inventoryAlerts.test.js','purchases.test.js','recipeCosting.test.js','purchaseImportParser.test.js','ebitda.test.js','insightsOverview.test.js','editAfterKitchen.test.js','menuOrderPerf.test.js','managerRole.test.js')
foreach ($testFile in $tests) {
  node "test/$testFile"
  if ($LASTEXITCODE -ne 0) { throw "Failed: $testFile" }
}
Set-Location ../admin
npm.cmd run build
npm.cmd run lint
npm.cmd run i18n:check
```

`npm.cmd` avoids this Windows machine's PowerShell script execution-policy error.
On other platforms use `npm`. Backend is plain JS; it has no build script.

Current observed results:

- 42 new tests passed (no database connection).
- All 12 listed existing regression suites passed.
- Admin production build passed; server syntax check passed.
- Existing admin lint fails with five errors: duplicate `Break` key in
  `admin/src/i18n/bn/staff.js`, and four unused payment-state variables in
  `admin/src/pages/admin/OrdersPage.jsx`.
- Existing translation check reports 19 missing Bengali entries in unchanged
  Orders, Invoices, Staff and shared components. No admin files changed in P1.

The storage tests use fakes to establish no-write dry-run behavior and repeatability.
Real MongoDB index creation, uniqueness and transactions have not been exercised
here. Before enabling later business writes, a separate nonproduction replica-set
integration gate must cover concurrent purchases/counts, request retries and
transaction rollback. No production DB should be used for these tests.

## Deploy and rollback checks

1. Verify deployed base commits; deploy the backend with
   `INVENTORY_V3_ENABLED=false` or absent. No setup runs from deploy hooks.
2. Check `/api/health`, legacy Inventory loading and stock writes, purchase reads,
   payable settlement and menu deductions on staging. Capabilities must report
   `enabled:false` and all feature flags false; unauthenticated requests are 401
   and manager requests to settings are 403.
3. On a dedicated staging replica set, follow the manual dry-run/apply commands
   above. Exercise purchases and repeated request keys, stale counts, approvals,
   custom recipes, recurrence replacement, reversals, uploads and transaction
   rollback. Do not use a production database.
4. Set backend `INVENTORY_V3_ENABLED=true` while the stored runtime setting stays
   false. Set Vercel `VITE_INVENTORY_V3=true` and deploy the admin build. The old
   page remains selected until the runtime setting is enabled.
5. Using an authenticated admin token, enable runtime V3 with the revision
   returned by GET `/api/admin/inventory/v3/settings`:

   ```powershell
   $headers = @{ Authorization = "Bearer <admin-token>" }
   $body = @{ revision = 0; enabled = $true } | ConvertTo-Json
   Invoke-RestMethod -Method Patch -Uri "https://<api-host>/api/admin/inventory/v3/settings" -Headers $headers -ContentType "application/json" -Body $body
   ```

   Replace revision `0` with the current revision. Verify the V3 tabs, order
   deductions and count approval on staging before enabling production.
6. Rollback: use V3 Settings (or “Switch back to original Inventory”) to disable
   runtime V3, then set the Render switch false if needed. Browsers poll every ten
   seconds. Restore the prior Vercel build if necessary. Preserve companion
   collections and valid stock/purchase movements; never delete transactions.

The legacy page cannot display new V3 expense/drawing records after rollback;
those records must remain preserved and accessible when V3 is restored. Existing
legacy stock/purchase records remain readable by the old UI.

## Delivered phases and reference constraints

- P2: flagged Stock/Suppliers, audited opening stock, reorder configuration.
- P3: purchases, expenses/income/drawings, recurring rules, schedules, ledger.
- P4: count submit/approve, losses, recipes, allocations and coverage.
- P5: overview/books/attention/running costs and a one-line link to the existing Insights ladder.

Keep the original page intact and the earnings ladder exclusively in Insights.
All mock figures, historical sample names and hardcoded success toasts are replaced
by real results. AI previews never upload, extract, save or call an AI backend.

Scope limits from the Phase 1 review remain in force:

- New expenses/drawings cannot change existing Invoices day-close totals without
  changing prohibited Invoices behavior. V3 reports their cash effects separately;
  do not promise an integration that has not been approved and implemented.
- Existing cancellation reverses stock, unlike the reference's cooked write-off
  assumption. Read Orders as-is and report missing write-off evidence.
- Salary gross comes from existing Staff snapshots; do not alter payroll rules.
- Packaging is food cost once, not also an operating expense.
- Known waste/free meals are separated before unexplained-loss totals.
- Calendar-period food cost and EBITDA stay unavailable until count coverage and
  eligible sales align; the UI shows missing evidence instead of scaling partial
  count intervals or filling gaps with estimates.
- Supplier order preparation never silently sends a message. The reference's
  interactive "Prepare, send in one tap" takes precedence over its contradictory
  change-note wording "Send automatically".
- The source HTML is the user's supplied, currently untracked file; it is not
  modified or automatically staged by this change.
