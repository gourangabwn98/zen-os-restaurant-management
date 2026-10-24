import { useEffect, useState } from "react";
import { Dialog, Field, Select, Button, Table, Chip } from "./ui.jsx";
import { v3Write, uploadV3Receipt, requestKey, moneyV3, pctV3 } from "../../../services/inventoryV3Service.js";

const UNITS = ["kg", "g", "l", "ml", "pcs", "packet", "dozen", "box"].map((x) => [x, x]);
const AUTO = [["OFF", "Off"], ["ASK_FIRST", "Ask me first"], ["ONE_TAP", "Prepare, send in one tap"]];
const SOURCES = [["CASH_DRAWER", "Cash drawer"], ["BANK_UPI", "Bank / UPI"], ["OWNER_POCKET", "Owner's pocket"]];
const CATEGORIES = ["Rent", "Gas / fuel", "Electricity", "Water", "Repairs", "Cleaning", "Transport", "Marketing", "Software & phone", "Licences", "Big purchase (equipment)", "Loan interest", "Tax", "Other income", "Owner took cash"];
const TITLES = { purchase: "Record purchase", expense: "Add expense, income or cash taken", count: "Count stock · every 4th day", item: "Add stock item", supplier: "Add supplier", recipe: "Add recipe", wastage: "Log wastage or free meals", settle: "Mark bill paid", nothing: "Confirm nothing bought", settings: "Inventory settings", order: "Prepare supplier order" };
const initial = (kind, data, selected) => {
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: data.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  if (kind === "item") return { name: selected?.name || "", unit: selected?.unit || "kg", currentStock: String(selected?.currentStock || 0), costPrice: selected?.costPrice ?? "", category: selected?.category || "", supplier: selected?.supplier || "", reorderLevel: selected?.reorderLevel || "", usualStockQty: selected?.config?.usualStockQty || "", costClass: selected?.config?.costClass || "FOOD", updatedAt: selected?.updatedAt };
  if (kind === "supplier") return { name: selected?.name || "", phone: selected?.phone || "", gstNumber: selected?.gstNumber || "", groups: selected?.config?.groups || [], creditFrequency: selected?.config?.creditFrequency || "SOMETIMES", autoOrderMode: selected?.config?.autoOrderMode || "OFF" };
  if (kind === "purchase") return { supplier: selected?.supplier || "", billDate: data.today, billTime: now, billNumber: "", paymentType: "PAID", paymentSource: "CASH_DRAWER", items: [{ inventoryItem: selected?._id || "", quantity: "", costPrice: "" }], billPhoto: "" };
  if (kind === "expense") return { category: selected?.category || "Electricity", amount: "", effectiveDate: data.today, paymentSource: "CASH_DRAWER", repeats: false, periods: 60, attachmentUrl: "", recurringRule: selected?.recurringRule || "", gasInterval: "", spreadYearly: false };
  if (kind === "count") return { lines: (selected ? [selected] : data.items).map((i) => ({ inventoryItem: i._id, name: i.name, unit: i.unit, expectedQty: i.currentStock, countedQty: "", stockUpdatedAt: i.updatedAt })) };
  if (kind === "recipe") return { menuItem: selected?._id || "", ingredients: selected?.recipe?.ingredients?.map((l) => ({ inventoryItem: l.inventoryItem || "", quantity: String(l.quantity), unit: l.unit, sourceType: l.sourceType || "STOCK", name: l.name || "", cost: l.cost ?? "" })) || [{ inventoryItem: "", quantity: "", unit: "g" }] };
  if (kind === "wastage") return { inventoryItem: selected?._id || "", quantity: "", kind: "WASTE", reason: "" };
  if (kind === "settle") return { source: "BANK_UPI" };
  if (kind === "nothing") return { localDate: data.books.missingPurchaseDays[0] || "" };
  if (kind === "settings") return { revision: data.settings.revision, foodCostTargetPercent: data.settings.foodCostTargetBps / 100, countIntervalDays: data.settings.countIntervalDays, autoOrderMode: data.settings.autoOrderMode };
  return {};
};
export default function EntryDialog({ kind, selected, data, onClose, onSaved }) {
  const [form, setForm] = useState(() => initial(kind, data, selected));
  const [key, setKey] = useState(requestKey), [busy, setBusy] = useState(false), [error, setError] = useState(""), [preview, setPreview] = useState(null);
  const set = (field, value) => { setForm((f) => ({ ...f, [field]: value })); setKey(requestKey()); setError(""); };
  const lineSet = (field, index, name, value) => set(field, form[field].map((l, i) => i === index ? { ...l, [name]: value } : l));
  useEffect(() => {
    if (!["purchase", "recipe"].includes(kind)) return;
    let active = true;
    const timer = setTimeout(() => {
      v3Write(kind === "purchase" ? "purchases/preview" : "recipes/preview", form)
        .then((r) => { if (active) setPreview(r); }).catch(() => { if (active) setPreview(null); });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [form, kind]);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const routes = { item: selected ? `items/${selected._id}` : "items", supplier: selected ? `suppliers/${selected._id}` : "suppliers", purchase: "purchases", expense: "financial-entries", count: "counts", recipe: "recipes", wastage: "wastage", settle: `purchases/${selected?._id}/settlements`, nothing: "book-confirmations", settings: "settings" };
      const payload = kind === "settings" ? { ...form, foodCostTargetBps: Math.round(Number(form.foodCostTargetPercent) * 100) } : { ...form, requestKey: key };
      await v3Write(routes[kind], payload, kind === "settings" || ["item", "supplier"].includes(kind) && selected ? "patch" : "post");
      if (kind === "expense" && form.category === "Gas / fuel" && form.gasInterval) await v3Write("book-expectations/gas", { intervalDays: Number(form.gasInterval) }, "put");
      onSaved(kind === "count" ? "Count submitted. Approve it in Stock to update balances." : "Saved");
    } catch (err) { setError(err.response?.data?.message || "Could not save. Your entries are still here; try again."); }
    finally { setBusy(false); }
  };
  const upload = async (file) => {
    if (!file) return;
    setBusy(true); setError("");
    try { const result = await uploadV3Receipt(file); set(kind === "purchase" ? "billPhoto" : "attachmentUrl", result.url); }
    catch (err) { setError(err.response?.data?.message || "Photo upload failed"); }
    finally { setBusy(false); }
  };
  const input = (name, label, options = {}) => <Field label={label} value={form[name] ?? ""} onChange={(e) => set(name, e.target.value)} {...options} />;
  const select = (name, label, options) => <Select label={label} value={form[name]} onChange={(v) => set(name, v)} options={options} />;
  const stockOptions = [["", "Choose stock item"], ...data.items.map((i) => [i._id, `${i.name} (${i.unit})`])];
  const soon = ["bill", "voice", "recai", "priceai"].includes(kind);
  if (soon) return <Dialog title={`${({ bill: "Snap a bill", voice: "Say it, Bengali or English", recai: "Draft recipe with AI", priceai: "Price-rise alerts" })[kind]} · COMING SOON`} onClose={onClose}><div className="iv3-note"><b>Nothing here saves yet.</b><p>{kind === "voice" ? '“আজ দুই কেজি চিকেন নষ্ট হয়ে গেছে” → a wastage entry to review. “গ্যাস সিলিন্ডার এগারোশো” → a gas expense to review.' : kind === "bill" ? "A future preview: read a bill photo and fill a purchase for you to check. Today, use Record purchase and attach a photo as proof." : kind === "recai" ? "A future preview: draft ingredients and quantities from a dish name, then review them before saving." : "A future preview: spot ingredient price changes from supplier bills."}</p></div><footer><Button onClick={onClose}>Close preview</Button></footer></Dialog>;
  if (kind === "order") {
    const supplier = selected, items = data.items.filter((i) => i.supplier === supplier?._id && i.currentStock <= i.reorderLevel);
    const text = `Stock request for ${supplier?.name || "supplier"}\n${items.map((i) => `${i.name}: please confirm quantity and price (${i.currentStock} ${i.unit} left)`).join("\n")}`;
    const phone = (supplier?.phone || "").replace(/\D/g, "");
    return <Dialog title="Prepare supplier order" onClose={onClose}><p>Review this list. WhatsApp opens a draft; you choose when to send it.</p><pre style={{ whiteSpace: "pre-wrap" }} className="iv3-note">{text}</pre>{!items.length && <p>No linked stock items need reordering.</p>}<footer>{phone && items.length > 0 && <a className="zc-btn pri" href={`https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Review in WhatsApp</a>}<Button ghost onClick={onClose}>Close</Button></footer></Dialog>;
  }
  return <Dialog title={selected && ["item", "supplier"].includes(kind) ? `Edit ${kind}` : TITLES[kind]} onClose={onClose} busy={busy}><form onSubmit={submit}>
    {error && <div className="iv3-error" role="alert">{error}</div>}
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
    {kind === "item" && <><p className="hint">Name, unit, stock and last-bill cost are all you need to start.</p><div className="iv3-form-grid">
      {input("name", "Name", { required: true })}{select("unit", "Unit", UNITS)}{!selected && input("currentStock", "In stock now", { type: "number", min: 0, step: "any", required: true })}{input("costPrice", "Cost per unit (₹)", { type: "number", min: 0, step: "any", required: true })}
      {input("category", "Group (optional)")}{input("reorderLevel", "Reorder at (optional)", { type: "number", min: 0, step: "any" })}{input("usualStockQty", "Usual stock (optional)", { type: "number", min: 0, step: "any" })}
      {select("supplier", "Supplier (optional)", [["", "No supplier"], ...data.suppliers.map((s) => [s._id, s.name])])}{select("costClass", "Cost classification", [["FOOD", "Food"], ["PACKAGING", "Packaging"], ["NON_FOOD", "Non-food"], ["UNKNOWN", "Not classified"]])}
    </div>{selected && <p className="hint">Use Count stock to change the quantity on the shelf.</p>}</>}
    {kind === "supplier" && <div className="iv3-form-grid">{input("name", "Name", { required: true })}{input("phone", "Phone (WhatsApp)", { required: true, type: "tel" })}{input("gstNumber", "GST no. (optional)")}{select("autoOrderMode", "Auto order", AUTO)}{select("creditFrequency", "Usually on credit?", [["YES", "Yes"], ["SOMETIMES", "Sometimes"], ["NO", "No"]])}<Field label="Supplies"><input className="zc-input" value={form.groups.join(", ")} placeholder="Grocery, dairy, packaging" onChange={(e) => set("groups", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} /></Field></div>}
    {kind === "purchase" && <><div className="iv3-form-grid">{select("supplier", "Supplier", [["", "Choose supplier"], ...data.suppliers.map((s) => [s._id, s.name])])}{input("billNumber", "Supplier bill number (optional)")}{input("billDate", "Bill date", { type: "date", required: true, max: data.today })}{input("billTime", "Bill time", { type: "time", required: true })}</div>
      {form.items.map((l, i) => <div className="iv3-entry-line" key={i}><Select label="Item" value={l.inventoryItem} options={stockOptions} onChange={(v) => { const item = data.items.find((x) => x._id === v); set("items", form.items.map((x, j) => j === i ? { inventoryItem: v, quantity: "", costPrice: item?.costPrice || "", unit: item?.unit } : x)); }} /><Field label="Quantity" type="number" min="0.000001" step="any" required value={l.quantity} onChange={(e) => lineSet("items", i, "quantity", e.target.value)} /><Field label="Rate (₹ / stock unit)" type="number" min="0" step="any" required value={l.costPrice} onChange={(e) => lineSet("items", i, "costPrice", e.target.value)} /><Button ghost aria-label={`Remove line ${i + 1}`} disabled={form.items.length === 1} onClick={() => set("items", form.items.filter((_, j) => j !== i))}>×</Button></div>)}
      <Button ghost onClick={() => set("items", [...form.items, { inventoryItem: "", quantity: "", costPrice: "" }])}>+ Add line</Button><div className="iv3-form-grid">{select("paymentType", "Paid?", [["PAID", "Paid now"], ["CREDIT", "On credit (baki)"]])}{form.paymentType === "PAID" && select("paymentSource", "Paid from", SOURCES)}</div>
      <div className="iv3-preview">Total <b>{moneyV3(preview?.totalPaise)}</b><small> · calculated by the server</small></div><p className="hint">Add new stock items or suppliers from their tabs before recording this bill.</p></>}
    {kind === "expense" && <><div className="iv3-form-grid">{select("category", "What is it?", CATEGORIES.map((x) => [x, x]))}{input("amount", "Amount (₹)", { type: "number", min: "0.01", step: "0.01", required: true })}{input("effectiveDate", "Bill date", { type: "date", max: data.today, required: true })}{select("paymentSource", form.category === "Other income" ? "Received into" : "Paid from", SOURCES)}
      {form.category === "Big purchase (equipment)" ? input("periods", "Spread over (months)", { type: "number", min: 1, max: 1200, required: true }) : !["Owner took cash"].includes(form.category) && <Field label="Repeats"><select className="zc-input" value={String(form.repeats)} onChange={(e) => set("repeats", e.target.value === "true")}><option value="false">No</option><option value="true">Every month</option></select></Field>}
      {form.category === "Licences" && <Field label="Spread yearly fee"><input type="checkbox" checked={form.spreadYearly} onChange={(e) => set("spreadYearly", e.target.checked)} /></Field>}
      {form.category === "Gas / fuel" && input("gasInterval", "Usual interval (days, optional)", { type: "number", min: 1, max: 365 })}
      {select("recurringRule", "Matches recurring bill (optional)", [["", "Not a recurring occurrence"], ...data.rules.filter((r) => r.category === form.category).map((r) => [r._id, r.category])])}
      </div>{form.paymentSource === "CASH_DRAWER" && <p className="iv3-note">This records the drawer movement in this ledger. The existing Invoices day-close calculation has not been changed.</p>}{form.category === "Big purchase (equipment)" && <p className="iv3-note">Equipment cost is spread over its life below operating profit.</p>}</>}
    {["expense", "purchase"].includes(kind) && <Field label="Attach bill photo (proof, optional)"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => upload(e.target.files?.[0])} />{(form.billPhoto || form.attachmentUrl) && <Chip tone="green">Photo attached</Chip>}</Field>}
    {kind === "count" && <><p className="iv3-note">Enter what is physically on the shelf. Submit, then an owner or manager approves the count. A stock movement during counting requires a refresh and recount.</p><Table headers={["Item", "System stock", "Left now"]}>{form.lines.map((l, i) => <tr key={l.inventoryItem}><td>{l.name}<small>{l.unit}</small></td><td>{l.expectedQty} {l.unit}</td><td><input className="zc-input iv3-count-input" aria-label={`Count ${l.name}`} type="number" min="0" step="any" value={l.countedQty} required onChange={(e) => lineSet("lines", i, "countedQty", e.target.value)} /></td></tr>)}</Table></>}
    {kind === "recipe" && <>{select("menuItem", "Dish", [["", "Choose dish"], ...data.dishes.map((d) => [d._id, `${d.name} · ${moneyV3(d.pricePaise)}`])])}
      {form.ingredients.map((l, i) => <div className="iv3-entry-line" key={i}>{l.sourceType === "CUSTOM" ? <Field label="Custom ingredient" value={l.name} onChange={(e) => lineSet("ingredients", i, "name", e.target.value)} /> : <Select label="Stock ingredient" value={l.inventoryItem} onChange={(v) => lineSet("ingredients", i, "inventoryItem", v)} options={stockOptions} />}<Field label="Per plate" type="number" min="0.000001" step="any" value={l.quantity} required onChange={(e) => lineSet("ingredients", i, "quantity", e.target.value)} /><Select label="Unit" value={l.unit} options={UNITS} onChange={(v) => lineSet("ingredients", i, "unit", v)} />{l.sourceType === "CUSTOM" && <Field label="Cost for this quantity (₹)" value={l.cost} onChange={(e) => lineSet("ingredients", i, "cost", e.target.value)} />}<Button ghost disabled={form.ingredients.length === 1} onClick={() => set("ingredients", form.ingredients.filter((_, j) => i !== j))}>Remove</Button></div>)}
      <Button ghost onClick={() => set("ingredients", [...form.ingredients, { inventoryItem: "", quantity: "", unit: "g" }])}>+ Ingredient</Button><div className="iv3-preview">Cost to make: <b>{moneyV3(preview?.totalPaise)}</b>{selected?.profit && <p>Current running-cost share: {moneyV3(selected.profit.overheadPaise)} · margin {pctV3(selected.profit.marginBps)}</p>}</div></>}
    {kind === "wastage" && <div className="iv3-form-grid">{select("inventoryItem", "Stock item", stockOptions)}{input("quantity", "Quantity (stock unit)", { type: "number", min: "0.000001", step: "any", required: true })}{select("kind", "Kind", [["WASTE", "Spoiled, burnt, expired"], ["STAFF_FREE_MEAL", "Staff / free meal"]])}{input("reason", "Reason", { required: true })}</div>}
    {kind === "settle" && <><p>Pay {moneyV3(selected.amountPaise)} for {selected.invoiceNumber}. This clears the existing payable once.</p>{select("source", "Paid from", SOURCES.slice(0, 2))}</>}
    {kind === "nothing" && <>{select("localDate", "Nothing bought on", data.books.missingPurchaseDays.map((d) => [d, d]))}<p className="hint">Confirm only a day on which no purchases were made.</p></>}
    {kind === "settings" && <div className="iv3-form-grid">{input("foodCostTargetPercent", "Food-cost target (%)", { type: "number", min: 0.01, max: 100, step: 0.01, required: true, onChange: (e) => set("foodCostTargetPercent", e.target.value) })}{input("countIntervalDays", "Count every (days)", { type: "number", min: 1, max: 365, required: true, onChange: (e) => set("countIntervalDays", Number(e.target.value)) })}{select("autoOrderMode", "Auto-order default", AUTO)}</div>}
    </fieldset><footer><Button ghost onClick={onClose} disabled={busy}>Cancel</Button><button className="zc-btn pri" type="submit" disabled={busy || ["purchase", "recipe"].includes(kind) && !preview}>{busy ? "Saving…" : kind === "count" ? "Submit count" : "Save"}</button></footer>
  </form></Dialog>;
}
