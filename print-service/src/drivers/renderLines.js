// src/drivers/renderLines.js
// Applies the line-array format produced by src/renderers/*.js onto a
// node-thermal-printer instance's formatting calls. Shared by both drivers
// so KOT/bill layout logic only exists once.
export const renderLinesToPrinter = (printer, lines) => {
  printer.clear();
  for (const line of lines) {
    if (line.type === "cut") { printer.cut(); continue; }
    if (line.type === "image") {
      // { bitmap: { width, height, data } } — already black/white (src/logo.js).
      // A logo that can't be encoded is skipped: never fail the bill over it.
      try {
        const { width, height, data } = line.bitmap;
        printer.alignCenter();
        printer.append(printer.printer.printImageBuffer(width, height, data));
        // Text drawn as an image (src/textImage.js) is one printed line —
        // no blank line after it.
        if (line.feedAfter !== false) printer.newLine();
      } catch { /* print without the logo */ }
      continue;
    }
    if (line.type === "feed") { printer.newLine(); continue; }
    if (line.bold) printer.bold(true);
    if (line.align === "center") printer.alignCenter();
    else if (line.align === "right") printer.alignRight();
    else printer.alignLeft();
    if (line.size === "large") printer.setTextDoubleHeight();

    // Anything outside the printer's built-in characters that wasn't turned
    // into an image (src/textImage.js) prints as "?" rather than garbage.
    printer.println(String(line.text ?? "").replace(/[^\x20-\x7E]/g, "?"));

    if (line.size === "large") printer.setTextNormal();
    if (line.bold) printer.bold(false);
  }
  printer.cut();
};
