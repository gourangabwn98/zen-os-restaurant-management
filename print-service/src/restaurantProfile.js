// src/restaurantProfile.js
// ─────────────────────────────────────────────────────────────────────────────
// Restaurant details for the BILL/KOT header — name, address, city, phone
// and logo, exactly as set in Admin → Profile. Read from the backend's public
// profile endpoint (GET /api/admin/restaurant/profile — the same one the
// customer app uses), so the print jobs themselves don't need to carry them
// and nothing in the database changes.
//
// Refreshed at most every REFRESH_MS; the last good copy is cached on disk
// next to the queue, so tickets keep their header while the internet is down.
// A header problem never blocks printing — worst case the ticket prints with
// whatever the job itself carries.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "fs";
import path from "path";
import { logger } from "./logger.js";

const REFRESH_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

const pick = (d = {}) => ({
  name: d.restaurantName || "",
  address: d.address || "",
  city: d.city || "",
  phone: d.phone || "",
  logo: d.logo || "",
  // "Scan & Pay" QR on unpaid bills (src/payQr.js) — Admin → Profile → Payment.
  upiId: d.upiId || "",
  upiPayeeName: d.upiPayeeName || "",
  paymentQr: d.paymentQr || "",
});

export class RestaurantProfileProvider {
  /**
   * @param {object} opts
   * @param {string} opts.backendUrl - same BACKEND_URL the socket uses
   * @param {string} opts.cacheDir
   * @param {Function} [opts.fetch]  - injectable for tests
   */
  constructor({ backendUrl, cacheDir, fetch: fetchImpl } = {}) {
    this.url = `${String(backendUrl || "").replace(/\/+$/, "")}/api/admin/restaurant/profile`;
    this.cacheFile = path.join(cacheDir, "restaurant-profile.json");
    this._fetch = fetchImpl || globalThis.fetch;
    this._profile = null;
    this._fetchedAt = 0;
  }

  _readDisk() {
    try { return JSON.parse(fs.readFileSync(this.cacheFile, "utf8")); } catch { return null; }
  }

  _writeDisk(profile) {
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      fs.writeFileSync(this.cacheFile, JSON.stringify(profile, null, 2));
    } catch (err) {
      logger.warn("Couldn't cache the restaurant profile:", err.message);
    }
  }

  /** { name, address, city, phone, logo } — possibly empty strings, never throws.
   * Never makes a print wait when ANY copy exists: a stale one (memory or
   * disk) is returned at once and refreshed in the background — a slow or
   * waking-up server must not hold a KOT for up to FETCH_TIMEOUT_MS. Only the
   * very first fetch, with nothing cached at all, is waited for. */
  async get() {
    if (this._profile && Date.now() - this._fetchedAt < REFRESH_MS) return this._profile;
    if (!this._profile) this._profile = this._readDisk();
    if (this._profile) {
      this._refresh();
      return this._profile;
    }
    return this._refresh();
  }

  /** One fetch at a time; → the profile to use (never throws). */
  _refresh() {
    if (this._inflight) return this._inflight;
    this._inflight = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await this._fetch(this.url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        this._profile = pick(body?.data || body);
        this._writeDisk(this._profile);
      } catch (err) {
        const cached = this._profile || this._readDisk();
        if (!cached) logger.warn(`Restaurant details unavailable (${err.message}) — printing without address/phone`);
        this._profile = cached || pick();
      } finally {
        clearTimeout(timer);
        this._fetchedAt = Date.now(); // also throttles retries after a failure
        this._inflight = null;
      }
      return this._profile;
    })();
    return this._inflight;
  }
}
