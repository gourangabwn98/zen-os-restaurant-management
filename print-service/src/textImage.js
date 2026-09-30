// src/textImage.js
// ─────────────────────────────────────────────────────────────────────────────
// Prints text the printer's built-in font can't show — Bengali ("Hotel
// খোয়াই"), Hindi, any non-Latin script — by drawing that line as an image
// with a Windows font and printing the image (same raster path as the logo).
//
// ESC/POS receipt printers only have a few Latin/Western code pages; there
// is no Bengali code page to switch to, so an image is the only way.
//
// How: lines are drawn by Windows' own text engine (GDI+ via PowerShell —
// always present on Windows, no extra install), which shapes complex scripts
// correctly (vowel signs, conjuncts). The default font, "Nirmala UI", ships
// with Windows 10/11 and covers Bengali, Devanagari and the other Indian
// scripts. All lines of a ticket that need it are drawn in ONE PowerShell
// run, and every drawn line is cached on disk (data/text-images/), so the
// restaurant name is only ever drawn once.
//
// Layout is unchanged: a line keeps its column positions (`cells` from
// src/renderers/layout.js), mapped to printer dots, so labels, values, qty
// and amount columns line up with the normal text lines around it. ASCII
// lines still print as native text (sharpest, fastest).
//
// Never fails a print: on any problem (not Windows, PowerShell blocked…) the
// lines are left as text and those characters print as "?".
// ─────────────────────────────────────────────────────────────────────────────
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
import { PNG } from "pngjs";
import { toReceiptBitmap } from "./logo.js";
import { needsImage } from "./renderers/layout.js";
import { logger } from "./logger.js";

const execFile = promisify(execFileCb);

// Standard ESC/POS font A is 12 dots wide: 48 chars = 576 dots (80 mm),
// 32 chars = 384 dots (58 mm).
const DOTS_PER_CHAR = 12;
const SIZES = {
  normal: { height: 34, fontPx: 22 }, // a little taller than a text line — room for vowel signs
  large:  { height: 64, fontPx: 40 }, // the double-height restaurant name
};

const PS_SCRIPT = [
  "param([string]$SpecPath)",
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Drawing",
  "$specs = Get-Content -Raw -Encoding UTF8 -LiteralPath $SpecPath | ConvertFrom-Json",
  "foreach ($s in $specs) {",
  "  $bmp = New-Object System.Drawing.Bitmap ([int]$s.width), ([int]$s.height)",
  "  $g = [System.Drawing.Graphics]::FromImage($bmp)",
  "  $g.Clear([System.Drawing.Color]::White)",
  "  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit",
  "  $style = [System.Drawing.FontStyle]::Regular",
  "  if ($s.bold) { $style = [System.Drawing.FontStyle]::Bold }",
  "  $font = New-Object System.Drawing.Font([string]$s.font, [single]$s.fontPx, $style, [System.Drawing.GraphicsUnit]::Pixel)",
  "  foreach ($c in $s.cells) {",
  "    $sf = New-Object System.Drawing.StringFormat",
  "    $sf.Alignment = 'Near'",
  "    if ($c.align -eq 'right') { $sf.Alignment = 'Far' }",
  "    if ($c.align -eq 'center') { $sf.Alignment = 'Center' }",
  "    $sf.LineAlignment = 'Center'",
  "    $sf.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap",
  "    $sf.Trimming = [System.Drawing.StringTrimming]::None",
  "    $rect = New-Object System.Drawing.RectangleF ([single]$c.x), ([single]0), ([single]$c.w), ([single]$s.height)",
  "    $g.DrawString([string]$c.text, $font, [System.Drawing.Brushes]::Black, $rect, $sf)",
  "    $sf.Dispose()",
  "  }",
  "  $bmp.Save([string]$s.file, [System.Drawing.Imaging.ImageFormat]::Png)",
  "  $font.Dispose(); $g.Dispose(); $bmp.Dispose()",
  "}",
].join("\r\n");

export class TextImageRenderer {
  /**
   * @param {object} opts
   * @param {string} opts.cacheDir            - data/ folder (images go in text-images/)
   * @param {string} [opts.font]              - Windows font with the needed script
   * @param {Function} [opts.draw]            - injectable for tests: (specs) => Promise<void>
   * @param {string} [opts.platform]
   */
  constructor({ cacheDir, font = "Nirmala UI", draw = null, platform = process.platform } = {}) {
    this.dir = path.join(cacheDir || os.tmpdir(), "text-images");
    this.font = font;
    this._draw = draw || ((specs) => this._drawWithPowerShell(specs));
    this.platform = platform;
    this._mem = new Map(); // key → bitmap
    this._warned = false;
  }

  _spec(line, charsPerLine) {
    const width = charsPerLine * DOTS_PER_CHAR;
    const { height, fontPx } = SIZES[line.size === "large" ? "large" : "normal"];
    const cells = (line.cells?.length ? line.cells : [{ text: String(line.text).trim(), start: 0, width: charsPerLine, align: line.align || "left" }])
      .filter((c) => String(c.text ?? "").trim() !== "")
      .map((c) => ({ text: String(c.text), x: c.start * DOTS_PER_CHAR, w: c.width * DOTS_PER_CHAR, align: c.align || "left" }));
    const base = { font: this.font, width, height, fontPx, bold: Boolean(line.bold), cells };
    const key = crypto.createHash("sha1").update(JSON.stringify(base)).digest("hex").slice(0, 20);
    return { ...base, key, file: path.join(this.dir, `${key}.png`) };
  }

  async _drawWithPowerShell(specs) {
    fs.mkdirSync(this.dir, { recursive: true });
    const script = path.join(this.dir, "draw-text.ps1");
    const specFile = path.join(this.dir, `spec-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(script, PS_SCRIPT);
    fs.writeFileSync(specFile, JSON.stringify(specs.map(({ key, ...s }) => s)));
    try {
      await execFile("powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, specFile],
        { timeout: 30000, windowsHide: true });
    } finally {
      fs.unlink(specFile, () => {});
    }
  }

  /**
   * Returns `lines` with every line the printer can't show as text replaced
   * by an image line of the same content and layout.
   */
  async apply(lines, { charsPerLine = 48 } = {}) {
    if (this.platform !== "win32") return lines;
    const targets = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => !line.type && needsImage(line.text));
    if (!targets.length) return lines;

    try {
      const specs = targets.map((t) => ({ ...t, spec: this._spec(t.line, charsPerLine) }));
      const missing = specs.filter(({ spec }) => !this._mem.has(spec.key) && !fs.existsSync(spec.file)).map((s) => s.spec);
      if (missing.length) {
        const unique = [...new Map(missing.map((s) => [s.key, s])).values()];
        await this._draw(unique);
      }
      const out = [...lines];
      for (const { i, line, spec } of specs) {
        let bitmap = this._mem.get(spec.key);
        if (!bitmap) {
          const png = PNG.sync.read(fs.readFileSync(spec.file));
          // Anti-aliased text → crisp dots; a slightly high threshold keeps
          // thin strokes of Bengali letters from breaking up.
          bitmap = toReceiptBitmap(png, { invert: false, dither: false, threshold: 170 });
          this._mem.set(spec.key, bitmap);
        }
        out[i] = { type: "image", bitmap, label: String(line.text).trim(), feedAfter: false };
      }
      return out;
    } catch (err) {
      if (!this._warned) logger.warn(`Couldn't draw non-Latin text as an image (${err.message}) — it will print as "?"`);
      this._warned = true;
      return lines;
    }
  }
}
