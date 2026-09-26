// Milestone 4: organize grid, split modes + ZIP, merge ordering (checks downloaded PDFs).
// Run via `npm run e2e` (serves ./out); outputs land in e2e/.output/.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const { PDFDocument, StandardFonts, rgb } = await import(pathToFileURL(`${repo}/node_modules/@cantoo/pdf-lib/cjs/index.js`).href);
const { unzipSync } = await import(pathToFileURL(`${repo}/node_modules/fflate/lib/index.cjs`).href);

const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const step = (s) => console.log("✓", s);

// Pages are identified by width: A = 300,310,…; B = 600,…; C = 700,…
async function makePdf(label, count, startWidth, height, color) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold); // standard font: pdf.js fetches /pdfjs/standard_fonts
  for (let i = 0; i < count; i++) {
    const w = startWidth + i * 10;
    const page = doc.addPage([w, height]);
    page.drawRectangle({ x: 0, y: 0, width: w, height, color });
    page.drawText(`${label}${i + 1}`, { x: 30, y: height / 2 - 40, size: 110, font, color: rgb(1, 1, 1) });
    page.drawText("TOP", { x: 30, y: height - 50, size: 36, font, color: rgb(1, 1, 1) });
  }
  return doc.save();
}
const widthsOf = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => Math.round(p.getWidth()));
const rotationsOf = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getRotation().angle);

mkdirSync("m4", { recursive: true });
writeFileSync("m4/A.pdf", await makePdf("A", 6, 300, 420, rgb(0.15, 0.23, 0.51)));
writeFileSync("m4/B.pdf", await makePdf("B", 3, 600, 300, rgb(0.06, 0.6, 0.45)));
writeFileSync("m4/C.pdf", await makePdf("C", 4, 700, 420, rgb(0.8, 0.45, 0.05)));
const locked = await PDFDocument.create();
locked.addPage();
locked.encrypt({ userPassword: "pw", ownerPassword: "owner" });
writeFileSync("m4/locked.pdf", await locked.save());
step("fixtures written");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
const origins = new Set();
const assetPaths = new Set();
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  const u = new URL(r.url());
  origins.add(u.origin);
  if (u.pathname.startsWith("/pdfjs/")) assetPaths.add(u.pathname.split("/").slice(0, 3).join("/"));
});
page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));

const tile = (n) => page.getByRole("button", { name: new RegExp(`^Page ${n}(?!\\d)`) });
const rendered = (loc) => loc.locator("canvas:not(.invisible)").first().waitFor();
async function drag(from, to) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(a.x + a.width / 2 + ((b.x - a.x) * i) / 12, a.y + a.height / 2 + ((b.y - a.y) * i) / 12);
  await page.mouse.move(b.x + b.width / 2 - 20, b.y + b.height / 2);
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(300);
}
async function download(trigger) {
  const [d] = await Promise.all([page.waitForEvent("download"), trigger()]);
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}

// ---------------------------------------------------------------- Organize
await page.goto(base + "/tools/organize/", { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(["m4/A.pdf"]);
await rendered(tile(6));
await page.screenshot({ path: "m4-01-organize.png" });
step("organize grid renders thumbnails");

await tile(2).click();
await page.getByRole("button", { name: "Rotate right" }).click();
await tile(4).click({ modifiers: ["Control"] });
await tile(4).click(); // select only page 4
await page.keyboard.press("Delete");
assert.ok(await page.getByRole("button", { name: /^Page 4 \(deleted\)/ }).isVisible());
await drag(tile(6), tile(1));
const order = await page.locator('ol li button[aria-pressed]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").match(/^Page (\d+)/)[1]));
console.log("   order after drag:", order.join(","));
assert.equal(order[0], "6");
// Undo the drag, redo it.
await page.keyboard.press("Control+z");
let undone = await page.locator('ol li button[aria-pressed]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").match(/^Page (\d+)/)[1]));
assert.equal(undone[0], "1");
await page.keyboard.press("Control+y");
await page.waitForTimeout(200);
await page.screenshot({ path: "m4-02-organize-edited.png" });
step("select, rotate, delete (key), drag-reorder, undo/redo");

const organized = await download(() => page.getByRole("button", { name: "Download edited PDF" }).click());
assert.equal(organized.name, "A-organized.pdf");
assert.deepEqual(await widthsOf(organized.bytes), [350, 300, 310, 320, 340]);
assert.deepEqual(await rotationsOf(organized.bytes), [0, 0, 90, 0, 0]);
step("organized download: order 6,1,2,3,5 · page 2 rotated 90° · page 4 gone");

await page.getByRole("button", { name: "Apply changes" }).click();
await page.getByText("Changes applied").waitFor();
await rendered(tile(5));
assert.equal(await page.locator('ol li button[aria-pressed]').count(), 5);
step("apply replaces the tab; grid reloads with 5 pages");

// ---------------------------------------------------------------- Split
await page.locator('aside a[href="/tools/split/"]').click();
await page.waitForURL("**/tools/split/");
await rendered(tile(5));
await tile(1).click();
await tile(3).click({ modifiers: ["Shift"] });
assert.equal(await page.getByPlaceholder("Click pages or type ranges").inputValue(), "1-3");
await page.getByPlaceholder("Click pages or type ranges").fill("2, 4-5");
assert.ok(await page.getByText(/3\s*of 5 pages selected/).isVisible());
await page.getByRole("button", { name: "Extract selected pages" }).click();
await page.getByText("Pages extracted").waitFor();
const extracted = await download(() => page.getByRole("button", { name: "Download result" }).click());
assert.equal(extracted.name, "A-pages-2_4-5.pdf");
assert.deepEqual(await widthsOf(extracted.bytes), [300, 320, 340]);
step("split/select: click + shift-click + typed ranges stay in sync; extract downloads 3 pages");

await page.getByRole("radio", { name: "Custom ranges" }).click();
await page.locator('input:not([type="file"])').first().fill("1-2, 3-");
await page.getByRole("button", { name: "Split into 2 files" }).click();
await page.getByText("Split into 2 files", { exact: true }).last().waitFor();
await page.screenshot({ path: "m4-03-split.png" });
const zip = await download(() => page.getByRole("button", { name: "Download all as ZIP" }).click());
const entries = unzipSync(new Uint8Array(zip.bytes));
const names = Object.keys(entries).sort();
assert.deepEqual(names, ["A-part-1.pdf", "A-part-2.pdf"]);
assert.deepEqual(await widthsOf(entries["A-part-2.pdf"]), [310, 320, 340]);
step(`split/ranges: ZIP contains ${names.join(", ")}`);

await page.getByRole("radio", { name: "Every page" }).click();
assert.ok(await page.getByRole("button", { name: "Split into 5 files" }).isVisible());
await page.getByRole("radio", { name: "Fixed size" }).click();
await page.getByRole("spinbutton").fill("2");
assert.ok(await page.getByRole("button", { name: "Split into 3 files" }).isVisible());
step("split modes: every page = 5 files, fixed 2 = 3 files");

// ---------------------------------------------------------------- Merge
await page.locator('aside a[href="/tools/merge/"]').click();
await page.waitForURL("**/tools/merge/");
await page.locator('input[type="file"]').setInputFiles(["m4/B.pdf", "m4/C.pdf", "m4/locked.pdf"]);
await page.getByText("Merge order").waitFor();
await page.getByText("This PDF is password-protected").waitFor();
assert.ok(await page.getByRole("button", { name: "Merge 3 PDFs" }).isVisible());
assert.ok(await page.getByRole("checkbox", { name: "Include locked.pdf" }).isDisabled());
step("merge automatically leaves out the password-protected PDF");

// Move C above A with the keyboard sensor: focus C's handle, Space, ArrowUp ×2, Space.
await page.getByRole("button", { name: /Reorder C\.pdf/ }).focus();
for (const key of ["Space", "ArrowUp", "ArrowUp", "Space"]) {
  await page.keyboard.press(key);
  await page.waitForTimeout(200);
}
const tabOrder = await page.getByRole("tab").allInnerTexts();
console.log("   tabs after keyboard reorder:", tabOrder.join(" | "));
assert.equal(tabOrder[0], "C.pdf");
await page.locator('input[value="merged.pdf"]').fill("bundle");
await page.getByRole("button", { name: "Merge 3 PDFs" }).click();
await page.getByText("12 pages from 3 files").waitFor();
await page.screenshot({ path: "m4-04-merge.png" });
const merged = await download(() => page.getByRole("button", { name: "Download result" }).click());
assert.equal(merged.name, "bundle.pdf");
assert.deepEqual(await widthsOf(merged.bytes), [700, 710, 720, 730, 350, 300, 310, 320, 340, 600, 610, 620]);
const mergedDoc = await PDFDocument.load(merged.bytes, { updateMetadata: false });
assert.equal(mergedDoc.getProducer(), undefined);
step("merge: keyboard reorder moves tabs too; 12 pages in C, A, B order; no producer metadata");

await page.getByRole("button", { name: "Open in a new tab" }).click();
await page.getByRole("tab", { name: /bundle\.pdf/ }).waitFor();
step("merged result opens as a new tab");

// ---------------------------------------------------------------- Preview + themes
await page.locator('aside a[href="/tools/sanitize/"]').click();
await page.getByRole("tab", { name: /bundle\.pdf/ }).click();
await page.getByText("Page 1 of 12").waitFor();
step("PDF preview shows first page and page count");

const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const p2 = await dark.newPage();
await p2.goto(base + "/tools/organize/", { waitUntil: "networkidle" });
await p2.locator('input[type="file"]').setInputFiles(["m4/C.pdf"]);
await p2.locator("canvas:not(.invisible)").nth(3).waitFor();
await p2.getByRole("button", { name: /^Page 2/ }).click();
await p2.screenshot({ path: "m4-05-organize-dark.png" });
const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p3 = await mob.newPage();
await p3.goto(base + "/tools/organize/", { waitUntil: "networkidle" });
await p3.locator('input[type="file"]').setInputFiles(["m4/A.pdf"]);
await p3.locator("canvas:not(.invisible)").nth(1).waitFor();
await p3.screenshot({ path: "m4-06-organize-mobile.png" });
console.log("   mobile overflow px:", await p3.evaluate(() => document.documentElement.scrollWidth - innerWidth));

console.log("   pdf.js assets fetched:", [...assetPaths]);
console.log("errors:", errors.length ? errors : "none");
console.log("origins:", [...origins]);
await browser.close();
