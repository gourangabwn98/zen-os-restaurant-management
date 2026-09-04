// utils/sendWhatsAppBill.js
import twilio from "twilio";

export const sendWhatsAppBill = async (phone, order, restaurantName) => {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_WHATSAPP_FROM || "+14155238886";

  if (!sid || !token) {
    console.warn("⚠️  Twilio not configured — skipping WhatsApp bill");
    return;
  }

  const client = twilio(sid, token);

  const itemLines = (order.items || [])
    .map(i => `  • ${i.name} ×${i.qty}  →  ₹${i.price * i.qty}`)
    .join("\n");

  const lines = [
    `🧾 *Bill — ${restaurantName}*`,
    ``,
    `Order ID: *${order.orderId}*`,
    order.tableNo ? `Table: T${order.tableNo}` : null,
    ``,
    `*Items:*`,
    itemLines,
    ``,
    order.subtotal > 0      ? `Subtotal:        ₹${order.subtotal}`       : null,
    order.tax > 0           ? `GST:             ₹${order.tax}`            : null,
    order.serviceCharge > 0 ? `Service Charge:  ₹${order.serviceCharge}` : null,
    order.discount > 0      ? `Discount:       -₹${order.discount}`       : null,
    ``,
    `*Total: ₹${Math.round(order.total)}*`,
    `Payment: ${order.paymentMethod || "Cash"} — ${order.paymentStatus || "Pending"}`,
    ``,
    `Thank you for visiting ${restaurantName}! 🙏`,
  ].filter(l => l !== null).join("\n");

  try {
    await client.messages.create({
      from: `whatsapp:+${from.replace(/^\+/, "")}`,
      to:   `whatsapp:+91${phone}`,
      body: lines,
    });
    console.log(`✅ WhatsApp bill sent to +91${phone}`);
  } catch (err) {
    console.error(`❌ WhatsApp bill failed:`, err.message);
  }
};