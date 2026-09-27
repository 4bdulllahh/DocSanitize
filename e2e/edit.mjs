// Milestone 11: Edit PDF. Every tool is used like a person would, then the saved PDF is checked
// with pdf.js (text, annotations, drawings) and pdf-lib (no author/date on annotations).
// Run via `npm run e2e` (serves ./out); outputs land in e2e/.output/.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const mod = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { PDFDocument, PDFName, StandardFonts, degrees } = await mod("node_modules/@cantoo/pdf-lib/cjs/index.js");
const { getDocument, OPS } = await mod("node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const { tinyPng } = await mod("src/lib/metadata/__tests__/fixtures.ts");

const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const step = (s) => console.log("✓", s);

// ---------------------------------------------------------------- Fixtures
mkdirSync("m11", { recursive: true });
{
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("Invoice 1042", { x: 72, y: 700, size: 20, font });
  page.drawText("Your balance is 1,200 USD.", { x: 72, y: 660, size: 12, font });
  page.drawText("Please pay within 30 days.", { x: 72, y: 640, size: 12, font });
  page.drawText("Thank you for your business.", { x: 72, y: 600, size: 12, font });
  const rotated = doc.addPage([612, 792]);
  rotated.setRotation(degrees(90));
  rotated.drawText("Appendix", { x: 72, y: 700, size: 14, font });
  writeFileSync("m11/invoice.pdf", await doc.save());
  writeFileSync("m11/logo.png", tinyPng());
}
step("fixtures: a two-page invoice (page 2 rotated 90°) and a logo");

async function inspect(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: `${repo}/node_modules/pdfjs-dist/standard_fonts/` });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const text = (await page.getTextContent()).items
      .filter((t) => t.str?.trim())
      .map((t) => {
        const [u, v] = viewport.convertToViewportPoint(t.transform[4], t.transform[5]);
        const [u2, v2] = viewport.convertToViewportPoint(t.transform[4] + t.transform[0], t.transform[5] + t.transform[1]);
        return { str: t.str, u, v, upright: u2 > u && Math.abs(v2 - v) < 0.5 };
      });
    const { fnArray } = await page.getOperatorList();
    pages.push({ text, annotations: await page.getAnnotations(), images: fnArray.filter((f) => f === OPS.paintImageXObject).length, paths: fnArray.filter((f) => f === OPS.constructPath).length });
  }
  await task.destroy();
  return pages;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
const origins = new Set();
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => origins.add(new URL(r.url()).origin));
page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
async function download(trigger) {
  const [d] = await Promise.all([page.waitForEvent("download"), trigger()]);
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}

const stage = page.getByRole("application", { name: /of the document being edited/ });
/** Screen position of a point given in page points (displayed, top-left origin). */
async function at(x, y) {
  let box = await stage.boundingBox();
  const s = box.width / (box.width > box.height ? 792 : 612); // page 2 is shown landscape
  // Keep the point in the middle of the window, clear of the sticky header and toolbar.
  const screenY = box.y + y * s;
  if (screenY < 300 || screenY > 800) {
    await page.evaluate((dy) => window.scrollBy(0, dy), screenY - 550);
    box = await stage.boundingBox();
  }
  return [box.x + x * s, box.y + y * s];
}
async function drag(from, to, steps = 6) {
  const start = await at(...from);
  const box = await stage.boundingBox();
  const s = box.width / (box.width > box.height ? 792 : 612); // page 2 is shown landscape
  await page.mouse.move(...start);
  await page.mouse.down();
  // Same scroll position as the start point (no scrolling mid-drag).
  const end = [box.x + to[0] * s, box.y + to[1] * s];
  await page.mouse.move(...end, { steps });
  await page.mouse.up();
}
const tool = (name) => page.getByRole("toolbar", { name: "Editing tools" }).getByRole("button", { name, exact: true }).click();
const changes = (n) => page.getByText(new RegExp(`^${n}\\s*changes? on`)).waitFor();

await page.goto(base + "/tools/edit-pdf/", { waitUntil: "networkidle" });
await page.locator('input[type="file"]').first().setInputFiles(["m11/invoice.pdf"]);
await stage.waitFor();
await page.waitForTimeout(800); // first render of the page

// ---------------------------------------------------------------- Edit existing text
await tool("Edit text");
await page.mouse.click(...(await at(120, 128))); // "Your balance is 1,200 USD." (baseline at y = 132)
const editor = page.getByRole("textbox", { name: "Edit this line of text" });
await editor.waitFor();
assert.equal(await editor.inputValue(), "Your balance is 1,200 USD.");
await page.keyboard.type("Your balance is 0 USD.");
await page.keyboard.press("Escape");
await changes(1);
step("edit text: clicked the line, its text is selected; typed a replacement");

// ---------------------------------------------------------------- Add text, shapes, drawing, marks
await tool("Add text");
await page.mouse.click(...(await at(360, 100)));
await page.keyboard.type("Approved");
await page.keyboard.press("Escape");
await changes(2);
await tool("Highlight");
await drag([60, 147], [240, 150]); // "Please pay within 30 days." (baseline 152)
await changes(3);
await tool("Rectangle");
await drag([72, 250], [220, 320]);
await tool("Arrow");
await drag([300, 260], [420, 300]);
await tool("Pen");
await drag([300, 360], [380, 390], 12);
await tool("Check mark");
await page.mouse.click(...(await at(460, 200)));
await tool("White-out");
await drag([70, 180], [260, 200]); // "Thank you for your business." (baseline 192)
await changes(8);
await tool("Note");
await page.mouse.click(...(await at(540, 60)));
await page.getByRole("textbox", { name: "Note" }).fill("Check the total");
await changes(9);
step("added text, highlight, rectangle, arrow, pen stroke, check mark, white-out and a note");

// ---------------------------------------------------------------- Image and signature
await tool("Image");
await page.locator('label:has-text("Choose an image") input[type="file"]').setInputFiles(["m11/logo.png"]);
await changes(10);
await tool("Signature");
await page.getByRole("radio", { name: "Type" }).click();
await page.getByRole("textbox", { name: "Your name" }).fill("Jane Doe");
await page.getByRole("button", { name: "Save signature" }).click();
await changes(11);
step("placed an image and a typed signature");

// ---------------------------------------------------------------- Select, move, delete, undo, redo
await tool("Select");
await drag([146, 285], [196, 335]); // move the rectangle by 50, 50
await page.getByRole("heading", { name: "Rectangle" }).waitFor();
await page.keyboard.press("Delete");
await changes(10);
await page.keyboard.press("Control+z");
await changes(11);
await page.keyboard.press("Control+Shift+z");
await changes(10);
await page.keyboard.press("Control+z");
await changes(11);
step("select + drag moves; Delete removes; undo and redo");

// ---------------------------------------------------------------- Rotated page
await page.getByRole("button", { name: "Next page" }).click();
await page.waitForTimeout(600);
await tool("Add text");
await page.mouse.click(...(await at(72, 150)));
await page.keyboard.type("Upright on a rotated page");
await page.keyboard.press("Escape");
await page.getByText(/12\s*changes on pages 1-2/).waitFor();
await page.screenshot({ path: "m11-01-rotated.png" });
await page.getByRole("button", { name: "Previous page" }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: "m11-02-editor.png" });
step("text added on the rotated page 2");

// ---------------------------------------------------------------- Save flattened
await page.getByRole("button", { name: "Save PDF" }).click();
await page.getByText("Edited PDF ready").waitFor();
const flat = await download(() => page.getByRole("button", { name: "Download result" }).click());
assert.equal(flat.name, "invoice-edited.pdf");
const [p1, p2] = await inspect(flat.bytes);
const strings = p1.text.map((t) => t.str);
assert.ok(strings.includes("Your balance is 0 USD."), strings.join(" | "));
assert.ok(strings.includes("Approved"));
assert.ok(!strings.join(" ").includes("1,200"), "the original text is gone from the file, not just covered");
assert.ok(!Buffer.from(flat.bytes).toString("latin1").includes("1,200"));
assert.ok(strings.includes("Thank you for your business."), "white-out covers but doesn't remove (as the UI says)");
const replaced = p1.text.find((t) => t.str === "Your balance is 0 USD.");
assert.ok(Math.abs(replaced.v - 132) < 1 && Math.abs(replaced.u - 72) < 1, `new line on the old baseline: ${replaced.u}, ${replaced.v}`);
assert.deepEqual(p1.annotations.map((a) => a.subtype), ["Text"], "flattened: only the note stays a comment");
assert.equal(p1.annotations[0].contentsObj.str, "Check the total");
assert.equal(p1.images, 2, "logo and signature");
assert.ok(p1.paths >= 5, "rectangle, arrow, pen, check mark, highlight and white-out drawn");
const upright = p2.text.find((t) => t.str === "Upright on a rotated page");
assert.ok(upright?.upright, "text reads left to right on the rotated page");
assert.ok(Math.abs(upright.u - 72) < 2, `placed where clicked: ${upright.u}`);
step("flattened: edited line replaced in the file, text/drawings/images in the page, note kept as a comment, rotated page upright");

// ---------------------------------------------------------------- Save editable
await page.getByRole("radio", { name: "Editable" }).click();
await page.getByRole("button", { name: "Save PDF" }).click();
await page.getByText("Edited PDF ready").waitFor();
const editable = await download(() => page.getByRole("button", { name: "Download result" }).click());
const [e1] = await inspect(editable.bytes);
const kinds = e1.annotations.map((a) => a.subtype).sort();
assert.deepEqual(kinds, ["FreeText", "Highlight", "Ink", "Line", "Square", "Stamp", "Stamp", "Stamp", "Text"].sort(), kinds.join());
const lib = await PDFDocument.load(editable.bytes);
for (const ref of lib.getPage(0).node.Annots().asArray()) {
  const annot = lib.context.lookup(ref);
  for (const key of ["T", "M", "CreationDate"]) assert.ok(!annot.has(PDFName.of(key)), `annotation has no /${key}`);
}
assert.ok(e1.text.some((t) => t.str === "Your balance is 0 USD.") && !e1.text.some((t) => t.str.includes("1,200")), "edited text is part of the page either way");
step("editable: FreeText, Highlight, Ink, Line, Square, Stamps and a Text note, none with an author or date");

// ---------------------------------------------------------------- Themes and mobile
const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const p2d = await dark.newPage();
await p2d.goto(base + "/tools/edit-pdf/", { waitUntil: "networkidle" });
await p2d.locator('input[type="file"]').first().setInputFiles(["m11/invoice.pdf"]);
await p2d.getByRole("application").waitFor();
await p2d.getByRole("button", { name: "Highlight", exact: true }).click();
await p2d.waitForTimeout(800);
await p2d.screenshot({ path: "m11-03-dark.png" });

const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p3 = await mob.newPage();
await p3.goto(base + "/tools/edit-pdf/", { waitUntil: "networkidle" });
await p3.locator('input[type="file"]').first().setInputFiles(["m11/invoice.pdf"]);
await p3.getByRole("application").waitFor();
await p3.waitForTimeout(800);
await p3.screenshot({ path: "m11-04-mobile.png", fullPage: true });
const overflow = await p3.evaluate(() => document.documentElement.scrollWidth - innerWidth);
console.log("   mobile overflow px:", overflow);
assert.ok(overflow <= 0, "no horizontal scroll on mobile");
step("dark theme and 390 px mobile screenshots");

console.log("errors:", errors.length ? errors : "none");
console.log("origins:", [...origins]);
assert.deepEqual(errors, []);
assert.deepEqual([...origins], [new URL(base).origin]);
await browser.close();
