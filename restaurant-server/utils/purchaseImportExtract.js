// utils/purchaseImportExtract.js
// ─────────────────────────────────────────────────────────────────────────────
// Turns an uploaded purchase document (PDF or image) into raw text, for
// utils/purchaseImportParser.js to then turn into candidate line items.
//
// This is the one place in the app that talks to a document-extraction
// library, so it's also where the honest capability boundary lives:
//   • Text-based PDF   → pdf-parse's getText() — reliable, no OCR involved.
//   • Scanned/image PDF → pdf-parse's getScreenshot() renders each page to a
//     PNG, then tesseract.js OCRs each page image. Slower and less reliable
//     than real text, so results come back flagged `ocr: true`.
//   • JPG/PNG/WEBP     → tesseract.js OCRs the image directly.
//
// Neither library requires an API key or paid service — both run locally in
// this process. tesseract.js does need outbound network access the FIRST
// time it runs on a given machine, to download the English trained-data file
// (~4MB) from its CDN; after that it's cached on disk and works offline. If
// that download fails (no internet, firewalled), OCR throws and the caller
// gets a clear "OCR unavailable" error rather than a silent empty result.
// ─────────────────────────────────────────────────────────────────────────────
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";

// Below this many non-whitespace characters, a "text" PDF is almost
// certainly a scan with no real text layer — worth a second look via OCR
// rather than reporting "0 items found" on a perfectly good invoice.
const MIN_TEXT_CHARS = 40;

// OCR every page of a scanned PDF individually gets expensive fast; a
// purchase invoice is realistically 1-3 pages, so cap it rather than let a
// 40-page PDF someone uploaded by mistake hang the request for minutes.
const MAX_OCR_PAGES = 5;

// tesseract.js defaults to caching its downloaded trained-data file in the
// current working directory, which for this server IS the project
// directory — left alone it drops a ~5MB eng.traineddata file straight into
// the repo. Point it at the OS temp dir instead. tesseract.js writes into
// this directory but never creates it, and silently swallows the write
// error if it's missing (falls back to re-downloading every time, no
// crash) — so it's created up front to make the cache actually stick.
const OCR_CACHE_PATH = path.join(os.tmpdir(), "adds-cafe-ocr-cache");
fs.mkdirSync(OCR_CACHE_PATH, { recursive: true });

const ocrImageBuffer = async (buffer) => {
  const worker = await createWorker("eng", 1, { cachePath: OCR_CACHE_PATH });
  try {
    const { data } = await worker.recognize(buffer);
    return data.text || "";
  } finally {
    await worker.terminate();
  }
};

// Call once at server startup (fire-and-forget, never blocks boot and never
// throws). Hosts like Render give a web service an EPHEMERAL filesystem —
// every redeploy/restart starts from an empty disk, so the first real
// upload after a deploy would otherwise pay for both the OCR run AND a
// ~4-5MB trained-data download inside the same request, on top of a slow/
// shared-CPU low-tier instance. That combination is easily slower than the
// platform's own request timeout, which kills the connection before this
// server ever gets to send its own clear JSON error — the browser just
// sees a bare 500/502 with no useful message. Priming the cache at boot
// (while nothing is waiting on a response) avoids paying that cost on a
// user's first click.
export const warmUpOcr = () => {
  createWorker("eng", 1, { cachePath: OCR_CACHE_PATH })
    .then((worker) => worker.terminate())
    .then(() => console.log("[purchase-import] OCR trained-data cache warmed"))
    .catch((err) => console.warn("[purchase-import] OCR warm-up failed (will retry on first real request):", err.message));
};

/**
 * @param {Buffer} buffer
 * @param {string} mimetype  one of application/pdf, image/jpeg, image/png, image/webp
 * @returns {Promise<{ sourceType: "TEXT_PDF"|"SCANNED_PDF"|"IMAGE", rawText: string, pageCount?: number, warning?: string }>}
 */
export const extractDocumentText = async (buffer, mimetype) => {
  if (mimetype === "application/pdf") {
    let parser;
    try {
      parser = new PDFParse({ data: buffer });
      const textResult = await parser.getText();
      const pageCount = textResult.pages?.length || textResult.total || 1;
      const text = (textResult.text || "").trim();

      if (text.length >= MIN_TEXT_CHARS) {
        return { sourceType: "TEXT_PDF", rawText: text, pageCount };
      }

      // Sparse/no text layer → likely a scanned PDF. Render pages to images
      // and OCR them instead of reporting an empty extraction.
      const pagesToRender = Math.min(pageCount, MAX_OCR_PAGES);
      const shots = await parser.getScreenshot({ scale: 2, first: pagesToRender });
      const ocrChunks = [];
      for (const page of shots.pages) {
        ocrChunks.push(await ocrImageBuffer(page.data));
      }
      const ocrText = ocrChunks.join("\n").trim();
      return {
        sourceType: "SCANNED_PDF",
        rawText: ocrText,
        pageCount,
        warning: pageCount > MAX_OCR_PAGES
          ? `Only the first ${MAX_OCR_PAGES} of ${pageCount} pages were scanned — this looked like a scanned document.`
          : undefined,
      };
    } finally {
      await parser?.destroy();
    }
  }

  // JPG / PNG / WEBP — straight to OCR.
  const rawText = await ocrImageBuffer(buffer);
  return { sourceType: "IMAGE", rawText };
};
