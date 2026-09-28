// Milestone 15: Markdown/HTML/Text to PDF, PDF to Text & Markdown, PDF to PowerPoint, PowerPoint
// to PDF, Convert & Resize Images and Compare PDFs. Downloads are checked in Node. Run via `npm run e2e`.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const mod = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { PDFDocument, PDFName, StandardFonts, rgb } = await mod("node_modules/@cantoo/pdf-lib/cjs/index.js");
const { getDocument } = await mod("node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const { strFromU8, unzipSync } = await mod("node_modules/fflate/lib/index.cjs");
const QRCode = (await mod("node_modules/qrcode/lib/index.js")).default;

const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const step = (s) => console.log("✓", s);

// ---------------------------------------------------------------- Fixtures
mkdirSync("m15", { recursive: true });
const PNG_DATA = (await QRCode.toBuffer("inline", { type: "png", margin: 1, scale: 3 })).toString("base64");
writeFileSync(
  "m15/notes.md",
  [
    "# Release notes",
    "",
    "Some **bold** text and a [link](https://example.com/docs).",
    "",
    "- First point",
    "- Second point",
    "",
    "| Name | Size |",
    "| --- | --- |",
    "| a.txt | 12 |",
    "",
    "```",
    "const answer = 42;",
    "```",
    "",
    "![Remote cat](https://example.com/cat.png)",
    "",
    `![Inline](data:image/png;base64,${PNG_DATA})`,
    "",
  ].join("\n"),
);
writeFileSync(
  "m15/page.html",
  `<!doctype html><html><head><title>T</title><script>fetch("https://example.com/track")</script><link rel="stylesheet" href="https://example.com/s.css"></head>
  <body><h2>Invoice summary</h2><p style="color:#c00">Overdue since March</p><img src="https://example.com/logo.png" alt="Company logo"><ul><li>Item one</li></ul></body></html>`,
);
writeFileSync("m15/log.txt", "col1\tcol2\nalpha\tbeta\n");
{
  const doc = await PDFDocument.create({ updateMetadata: false });
  const [regular, bold] = [await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold)];
  const page = doc.addPage([612, 792]);
  page.drawText("Annual Report", { x: 72, y: 700, size: 26, font: bold });
  page.drawText("Sales rose by a third this year, which is good news for everyone.", { x: 72, y: 650, size: 11, font: regular });
  page.drawText("The team credits the new catalogue and faster delivery.", { x: 72, y: 636, size: 11, font: regular });
  page.drawText("• Faster delivery", { x: 72, y: 600, size: 11, font: regular });
  page.drawText("• Lower prices", { x: 72, y: 586, size: 11, font: regular });
  writeFileSync("m15/report.pdf", await doc.save());
}
{
  const doc = await PDFDocument.create({ updateMetadata: false });
  const [regular, bold] = [await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold)];
  const page = doc.addPage([792, 612]);
  page.drawRectangle({ x: 0, y: 520, width: 792, height: 92, color: rgb(0.15, 0.23, 0.5) });
  page.drawText("Quarterly results", { x: 60, y: 550, size: 32, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Revenue grew in every region", { x: 60, y: 440, size: 20, font: regular, color: rgb(0.1, 0.3, 0.85) });
  page.drawCircle({ x: 600, y: 300, size: 80, color: rgb(0.9, 0.5, 0.1) });
  writeFileSync("m15/slides.pdf", await doc.save());
}
async function contract(lines) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  lines.forEach((line, i) => page.drawText(line, { x: 72, y: 700 - i * 20, size: 12, font }));
  return doc.save();
}
writeFileSync("m15/contract-v1.pdf", await contract(["The buyer pays 500 dollars within 30 days of delivery.", "Late fees apply after that.", "This clause is removed later."]));
writeFileSync("m15/contract-v2.pdf", await contract(["The buyer pays 750 dollars within 30 days of delivery.", "Late fees apply after that.", "Signed by both parties today."]));
writeFileSync("m15/qr.png", await QRCode.toBuffer("https://example.com/convert-me", { type: "png", margin: 2, scale: 10 }));
step("fixtures: Markdown, HTML and text files, PDFs for text, slides and comparison, a PNG");

async function pdfText(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: `${repo}/node_modules/pdfjs-dist/standard_fonts/` });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((t) => t.str).join(" ").replace(/\s+/g, " "));
  await task.destroy();
  return pages;
}
async function noMetadata(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(doc.getProducer(), undefined);
  assert.equal(doc.getCreator(), undefined);
  assert.equal(doc.getCreationDate(), undefined);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await ctx.newPage();
const errors = [];
const origins = new Set();
const watch = (p) => {
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => origins.add(new URL(r.url()).origin));
  p.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
};
watch(page);
async function download(name = "Download result", p = page) {
  const [d] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name, exact: true }).click()]);
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}
const main = (p = page) => p.locator("main");
const open = async (tool, files, p = page) => {
  await p.goto(`${base}/tools/${tool}/`, { waitUntil: "networkidle" });
  await main(p).locator('input[type="file"]').first().setInputFiles(files);
};

// ---------------------------------------------------------------- Markdown, HTML and text to PDF
await open("text-to-pdf", ["m15/notes.md"]);
await page.getByRole("heading", { name: "Markdown to PDF" }).waitFor();
await page.getByRole("button", { name: "Convert to PDF" }).click();
await page.getByText("PDF ready").waitFor({ timeout: 60_000 });
await page.getByText(/1 picture on the web or in other files was left out/).waitFor();
const md = await download();
assert.equal(md.name, "notes.pdf");
const [mdText] = await pdfText(md.bytes);
for (const words of ["Release notes", "bold", "First point", "a.txt", "const answer = 42;"]) assert.ok(mdText.includes(words), `${words} in ${mdText}`);
await noMetadata(md.bytes);
assert.ok(md.bytes.toString("latin1").includes("/Subtype /Image"), "the embedded picture is in the PDF");

await open("text-to-pdf", ["m15/page.html"]);
await page.getByRole("button", { name: "Convert to PDF" }).click();
await page.getByText("PDF ready").waitFor({ timeout: 60_000 });
const [htmlText] = await pdfText((await download()).bytes);
for (const words of ["Invoice summary", "Overdue since March", "[Company logo]", "Item one"]) assert.ok(htmlText.includes(words), words);
assert.ok(!htmlText.includes("fetch"), "scripts aren't printed");

await open("text-to-pdf", ["m15/log.txt"]);
await page.getByRole("checkbox", { name: /Fixed-width font/ }).check();
await page.getByRole("button", { name: "Convert to PDF" }).click();
await page.getByText("PDF ready").waitFor({ timeout: 60_000 });
const [logText] = await pdfText((await download()).bytes);
assert.match(logText, /col1\s+col2/);
step("Markdown (table, code, embedded picture; web picture left out), HTML (script and web resources never fetched) and text to PDF");

// ---------------------------------------------------------------- PDF to Text & Markdown
await open("pdf-to-text", ["m15/report.pdf"]);
await page.getByRole("button", { name: "Extract as .md" }).click();
const extracted = page.getByRole("region", { name: "Extracted text" });
await extracted.waitFor({ timeout: 60_000 });
assert.match(await extracted.innerText(), /# Annual Report/);
const mdFile = await download();
assert.equal(mdFile.name, "report.md");
const markdown = mdFile.bytes.toString("utf8");
assert.match(markdown, /^# Annual Report\n\nSales rose by a third this year, which is good news for everyone\. The team credits/);
assert.match(markdown, /- Faster delivery\n- Lower prices/);
await page.getByRole("radio", { name: "Plain text" }).click();
await page.getByRole("button", { name: "Extract as .txt" }).click();
await extracted.waitFor();
const txt = await download();
assert.equal(txt.name, "report.txt");
assert.match(txt.bytes.toString("utf8"), /^Annual Report\n\n/);
step("PDF to Markdown and plain text: heading, rejoined paragraph and list");

// ---------------------------------------------------------------- PDF to PowerPoint
await open("pdf-to-pptx", ["m15/slides.pdf"]);
await page.getByRole("button", { name: "Convert to .pptx" }).click();
await page.getByText("Presentation ready").waitFor({ timeout: 90_000 });
const pptx = await download();
assert.equal(pptx.name, "slides.pptx");
const parts = unzipSync(new Uint8Array(pptx.bytes));
assert.ok(!Object.keys(parts).some((p) => p.startsWith("docProps")), "no document properties");
assert.ok(parts["ppt/media/page1.jpeg"], "a picture of the page");
const slideXml = strFromU8(parts["ppt/slides/slide1.xml"]);
assert.match(slideXml, /<a:t>Quarterly results<\/a:t>/);
assert.match(slideXml, /<a:t>Revenue grew in every region<\/a:t>/);
assert.match(strFromU8(parts["ppt/presentation.xml"]), new RegExp(`cx="${792 * 12700}" cy="${612 * 12700}"`));
// The white title and blue text keep their colours.
const colorOf = (text) => new RegExp(`srgbClr val="([0-9A-F]{6})"/></a:solidFill><a:latin[^>]*/><a:cs[^>]*/></a:rPr><a:t>${text}`).exec(slideXml)?.[1];
const [white, blue] = [colorOf("Quarterly results"), colorOf("Revenue grew in every region")];
assert.ok(parseInt(white.slice(0, 2), 16) > 200, `title colour ${white}`);
assert.ok(parseInt(blue.slice(4, 6), 16) > parseInt(blue.slice(0, 2), 16) + 60, `body colour ${blue}`);
writeFileSync("m15/slides.pptx", pptx.bytes);
await page.getByRole("radio", { name: "Pictures of pages" }).click();
await page.getByRole("button", { name: "Convert to .pptx" }).click();
await page.getByText("Presentation ready").waitFor({ timeout: 90_000 });
const pictures = unzipSync(new Uint8Array((await download()).bytes));
assert.ok(!strFromU8(pictures["ppt/slides/slide1.xml"]).includes("<a:t>"), "picture slides have no text boxes");
step("PDF to PowerPoint: editable text boxes in their colours over the page picture; picture-only slides");

// ---------------------------------------------------------------- PowerPoint to PDF
await open("pptx-to-pdf", ["m15/slides.pptx"]);
await page.getByRole("button", { name: "Convert to PDF" }).click();
await page.getByText("PDF ready").waitFor({ timeout: 60_000 });
const fromPptx = await download();
assert.equal(fromPptx.name, "slides.pdf");
const [pptText] = await pdfText(fromPptx.bytes);
assert.ok(pptText.includes("Quarterly results") && pptText.includes("Revenue grew in every region"), pptText);
const roundTrip = await PDFDocument.load(fromPptx.bytes, { updateMetadata: false });
assert.deepEqual(Object.values(roundTrip.getPage(0).getSize()).map(Math.round), [792, 612]);
await noMetadata(fromPptx.bytes);
step("PowerPoint to PDF: the converted deck comes back at slide size with its text");

// ---------------------------------------------------------------- Convert & Resize Images
const qrSize = readFileSync("m15/qr.png").readUInt32BE(16);
await open("convert-image", ["m15/qr.png"]);
await main().getByRole("combobox", { name: "Format" }).selectOption("bmp");
await page.getByRole("button", { name: "Convert to BMP" }).click();
await page.getByText("1 image converted to BMP").waitFor({ timeout: 30_000 });
const bmp = await download();
assert.equal(bmp.name, "qr.bmp");
assert.equal(bmp.bytes.subarray(0, 2).toString("latin1"), "BM");
assert.equal(bmp.bytes.readInt32LE(18), qrSize);

await main().getByRole("combobox", { name: "Format" }).selectOption("webp");
await page.getByRole("radio", { name: "Scale" }).click();
await page.getByRole("button", { name: "Convert to WebP" }).click();
await page.getByText("1 image converted to WebP").waitFor({ timeout: 30_000 });
const webp = await download();
assert.equal(webp.bytes.subarray(8, 12).toString("latin1"), "WEBP");
await page.getByText(`${Math.round(qrSize / 2)} × ${Math.round(qrSize / 2)}`).waitFor();

await main().getByRole("combobox", { name: "Format" }).selectOption("ico");
await page.getByRole("button", { name: "Convert to ICO" }).click();
await page.getByText("1 image converted to ICO").waitFor({ timeout: 30_000 });
const ico = await download();
assert.deepEqual([ico.bytes.readUInt16LE(2), ico.bytes.readUInt16LE(4)], [1, 4]);
assert.deepEqual([ico.bytes[6], ico.bytes[6 + 3 * 16]], [16, 0]);
step("convert & resize: BMP at full size, WebP at 50%, a 4-size ICO");

// ---------------------------------------------------------------- Compare PDFs
await open("compare-pdf", ["m15/contract-v1.pdf", "m15/contract-v2.pdf"]);
await page.getByRole("button", { name: "Compare text" }).click();
const status = page.getByText(/^\d+ changes?: /);
await status.waitFor({ timeout: 60_000 });
assert.equal(await status.innerText(), "2 changes: 0 added, 0 removed, 2 changed.");
const list = page.getByRole("region", { name: "Changes" });
assert.match(await list.innerText(), /500\s*→\s*750/);
assert.match(await list.innerText(), /This clause is removed later\.\s*→\s*Signed by both parties today\./);
await page.getByRole("region", { name: "Pages with the change" }).waitFor();
await page.getByRole("button", { name: "Mark changes" }).click();
await page.getByText("Marked copies ready").waitFor({ timeout: 60_000 });
const [zipDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download all as ZIP" }).click()]);
const zipped = unzipSync(new Uint8Array(readFileSync(await zipDownload.path())));
assert.deepEqual(Object.keys(zipped).sort(), ["contract-v1-removed-marked.pdf", "contract-v2-changes-marked.pdf", "contract-v2-changes.txt"]);
const marked = await PDFDocument.load(zipped["contract-v2-changes-marked.pdf"], { updateMetadata: false });
const subtypes = marked.getPage(0).node.Annots().asArray().map((ref) => marked.context.lookup(ref).get(PDFName.of("Subtype"))?.toString());
assert.ok(subtypes.includes("/Highlight") && subtypes.includes("/Text"), subtypes.join());
assert.match(strFromU8(zipped["contract-v2-changes.txt"]), /Changed \(page 1 → 1\): 500 → 750/);

await page.getByRole("radio", { name: "Pictures" }).click();
await page.getByText(/% of the page differs/).waitFor({ timeout: 60_000 });
step("compare PDFs: two changes listed and highlighted, marked copies with highlights and notes, picture comparison");

// ---------------------------------------------------------------- Dark + mobile
const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const dp = await dark.newPage();
watch(dp);
await open("compare-pdf", ["m15/contract-v1.pdf", "m15/contract-v2.pdf"], dp);
await dp.getByRole("button", { name: "Compare text" }).click();
await dp.getByRole("region", { name: "Pages with the change" }).waitFor({ timeout: 60_000 });
await dp.waitForTimeout(800);
await dp.screenshot({ path: "m15-01-compare-dark.png" });

const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const mp = await mob.newPage();
watch(mp);
const overflow = {};
for (const [tool, input, ready] of [
  ["text-to-pdf", ["m15/notes.md"], "Convert to PDF"],
  ["pdf-to-text", ["m15/report.pdf"], "Extract as .md"],
  ["pdf-to-pptx", ["m15/slides.pdf"], "Convert to .pptx"],
  ["convert-image", ["m15/qr.png"], "Convert to WebP"],
  ["compare-pdf", ["m15/contract-v1.pdf", "m15/contract-v2.pdf"], "Compare text"],
]) {
  await open(tool, input, mp);
  await mp.getByRole("button", { name: ready }).waitFor();
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: `m15-02-${tool}-mobile.png`, fullPage: true });
  overflow[tool] = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
}
console.log("   mobile overflow px:", overflow);
assert.ok(Object.values(overflow).every((px) => px <= 0), "no horizontal scroll on mobile");
step("dark theme and 390 px mobile screenshots");

console.log("errors:", errors.length ? errors : "none");
console.log("origins:", [...origins]);
assert.deepEqual(errors, []);
assert.deepEqual([...origins], [new URL(base).origin]);
await browser.close();
