// Milestone 3: metadata audit/strip/verify for PDF, JPEG, PNG, WebP (checks downloaded bytes).
// Run via `npm run e2e` (serves ./out); outputs land in e2e/.output/.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const fx = await import(pathToFileURL(`${repo}/src/lib/metadata/__tests__/fixtures.ts`).href);
const { PDFDocument } = await import(pathToFileURL(`${repo}/node_modules/@cantoo/pdf-lib/cjs/index.js`).href);

const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const step = (s) => console.log("✓", s);
const browser = await chromium.launch();

// ---- Fixtures: real images rendered by the browser, metadata added by the test builders.
const gen = await browser.newPage();
const render = (type) =>
  gen.evaluate(async (type) => {
    const c = new OffscreenCanvas(800, 600);
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 800, 600);
    grad.addColorStop(0, "#263a81"); grad.addColorStop(1, "#10b981");
    g.fillStyle = grad; g.fillRect(0, 0, 800, 600);
    g.fillStyle = "#fff"; g.font = "bold 56px sans-serif"; g.fillText(type.split("/")[1].toUpperCase() + " photo", 200, 320);
    const blob = await c.convertToBlob({ type, quality: 0.9 });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, type).then((a) => new Uint8Array(a));
const [jpg, png, webp] = [await render("image/jpeg"), await render("image/png"), await render("image/webp")];
await gen.close();

mkdirSync("m3", { recursive: true });
const exif = { artist: "Jane Doe", make: "Apple", model: "iPhone 17 Pro", serial: "F2LXK9", gps: { lat: 25.197197, lon: 55.274376 } };
const files = {
  "memo.pdf": await fx.leakyPdf(fx.addJpegMetadata(jpg, { exif })),
  "IMG_2041.jpg": fx.addJpegMetadata(jpg, { exif, xmp: fx.SAMPLE_XMP, comment: "Edited on Jane's MacBook", trailer: new Uint8Array(20000).fill(3) }),
  "Screenshot.png": fx.addPngMetadata(png, { text: { Author: "Jane Doe", Software: "macOS 16" }, xmp: fx.SAMPLE_XMP, privateChunk: true }),
  "holiday.webp": fx.addWebpMetadata(webp, { exif, xmp: fx.SAMPLE_XMP, width: 800, height: 600 }),
};
const locked = await PDFDocument.create();
locked.addPage();
locked.encrypt({ userPassword: "secret", ownerPassword: "owner" });
files["locked.pdf"] = await locked.save();
for (const [name, bytes] of Object.entries(files)) writeFileSync(`m3/${name}`, bytes);
const paths = Object.keys(files).map((n) => `m3/${n}`);
step("fixtures written");

// ---- App
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
const origins = new Set();
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => origins.add(new URL(r.url()).origin));
page.on("worker", (w) => console.log("   worker started:", new URL(w.url()).pathname));

await page.goto(base + "/tools/sanitize/", { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(paths);
await page.getByRole("tab", { name: /memo\.pdf/ }).waitFor();

// 1. PDF audit
const table = page.locator("table");
await table.getByText("Bob Reviewer").waitFor();
for (const text of ["Jane Doe", "salaries.csv", "Microsoft Word for Microsoft 365", "Previous revisions", "Embedded photo 1"]) {
  assert.ok(await page.getByText(text, { exact: false }).first().isVisible(), `PDF audit missing ${text}`);
}
await page.getByText("This file reveals a location:").waitFor();
const sensitiveBadge = await page.getByRole("button", { name: /^Sensitive \d+/ }).innerText();
console.log("   pdf:", await page.getByRole("button", { name: /^All \d+/ }).innerText(), "/", sensitiveBadge);
await page.screenshot({ path: "m3-01-pdf-audit.png", fullPage: true });
step("PDF audit lists info, XMP, comment author, attachment, revisions, embedded photo GPS");

// 2. Strip PDF + verify + download
await page.getByRole("button", { name: "Strip all metadata" }).click();
await page.getByText("Verified by re-reading the cleaned file from scratch.").waitFor();
assert.ok(await page.getByRole("tab", { name: /memo\.pdf/ }).locator('[aria-label="Done"]').isVisible());
await page.screenshot({ path: "m3-02-pdf-clean.png", fullPage: true });
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download clean file" }).click()]);
assert.equal(dl.suggestedFilename(), "memo-clean.pdf");
const cleanPdf = readFileSync(await dl.path());
const text = cleanPdf.toString("latin1");
for (const secret of ["Jane Doe", "Bob Reviewer", "salaries.csv", "Distiller", "F2LXK9", "iPhone"]) assert.ok(!text.includes(secret), `clean PDF still contains ${secret}`);
assert.equal(text.match(/%%EOF/g).length, 1);
const reloaded = await PDFDocument.load(cleanPdf);
assert.equal(reloaded.getPageCount(), 1);
step(`PDF stripped: verified 0 tags, download clean (${files["memo.pdf"].length} → ${cleanPdf.length} bytes), still opens`);

// 3. Use cleaned version -> audit now reports clean
await page.getByRole("button", { name: "Use cleaned version in workspace" }).click();
await page.locator("section", { hasText: "Metadata audit" }).getByText("0 metadata tags found").waitFor();
step("cleaned version promoted into the tab; re-audit shows 0 tags");

// 4. JPEG audit with sensitive-only filter
await page.getByRole("tab", { name: /IMG_2041/ }).click();
await table.getByText("F2LXK9").waitFor();
assert.ok(await page.getByText("Data after end of image").isVisible());
await page.screenshot({ path: "m3-03-jpeg-audit.png", fullPage: true });
const allRows = await table.locator("tbody tr").count();
await page.getByRole("button", { name: /^Sensitive \d+/ }).click();
const sensitiveRows = await table.locator("tbody tr").count();
assert.ok(sensitiveRows < allRows);
await page.getByRole("button", { name: /^All \d+/ }).click();
step(`JPEG audit: serial, GPS, trailer found; sensitive filter ${allRows} → ${sensitiveRows} rows`);

// 5. Locked PDF
await page.getByRole("tab", { name: /locked\.pdf/ }).click();
await page.getByText("Password-protected PDF").waitFor();
assert.ok(await page.getByRole("link", { name: "Open Unlock PDF" }).isVisible());
step("password-protected PDF shows unlock guidance");

// 6. Batch the rest
await page.getByRole("tab", { name: /IMG_2041/ }).click();
// The promoted PDF was reset to its (already clean) content, so all 5 tabs are pending again.
await page.getByRole("button", { name: /Sanitize all 5 files/ }).click();
await page.getByText(/4 files sanitized/).waitFor();
assert.ok(await page.getByText("1 couldn't be processed").isVisible());
for (const name of ["IMG_2041", "Screenshot", "holiday"]) {
  assert.ok(await page.getByRole("tab", { name: new RegExp(name) }).locator('[aria-label="Done"]').isVisible(), name);
}
assert.ok(await page.getByRole("tab", { name: /locked/ }).locator('[aria-label="Error"]').isVisible());
step("batch sanitized 4 files; locked PDF marked as error");

// 7. Each image verified clean, and downloaded bytes are clean
for (const [name, expected] of [["IMG_2041", "IMG_2041-clean.jpg"], ["Screenshot", "Screenshot-clean.png"], ["holiday", "holiday-clean.webp"]]) {
  await page.getByRole("tab", { name: new RegExp(name) }).click();
  await page.getByText("Verified by re-reading the cleaned file from scratch.").waitFor();
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download clean file" }).click()]);
  assert.equal(d.suggestedFilename(), expected);
  await d.saveAs(`m3-clean/${expected}`);
  const bytes = readFileSync(await d.path()).toString("latin1");
  for (const secret of ["Jane Doe", "F2LXK9", "Apple", "Dubai", "iDOT"]) assert.ok(!bytes.includes(secret), `${expected} contains ${secret}`);
}
await page.screenshot({ path: "m3-04-image-clean.png", fullPage: true });
step("all three images verified clean and downloads contain none of the secrets");

// 8. Cleaned images still decode in the browser
const decodes = await page.evaluate(async () => {
  const out = [];
  for (const img of document.querySelectorAll('img[alt^="Preview"]')) out.push(img.naturalWidth);
  return out;
});
console.log("   preview widths:", decodes);

// 9. Dark mode + mobile
const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const p2 = await dark.newPage();
await p2.goto(base + "/tools/sanitize/", { waitUntil: "networkidle" });
await p2.locator('input[type="file"]').setInputFiles(["m3/IMG_2041.jpg"]);
await p2.locator("table").getByText("F2LXK9").waitFor();
await p2.screenshot({ path: "m3-05-dark.png", fullPage: true });
const mob = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p3 = await mob.newPage();
await p3.goto(base + "/tools/sanitize/", { waitUntil: "networkidle" });
await p3.locator('input[type="file"]').setInputFiles(["m3/memo.pdf"]);
await p3.locator("table").getByText("Bob Reviewer").waitFor();
await p3.screenshot({ path: "m3-06-mobile.png", fullPage: true });
console.log("   mobile overflow px:", await p3.evaluate(() => document.documentElement.scrollWidth - innerWidth));

console.log("errors:", errors.length ? errors : "none");
console.log("origins:", [...origins]);
await browser.close();
