// Milestone 12: page tools (rotate, delete, insert, crop, resize, remove blank pages), header &
// footer, Bates numbering, flatten, grayscale, document properties, bookmarks and Fill PDF.
// Each download is checked with pdf-lib / pdf.js. Run via `npm run e2e`; outputs in e2e/.output/.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const mod = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { PDFDocument, StandardFonts, rgb } = await mod("node_modules/@cantoo/pdf-lib/cjs/index.js");
const { getDocument } = await mod("node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const { unzipSync } = await mod("node_modules/fflate/lib/index.cjs");

const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const step = (s) => console.log("✓", s);

// ---------------------------------------------------------------- Fixtures
mkdirSync("m12", { recursive: true });
{
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle("Draft");
  doc.setAuthor("Jane Doe");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 4; i++) {
    const page = doc.addPage([612, 792]);
    if (i === 3) continue; // blank
    page.drawText(`Page ${i}`, { x: 100, y: 650, size: 24, font, color: i === 4 ? rgb(0.9, 0.1, 0.1) : rgb(0, 0, 0) });
    if (i === 4) page.drawRectangle({ x: 100, y: 400, width: 200, height: 100, color: rgb(0.1, 0.4, 0.9) });
  }
  writeFileSync("m12/report.pdf", await doc.save());

  const other = await PDFDocument.create({ updateMetadata: false });
  for (let i = 1; i <= 2; i++) other.addPage([612, 792]).drawText(`Other ${i}`, { x: 100, y: 650, size: 24, font: await other.embedFont(StandardFonts.Helvetica) });
  writeFileSync("m12/other.pdf", await other.save());

  const form = await PDFDocument.create({ updateMetadata: false });
  const fp = form.addPage([612, 792]);
  const f = form.getForm();
  f.createTextField("FullName").addToPage(fp, { x: 72, y: 650, width: 250, height: 22 });
  f.createCheckBox("Agree").addToPage(fp, { x: 72, y: 610, width: 16, height: 16 });
  const plan = f.createRadioGroup("Plan");
  plan.addOptionToPage("basic", fp, { x: 72, y: 570, width: 16, height: 16 });
  plan.addOptionToPage("pro", fp, { x: 130, y: 570, width: 16, height: 16 });
  const country = f.createDropdown("Country");
  country.addOptions(["Oman", "Pakistan", "UAE"]);
  country.addToPage(fp, { x: 72, y: 520, width: 150, height: 22 });
  writeFileSync("m12/form.pdf", await form.save());
}
step("fixtures: a 4-page report (page 3 blank, page 4 in colour), a 2-page PDF and a form");

async function pdfjs(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: `${repo}/node_modules/pdfjs-dist/standard_fonts/` });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const text = (await page.getTextContent()).items.filter((t) => t.str?.trim()).map((t) => t.str);
    pages.push({ size: [Math.round(viewport.width), Math.round(viewport.height)], text: text.join(" | ") });
  }
  const outline = await doc.getOutline();
  await task.destroy();
  return { pages, outline };
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
async function download(name = "Download result") {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name }).click()]);
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}
const go = async (tool) => {
  await page.locator(`aside a[href="/tools/${tool}/"]`).click();
  await page.waitForURL(`**/tools/${tool}/`);
};
const tab = (name) => page.getByRole("tab", { name: new RegExp(name.replace(".", "\\.")) }).click();
const tile = (n) => page.getByRole("button", { name: new RegExp(`^Page ${n}(,|$)`) });

await page.goto(base + "/tools/rotate/", { waitUntil: "networkidle" });
await page.locator('input[type="file"]').first().setInputFiles(["m12/report.pdf", "m12/other.pdf", "m12/form.pdf"]);
await tab("report.pdf");

// ---------------------------------------------------------------- Rotate
await page.getByRole("button", { name: "Clear" }).click();
await tile(2).click();
await page.getByRole("radio", { name: "Right 90°" }).click();
await page.getByRole("button", { name: "Rotate 1 page" }).click();
const rotated = await download();
assert.deepEqual((await PDFDocument.load(rotated.bytes)).getPages().map((p) => p.getRotation().angle), [0, 90, 0, 0]);
step("rotate: only the picked page turned 90°");

// ---------------------------------------------------------------- Delete pages
await go("delete-pages");
await tile(2).click();
await tile(3).click({ modifiers: ["Shift"] });
await page.getByRole("button", { name: "Delete 2 pages" }).click();
const deleted = await download();
assert.deepEqual((await pdfjs(deleted.bytes)).pages.map((p) => p.text), ["Page 1", "Page 4"]);
step("delete pages: pages 2-3 (shift-click range) removed");

// ---------------------------------------------------------------- Insert pages
await go("insert-pages");
await page.getByRole("radio", { name: "Another PDF" }).click();
await page.getByRole("combobox", { name: "Position" }).selectOption({ label: "After page 1" });
await page.getByRole("combobox", { name: "From" }).selectOption({ label: "other.pdf" });
await page.getByRole("textbox", { name: "Its pages" }).fill("2");
await page.getByRole("button", { name: "Insert pages" }).click();
const inserted = await download();
assert.deepEqual((await pdfjs(inserted.bytes)).pages.map((p) => p.text), ["Page 1", "Other 2", "Page 2", "", "Page 4"]);
await page.getByRole("radio", { name: "Blank pages" }).click();
await page.getByRole("combobox", { name: "Position" }).selectOption({ label: "At the end" });
await page.getByRole("spinbutton", { name: "How many" }).fill("2");
await page.getByRole("radio", { name: "A4" }).click();
await page.getByRole("button", { name: "Insert 2 blank pages" }).click();
const blanks = await download();
assert.deepEqual((await pdfjs(blanks.bytes)).pages.map((p) => p.size).slice(-3), [[612, 792], [595, 842], [595, 842]]);
step("insert pages: page 2 of another PDF after page 1; two A4 blank pages at the end");

// ---------------------------------------------------------------- Crop
await go("crop");
await page.getByRole("spinbutton", { name: "Top (mm)" }).fill("25.4");
await page.getByRole("spinbutton", { name: "Left (mm)" }).fill("25.4");
await page.getByRole("button", { name: "Crop 4 pages" }).click();
const cropped = await download();
const croppedPages = (await pdfjs(cropped.bytes)).pages;
assert.deepEqual(croppedPages[0].size.map((v) => Math.abs(v - Math.round(v))), [0, 0]);
assert.ok(croppedPages.every((p) => p.size[0] < 612 - 60 && p.size[1] < 792 - 60), JSON.stringify(croppedPages.map((p) => p.size)));
await page.screenshot({ path: "m12-01-crop.png" });
await page.getByRole("radio", { name: "Remove white margins" }).click();
await page.getByText("Each page is trimmed to its own content.").waitFor();
await page.getByRole("button", { name: "Crop all pages" }).click();
const trimmed = await download();
const trimmedPages = (await pdfjs(trimmed.bytes)).pages;
assert.ok(trimmedPages[0].size[0] < 200 && trimmedPages[0].size[1] < 80, `page 1 trimmed to its text: ${trimmedPages[0].size}`);
assert.deepEqual(trimmedPages[2].size, [612, 792], "the blank page isn't cropped");
assert.equal(trimmedPages[0].text, "Page 1");
step("crop: 1-inch margins typed; automatic trim to each page's content (blank page left alone)");

// ---------------------------------------------------------------- Resize
await go("resize-pages");
await page.getByText(/Now: Letter/).waitFor();
await page.getByRole("radio", { name: "A4" }).click();
await page.getByRole("button", { name: "Resize pages" }).click();
const resized = await download();
assert.ok((await pdfjs(resized.bytes)).pages.every((p) => p.size[0] === 595 && p.size[1] === 842));
step("resize: Letter → A4 on every page");

// ---------------------------------------------------------------- Remove blank pages
await go("remove-blank");
await page.getByText(/Found 1 blank page/).waitFor();
await page.getByRole("button", { name: "Remove 1 page" }).click();
const noBlanks = await download();
assert.deepEqual((await pdfjs(noBlanks.bytes)).pages.map((p) => p.text), ["Page 1", "Page 2", "Page 4"]);
step("remove blank pages: page 3 found and removed");

// ---------------------------------------------------------------- Header & footer
await go("header-footer");
await page.getByRole("img", { name: "Preview of page 1" }).waitFor();
await page.getByRole("button", { name: "Add header & footer" }).click();
const headed = await download();
const headedPages = (await pdfjs(headed.bytes)).pages;
assert.ok(headedPages[0].text.includes("Page 1 of 4") && headedPages[0].text.includes("report.pdf"), headedPages[0].text);
assert.ok(headedPages[3].text.includes("Page 4 of 4"));
step("header & footer: file name at the top, “Page n of 4” at the bottom");

// ---------------------------------------------------------------- Grayscale
await go("grayscale");
await page.getByRole("button", { name: "Convert to grayscale" }).click();
await page.getByText("Grayscale PDF ready").waitFor();
const gray = await download();
const grayDoc = await PDFDocument.load(gray.bytes);
const content = new TextDecoder().decode(await (async () => {
  const { decodePDFRawStream } = await mod("node_modules/@cantoo/pdf-lib/cjs/index.js");
  return grayDoc.getPage(3).node.Contents().asArray().map((r) => decodePDFRawStream(grayDoc.context.lookup(r)).decode()).reduce((a, b) => new Uint8Array([...a, ...b]));
})());
assert.ok(!/\brg\b/.test(content) && /\bg\b/.test(content), "colour operators rewritten as gray");
step("grayscale: red text and blue rectangle become gray operators");

// ---------------------------------------------------------------- Edit metadata
await go("edit-metadata");
await page.getByRole("textbox", { name: "Title" }).fill("Quarterly report");
await page.getByRole("textbox", { name: "Author" }).fill("");
await page.getByRole("button", { name: "Save properties" }).click();
const props = await download();
const propsDoc = await PDFDocument.load(props.bytes, { updateMetadata: false });
assert.equal(propsDoc.getTitle(), "Quarterly report");
assert.equal(propsDoc.getAuthor(), undefined);
assert.ok(!Buffer.from(props.bytes).toString("latin1").includes("Jane Doe"));
step("edit metadata: title set, author removed");

// ---------------------------------------------------------------- Bookmarks
await go("bookmarks");
await page.getByText("No bookmarks yet.").waitFor();
await page.getByRole("button", { name: "Add a bookmark for page 1" }).click();
await page.keyboard.type("Introduction");
await page.getByRole("button", { name: "Next page" }).click();
await page.getByRole("button", { name: "Add a bookmark for page 2" }).click();
await page.keyboard.type("Details");
await page.getByRole("button", { name: "Move “Details” in a level" }).click();
await page.getByRole("button", { name: "Save bookmarks" }).click();
const marked = await download();
const { outline } = await pdfjs(marked.bytes);
assert.deepEqual(outline.map((o) => [o.title, o.items.map((i) => i.title)]), [["Introduction", ["Details"]]]);
step("bookmarks: “Introduction” with “Details” nested under it");

// ---------------------------------------------------------------- Bates (all open PDFs, in tab order)
await go("bates");
await page.getByText("DOC-000005 – DOC-000006").waitFor();
await page.getByRole("button", { name: "Number 3 PDFs" }).click();
await page.getByText("Bates numbers added").waitFor();
const zip = await download("Download all as ZIP");
const numbered = unzipSync(new Uint8Array(zip.bytes));
assert.deepEqual(Object.keys(numbered).sort(), ["form-bates.pdf", "other-bates.pdf", "report-bates.pdf"]);
const otherText = (await pdfjs(numbered["other-bates.pdf"])).pages.map((p) => p.text);
assert.ok(otherText[0].includes("DOC-000005") && otherText[1].includes("DOC-000006"), otherText.join());
step("bates: numbering continues across report (1-4), other (5-6) and form (7)");

// ---------------------------------------------------------------- Fill PDF
await go("fill-pdf");
await tab("form.pdf");
await page.getByRole("group", { name: "Fields on page 1" }).getByRole("textbox", { name: "Full Name" }).fill("Aïsha Khan");
await page.getByRole("checkbox", { name: "Agree" }).first().click();
await page.getByRole("group", { name: "Fields on page 1" }).getByRole("radio", { name: "Plan: pro" }).click();
await page.getByRole("list", { name: "All fields" }).getByRole("combobox", { name: "Country" }).selectOption("UAE");
await page.screenshot({ path: "m12-02-fill.png" });
await page.getByRole("button", { name: "Save filled PDF" }).click();
const filled = await download();
const form = (await PDFDocument.load(filled.bytes)).getForm();
assert.equal(form.getTextField("FullName").getText(), "Aïsha Khan");
assert.equal(form.getCheckBox("Agree").isChecked(), true);
assert.equal(form.getRadioGroup("Plan").getSelected(), "pro");
assert.deepEqual(form.getDropdown("Country").getSelected(), ["UAE"]);
await page.getByRole("checkbox", { name: /Flatten the form/ }).check();
await page.getByRole("button", { name: "Save filled PDF" }).click();
const flatFill = await download();
assert.equal((await PDFDocument.load(flatFill.bytes)).getForm().getFields().length, 0);
assert.ok((await pdfjs(flatFill.bytes)).pages[0].text.includes("Aïsha Khan"));
step("fill PDF: text, checkbox, radio and dropdown filled on the page and in the list; flattened copy too");

// ---------------------------------------------------------------- Flatten (a filled form)
await go("flatten");
await page.getByText(/4 form fields and 0 comments/).waitFor();
await page.getByRole("button", { name: "Flatten", exact: true }).click();
const flattened = await download();
assert.equal((await PDFDocument.load(flattened.bytes)).getForm().getFields().length, 0);
step("flatten: the form's 4 fields drawn into the page and removed");

// ---------------------------------------------------------------- Themes and mobile
const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const p2 = await dark.newPage();
await p2.goto(base + "/tools/remove-blank/", { waitUntil: "networkidle" });
await p2.locator('input[type="file"]').first().setInputFiles(["m12/report.pdf"]);
await p2.getByText(/Found 1 blank page/).waitFor();
await p2.screenshot({ path: "m12-03-blank-dark.png" });

const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p3 = await mob.newPage();
const overflow = {};
for (const [tool, file, ready] of [["fill-pdf", "m12/form.pdf", "Save filled PDF"], ["crop", "m12/report.pdf", "Crop 4 pages"], ["bookmarks", "m12/report.pdf", "Save bookmarks"]]) {
  await p3.goto(`${base}/tools/${tool}/`, { waitUntil: "networkidle" });
  await p3.locator('input[type="file"]').first().setInputFiles([file]);
  await p3.getByRole("button", { name: ready }).waitFor();
  await p3.waitForTimeout(500);
  await p3.screenshot({ path: `m12-04-${tool}-mobile.png`, fullPage: true });
  overflow[tool] = await p3.evaluate(() => document.documentElement.scrollWidth - innerWidth);
}
console.log("   mobile overflow px:", overflow);
assert.ok(Object.values(overflow).every((px) => px <= 0), "no horizontal scroll on mobile");
step("dark theme and 390 px mobile screenshots");

console.log("errors:", errors.length ? errors : "none");
console.log("origins:", [...origins]);
assert.deepEqual(errors, []);
assert.deepEqual([...origins], [new URL(base).origin]);
await browser.close();
