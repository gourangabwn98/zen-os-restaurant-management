// src/payQr.js
// ─────────────────────────────────────────────────────────────────────────────
// "Scan & Pay" QR at the bottom of an unpaid bill.
//
// Preferred: a UPI QR generated for THIS bill from the restaurant's UPI ID
// (Admin → Profile → Payment: upiId / upiPayeeName) with the bill's total and
// number filled in — the customer's UPI app opens with the exact amount.
// Fallback: the payment QR image the admin uploaded (Profile → paymentQr).
//
// Printed as a raster image — the same path as the logo, so it works on any
// ESC/POS printer, including ones without native QR support.
//
// Scanning/paying never changes the order: like the customer app's UPI
// link, a UPI payment stays PENDING_VERIFICATION until staff mark it paid
// (CLAUDE.md → Payment). Paid bills get no QR.
// ─────────────────────────────────────────────────────────────────────────────
import QRCode from "qrcode";

const UPI_ID_RE = /^[\w.-]{2,}@[a-zA-Z][\w.-]*$/;

export const isUpiId = (v) => UPI_ID_RE.test(String(v || "").trim());

/**
 * upi://pay link (NPCI "UPI linking" spec): pa payee VPA, pn payee name,
 * am amount (2 decimals), cu INR, tn note shown to the payer.
 */
export const upiPayUrl = ({ upiId, payeeName, amount, note }) => {
  const q = new URLSearchParams();
  q.set("pa", String(upiId).trim());
  if (payeeName) q.set("pn", String(payeeName).trim().slice(0, 50));
  if (Number(amount) > 0) q.set("am", Number(amount).toFixed(2));
  q.set("cu", "INR");
  if (note) q.set("tn", String(note).slice(0, 50));
  // URLSearchParams encodes spaces as "+", which some UPI apps show
  // literally — use %20 like the customer app's deep link. The VPA's "@"
  // stays literal, as on bank-issued UPI QR codes (NPCI's examples), which
  // every UPI scanner accepts.
  return `upi://pay?${q.toString().replace(/\+/g, "%20").replace(/^pa=([^&]*)%40/, "pa=$1@")}`;
};

/**
 * Text → black/white RGBA bitmap (what the raster printer path expects),
 * about `sizeDots` wide, with the standard 4-module quiet zone. Modules are
 * whole dots (no scaling blur), and the width is a multiple of 8 because the
 * printer packs 8 dots per byte.
 */
export const qrBitmap = (text, { sizeDots = 240 } = {}) => {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = modules.size;
  const quiet = 4;
  const scale = Math.max(2, Math.floor(sizeDots / (n + quiet * 2)));
  const raw = (n + quiet * 2) * scale;
  const width = Math.ceil(raw / 8) * 8;
  const height = raw;
  const offset = Math.floor((width - raw) / 2);
  const data = Buffer.alloc(width * height * 4, 255); // white, opaque
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!modules.get(r, c)) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const px = offset + (c + quiet) * scale + x;
          const py = (r + quiet) * scale + y;
          const i = (py * width + px) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { width, height, data };
};

export class PayQrProvider {
  /**
   * @param {object} opts
   * @param {number} [opts.sizeDots]      - printed QR width in dots (~30 mm at 240)
   * @param {{get(url:string):Promise<object|null>}} [opts.imageProvider]
   *        - loads the admin's uploaded QR image (a LogoProvider set up for
   *          crisp black/white, no inversion/dithering)
   */
  constructor({ sizeDots = 240, imageProvider = null } = {}) {
    this.sizeDots = sizeDots;
    this.imageProvider = imageProvider;
  }

  /**
   * QR for a bill, or null when there's nothing to show (already paid, no
   * UPI ID and no uploaded QR, or a zero total).
   * @returns {Promise<null | { bitmap, upiId?: string, amount?: number }>}
   */
  async forBill(payload = {}, profile = {}) {
    if (payload.paymentStatus === "PAID") return null;
    const total = Number(payload.total) || 0;
    if (isUpiId(profile.upiId) && total > 0) {
      const url = upiPayUrl({
        upiId: profile.upiId,
        payeeName: profile.upiPayeeName || profile.name,
        amount: total,
        note: payload.orderId ? `Bill ${payload.orderId}` : "",
      });
      return { bitmap: qrBitmap(url, { sizeDots: this.sizeDots }), upiId: String(profile.upiId).trim(), amount: total };
    }
    if (profile.paymentQr && this.imageProvider) {
      const bitmap = await this.imageProvider.get(profile.paymentQr);
      return bitmap ? { bitmap } : null;
    }
    return null;
  }
}
