// src/logo.js
// ─────────────────────────────────────────────────────────────────────────────
// The restaurant logo at the top of a printed bill (Admin → Profile → logo,
// sent by the backend as payload.logoUrl).
//
// A thermal printer only prints black dots, so the logo is converted to
// 1-bit receipt art here:
//   - resized to the receipt (Cloudinary does it on the fly for Cloudinary
//     URLs, and converts JPG/WebP to PNG; any other URL must already be PNG)
//   - a mostly-dark logo (light artwork on a black background) is inverted,
//     so the artwork prints in black on white paper instead of as gaps in a
//     solid black square — which is slow, wastes paper and is unreadable
//   - Floyd–Steinberg dithered, so shading keeps its detail
//
// Never blocks a bill: any failure (offline, not a PNG, bad URL) means the
// bill prints without a logo. The last good logo is cached on disk next to
// the queue, so bills keep their logo while the internet is down.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { logger } from "./logger.js";

const FETCH_TIMEOUT_MS = 8000;
const RETRY_FAILED_AFTER_MS = 5 * 60 * 1000; // don't hammer a broken URL on every bill

/** Cloudinary delivery URL → same image, fitted inside w×h and as PNG. */
export const cloudinaryPngUrl = (url, width, height) => {
  const m = /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/i.exec(url);
  if (!m) return url;
  return `${m[1]}c_limit,w_${width},h_${height}/f_png/${m[2]}`;
};

/**
 * RGBA pixels → pure black/white RGBA (what node-thermal-printer's raster
 * conversion expects), inverting mostly-dark images and dithering. Pure.
 */
export const toReceiptBitmap = ({ width, height, data }, { invert = "auto", dither = true, threshold = 128 } = {}) => {
  const lum = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3] / 255; // transparent → paper (white)
    const l = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
    lum[i] = l * a + 255 * (1 - a);
    sum += lum[i];
  }
  const flip = invert === true || (invert === "auto" && sum / (width * height) < 110);
  if (flip) for (let i = 0; i < lum.length; i++) lum[i] = 255 - lum[i];

  // Floyd–Steinberg error diffusion.
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const v = lum[i] < threshold ? 0 : 255;
      if (!dither) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; out[i * 4 + 3] = 255; continue; }
      const err = lum[i] - v;
      if (x + 1 < width) lum[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) lum[i + width - 1] += (err * 3) / 16;
        lum[i + width] += (err * 5) / 16;
        if (x + 1 < width) lum[i + width + 1] += err / 16;
      }
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
      out[i * 4 + 3] = 255;
    }
  }
  return { width, height, data: out, inverted: flip };
};

export class LogoProvider {
  /**
   * @param {object} opts
   * @param {string} opts.cacheDir   - where the last good logo is kept
   * @param {number} [opts.width]    - max logo width in printer dots (58 mm ≈ 384 dots)
   * @param {number} [opts.height]   - max logo height in dots
   * @param {"auto"|boolean} [opts.invert]
   * @param {boolean} [opts.dither]  - false = hard black/white (QR codes must stay crisp)
   * @param {string} [opts.cacheName] - disk cache file name (one per use: logo, payment QR)
   * @param {Function} [opts.fetch]  - injectable for tests
   */
  constructor({ cacheDir, width = 192, height = 160, invert = "auto", dither = true, cacheName = "logo-cache", fetch: fetchImpl } = {}) {
    this.cacheDir = cacheDir;
    this.width = width;
    this.height = height;
    this.invert = invert;
    this.dither = dither;
    this.cacheName = cacheName;
    this._fetch = fetchImpl || globalThis.fetch;
    this._mem = new Map();       // url → bitmap
    this._failedAt = new Map();  // url → time of last failed download
  }

  _cachePaths() {
    return { png: path.join(this.cacheDir, `${this.cacheName}.png`), meta: path.join(this.cacheDir, `${this.cacheName}.json`) };
  }

  _readDiskCache(url) {
    try {
      const { png, meta } = this._cachePaths();
      const m = JSON.parse(fs.readFileSync(meta, "utf8"));
      if (m.url !== url || m.width !== this.width || m.height !== this.height) return null;
      return PNG.sync.read(fs.readFileSync(png));
    } catch {
      return null;
    }
  }

  _writeDiskCache(url, pngBuffer) {
    try {
      const { png, meta } = this._cachePaths();
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.writeFileSync(png, pngBuffer);
      fs.writeFileSync(meta, JSON.stringify({ url, width: this.width, height: this.height, savedAt: new Date().toISOString() }));
    } catch (err) {
      logger.warn("Couldn't cache the logo:", err.message);
    }
  }

  async _download(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await this._fetch(cloudinaryPngUrl(url, this.width, this.height), { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }

  /** Receipt bitmap for this logo URL, or null (print without a logo). */
  async get(url) {
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
    if (this._mem.has(url)) return this._mem.get(url);

    let png = null;
    const lastFail = this._failedAt.get(url);
    if (!lastFail || Date.now() - lastFail > RETRY_FAILED_AFTER_MS) {
      try {
        const buf = await this._download(url);
        png = PNG.sync.read(buf); // throws if it isn't a PNG
        this._writeDiskCache(url, buf);
        this._failedAt.delete(url);
      } catch (err) {
        this._failedAt.set(url, Date.now());
        logger.warn(`Logo download failed (${err.message}) — using the cached copy if there is one`);
      }
    }
    png = png || this._readDiskCache(url);
    if (!png) return null;

    // Never wider than the requested size, whatever the source returned.
    if (png.width > this.width * 2 || png.height > this.height * 2) {
      logger.warn(`Logo is ${png.width}×${png.height} — too large to print; upload a smaller one or use a Cloudinary URL`);
      return null;
    }
    const bitmap = toReceiptBitmap(png, { invert: this.invert, dither: this.dither });
    this._mem.set(url, bitmap);
    return bitmap;
  }
}
