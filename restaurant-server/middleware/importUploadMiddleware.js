// middleware/importUploadMiddleware.js
// ─────────────────────────────────────────────────────────────────────────────
// Upload handling for the Inventory → Import Purchase feature. Deliberately
// separate from middleware/uploadMiddleware.js (menu/banner images): that one
// uploads permanently to Cloudinary, but a purchase invoice is processed once
// to extract line items and then discarded — it is never written to disk or
// to any public storage (see CLAUDE.md "do not permanently store uploaded
// documents unless there is a real requirement").
//
// multer.memoryStorage() keeps the file only as an in-memory Buffer for the
// lifetime of the request; nothing here ever touches the filesystem or a
// third-party bucket.
// ─────────────────────────────────────────────────────────────────────────────
import multer from "multer";

// Accepted formats — PDF, JPG/JPEG, PNG, WEBP. Anything else is rejected
// before it ever reaches the extraction step.
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// Real magic-byte signatures — filename/mimetype headers are client-supplied
// and untrusted, so the actual bytes are what get checked before parsing.
const SIGNATURES = [
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },          // %PDF
  { mime: "image/jpeg",      bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png",       bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/webp",      bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, riff: true }, // "RIFF"...."WEBP"
];

export const sniffFileType = (buffer) => {
  if (!buffer || buffer.length < 12) return null;
  for (const sig of SIGNATURES) {
    const slice = buffer.subarray(sig.offset || 0, (sig.offset || 0) + sig.bytes.length);
    if (slice.every((b, i) => b === sig.bytes[i])) {
      if (sig.riff) {
        // RIFF container — confirm the "WEBP" tag at bytes 8-11 before trusting it.
        const tag = buffer.subarray(8, 12).toString("ascii");
        if (tag !== "WEBP") continue;
      }
      return sig.mime;
    }
  }
  return null;
};

const MAX_IMPORT_FILE_BYTES = 15 * 1024 * 1024; // 15 MB — invoices/scans run larger than a menu photo

export const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error("Unsupported file type — upload a PDF, JPG, PNG or WEBP file"), { statusCode: 400 }), false);
  },
});

// Wraps a single-file multer middleware so every failure (wrong type, too
// large, malformed multipart body) comes back as a clean 400 instead of
// falling through to the generic 500 error handler.
export const importUploadSingle = (fieldName) => (req, res, next) => {
  importUpload.single(fieldName)(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: `File is too large — the maximum is ${MAX_IMPORT_FILE_BYTES / (1024 * 1024)}MB` });
    }
    return res.status(err.statusCode || 400).json({ message: err.message || "Upload failed" });
  });
};

export { MAX_IMPORT_FILE_BYTES };
