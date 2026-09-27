// Milestone 6: PDF -> Word/Excel and Word/Excel -> PDF (checks downloaded files with independent readers).
// Run via `npm run e2e` (serves ./out); outputs land in e2e/.output/.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const mod = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { PDFDocument, StandardFonts, rgb } = await mod("node_modules/@cantoo/pdf-lib/cjs/index.js");
const { unzipSync } = await mod("node_modules/fflate/lib/index.cjs");
const mammoth = (await mod("node_modules/mammoth/lib/index.js")).default;
const XLSX = await mod("node_modules/xlsx/xlsx.mjs");
const { getDocument } = await mod("node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const metaFx = await mod("src/lib/metadata/__tests__/fixtures.ts");
const officeFx = await mod("src/lib/office/__tests__/fixtures.ts");

const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const step = (s) => console.log("✓", s);

async function pdfTexts(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const doc = await task.promise;
  const texts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const { items } = await (await doc.getPage(i)).getTextContent();
    texts.push(items.map((it) => it.str + (it.hasEOL ? " " : "")).join("").replace(/\s+/g, " "));
  }
  await task.destroy();
  return texts;
}

// ---------------------------------------------------------------- Fixtures
mkdirSync("m6", { recursive: true });
{
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = (page, s, x, y, size = 11, font = regular) => page.drawText(s, { x, y, size, font, color: rgb(0, 0, 0) });
  const p1 = doc.addPage([612, 792]);
  text(p1, "Annual Report", 72, 700, 24, bold);
  text(p1, "Overview", 72, 650, 15, bold);
  ["This year the team shipped three privacy tools that run entirely in the", "browser, so documents never leave the device of the person using them.", "Adoption grew steadily across every region we track."].forEach((l, i) => text(p1, l, 72, 625 - i * 14, 11));
  text(p1, "• Faster conversions", 72, 570);
  text(p1, "• No uploads, ever", 72, 556);
  text(p1, "Page 1", 290, 40, 9);
  const p2 = doc.addPage([612, 792]);
  text(p2, "Regional revenue", 72, 700, 15, bold);
  const rows = [["Region", "Units", "Revenue"], ["North", "1,200", "14,400.00"], ["South", "800", "9,600.50"], ["West", "35", "(420.00)"]];
  rows.forEach((row, r) => row.forEach((cell, c) => text(p2, cell, [72, 260, 400][c], 660 - r * 16, 11, r === 0 ? bold : regular)));
  text(p2, "Page 2", 290, 40, 9);
  writeFileSync("m6/report.pdf", await doc.save());
}
const photo = metaFx.addJpegMetadata(metaFx.TINY_JPEG, { exif: { artist: "Jane Doe", gps: { lat: 25.2, lon: 55.27 } } });
writeFileSync("m6/plan.docx", officeFx.sampleDocx(photo));
{
  const book = XLSX.utils.book_new();
  const sales = XLSX.utils.aoa_to_sheet([["Region", "Units", "Revenue"], ...Array.from({ length: 90 }, (_, i) => [`Region ${i + 1}`, i * 10, i * 123.45])]);
  for (let r = 2; r <= 91; r++) sales[`C${r}`].z = '"$"#,##0.00';
  XLSX.utils.book_append_sheet(book, sales, "Sales");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["internal"]]), "Scratch");
  book.Workbook = { Sheets: [{ name: "Sales", Hidden: 0 }, { name: "Scratch", Hidden: 1 }] };
  writeFileSync("m6/sales.xlsx", XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}
writeFileSync("m6/broken.docx", "PK\x03\x04 not really a zip");
step("fixtures written");

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
const go = async (tool) => {
  await page.locator(`aside a[href="/tools/${tool}/"]`).click();
  await page.waitForURL(`**/tools/${tool}/`);
};

// ---------------------------------------------------------------- PDF to Word
await page.goto(base + "/tools/pdf-to-word/", { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(["m6/report.pdf"]);
await page.locator("canvas:not(.invisible)").first().waitFor();
await page.getByRole("button", { name: "Convert to .docx" }).click();
await page.getByText("Word document ready").waitFor();
await page.getByRole("heading", { name: "Annual Report" }).waitFor(); // in-app preview
await page.screenshot({ path: "m6-01-pdf-to-word.png" });
const docx = await download(() => page.getByRole("button", { name: "Download result" }).click());
assert.equal(docx.name, "report.docx");
const html = (await mammoth.convertToHtml({ buffer: docx.bytes })).value;
console.log("   docx html:", html.slice(0, 260), "…");
assert.match(html, /<h1><strong>Annual Report<\/strong><\/h1>/);
assert.match(html, /<h2><strong>Overview<\/strong><\/h2>/);
assert.ok(html.includes("<p>This year the team shipped three privacy tools that run entirely in the browser, so documents never leave the device of the person using them."));
assert.ok(html.includes("No uploads, ever"));
assert.ok(!html.includes("Page 1"), "page-number footer removed");
assert.ok(!Object.keys(unzipSync(new Uint8Array(docx.bytes))).some((f) => f.startsWith("docProps")), "no document properties");
step("PDF to Word: headings, joined paragraph lines, bullets; footer page numbers dropped; no docProps");

await page.getByRole("button", { name: "Open in a new tab" }).click();
await page.getByRole("tab", { name: /report\.docx/ }).waitFor();
await go("word-to-pdf");
await page.getByRole("button", { name: "Convert to PDF" }).click();
await page.getByText("PDF ready").waitFor();
const roundTrip = await download(() => page.getByRole("button", { name: "Download result" }).click());
assert.equal(roundTrip.name, "report.pdf");
assert.match((await pdfTexts(roundTrip.bytes))[0], /Annual Report Overview This year the team/);
step("chained: the .docx opens in a tab and converts back to PDF");

// ---------------------------------------------------------------- PDF to Excel
await page.getByRole("tab", { name: /^report\.pdf/ }).click();
await go("pdf-to-excel");
await page.getByPlaceholder("All pages").fill("2");
await page.getByRole("button", { name: "Convert to .xlsx" }).click();
await page.getByText("Spreadsheet ready").waitFor();
await page.getByRole("cell", { name: "9600.5" }).waitFor();
await page.screenshot({ path: "m6-02-pdf-to-excel.png" });
const xlsx = await download(() => page.getByRole("button", { name: "Download result" }).click());
assert.equal(xlsx.name, "report.xlsx");
const book = XLSX.read(xlsx.bytes, { type: "buffer" });
assert.deepEqual(book.SheetNames, ["Page 2"]);
const rows = XLSX.utils.sheet_to_json(book.Sheets["Page 2"], { header: 1 });
console.log("   rows:", JSON.stringify(rows));
assert.equal(rows.length, 5, "footer page number dropped");
assert.deepEqual(rows.slice(1), [
  ["Region", "Units", "Revenue"],
  ["North", 1200, 14400],
  ["South", 800, 9600.5],
  ["West", 35, -420],
]);
step("PDF to Excel: page 2's table becomes rows and columns with real numbers");

// ---------------------------------------------------------------- Word to PDF
await go("word-to-pdf");
await page.locator('input[type="file"]').setInputFiles(["m6/plan.docx", "m6/broken.docx"]);
await page.getByRole("tab", { name: /plan\.docx/ }).click();
await page.getByRole("radio", { name: "Letter" }).click();
await page.getByRole("button", { name: "Convert to PDF" }).click();
await page.getByText("PDF ready").waitFor();
await page.getByText(/aren't covered by the built-in font/).waitFor();
await page.locator("section[aria-label='Result preview'] canvas:not(.invisible)").nth(1).waitFor();
await page.screenshot({ path: "m6-03-word-to-pdf.png" });
const planPdf = await download(() => page.getByRole("button", { name: "Download result" }).click());
const planTexts = await pdfTexts(planPdf.bytes);
assert.equal(planTexts.length, 2);
assert.match(planTexts[0], /Quarterly Plan Goals Plain, bold, italic and underlined text\./);
assert.match(planTexts[0], /1\. Step one 2\. Step two/);
assert.ok(!latin(planPdf.bytes).includes("Jane Doe"), "photo EXIF stripped");
assert.equal((await PDFDocument.load(planPdf.bytes)).getPage(0).getWidth(), 612);
step("Word to PDF: 2 Letter pages, lists numbered, missing-glyph warning shown, photo EXIF stripped");

await page.getByRole("tab", { name: /broken\.docx/ }).click();
await page.getByRole("button", { name: "Convert to PDF" }).click();
await page.getByText("couldn't be read as a Word document").waitFor();
step("a damaged .docx gets a clear error");

// ---------------------------------------------------------------- Excel to PDF
await go("excel-to-pdf");
await page.locator('input[type="file"]').setInputFiles(["m6/sales.xlsx"]);
await page.getByRole("checkbox", { name: "Sales" }).waitFor();
assert.equal(await page.getByRole("checkbox", { name: "Scratch" }).isChecked(), false);
await page.getByRole("button", { name: "Convert to PDF" }).click();
await page.getByText("PDF ready").waitFor();
await page.locator("section[aria-label='Result preview'] canvas:not(.invisible)").first().waitFor();
await page.screenshot({ path: "m6-04-excel-to-pdf.png" });
const salesPdf = await download(() => page.getByRole("button", { name: "Download result" }).click());
assert.equal(salesPdf.name, "sales.pdf");
const salesTexts = await pdfTexts(salesPdf.bytes);
assert.ok(salesTexts.length >= 2);
for (const text of salesTexts) assert.match(text, /Region Units Revenue/);
assert.match(salesTexts.join(" "), /Region 90 890 \$10,987\.05/);
assert.ok(!salesTexts.join(" ").includes("internal"), "hidden sheet left out");
step(`Excel to PDF: ${salesTexts.length} pages, header repeated, currency formatted, hidden sheet skipped`);

// ---------------------------------------------------------------- Themes and mobile
const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const p2 = await dark.newPage();
await p2.goto(base + "/tools/excel-to-pdf/", { waitUntil: "networkidle" });
await p2.locator('input[type="file"]').setInputFiles(["m6/sales.xlsx"]);
await p2.getByRole("button", { name: "Convert to PDF" }).click();
await p2.locator("section[aria-label='Result preview'] canvas:not(.invisible)").first().waitFor();
await p2.screenshot({ path: "m6-05-excel-dark.png" });
await p2.goto(base + "/tools/pdf-to-word/", { waitUntil: "networkidle" });
await p2.locator('input[type="file"]').setInputFiles(["m6/report.pdf"]);
await p2.getByRole("button", { name: "Convert to .docx" }).click();
await p2.getByText("Word document ready").waitFor();
await p2.screenshot({ path: "m6-06-word-dark.png" });

const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p3 = await mob.newPage();
const overflow = {};
for (const [tool, file] of [["pdf-to-word", "m6/report.pdf"], ["pdf-to-excel", "m6/report.pdf"], ["word-to-pdf", "m6/plan.docx"], ["excel-to-pdf", "m6/sales.xlsx"]]) {
  await p3.goto(`${base}/tools/${tool}/`, { waitUntil: "networkidle" });
  await p3.locator('input[type="file"]').setInputFiles([file]);
  await p3.getByRole("button", { name: /Convert/ }).first().waitFor();
  await p3.waitForTimeout(300);
  await p3.screenshot({ path: `m6-07-${tool}-mobile.png`, fullPage: true });
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

function latin(bytes) {
  return Buffer.from(bytes).toString("latin1");
}
