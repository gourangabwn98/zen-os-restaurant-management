# Hotel KHOAI change round — implementation map & report

Source of truth: *Hotel KHOAI — Change & Requirement Tracker* (Claude Doc, 60 items).
Item IDs are used in code comments, tests and this report.

## Phase 0 — what already existed (audit, 2026-10-04)

| Area | Existing implementation | Gap vs tracker |
|---|---|---|
| Apps | `admin/` (= the POS + Admin console), `waiter/`, `kitchen/`, `customer/` (PWA), `restaurant-server/`, `print-service/` | no separate "POS" app — Admin is the POS |
| Branding | `admin/src/theme.js` `BRAND_NAME = "Ad's Cafe"`; AdminLayout fallback `"Ad's Cafe"` while the profile loads; Kitchen header `"Ad's Cafe"`; titles "Zen OS — …"; customer manifest "Zen OS — Order", generic plate icon; login logo = peacock (`charu_logo.webp`); OTP SMS "Adda Cafe"; DB `RestaurantProfile` / print-service cache hold the old name+logo | "Eddie's Cafe" = the spoken **"AD's Cafe"** fallback flashing during load/transitions (GLB-02) |
| Order lifecycle | `utils/orderStateMachine.js`; edit window (`autoPrepareAt`, `editWindowMinutes` = 3, DB-persisted, 15 s server tick, exactly-once KOT via `sendToKitchenTx`) | window starts at staff **acceptance**, customer can't edit while `PENDING_CONFIRMATION` (ORD-01) |
| Billing | `Order.paymentStatus` (money) + `Order.status=COMPLETED` set **by hand** from Dashboard / Orders / Waiter ("Mark Completed"), gated on PAID; legacy `Invoice` collection still read by the Dashboard ("invoice pending", Mark paid/Cancel on the floor) | no settlement concept; completion is an operational button; dashboard bills (BIL-01/02, DSH-03) |
| Dashboard floor | `dashboard/model.js floorTables` guesses: held orders = "Cooking", READY = "Eating", plus "bill"/"long" overrides | DSH-04/05 |
| Menu | `MenuItem.category` = one category **name**; `Category.sortOrder` drag order (admin); customer groups items alphabetically (`sort category:1`) | MNU-01..07; customer ignores saved order (MNU-02) |
| i18n | Admin: hand-rolled EN/বাংলা (`i18n/core.js`, lazy bn dictionary) | Waiter + Kitchen have none (GLB-04) |
| Theme | Admin: light/dark/**system**; customer light/dark | GLB-05 |
| Sidebar | Admin: hide/show whole sidebar; hidden state has no nav and **no bell** | GLB-06, NTF-01 |
| Notifications | Admin bell in sidebar brand row, order events only, in-memory | NTF-01/02/03 (no waiter calls / system alerts, vanishes when sidebar hidden) |
| Tables/QR | QR = `${CUSTOMER_FRONTEND_URL}/?table=N&t=token`, image stored at creation; capacity select 2/4/6 | QR built from an unset/old base URL is not a link (TBL-01); TBL-02/03/04 |
| Inventory | Purchases (item must exist, `invoiceNumber` optional, date only), wastage (item must exist, fixed reasons), suppliers (name/phone/email/GST) | INV-01..14 |
| Employees | `User` role admin/waiter/chef; `hr` sub-doc already has ID proof, emergency, photo, UPI/bank; attendance sessions ONLINE/BREAK/OFFLINE (self-service); leave PENDING/APPROVED/DECLINED with a hand-set `paid` flag; `paidLeavePerMonth` default 1 | EMP-01 (manager set), EMP-02 (4/month carry-forward, approval-keyed pay), EMP-03 (Other role) |
| Insights | revenue, making cost, dishes, customers | INS-01/02 |
| Settings | `services.{dineIn,takeAway,delivery}` saved but **never enforced** (backend or customer cart) | SET-01 |
| Customer | hero carousel (banners, best sellers, coupons), Sheet-based Call waiter, 5-tab nav with a special centre "fab" for Orders, cart repeats the table | CUS-02..07 |
| Tests | 36 backend suites (plain node + fakes), all green; waiter has 1 test; no frontend test runner | builds are the frontend gate |

## Key design decisions

- **BIL-02** — new billing lifecycle on the order: `billStatus OPEN|SETTLED`, `billSettledAt`, `billSettledBy`.
  `paymentStatus` stays "money received". `services/billingService.js settleBills` is the only way to settle
  (records the payment if not yet paid, then settles). Operational `COMPLETED` is now **system-only**
  (`orderStateMachine` `SYSTEM_ONLY_TARGETS`): it is applied by billing when an order is both *served*
  (`DELIVERED`) and *settled* — whichever happens last. No person, admin included, can move an order to
  COMPLETED through the status endpoint any more. Existing COMPLETED orders read as SETTLED (read-time
  fallback + idempotent `scripts/migrate-khoai.js`).
- **DSH-04/05** floor state = the table's *current* order (latest active, else latest completed today):
  Placed (held, not cooking) → Cooking (PREPARING) → Ready to Deliver (READY) → Eating (DELIVERED, waiter
  taps **Served**) → Completed (bill settled). Legacy `Invoice` docs no longer drive the floor.
- **ORD-01** keeps staff acceptance of QR orders (existing anti-prank gate) but the hold now counts from
  **placement**: `autoPrepareAt = max(placedAt + window, acceptedAt)`. Customers may edit from placement
  (PENDING_CONFIRMATION or Placed) until the KOT fires. Timer stays server-side.
- **MNU-01** `MenuItem.categories: [String]` (extra categories, by name, like `category`); `category` stays
  the primary (schedule, reports, history). **MNU-03/04/05/07** are *smart* `Category` docs
  (`kind: "SMART"`, `smartKey`) whose members are computed (item flags / real sales / real ratings), so they
  get admin ordering (MNU-02) and icons (MNU-06) for free. Order lines keep their own snapshots.
- **Branding** — one `brand.js` per app (apps are separately built, no shared package by design) +
  `/brand/*` static assets; the DB profile name/logo still wins once loaded. Server: `utils/brand.js`.
</content>
</invoke>

---

## Final report (2026-10-04)

**How this was verified:** 43 backend suites (`node test/*.test.js`) pass; admin has 3 test files
(floor states, menu categories, table session) and waiter and kitchen have i18n tests, all passing.
All four frontends build (`npm run build`). Admin ESLint is clean, and admin `npm run i18n:check`
reports every one of its 3,873 strings translated. **Not done:** a click-through in a browser
against a real MongoDB, and running the migration. Treat a staging pass as the next gate.

### Tracker completion

| ID | Requirement | Status | Main files | Tests | Notes |
|---|---|---|---|---|---|
| GLB-01 | Hotel KHOAI branding across POS & Admin | COMPLETE | `*/src/brand.js`, `*/public/brand/khoai-v2/`, AdminLayout, LoginPage, `restaurant-server/utils/brand.js` | build | The DB profile name/logo still wins once loaded — see GLB-02 |
| GLB-02 | "Eddie's Cafe" must never appear | PARTIAL | brand.js fallbacks, Kitchen header, OTP SMS | build | Code no longer has "AD's Cafe". The **DB profile** may still hold it: run `migrate-khoai.js --rebrand` |
| GLB-03 | Browser tab titles | COMPLETE | each `index.html`, manifest | build | "Hotel KHOAI – Admin / Waiter / Kitchen" |
| GLB-04 | Language switcher (English / বাংলা) | COMPLETE | admin `LanguageProvider` (no remount), waiter + kitchen `i18n/` | waiter/kitchen `i18n.test.js`, `i18n:check` | Switching keeps forms, route, order and login |
| GLB-05 | Theme: Light and Dark only | COMPLETE | admin `themeContext.js`, `ThemeProvider.jsx`, `ThemeToggle.jsx`, server theme endpoint | build | A saved "system" value migrates to dark |
| GLB-06 | Collapsible sidebar | COMPLETE | `AdminLayout.jsx` | build | Remembered per device |
| GLB-07 | Consistent time picker | COMPLETE | `admin/src/components/TimePicker.jsx`; menu, offers, profile, purchase | build | No native `type="time"` left in admin |
| NTF-01 | Notification icon placement | COMPLETE | `NotificationBell.jsx`, AdminLayout top bar | build | |
| NTF-02 | Expandable notification panel | COMPLETE | `NotificationBell.jsx`, `useNotificationFeed.js` | build | |
| NTF-03 | Consistent notification UI | COMPLETE | `notifications/model.js` (one line component for toast + panel) | build | |
| DSH-01 | Keep Today's Details and Totals | COMPLETE | `DashboardPage.jsx` | build | Guard: kept unchanged |
| DSH-02 | Table Detail View from On the Floor | COMPLETE | `dashboard/TableDetailView.jsx`, `FloorCard.jsx` | build | |
| DSH-03 | No order completion from the Dashboard | COMPLETE | `DashboardPage.jsx`, `orderStateMachine.js` (COMPLETED system-only) | `billing`, `orderLogic` | Server-enforced, not just hidden |
| DSH-04 | Floor status flow with named triggers | COMPLETE | `dashboard/model.js`, `floorLabels.js`, `statusLabels.js` | `admin/test/floorState.test.js` | Placed → Cooking → Ready to Deliver → Eating → Completed |
| DSH-05 | Dashboard shows the current active state | COMPLETE | `dashboard/model.js floorTables` | `floorState.test.js` | |
| ORD-01 | 3-minute change window (KOT held) | COMPLETE | `orderService.js` (`holdUntil`, `EDITABLE_STATUSES`) | `editWindow.test.js` | Counts from placement; owner questions below |
| ORD-02 | Add Items opens the real Customer menu | COMPLETE | customer `useOrderEdit.js`, `AppState.jsx`, `OrderEditReview.jsx` | build | The cart becomes the edit draft |
| BIL-01 | Billing only through the Invoice workflow | COMPLETE | `InvoicesPage.jsx`, `InvoiceDrawer.jsx`, `CollectModal.jsx`, TablesPage, OrdersPage, waiter `OrderDetailPage` | `billing.test.js` | Legacy Invoice docs no longer used on the floor |
| BIL-02 | Separate operational and billing status | COMPLETE | `billingService.js`, `billingController.js`, `orderStateMachine.js` | `billing`, `paymentBeforeComplete` | Settled + served ⇒ completed, whichever happens last |
| TBL-01 | QR opens the Customer PWA directly | PARTIAL | `utils/qrLink.js`, `tableController.js`, TablesPage "Fix link" | `qrLink.test.js` | Needs `CUSTOMER_FRONTEND_URL` set, then old QRs fixed and reprinted |
| TBL-02 | Free-entry table capacity | COMPLETE | TablesPage (create + edit), `tableController.cleanSeats` | build | 1–100 |
| TBL-03 | QR auto-generation note only | COMPLETE | TablesPage create modal | build | |
| TBL-04 | "Party Size" → "Number of People" | COMPLETE | TablesPage waitlist | build | |
| MNU-01 | One item, multiple categories | COMPLETE | `MenuItem.categories`, `menuController.js`, `categoryService.js`, admin item form | `menuCategories`, `categoryService`, admin `menuCategories.test.js` | One document everywhere |
| MNU-02 | Admin controls category order | COMPLETE | existing drag order, now including smart categories | `menuBoard` | |
| MNU-03 | Fast Available flag | COMPLETE | `isFastAvailable`, item form "Special lists" | `menuCategories` | |
| MNU-04 | Chef's Picks flag | COMPLETE | `isChefsPick` | `menuCategories` | |
| MNU-05 | Today's Special flag | COMPLETE | `isTodaysSpecial` | `menuCategories` | |
| MNU-06 | Category icons | COMPLETE | `CategoryIcon.jsx` (admin + customer), icon picker, `iconShown` | admin `menuCategories.test.js` | No emoji placeholders |
| MNU-07 | Smart categories from data | COMPLETE | `smartCategoryService.js` | `menuCategories` | Empty, and hidden from customers, until real data exists |
| INV-01 | Inline Add Supplier | COMPLETE | `EntryModals.jsx PurchaseModal` | build | |
| INV-02 | Purchase bill number | COMPLETE | `utils/purchaseBill.js`, PurchasesTab "System-generated" tag | `purchases.test.js` | The `AUTO-` prefix awaits owner confirmation |
| INV-03 | Bill date and time | COMPLETE | PurchaseModal (date + TimePicker), `validateBillDateTime` | `purchases` | Restaurant timezone, never in the future |
| INV-04 | Manual item entry | COMPLETE | PurchaseModal manual lines, `stockItemForManualLine` | `purchases` | Links or creates the stock item |
| INV-05 | Supplier bill photo | COMPLETE | `POST /purchases/bill-photo`, PurchaseModal | build | OCR only suggests the number |
| INV-06 | Payment type: Paid or Credit | COMPLETE | `paymentPlan`, PurchaseModal, PurchasesTab | `purchases` | |
| INV-07 | Payment source incl. Owner's Pocket | COMPLETE | `paymentPlan`, "Money owed" panel, `settlePurchasePayable` | `purchases`, `ebitda` | Booked as a payable, never counted twice |
| INV-08 | Manual waste item | COMPLETE | `recordWastage`, WastageModal, WastageTab | `purchases` | Recorded as a loss only; no stock moved |
| INV-09 | Quantity with unit | COMPLETE | WastageModal + PurchaseModal unit selects, `utils/units.js` | `purchases` | |
| INV-10 | Waste reason with Others | COMPLETE | WastageModal | `purchases` | Free text required |
| INV-11 | Supplier fields | COMPLETE | `utils/supplierInput.js`, SuppliersTab | `purchases` | Whitelisted (it used to accept `req.body` wholesale) |
| INV-12 | Supplied items | COMPLETE | SuppliersTab | `purchases` | Stock items or typed names |
| INV-13 | Auto-order preference | PARTIAL | `autoOrderPreference`, SuppliersTab | `purchases` | The preference is stored and shown. No automatic re-order sending exists yet |
| INV-14 | Credit preference | COMPLETE | `creditPreference`/`creditTerms`, PurchaseModal default | `purchases` | |
| EMP-01 | Manager-set employee status | COMPLETE | `setEmployeeShift`, `PATCH /:id/shift`, EmployeeProfile `ShiftControl` | `khoaiStaff` | The heartbeat sweep never auto-closes these |
| EMP-02 | Monthly leave: carry-forward + approval pay | COMPLETE | `leaveService.js`, LeaveTab | `staffHr`, `khoaiStaff` | Approved = paid, declined = loss of pay; no cap (to confirm) |
| EMP-03 | Employee role with Other | COMPLETE | role `staff` + `jobTitle`, EmployeeForm | `khoaiStaff` | No app login for this role |
| EMP-04 | Employee documents | COMPLETE | existing DocumentsTab (`hr.*`) | existing | ID proof is stored as type + last 4 digits, not a scan |
| INS-01 | EBITDA section | COMPLETE | `computeEbitda`, `insights/Ebitda.jsx` | `ebitda.test.js` | Rent and power aren't recorded in the app, so they aren't deducted |
| INS-02 | "Where Every Rupee Went" | COMPLETE | existing ladder + "Where the money went out" (`purchasesByFunding`) | `ebitda` | |
| SET-01 | Service toggles save and take effect | COMPLETE | `utils/serviceToggles.js`, `profileController.js`, customer CartPage, Profile hint | `serviceToggles.test.js` | Staff orders are exempt |
| SET-02 | Restaurant Profile UI to mockup | COMPLETE | `ProfilePage.jsx` | build | "Pure veg mode" from the mockup is a new feature — see the audit |
| CUS-01 | Hotel KHOAI logo on auth & install | COMPLETE | customer LoginPage, InstallPrompt, manifest, SW | build | iOS home-screen icons refresh only on reinstall |
| CUS-02 | Home promotional banner | COMPLETE | `BannerCarousel.jsx` | build | Fed by MNU-03/04/05 + best sellers |
| CUS-03 | Offers and coupons on Home | COMPLETE | `OffersRail.jsx` | build | |
| CUS-04 | Remove duplicate table info in Cart | COMPLETE | `CartPage.jsx`, `Topbar.jsx` | build | |
| CUS-05 | Consistent bottom-nav active state | COMPLETE | `BottomNav.jsx`, CSS | build | Four tabs |
| CUS-06 | Call Waiter UI consistency | COMPLETE | `CallWaiterFab.jsx` | build | One control |
| CUS-07 | Call Waiter centered modal | COMPLETE | `components/ui/Modal.jsx` | build | |
| AUD-01 | Mockup ↔ Production parity audit | PARTIAL | this report | — | First pass done (below); a screen-by-screen visual review on staging is still needed |

**Totals:** 56 COMPLETE · 4 PARTIAL (GLB-02, TBL-01, INV-13, AUD-01) · 0 BLOCKED.

### AUD-01 — first-pass parity findings (`design-reference/zen-os-design-reference.html`)

For every screen, its section titles and buttons were checked against the admin and kitchen source.
Tables, Combined bill, Invoices and Restaurant profile were also compared by hand.

| Screen | Gap | Done now? |
|---|---|---|
| Tables | "Print all QR codes" | **Added** |
| Combined bill | "Send on WhatsApp" | **Added** |
| Restaurant profile | "last updated" subtitle, GSTIN under Identity | **Added** |
| Restaurant profile | "Pure veg mode" toggle (hides non-veg items) | Not built — a new feature; needs owner sign-off |
| Invoices | "Refunded" figure in the strip | Not built — there is no refund state (a refund is a cancellation) |
| Inventory → movements | "Source" filter | Not built (P3 polish) |
| Several | Label wording ("Add table" vs "New Table", "Create account" vs "Add Employee") | Left as is; cosmetic |

### Architecture changes
- Orders carry a billing lifecycle (`billStatus`), separate from `status` and `paymentStatus`. COMPLETED is system-only.
- Smart categories are real `Category` documents, filled from flags or data when they are read.
- Purchases carry payment type, source and a `payable` sub-document. Paying it back is a settlement, not a cost.
- Each app has one `brand.js`; brand assets are versioned; the service worker clears old caches.

### DB / schema changes (all additive, nothing deleted)
- `Order`: `billStatus`, `billSettledAt`, `billSettledBy`.
- `Category`: `kind`, `smartKey` (unique partial index), `icon`.
- `MenuItem`: `categories[]`, `isFastAvailable`, `isChefsPick`, `isTodaysSpecial`.
- `Supplier`: `suppliedItems`, `autoOrderPreference`, `creditPreference`, `creditTerms`.
- `StockPurchase`: line `name/unit/manual/amount` (`inventoryItem` optional), `billNumberSource`, `billDate`, `billTime`, `billPhoto`, `paymentType`, `paymentSource`, `payable`.
- `WastageLog`: `itemName`, `unit`, `reasonText` (`inventoryItem` optional).
- `User`: role `staff`, `jobTitle`. `AttendanceSession`: role `staff`, `managed`, `changedBy`.
- Migration `restaurant-server/scripts/migrate-khoai.js`: dry run by default; `--apply`, `--rebrand`, `--fix-qr`. **Not run.**

### API changes
- `POST /api/admin/orders/settle`, `POST /api/admin/orders/:id/reopen-bill`.
- `PATCH /api/admin/employees/:id/shift`.
- `POST /api/admin/inventory/purchases/bill-photo`, `GET /payables`, `POST /purchases/:id/settle-payable`, `GET /cash-out`.
- `POST …/regenerate-qr` accepts `{ keepToken }`. `GET /tables` adds `qrStale`/`qrBaseConfigured` and strips QR tokens for non-staff.
- The status endpoint refuses COMPLETED from people. `PATCH …/payment` refuses changes on a settled bill (409).
- The categories list adds `iconShown`, `smartSource`, `smartFlag`; menu items add `categoryList`.

### PWA / cache
- The customer manifest keeps `"id": "/"`, so installed apps update in place. Bumping `SW_VERSION` deletes old caches; Vercel cache headers are added.

### Owner decisions still open
1. **ORD-01** — should a manager be able to override after the KOT prints (e.g. with a PIN)? Should unaccepted QR orders go to the kitchen on their own?
2. **EMP-02** — is there a cap on carried-forward leave? (None today.)
3. **INV-02** — is `AUTO-` the right marker for system bill numbers?
4. **AUD-01** — should "Pure veg mode" be built?

### Owner / deploy actions
- Set `CUSTOMER_FRONTEND_URL` (and optionally `BRAND_NAME`) on the backend.
- Run `node scripts/migrate-khoai.js` as a dry run, then with `--apply --rebrand --fix-qr`. Upload the Hotel KHOAI logo in Admin → Profile.
- Reprint table QRs after "Fix link".
- Consider a custom domain instead of `zen-os-customer.vercel.app`.

### Known pre-existing issue (not changed)
- A customer Firebase login with an employee's phone number returns that employee's token. The `staff` role has no app access, so it is not an escalation path for the new role, but it should be reviewed.
