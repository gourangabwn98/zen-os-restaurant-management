// src/payQr.js
// ─────────────────────────────────────────────────────────────────────────────
// "Scan & Pay" QR at the bottom of an unpaid bill.
//
// Which QR, in order:
//   1. The payment QR the admin uploaded (Admin → Profile → paymentQr — e.g.
//      the PhonePe/GPay merchant QR). Its content is READ (jsQR) and printed
//      again as a clean, standard black-on-white QR: uploaded images are often
//      inverted (white on black — many scanners can't read that), have a logo
//      in the middle, or are blurry after resizing. The content is used
//      exactly as uploaded, never altered.
//   2. If it can't be read: the uploaded image itself, normalised to black on
//      white (src/logo.js, crisp — no dithering).
//   3. No uploaded QR: a UPI QR generated from the UPI ID (upiId /
//      upiPayeeName) with THIS bill's total and number filled in.
//
// Printed as a raster image — the same path as the logo, so it works on any
// ESC/POS printer, including ones without native QR support.
//
// Scanning/paying never changes the order: like the customer app's UPI
// link, a UPI payment stays PENDING_VERIFICATION until staff mark it paid
// (CLAUDE.md → Payment). Paid bills get no QR.
// ─────────────────────────────────────────────────────────────────────────────
import QRCode from "qrcode";
import jsQR from "jsqr";
import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { cloudinaryPngUrl } from "./logo.js";
import { logger } from "./logger.js";

const FETCH_TIMEOUT_MS = 8000;

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

/** QR content → the payee VPA, if it's a UPI link ("" otherwise). */
export const upiPayee = (text) => {
  const m = /^upi:\/\/pay\?(.*)$/i.exec(String(text || ""));
  if (!m) return "";
  try { return new URLSearchParams(m[1]).get("pa") || ""; } catch { return ""; }
};

/** RGBA pixels → QR text, trying normal and inverted (white-on-black). */
export const decodeQr = ({ width, height, data }) => {
  const r = jsQR(new Uint8ClampedArray(data), width, height, { inversionAttempts: "attemptBoth" });
  return r?.data || null;
};

export class PayQrProvider {
  /**
   * @param {object} opts
   * @param {number} [opts.sizeDots]      - printed QR width in dots (~30 mm at 240)
   * @param {string} [opts.cacheDir]      - where the read QR content is kept (offline)
   * @param {{get(url:string):Promise<object|null>}} [opts.imageProvider]
   *        - loads the uploaded image when its QR can't be read (a LogoProvider
   *          set up for crisp black/white)
   * @param {Function} [opts.fetch]       - injectable for tests
   */
  constructor({ sizeDots = 240, cacheDir = null, imageProvider = null, fetch: fetchImpl } = {}) {
    this.sizeDots = sizeDots;
    this.cacheFile = cacheDir ? path.join(cacheDir, "payment-qr.json") : null;
    this.imageProvider = imageProvider;
    this._fetch = fetchImpl || globalThis.fetch;
    this._decoded = new Map(); // uploaded image URL → QR text (null = unreadable)
  }

  _readCache(url) {
    try {
      const c = JSON.parse(fs.readFileSync(this.cacheFile, "utf8"));
      return c.url === url ? c.text : undefined;
    } catch { return undefined; }
  }

  _writeCache(url, text) {
    if (!this.cacheFile) return;
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      fs.writeFileSync(this.cacheFile, JSON.stringify({ url, text, readAt: new Date().toISOString() }, null, 2));
    } catch { /* cache is optional */ }
  }

  /** The uploaded QR's content, or null if it can't be read. Cached per URL. */
  async _readUploaded(url) {
    if (this._decoded.has(url)) return this._decoded.get(url);
    let text = null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await this._fetch(cloudinaryPngUrl(url, 800, 800), { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = decodeQr(PNG.sync.read(Buffer.from(await res.arrayBuffer())));
      if (!text) logger.warn("The uploaded payment QR couldn't be read — printing the image itself");
      this._writeCache(url, text);
    } catch (err) {
      const cached = this.cacheFile ? this._readCache(url) : undefined;
      if (cached === undefined) {
        logger.warn(`Payment QR download failed (${err.message})`);
        return null; // not cached — try again next bill
      }
      text = cached;
    } finally {
      clearTimeout(timer);
    }
    this._decoded.set(url, text);
    return text;
  }

  /**
   * QR for a bill, or null when there's nothing to show (already paid, or
   * no payment QR / UPI ID configured).
   * @returns {Promise<null | { bitmap, upiId?: string, amount?: number }>}
   */
  async forBill(payload = {}, profile = {}) {
    if (payload.paymentStatus === "PAID") return null;
    // A combined bill with some orders already paid asks only for the rest.
    const total = Number(payload.combined && payload.dueTotal != null ? payload.dueTotal : payload.total) || 0;
    const amount = total > 0 ? total : undefined;

    if (profile.paymentQr) {
      const text = await this._readUploaded(profile.paymentQr);
      if (text) {
        return { bitmap: qrBitmap(text, { sizeDots: this.sizeDots }), upiId: upiPayee(text) || undefined, amount };
      }
      const bitmap = this.imageProvider ? await this.imageProvider.get(profile.paymentQr) : null;
      if (bitmap) return { bitmap, amount };
    }
    if (isUpiId(profile.upiId) && total > 0) {
      const url = upiPayUrl({
        upiId: profile.upiId,
        payeeName: profile.upiPayeeName || profile.name,
        amount: total,
        note: payload.orderId ? `Bill ${payload.orderId}` : "",
      });
      return { bitmap: qrBitmap(url, { sizeDots: this.sizeDots }), upiId: String(profile.upiId).trim(), amount: total };
    }
    return null;
  }
}
