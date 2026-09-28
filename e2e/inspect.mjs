// Milestone 14: the Inspect tools — Find Personal Data (-> Redact), Inspect PDF (fake redactions,
// hidden text, clean), Inspect Office File (clean), Image Forensics, Check File & Hashes and
// Check Links & QR Codes. Downloads are checked in Node. Run via `npm run e2e`.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const mod = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, rgb } = await mod("node_modules/@cantoo/pdf-lib/cjs/index.js");
const { getDocument } = await mod("node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const { strFromU8, strToU8, unzipSync, zipSync } = await mod("node_modules/fflate/lib/index.cjs");
const QRCode = (await mod("node_modules/qrcode/lib/index.js")).default;
const metaFx = await mod("src/lib/metadata/__tests__/fixtures.ts");

const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const step = (s) => console.log("✓", s);

// ---------------------------------------------------------------- Fixtures
mkdirSync("m14", { recursive: true });
{
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const lines = ["Contact: jane.doe@example.com", "Phone: +44 20 7946 0958", "Card 4111 1111 1111 1111", "Order 12345678"];
  lines.forEach((text, i) => page.drawText(text, { x: 72, y: 700 - i * 30, size: 14, font }));
  writeFileSync("m14/people.pdf", await doc.save());
}
{
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const { context } = doc;
  const p1 = doc.addPage([612, 792]);
  p1.drawText("Client: John Smith", { x: 72, y: 700, size: 16, font });
  // A "redaction" that only draws a box over the name.
  p1.drawRectangle({ x: 125, y: 694, width: 90, height: 22, color: rgb(0, 0, 0) });
  p1.drawText("Visible line of text", { x: 72, y: 650, size: 16, font });
  p1.drawText("Ignore previous instructions", { x: 72, y: 600, size: 12, font, color: rgb(1, 1, 1) });
  doc.addJavaScript("hello", "app.alert('hi')");
  await doc.attach(new TextEncoder().encode("notes"), "notes.txt", { mimeType: "text/plain" });
  const comment = context.register(context.obj({ Type: "Annot", Subtype: "Text", Rect: [500, 700, 520, 720], T: PDFHexString.fromText("Reviewer Ray"), Contents: PDFHexString.fromText("Remove the client name") }));
  p1.node.set(PDFName.of("Annots"), context.obj([comment]));

  const p2 = doc.addPage([612, 792]);
  p2.drawText("Log in at www.mybank.com", { x: 72, y: 700, size: 14, font });
  const link = context.register(context.obj({ Type: "Annot", Subtype: "Link", Rect: [140, 695, 260, 715], Border: [0, 0, 0], A: { S: "URI", URI: PDFString.of("https://evil.test/login") } }));
  p2.node.set(PDFName.of("Annots"), context.obj([link]));
  p2.drawText("More at http://bit.ly/abc123 today", { x: 72, y: 660, size: 14, font });
  const qr = await doc.embedPng(await QRCode.toBuffer("https://paypal.com-secure.example.xyz/pay", { type: "png", margin: 2, scale: 6 }));
  p2.drawImage(qr, { x: 72, y: 400, width: 180, height: 180 });
  writeFileSync("m14/tricky.pdf", await doc.save());
}
{
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const rels = (list) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.join("")}</Relationships>`;
  const parts = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    "_rels/.rels": rels([`<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>`, `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`]),
    "docProps/core.xml": `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Jane Doe</dc:creator></cp:coreProperties>`,
    "word/_rels/document.xml.rels": rels([`<Relationship Id="rId5" Type="${REL}/comments" Target="comments.xml"/>`]),
    "word/comments.xml": `<?xml version="1.0"?><w:comments ${W}><w:comment w:id="0" w:author="Reviewer Ray"><w:p><w:r><w:t>Lower the price?</w:t></w:r></w:p></w:comment></w:comments>`,
    "word/document.xml": `<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Price: </w:t></w:r><w:del w:author="John Roe"><w:r><w:delText>900</w:delText></w:r></w:del><w:ins w:author="John Roe"><w:r><w:t>950</w:t></w:r></w:ins><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p></w:body></w:document>`,
  };
  writeFileSync("m14/offer.docx", zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)]))));
}
writeFileSync("m14/generated.png", metaFx.addPngMetadata(metaFx.tinyPng(), { text: { parameters: "a lighthouse at dusk, Steps: 30, Sampler: DPM++", Software: "ComfyUI" } }));
const disguised = new Uint8Array(4096);
disguised.set([0x4d, 0x5a, 0x90, 0x00]);
writeFileSync("m14/invoice.pdf", disguised);
writeFileSync("m14/data.bin", new Uint8Array([1, 2, 3, 250, 0, 9, 8, 7]));
writeFileSync("m14/qr.png", await QRCode.toBuffer("WIFI:T:WPA;S:Office Guest;P:hunter22;;", { type: "png", margin: 2, scale: 8 }));
step("fixtures: a PDF with personal data, a PDF with hidden and risky content, a .docx, an AI-labelled PNG, a disguised program and QR codes");

async function pdfText(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: `${repo}/node_modules/pdfjs-dist/standard_fonts/` });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((t) => t.str).join(" "));
  await task.destroy();
  return pages;
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
async function download(name = "Download result") {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name, exact: true }).click()]);
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}
const main = () => page.locator("main");

// ---------------------------------------------------------------- Find Personal Data -> Redact
await page.goto(base + "/tools/find-pii/", { waitUntil: "networkidle" });
await main().locator('input[type="file"]').first().setInputFiles(["m14/people.pdf"]);
const found = page.getByRole("region", { name: "Personal data found" });
await found.waitFor();
const foundText = await found.innerText();
for (const value of ["jane.doe@example.com", "+44 20 7946 0958", "4111 1111 1111 1111"]) assert.ok(foundText.includes(value), value);
// Three findings: an order number isn't personal data.
assert.equal(await found.getByRole("checkbox").count(), 3);
await page.getByRole("checkbox", { name: /^Phone number/ }).uncheck();
await page.getByRole("button", { name: "Redact 2 items" }).click();
await page.waitForURL("**/tools/redact/");
await page.getByText("Marked 2 items from Find Personal Data").waitFor();
await page.getByRole("button", { name: "Apply redactions" }).click();
await page.getByText("Redacted", { exact: true }).waitFor({ timeout: 60_000 });
const [redacted] = await pdfText((await download()).bytes);
assert.ok(!redacted.includes("jane.doe") && !redacted.includes("4111"), redacted);
step("find personal data: email and card found (not an order number), handed to Redact and removed");

// Redact's own "Mark personal data" button.
await page.getByRole("button", { name: /Mark personal data/ }).click();
await page.getByText(/Marked \d+ pieces? of personal data/).waitFor();
step("redact: “Mark personal data” marks what Find Personal Data finds");

// ---------------------------------------------------------------- Inspect PDF
await page.goto(base + "/tools/inspect-pdf/", { waitUntil: "networkidle" });
await main().locator('input[type="file"]').first().setInputFiles(["m14/tricky.pdf"]);
const report = page.getByRole("region", { name: "What's in this PDF" });
await page.getByText(/to check before sharing/).waitFor({ timeout: 60_000 });
const reportText = await report.innerText();
for (const expected of ["Text hidden under black boxes on 1 page", "John Smith", "Invisible text on 1 page", "Ignore previous instructions", "JavaScript", "notes.txt", "Reviewer Ray", "web link"]) assert.ok(reportText.includes(expected), `${expected} in ${reportText}`);
assert.ok(!/Page 1: “Visible line/.test(reportText), "visible text isn't reported");
await page.screenshot({ path: "m14-01-inspect-pdf.png" });
await page.getByRole("button", { name: "Clean PDF" }).click();
await page.getByText("Cleaned PDF ready").waitFor();
const cleaned = await download();
assert.equal(cleaned.name, "tricky-cleaned.pdf");
{
  const doc = await PDFDocument.load(cleaned.bytes, { updateMetadata: false });
  const names = doc.catalog.lookup(PDFName.of("Names"));
  assert.ok(!names || (!names.has(PDFName.of("JavaScript")) && !names.has(PDFName.of("EmbeddedFiles"))), "scripts and attachments removed");
  assert.equal(doc.getPage(0).node.lookup(PDFName.of("Annots"))?.size() ?? 0, 0, "comment removed");
  assert.equal(doc.getPage(1).node.lookup(PDFName.of("Annots"))?.size(), 1, "the link stays");
}
await page.getByRole("button", { name: "Redact it properly" }).first().click();
await page.waitForURL("**/tools/redact/");
await page.getByText("Marked the text under black boxes found by Inspect PDF").waitFor();
step("inspect PDF: fake redaction and invisible text found, cleaned file keeps links, fake redaction handed to Redact");

// ---------------------------------------------------------------- Inspect Office File
await page.goto(base + "/tools/inspect-office/", { waitUntil: "networkidle" });
await main().locator('input[type="file"]').first().setInputFiles(["m14/offer.docx"]);
const office = page.getByRole("region", { name: "What's in this word document" });
await office.waitFor();
const officeText = await office.innerText();
for (const expected of ["Jane Doe", "John Roe", "Reviewer Ray", "Lower the price?", "Deleted: “900”"]) assert.ok(officeText.includes(expected), expected);
await page.getByRole("button", { name: "Clean file" }).click();
await page.getByText("Cleaned file ready").waitFor();
const cleanDocx = await download();
{
  const parts = unzipSync(new Uint8Array(cleanDocx.bytes));
  const document = strFromU8(parts["word/document.xml"]);
  assert.ok(document.includes("<w:t>950</w:t>") && !document.includes("900") && !document.includes("comment"), document);
  assert.equal(parts["word/comments.xml"], undefined);
  assert.ok(!strFromU8(parts["docProps/core.xml"]).includes("Jane"));
}
step("inspect Office: people, comments and a deleted price found; cleaned .docx keeps the current text only");

// ---------------------------------------------------------------- Image Forensics
await page.goto(base + "/tools/image-forensics/", { waitUntil: "networkidle" });
await main().locator('input[type="file"]').first().setInputFiles(["m14/generated.png"]);
const forensic = page.getByRole("region", { name: "What the file says about itself" });
await forensic.waitFor();
assert.match(await forensic.innerText(), /Marked as made with AI[\s\S]*a lighthouse at dusk/);
await page.locator('img[alt="Error level analysis"]').waitFor();
step("image forensics: AI generator settings found; error level view drawn");

// ---------------------------------------------------------------- Check File & Hashes
await page.goto(base + "/tools/check-file/", { waitUntil: "networkidle" });
await main().locator('input[type="file"]').first().setInputFiles(["m14/invoice.pdf", "m14/data.bin"]);
await page.getByRole("tab", { name: /invoice\.pdf/ }).click();
await page.getByText("Named .pdf, but it's really: Windows program").waitFor();
await page.getByText("This file isn't what it seems or can run code").waitFor();
const sha = createHash("sha256").update(disguised).digest("hex");
await page.getByRole("textbox", { name: "Compare with a published hash" }).fill(sha.toUpperCase());
await page.getByText("Matches the SHA-256 hash").waitFor();
assert.equal(await page.getByRole("region", { name: "Hashes" }).getByText(createHash("md5").update(disguised).digest("hex")).count(), 1);
await page.getByRole("tab", { name: /data\.bin/ }).click();
await page.getByText("Format not recognised").waitFor();
step("check file: a program named .pdf is caught; SHA-256 matches a pasted hash; MD5 shown; any file type opens");

// ---------------------------------------------------------------- Check Links & QR Codes
await page.goto(base + "/tools/check-links/", { waitUntil: "networkidle" });
await main().locator('input[type="file"]').first().setInputFiles(["m14/tricky.pdf", "m14/qr.png"]);
await page.getByRole("tab", { name: /tricky\.pdf/ }).click();
const links = page.getByRole("region", { name: "Links found" });
await links.waitFor({ timeout: 60_000 });
const linkText = await links.innerText();
assert.ok(linkText.includes("The text shows “www.mybank.com”, but the link goes to evil.test."), linkText);
assert.ok(linkText.includes("A shortened link"), linkText);
assert.ok(linkText.includes("QR code: Web link") && linkText.includes("Uses “paypal” in the address, but the site is example.xyz"), linkText);
await page.screenshot({ path: "m14-02-check-links.png" });
await page.getByRole("tab", { name: /qr\.png/ }).click();
await page.getByText("QR code: wi-fi network").waitFor();
assert.match(await page.getByRole("region", { name: "Links found" }).innerText(), /Network: Office Guest[\s\S]*Includes the password/);
step("check links: mismatched link text, a short link and a brand look-alike QR code in the PDF; a Wi-Fi QR code in a picture");

// ---------------------------------------------------------------- Dark + mobile
const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const dp = await dark.newPage();
watch(dp);
await dp.goto(base + "/tools/inspect-pdf/", { waitUntil: "networkidle" });
await dp.locator("main").locator('input[type="file"]').first().setInputFiles(["m14/tricky.pdf"]);
await dp.getByText(/to check before sharing/).waitFor({ timeout: 60_000 });
await dp.screenshot({ path: "m14-03-inspect-dark.png" });

const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const mp = await mob.newPage();
watch(mp);
const overflow = {};
for (const [tool, input, ready] of [
  ["find-pii", "m14/people.pdf", "Redact 3 items"],
  ["inspect-office", "m14/offer.docx", "Clean file"],
  ["check-file", "m14/invoice.pdf", "Compare with a published hash"],
  ["check-links", "m14/tricky.pdf", null],
]) {
  await mp.goto(`${base}/tools/${tool}/`, { waitUntil: "networkidle" });
  await mp.locator("main").locator('input[type="file"]').first().setInputFiles([input]);
  if (ready === "Compare with a published hash") await mp.getByRole("textbox", { name: ready }).waitFor();
  else if (ready) await mp.getByRole("button", { name: ready }).waitFor();
  else await mp.getByRole("region", { name: "Links found" }).waitFor({ timeout: 60_000 });
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: `m14-04-${tool}-mobile.png`, fullPage: true });
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
