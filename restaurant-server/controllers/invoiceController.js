// controllers/invoiceController.js
export const generateInvoice = async (req, res) => {
  try {
    const { Invoice, Order, RestaurantProfile } = req.models;
    const { orders: orderIds, items, userId, isGuest, tableNo } = req.body;

    const safeItems  = items || [];
    const subtotal   = safeItems.reduce((s, i) => s + (i.price||0) * (i.qty||0), 0);
    const restaurant = await RestaurantProfile.findOne();
    const gstRate    = (restaurant?.gstRate || 0) / 100;
    const tax        = Math.round(subtotal * gstRate);
    const sc         = restaurant?.serviceCharge || 0;
    const totalQty   = safeItems.reduce((s, i) => s + (i.qty||0), 0);
    const serviceChargeAmt = sc * totalQty;
    const total      = subtotal + tax + serviceChargeAmt;
    const safeUserId = userId && userId !== "guest" ? userId : null;

    const invoice = await Invoice.create({
      orders: orderIds || [], user: safeUserId, isGuest: isGuest || false,
      items: safeItems, subtotal, tax, serviceCharge: serviceChargeAmt,
      total, tableNo: tableNo || null,
    });

    res.status(201).json(invoice);
  } catch (err) {
    console.error("Invoice error:", err);
    res.status(500).json({ message: "Failed to generate invoice" });
  }
};

export const getMyInvoices = async (req, res) => {
  try {
    const { Invoice } = req.models;
    const filter = req.user ? { user: req.user._id } : { isGuest: true };
    const invoices = await Invoice.find(filter).sort({ createdAt: -1 });
    res.json(invoices);
  } catch (err) { res.status(500).json({ message: "Failed to fetch invoices" }); }
};

export const getInvoiceById = async (req, res) => {
  try {
    const { Invoice } = req.models;
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });
    res.json(invoice);
  } catch (err) { res.status(500).json({ message: "Failed to fetch invoice" }); }
};
