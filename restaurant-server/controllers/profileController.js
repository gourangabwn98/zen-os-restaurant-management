// controllers/profileController.js
import cloudinary  from "../config/cloudinary.js";
import streamifier from "streamifier";
import { isPhonePeConfigured } from "../services/paymentService.js";
import { PAYMENT_MODES, effectivePaymentMode } from "../utils/paymentMode.js";
import { effectiveServices } from "../utils/serviceToggles.js";
import { emitMenuUpdated } from "../sockets/socket.js";

const uploadToCloudinary = (buffer, folder = "restaurant", size = 400) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, allowed_formats: ["jpg","jpeg","png","webp","avif"],
        transformation: [{ width: size, height: size, crop: "limit", quality: "auto" }] },
      (error, result) => { if (error) return reject(error); resolve(result.secure_url); }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });

export const getRestaurantProfile = async (req, res) => {
  try {
    const { RestaurantProfile } = req.models;
    const profile = await RestaurantProfile.findOne();
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    const phonePeEnabled = isPhonePeConfigured();
    res.json({
      data: {
        ...profile.toObject(),
        phonePeEnabled,
        // What customers actually get (ONLINE without PhonePe falls back to CASH).
        effectivePaymentMode: effectivePaymentMode(profile.paymentMode, phonePeEnabled),
      },
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const updateRestaurantProfile = async (req, res) => {
  try {
    const { RestaurantProfile } = req.models;
    if (req.body.paymentMode !== undefined) {
      if (!PAYMENT_MODES.includes(req.body.paymentMode)) {
        return res.status(400).json({ message: `paymentMode must be one of: ${PAYMENT_MODES.join(", ")}` });
      }
      // Pay-first needs a gateway that confirms payments automatically.
      if (req.body.paymentMode === "ONLINE" && !isPhonePeConfigured()) {
        return res.status(400).json({ message: "\"Online only\" needs the PhonePe gateway configured on the server — set it up first, or choose Cash or Both" });
      }
    }
    if (req.body.editWindowMinutes !== undefined) {
      const m = Number(req.body.editWindowMinutes);
      if (!Number.isInteger(m) || m < 0 || m > 15) {
        return res.status(400).json({ message: "Edit window must be a whole number of minutes from 0 to 15" });
      }
      req.body.editWindowMinutes = m;
    }
    // SET-01: service toggles are booleans, merged onto what's saved so a
    // partial update can never silently switch another service off.
    if (req.body.services !== undefined) {
      const svc = req.body.services;
      if (!svc || typeof svc !== "object" || Array.isArray(svc)) {
        return res.status(400).json({ message: "services must be { dineIn, takeAway, delivery }" });
      }
      const clean = {};
      for (const k of ["dineIn", "takeAway", "delivery"]) {
        if (svc[k] === undefined) continue;
        if (typeof svc[k] !== "boolean") return res.status(400).json({ message: `services.${k} must be true or false` });
        clean[k] = svc[k];
      }
      const current = await RestaurantProfile.findOne().select("services").lean();
      req.body.services = { ...effectiveServices(current), ...clean };
    }
    let profile = await RestaurantProfile.findOne();
    if (!profile) {
      profile = await RestaurantProfile.create({ restaurantName: req.body.restaurantName || "Restaurant", ...req.body });
    } else {
      Object.assign(profile, req.body);
      await profile.save();
    }
    // Open customer apps re-read the profile + menu (SET-01: a switched-off
    // service disappears without a reload). The event carries no data.
    if (req.body.services !== undefined) emitMenuUpdated(req.tenantKey);
    res.json({ success: true, data: profile });
  } catch (err) { res.status(400).json({ message: err.message }); }
};

// POST /api/admin/restaurant/payment-qr — multipart field "paymentQr".
// Larger size limit than the logo so the QR's modules stay scannable.
export const uploadPaymentQr = async (req, res) => {
  try {
    const { RestaurantProfile } = req.models;
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const url = await uploadToCloudinary(req.file.buffer, "adda-payment-qr", 1000);
    const profile = await RestaurantProfile.findOneAndUpdate({}, { paymentQr: url }, { returnDocument: "after", upsert: true });
    res.json({ success: true, paymentQr: url, data: profile });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// DELETE /api/admin/restaurant/payment-qr
export const removePaymentQr = async (req, res) => {
  try {
    const { RestaurantProfile } = req.models;
    const profile = await RestaurantProfile.findOneAndUpdate({}, { paymentQr: "" }, { returnDocument: "after" });
    res.json({ success: true, data: profile });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const uploadRestaurantLogo = async (req, res) => {
  try {
    const { RestaurantProfile } = req.models;
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const url = await uploadToCloudinary(req.file.buffer, "adda-logos");
    const profile = await RestaurantProfile.findOneAndUpdate({}, { logo: url }, { returnDocument: "after", upsert: true });
    res.json({ success: true, logo: url, data: profile });
  } catch (err) { res.status(500).json({ message: err.message }); }
};
