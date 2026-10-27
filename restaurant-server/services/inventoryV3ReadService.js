import * as c from "../utils/inventoryV3Calculations.js";
import { classifyStockLevel } from "../utils/inventoryConstants.js";
import { effectiveRole } from "../middleware/rbac.js";
import { fail, profileTimezone, localDay, dayInstant, validDate } from "./inventoryV3Operations.js";

const sid = (v) => String(v?._id || v || "");
const amount = (v) => c.rupeesToPaise(c.legacyDecimal(v || 0));
const bounded = async (query) => { const rows = await query.limit(10001).lean(); if (rows.length > 10000) throw fail("Too many records. Choose a shorter reporting period.", 422); return rows; };
export const monthBounds = (month, timezone, now = new Date()) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail("Choose a valid month");
  const startDay = `${month}-01`, [y, m] = month.split("-").map(Number);
  const nextDay = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  return { from: dayInstant(startDay, timezone), to: new Date(Math.min(dayInstant(nextDay, timezone).getTime(), now.getTime())), startDay, endDay: localDay(new Date(Math.min(dayInstant(nextDay, timezone).getTime() - 1, now.getTime())), timezone) };
};
const recipeProjection = (r, byId) => (r?.ingredients || []).map((l) => {
  const item = byId.get(sid(l.inventoryItem));
  return l.sourceType === "CUSTOM" ? { sourceType: "CUSTOM", costPaise: l.cost == null ? null : amount(l.cost) } : {
    quantity: c.legacyDecimal(l.quantity), unit: l.unit, stockUnit: item?.unit || l.unit, unitRateRupees: item?.costPrice > 0 ? c.legacyDecimal(item.costPrice) : null,
  };
});

export const stockData = async (req) => {
  const [items, configs, suppliers, supplierConfigs, payables] = await Promise.all([
    bounded(req.models.InventoryItem.find({ status: "Active" }).sort({ name: 1 })), bounded(req.v3.InventoryItemV3Config.find()),
    bounded(req.models.Supplier.find({ status: "Active" }).sort({ name: 1 })), bounded(req.v3.InventorySupplierV3Config.find()),
    bounded(req.models.StockPurchase.find({ "payable.to": { $in: ["SUPPLIER", "OWNER"] }, "payable.settledAt": null }).sort({ purchaseDate: 1 })),
  ]);
  const byConfig = new Map(configs.map((x) => [sid(x.inventoryItem), x])), bySupplier = new Map(supplierConfigs.map((x) => [sid(x.supplier), x]));
  const rows = items.map((i) => ({ ...i, config: byConfig.get(sid(i)) || {}, costPaise: i.costPrice > 0 ? amount(i.costPrice) : null,
    valuePaise: i.costPrice > 0 ? c.lineAmountPaise({ quantity: c.legacyDecimal(i.currentStock), unit: i.unit, unitRateRupees: c.legacyDecimal(i.costPrice) }) : null,
    stockLevel: classifyStockLevel(i.currentStock, i.reorderLevel, i.criticalLevel) }));
  const bills = payables.map((p) => ({ _id: p._id, supplier: p.supplier, date: p.billDate || p.purchaseDate, invoiceNumber: p.invoiceNumber, to: p.payable.to, amountPaise: amount(p.payable.amount) }));
  return { items: rows, suppliers: suppliers.map((s) => ({ ...s, config: bySupplier.get(sid(s)) || {}, duePaise: c.sumPaise(bills.filter((b) => b.to === "SUPPLIER" && sid(b.supplier) === sid(s)).map((b) => b.amountPaise)) })), payables: bills,
    stockValuePaise: rows.some((i) => i.valuePaise == null) ? null : c.sumPaise(rows.map((i) => i.valuePaise)),
    supplierDuePaise: c.sumPaise(bills.filter((b) => b.to === "SUPPLIER").map((b) => b.amountPaise)),
    settings: { foodCostTargetBps: req.v3Settings.foodCostTargetBps, countIntervalDays: req.v3Settings.countIntervalDays, autoOrderMode: req.v3Settings.autoOrderMode, revision: req.v3Settings.revision },
  };
};

// Inventory Manager read model: operational stock only. It deliberately omits
// revenue, EBITDA, financial entries, payables and recipe profitability.
export const mobileOperationalView = (base) => {
  const rows = base.items.map((i) => ({
    ...i,
    supplierName: base.suppliers.find((s) => sid(s) === sid(i.supplier))?.name || "",
    status: i.status || "Active",
  }));
  return {
    items: rows,
    suppliers: base.suppliers.map((s) => ({ _id: s._id, name: s.name })),
    categories: [...new Set(rows.map((i) => i.category).filter(Boolean))].sort(),
    summary: {
      total: rows.length,
      low: rows.filter((i) => i.currentStock > 0 && i.stockLevel !== "OK").length,
      out: rows.filter((i) => i.currentStock <= 0).length,
    },
  };
};

export const mobileWorkspaceData = async (req) => {
  // Admin V3's stock tab is backed by stockData(). Reuse that exact read
  // model here so the mobile presentation cannot drift in fields, thresholds,
  // supplier relationships, cost/value calculations, or active-item scope.
  const base = await stockData(req), view = mobileOperationalView(base);

  const requestedPage = Number.parseInt(req.query.historyPage, 10);
  const requestedLimit = Number.parseInt(req.query.historyLimit, 10);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit = Number.isInteger(requestedLimit) ? Math.min(50, Math.max(10, requestedLimit)) : 25;
  const filter = {};
  if (req.query.inventoryItem) filter.inventoryItem = req.query.inventoryItem;
  if (req.query.type) filter.type = req.query.type;
  const [movementRows, totalMovements] = await Promise.all([
    req.models.StockLedger.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit)
      .populate("inventoryItem", "name nameBn unit").lean(),
    req.models.StockLedger.countDocuments(filter),
  ]);
  return {
    ...view,
    movements: movementRows.map((m) => ({ _id: m._id, itemId: m.inventoryItem?._id || m.inventoryItem, itemName: m.inventoryItem?.name || "Item",
      itemNameBn: m.inventoryItem?.nameBn || "", unit: m.inventoryItem?.unit || "", type: m.type, quantity: m.quantity,
      balanceAfter: m.balanceAfter, reason: m.reason || "", createdAt: m.createdAt, createdBy: m.createdBy || null })),
    movementMeta: { total: totalMovements, page, pages: Math.max(1, Math.ceil(totalMovements / limit)), limit },
  };
};

export const projectCosts = ({ entries, rules, schedules, month, startDay, endDay }) => {
  const scheduledIds = new Set(schedules.map((s) => sid(s.financialEntry)));
  const reversed = new Set(entries.filter((e) => e.reversalOf).map((e) => sid(e.reversalOf)));
  const rows = entries.filter((e) => e.effectiveDate >= startDay && e.effectiveDate <= endDay && !e.reversalOf && !reversed.has(sid(e))).map((e) => ({ ...e, label: e.category, recognizedPaise: scheduledIds.has(sid(e)) ? 0 : e.amountPaise }));
  for (const rule of rules) {
    const due = `${month}-${String(rule.day).padStart(2, "0")}`;
    if (!rule.enabled || due < rule.effectiveFrom || due > endDay || rule.effectiveTo && due > rule.effectiveTo || rule.frequency === "YEARLY" && Number(month.slice(-2)) !== rule.month) continue;
    const occurrenceKey = `${rule.ruleKey}:${rule.revision}:${month}`;
    if (rows.some((e) => e.occurrenceKey === occurrenceKey) || entries.some((e) => e.occurrenceKey === occurrenceKey && reversed.has(sid(e)))) continue;
    rows.push({ _id: occurrenceKey, label: rule.category, category: rule.category, treatment: rule.treatment, source: "REPEATS", amountPaise: rule.amountPaise, recognizedPaise: rule.amountPaise, effectiveDate: due, paymentSource: "UNPAID", occurrenceKey, recurringRule: rule._id });
  }
  for (const schedule of schedules) {
    if (reversed.has(sid(schedule.financialEntry))) continue;
    const [sy, sm] = schedule.startsOn.split("-").map(Number), [y, m] = month.split("-").map(Number);
    const index = (y - sy) * 12 + m - sm;
    if (index < 0 || index >= schedule.periods || schedule.startsOn > endDay) continue;
    const recognizedPaise = c.allocateCost({ basisPaise: schedule.basisPaise, residualPaise: schedule.residualPaise || 0, periods: schedule.periods })[index];
    rows.push({ _id: `schedule:${schedule._id}:${month}`, label: schedule.treatment === "OPERATING_EXPENSE" ? "Licences (monthly share)" : "Equipment wear", treatment: schedule.treatment, amountPaise: recognizedPaise, recognizedPaise, source: "SPREAD", paymentSource: "NONE", effectiveDate: `${month}-01` });
  }
  return rows;
};

// Only compare observed count intervals. Missing coverage is never filled with
// theoretical system stock and presented as an actual physical count.
export const countIntervals = ({ counts, items, movements, purchases, from, to }) => {
  const purchaseById = new Map(purchases.map((p) => [sid(p), p]));
  const rows = [];
  for (const item of items.filter((i) => i.config?.costClass !== "NON_FOOD")) {
    const observations = counts.filter((x) => x.status === "APPROVED").map((x) => ({ at: new Date(x.approvedAt), line: x.lines.find((l) => sid(l.inventoryItem) === sid(item)) })).filter((x) => x.line).sort((a, b) => a.at - b.at);
    for (let i = 1; i < observations.length; i++) {
      const a = observations[i - 1], b = observations[i];
      if (b.at < from || a.at >= to || a.line.unitRateRupees == null || b.line.unit !== a.line.unit) continue;
      const moves = movements.filter((l) => sid(l.inventoryItem) === sid(item) && new Date(l.createdAt) > a.at && new Date(l.createdAt) <= b.at && l.type !== "PHYSICAL_COUNT");
      if (moves.some((m) => m.type === "ADJUSTMENT")) continue;
      const received = []; let invalid = false;
      for (const m of moves.filter((l) => l.type === "PURCHASE")) {
        const p = purchaseById.get(sid(m.relatedPurchase));
        const lines = p?.items?.filter((l) => sid(l.inventoryItem) === sid(item));
        if (!lines?.length) { invalid = true; break; }
        received.push({ quantity: c.legacyDecimal(m.quantity), amountPaise: c.sumPaise(lines.map((l) => l.amount == null ? c.lineAmountPaise({ quantity: c.legacyDecimal(l.quantity), unitRateRupees: c.legacyDecimal(l.costPrice), unit: l.unit || item.unit }) : amount(l.amount))) });
      }
      if (invalid) continue;
      const used = c.intervalValuation({ openingQty: a.line.countedQty, openingRate: a.line.unitRateRupees, purchases: received, closingQty: b.line.countedQty });
      const known = moves.filter((l) => l.type === "WASTAGE").reduce((n, l) => n - l.quantity, 0);
      const recipe = moves.filter((l) => l.type === "SALE_DEDUCTION" || l.type === "REVERSAL").reduce((n, l) => n - l.quantity, 0);
      const totalReceipts = received.reduce((n, l) => n + Number(l.quantity), 0);
      const variance = c.reconcileCount({ openingQty: a.line.countedQty, purchasedQty: c.legacyDecimal(totalReceipts), countedQty: b.line.countedQty,
        recipeQty: c.legacyDecimal(Math.max(0, recipe)), knownLossQty: c.legacyDecimal(known), unitRateRupees: b.line.unitRateRupees, unit: item.unit, complete: recipe >= 0 });
      rows.push({ item: item.name, inventoryItem: item._id, from: a.at, to: b.at, ...used, ...variance });
    }
  }
  const inRange = rows.filter((r) => r.from >= from && r.to <= to);
  return { rows: inRange, observedCostPaise: c.sumPaise(inRange.filter((r) => r.amountPaise != null).map((r) => r.amountPaise)),
    unexplainedPaise: inRange.length ? c.sumPaise(inRange.filter((r) => r.lossPaise != null).map((r) => r.lossPaise)) : null,
    complete: false }; // Count intervals are labelled explicitly; calendar-period COGS is not inferred.
};

export const workspaceData = async (req) => {
  const tz = await profileTimezone(req.models), today = localDay(new Date(), tz), month = req.query.month || today.slice(0, 7);
  if (month > today.slice(0, 7)) throw fail("Choose this month or an earlier month");
  const bounds = monthBounds(month, tz), base = await stockData(req), admin = effectiveRole(req.user) === "admin";
  const since = new Date(bounds.from.getTime() - 35 * 86400000);
  const [purchases, counts, movements, wastage, classifications, recipes, menu, confirmations] = await Promise.all([
    bounded(req.models.StockPurchase.find({ createdAt: { $gte: since } }).sort({ purchaseDate: -1 })),
    bounded(req.v3.InventoryCountSession.find({ createdAt: { $gte: since } }).sort({ submittedAt: -1 })),
    bounded(req.models.StockLedger.find({ createdAt: { $gte: since, $lte: bounds.to } })),
    bounded(req.models.WastageLog.find({ wastageDate: { $gte: bounds.from, $lte: bounds.to } })),
    bounded(req.v3.InventoryLossClassification.find({ createdAt: { $gte: since } })),
    bounded(req.models.Recipe.find({ status: "Active" })), bounded(req.models.MenuItem.find()),
    bounded(req.v3.InventoryBookConfirmation.find({ localDate: { $gte: bounds.startDay, $lte: bounds.endDay } })),
  ]);
  const itemById = new Map(base.items.map((x) => [sid(x), x])), recipeById = new Map(recipes.map((r) => [sid(r.menuItem), r]));
  const intervals = countIntervals({ counts, items: base.items, movements, purchases, from: bounds.from, to: bounds.to });
  const wasteType = new Map(classifications.map((x) => [sid(x.wastage), x.kind]));
  const loss = { wastePaise: c.sumPaise(wastage.filter((x) => wasteType.get(sid(x)) !== "STAFF_FREE_MEAL").map((x) => amount(x.costImpact))),
    freeMealsPaise: c.sumPaise(wastage.filter((x) => wasteType.get(sid(x)) === "STAFF_FREE_MEAL").map((x) => amount(x.costImpact))), unexplainedPaise: intervals.unexplainedPaise, discountsPaise: null, writeOffPaise: null };
  const inPeriod = purchases.filter((p) => new Date(p.purchaseDate) >= bounds.from && new Date(p.purchaseDate) <= bounds.to);
  let financial = [], rules = [], expected = [], sales = [], salary = [];
  if (admin) [financial, rules, expected, sales, salary] = await Promise.all([
    bounded(req.v3.InventoryFinancialEntry.find({ effectiveDate: { $lte: bounds.endDay } })), bounded(req.v3.InventoryRecurringRule.find()), bounded(req.v3.InventoryBookExpectation.find({ enabled: true })),
    bounded(req.models.Order.find({ createdAt: { $gte: since, $lte: bounds.to }, paymentStatus: "PAID", status: { $ne: "CANCELLED" } }).select("createdAt subtotal discount serviceCharge items total tax")),
    bounded(req.models.StaffPay.find({ month, type: "SALARY" })),
  ]);
  const schedules = admin ? await bounded(req.v3.InventoryCostSchedule.find({ startsOn: { $lte: bounds.endDay } })) : [];
  const costs = admin ? projectCosts({ entries: financial, rules, schedules, month, ...bounds }) : [];
  const payroll = c.payrollExpense(salary.map((s) => ({ type: s.type, grossPaise: s.breakdown?.gross == null ? null : amount(s.breakdown.gross) })));
  if (admin && salary.length) costs.push({ _id: "staff", label: "Salaries & overtime (before advances)", category: "Staff", treatment: "OPERATING_EXPENSE", source: "AUTO", recognizedPaise: payroll.amountPaise, amountPaise: payroll.amountPaise, paymentSource: "Staff", effectiveDate: bounds.startDay });
  const operatingCostsPaise = admin ? c.sumPaise(costs.filter((x) => x.treatment === "OPERATING_EXPENSE").map((x) => x.recognizedPaise || 0)) : null;
  const periodSales = sales.filter((s) => new Date(s.createdAt) >= bounds.from);
  const revenueFor = (rows) => c.actualRevenue({ subtotalPaise: c.sumPaise(rows.map((s) => amount(s.subtotal))), discountPaise: c.sumPaise(rows.map((s) => amount(s.discount))), serviceChargePaise: c.sumPaise(rows.map((s) => amount(s.serviceCharge))) });
  const revenuePaise = admin ? revenueFor(periodSales) : null;
  if (admin) loss.discountsPaise = c.sumPaise(periodSales.map((s) => amount(s.discount)));
  const sold = new Map();
  for (const order of periodSales) for (const l of order.items || []) sold.set(sid(l.menuItem), (sold.get(sid(l.menuItem)) || 0) + l.qty);
  const dishes = menu.map((m) => {
    const r = recipeById.get(sid(m)), cost = c.recipeCost(recipeProjection(r, itemById)), pricePaise = amount(m.price);
    return { _id: m._id, name: m.name, pricePaise, sold: admin ? sold.get(sid(m)) || 0 : null, recipe: r || null, costPaise: cost.totalPaise,
      foodStatus: c.foodCostStatus({ foodCostPaise: cost.totalPaise, revenuePaise: pricePaise, targetBps: base.settings.foodCostTargetBps }),
      targetPricePaise: cost.totalPaise == null ? null : c.targetPrice({ recipeCostPaise: cost.totalPaise, targetBps: base.settings.foodCostTargetBps }),
      profit: admin ? c.dishProfit({ pricePaise, recipeCostPaise: cost.totalPaise, runningCostsPaise: operatingCostsPaise, revenuePaise, soldQty: c.legacyDecimal(sold.get(sid(m)) || 0) }) : null };
  }).sort((a, b) => (b.sold || 0) - (a.sold || 0));
  const purchaseRows = inPeriod.map((p) => ({ _id: sid(p), effectiveDate: p.billDate || localDay(new Date(p.purchaseDate), tz), label: `${base.suppliers.find((s) => sid(s) === sid(p.supplier))?.name || "Supplier"} · ${p.invoiceNumber || "Purchase"}`, treatment: "FOOD_STOCK", source: p.billPhoto ? "BILL_PHOTO" : "MANUAL", paymentSource: p.paymentType === "CREDIT" ? "CREDIT" : p.paymentSource || "UNKNOWN", amountPaise: amount(p.totalCost), attachmentUrl: p.billPhoto }));
  const lastCounts = new Map();
  for (const x of counts.filter((x) => x.status === "APPROVED")) for (const l of x.lines) {
    const previous = lastCounts.get(sid(l.inventoryItem)); if (!previous || new Date(x.approvedAt) > previous) lastCounts.set(sid(l.inventoryItem), new Date(x.approvedAt));
  }
  const dueItems = base.items.filter((i) => !lastCounts.has(sid(i)) || new Date() - lastCounts.get(sid(i)) >= base.settings.countIntervalDays * 86400000);
  const lastDay = bounds.endDay, missingPurchaseDays = [];
  for (let d = bounds.startDay; d < lastDay; d = new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10)) {
    if (!purchaseRows.some((p) => p.effectiveDate === d) && !confirmations.some((x) => x.localDate === d)) missingPurchaseDays.push(d);
  }
  const checks = [
    { label: "Sales, discounts, write-offs", status: "unavailable", detail: "Sales and discounts use paid bills. Dedicated write-off records are unavailable.", action: null },
    { label: "Salaries & overtime", status: "unavailable", detail: salary.length ? "Recorded gross salaries included; payroll completeness needs Staff review." : "No finalized salary snapshots for this month.", action: "staff" },
    { label: "Rent, software", status: ["Rent", "Software & phone"].every((k) => costs.some((e) => e.category === k)) ? "complete" : "missing", detail: "Configure recurring costs or enter this month's bills.", action: "expense" },
    { label: "Electricity bill", status: costs.some((e) => e.category === "Electricity" && e.source !== "REPEATS") ? "complete" : "missing", action: "expense", category: "Electricity" },
    { label: "Stock count due", status: dueItems.length ? "missing" : "complete", detail: `${dueItems.length} items need an approved count`, action: "count" },
    { label: "Days with no purchase entered", status: missingPurchaseDays.length ? "missing" : "complete", detail: `${missingPurchaseDays.length} days to confirm`, action: "nothing" },
  ];
  const gas = expected.find((e) => e.category === "Gas / fuel");
  const gasEntries = financial.filter((e) => e.category === "Gas / fuel").sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  checks.push({ label: "Gas interval", status: !gas ? "unavailable" : gasEntries[0] && Date.parse(today) - Date.parse(gasEntries[0].effectiveDate) <= gas.intervalDays * 86400000 ? "complete" : "missing", detail: gas ? `Usually every ${gas.intervalDays} days` : "Set the usual interval when logging gas", action: "expense", category: "Gas / fuel" });
  const todayDate = dayInstant(today, tz), weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const weekStart = new Date(todayDate.getTime() - ((weekday + 6) % 7) * 86400000);
  const weekPurchases = purchases.filter((p) => new Date(p.purchaseDate) >= weekStart && new Date(p.purchaseDate) <= new Date());
  const spend = c.groupedSpend(weekPurchases.flatMap((p) => p.items.map((l) => ({ group: itemById.get(sid(l.inventoryItem))?.category || "Uncategorised", amountPaise: l.amount == null ? c.lineAmountPaise({ quantity: c.legacyDecimal(l.quantity), unit: l.unit || itemById.get(sid(l.inventoryItem))?.unit || "pcs", unitRateRupees: c.legacyDecimal(l.costPrice) }) : amount(l.amount) }))));
  const stockDays = base.items.map((i) => {
    const used = movements.filter((m) => sid(m.inventoryItem) === sid(i) && ["SALE_DEDUCTION", "REVERSAL"].includes(m.type)).reduce((n, m) => n - m.quantity, 0);
    return { inventoryItem: i._id, days: c.stockDays({ stockQty: c.legacyDecimal(i.currentStock), consumedQty: c.legacyDecimal(Math.max(0, used)), observedDays: Math.max(1, Math.floor((bounds.to - since) / 86400000)) }) };
  });
  const overallDays = stockDays.filter((x) => x.days != null).sort((a, b) => a.days - b.days)[0]?.days ?? null;
  return { ...base, timezone: tz, today, month, period: bounds, admin, dishes, counts, intervals, loss, lossTotalPaise: null,
    ledger: [...purchaseRows, ...costs].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate)), costs, rules, operatingCostsPaise,
    overview: { spend, foodStatus: { tone: "unavailable", percentBps: null }, trend: Array.from({ length: 4 }, () => null), stockDays: overallDays, stockDaysLabel: "earliest tracked item", dueItems: dueItems.length,
      unexplainedPaise: intervals.unexplainedPaise, earnings: { ebitdaPaise: null, marginBps: null }, reason: "Approved counts do not yet establish full calendar-period food cost." },
    earnings: { revenuePaise, foodCostPaise: null, operatingCostsPaise, otherIncomePaise: c.sumPaise(costs.filter((e) => e.treatment === "OTHER_INCOME").map((e) => e.recognizedPaise)), ...c.earnings({ revenuePaise: revenuePaise || 0, foodCostPaise: null, operatingCostsPaise, complete: false }) },
    books: { checks: admin ? checks : checks.filter((x) => ["count", "nothing"].includes(x.action)), ...c.booksComplete(admin ? checks : checks.filter((x) => ["count", "nothing"].includes(x.action))), missingPurchaseDays },
  };
};
