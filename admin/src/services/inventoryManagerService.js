import { getInventoryItems, getSuppliers, getStockMovements, createInventoryItem, updateInventoryItem, adjustInventoryItem } from "./inventoryService.js";

export const getLegacyManagerWorkspace = async (historyPage = 1) => {
  const [itemsRes, suppliersRes, movementsRes] = await Promise.all([
    getInventoryItems({ status: "Active" }),
    getSuppliers(),
    getStockMovements({ page: historyPage, limit: 25 }),
  ]);
  const rawItems = itemsRes.data?.items || [];
  const items = rawItems.map((item) => {
    const costPaise = Number(item.costPrice) > 0 ? Math.round(Number(item.costPrice) * 100) : null;
    return { ...item, costPaise, valuePaise: costPaise == null ? null : Math.round(Number(item.currentStock || 0) * costPaise), supplierName: item.supplier?.name || "", config: {} };
  });
  const movements = (movementsRes.data?.movements || []).map((m) => ({
    _id: m._id, itemId: m.inventoryItem?._id, itemName: m.inventoryItem?.name || "Item", itemNameBn: m.inventoryItem?.nameBn || "",
    unit: m.inventoryItem?.unit || "", type: m.type, quantity: m.quantity, balanceAfter: m.balanceAfter, reason: m.reason || "", createdAt: m.createdAt, createdBy: m.createdBy || null,
  }));
  return {
    source: "legacy", items, suppliers: (suppliersRes.data?.suppliers || []).map((s) => ({ _id: s._id, name: s.name })),
    categories: [...new Set(items.map((i) => i.category).filter(Boolean))].sort(),
    summary: { total: items.length, low: items.filter((i) => i.currentStock > 0 && i.stockLevel !== "OK").length, out: items.filter((i) => i.currentStock <= 0).length },
    movements, movementMeta: { total: movementsRes.data?.total || 0, page: movementsRes.data?.page || historyPage, pages: Math.max(1, movementsRes.data?.pages || 1), limit: 25 },
  };
};

export const saveLegacyManagerItem = async (form, editing) => {
  const payload = {
    name: form.name.trim(),
    nameBn: form.nameBn?.trim() || "",
    unit: form.unit,
    category: form.category || "",
    costPrice: Number(form.costPrice || 0),
    reorderLevel: Number(form.reorderLevel || 0),
    criticalLevel: form.criticalLevel === "" || form.criticalLevel == null ? null : Number(form.criticalLevel),
    supplier: form.supplier || null,
    isBatchTracked: Boolean(form.isBatchTracked),
    notes: form.notes?.trim() || "",
  };
  if (editing) return updateInventoryItem(editing._id, payload);
  const result = await createInventoryItem(payload);
  const item = result.data?.item;
  if (item && Number(form.currentStock) > 0) await adjustInventoryItem(item._id, { newStock: Number(form.currentStock), type: "MANUAL_ADJUSTMENT", reason: "Opening stock" });
  return result;
};

export const adjustLegacyManagerStock = (item, direction, quantity, reason) => adjustInventoryItem(item._id, {
  newStock: Number(item.currentStock) + (direction === "IN" ? Number(quantity) : -Number(quantity)),
  type: "MANUAL_ADJUSTMENT", reason,
});
