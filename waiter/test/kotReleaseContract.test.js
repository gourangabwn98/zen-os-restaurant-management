// Read-only compatibility check of the local release. Never launches the EXE:
// only its standalone text-layout function is evaluated, without imports,
// filesystem/network APIs, processor, queue, drivers, or printer configuration.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import * as layout from "../../print-service/src/renderers/layout.js";
import { renderKot } from "../../print-service/src/renderers/kotRenderer.js";
import { diffOrderLines } from "../../restaurant-server/services/kotService.js";

const exe = readFileSync(new URL("../../print-service/client-update-2026-10-10/SohojPrintService.exe", import.meta.url));
const marker = exe.indexOf(Buffer.from("// src/config.js"));
assert.ok(marker > 0, "release must contain inspectable bundled source");
const source = exe.subarray(marker).toString("utf8");
const section = (name) => {
  const start = source.indexOf(`// ${name}\n`);
  assert.ok(start >= 0, `missing ${name}`);
  const end = source.indexOf("\n// ", start + 4);
  assert.ok(end > start);
  return source.slice(start, end);
};
const renderer = section("src/renderers/kotRenderer.js");
assert.ok(!/\brequire\s*\(|\bimport\b/.test(renderer));
const bundledRender = runInNewContext(`${renderer}\nrenderKot;`, { ...layout }, { timeout: 1000 });
const socket = section("src/socketClient.js");
assert.ok(socket.includes('"kot:created"'));
assert.match(socket, /items: payload.items/);
assert.match(socket, /payload.changed.*changed: true/);
const parent = (quantity) => ({ menuItem: "rice", name: "Rice", qty: 2, notes: "less spicy",
  ...(quantity && { addons: [{ addonId: "egg", name: "Boiled Egg", price: 25, qty: quantity }] }) });
for (const [before, after] of [[1, 3], [3, 1], [0, 1], [1, 0]]) {
  const { added, removed } = diffOrderLines([parent(before)], [parent(after)]);
  const payload = { orderId: "TEST-ONLY", jobType: "KOT", changed: true, items: [...added, ...removed], createdAt: "2026-10-16T10:00:00Z" };
  for (const width of [32, 48]) {
    const actual = bundledRender(payload, { width });
    assert.equal(JSON.stringify(actual), JSON.stringify(renderKot(payload, { width })), "bundled and current renderer must agree");
    const paper = actual.map((r) => r.text || "").join("\n");
    assert.match(paper, /ORDER CHANGED/);
    assert.match(paper, /CANCEL - Rice/);
    assert.match(paper, /Note: less spicy/);
    assert.match(paper, /Boiled Egg/);
    assert.match(paper, /x2/);
    if (after > 1) assert.ok(paper.includes(`+ ${after} x Boiled Egg`));
  }
}
console.log(`kotReleaseContract.test.js: 4 changes at 2 widths match exact bundled renderer; EXE SHA256 ${createHash("sha256").update(exe).digest("hex")}`);
