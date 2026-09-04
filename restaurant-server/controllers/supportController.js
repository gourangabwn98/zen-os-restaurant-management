// controllers/supportController.js
import { sendWhatsAppText } from "../utils/sendWhatsAppText.js";

// POST /api/support — guest or logged-in customer
export const createTicket = async (req, res) => {
  try {
    const { name, phone, email, subject, message, orderId } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ message: "Please describe your issue" });
    }

    const { SupportTicket, RestaurantProfile } = req.models;

    const ticket = await SupportTicket.create({
      name:    name  || req.user?.name  || "",
      phone:   phone || req.user?.phone || "",
      email:   email || "",
      subject: subject || "General",
      message: message.trim(),
      order:   orderId || null,
      user:    req.user?._id || null,
    });

    // Best-effort notify the restaurant — never blocks ticket creation.
    const restaurant = await RestaurantProfile.findOne();
    if (restaurant?.phone) {
      const lines = [
        `🆘 *New support request* — ${restaurant.restaurantName || "Restaurant"}`,
        ``,
        `From: ${ticket.name || "Guest"}${ticket.phone ? ` (${ticket.phone})` : ""}`,
        `Subject: ${ticket.subject}`,
        orderId ? `Order: ${orderId}` : null,
        ``,
        ticket.message,
      ].filter(Boolean).join("\n");
      sendWhatsAppText(restaurant.phone, lines).catch(() => {});
    }

    res.status(201).json({ success: true, ticket });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/support/my — logged-in customer's own tickets
export const getMyTickets = async (req, res) => {
  try {
    const { SupportTicket } = req.models;
    const tickets = await SupportTicket.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ tickets });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
