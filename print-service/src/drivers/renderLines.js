// src/drivers/renderLines.js
// Applies the line-array format produced by src/renderers/*.js onto a
// node-thermal-printer instance's formatting calls. Shared by both drivers
// so KOT/bill layout logic only exists once.
export const renderLinesToPrinter = (printer, lines) => {
  printer.clear();
  for (const line of lines) {
    if (line.type === "cut") { printer.cut(); continue; }
    if (line.type === "feed") { printer.newLine(); continue; }
    if (line.bold) printer.bold(true);
    if (line.align === "center") printer.alignCenter();
    else if (line.align === "right") printer.alignRight();
    else printer.alignLeft();
    if (line.size === "large") printer.setTextDoubleHeight();

    printer.println(line.text ?? "");

    if (line.size === "large") printer.setTextNormal();
    if (line.bold) printer.bold(false);
  }
  printer.cut();
};
