// Milestone 10: HEIC/AVIF support, "keep technical data", audit filters, HEIC to JPG and tool search.
// Run via `npm run e2e` (serves ./out); outputs land in e2e/.output/.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const mod = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { getDocument, OPS } = await mod("node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const { unzipSync } = await mod("node_modules/fflate/lib/index.cjs");
const { default: exifr } = await mod("node_modules/exifr/dist/full.umd.cjs");
const { addJpegMetadata } = await mod("src/lib/metadata/__tests__/fixtures.ts");
const libheif = createRequire(import.meta.url)(`${repo}/node_modules/libheif-js/wasm-bundle.js`);

const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const step = (s) => console.log("✓", s);

// ---------------------------------------------------------------- Fixtures
mkdirSync("m10", { recursive: true });
const heifDir = `${repo}/src/lib/metadata/__tests__/heif`;
copyFileSync(`${heifDir}/photo.heic`, "m10/IMG_0001.heic");
copyFileSync(`${heifDir}/photo.avif`, "m10/sunset.avif");
const heic = readFileSync("m10/IMG_0001.heic");

function decodeHeic(bytes) {
  const [image] = new libheif.HeifDecoder().decode(new Uint8Array(bytes));
  return { width: image.get_width(), height: image.get_height() };
}
/** Width and height from a JPEG's SOF marker, and whether it has an APP1 (EXIF/XMP) segment. */
function jpegInfo(bytes) {
  let app1 = false;
  for (let i = 2; i < bytes.length; ) {
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xe1) app1 = true;
    if (marker >= 0xc0 && marker <= 0xc2) return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], app1 };
    i += 2 + length;
  }
  return { app1 };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();

// A real (decodable) 40×30 JPEG from the browser's encoder, then personal and technical tags added.
const plainJpeg = Buffer.from(
  await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(40, 30);
    const g = canvas.getContext("2d");
    g.fillStyle = "#2a6";
    g.fillRect(0, 0, 40, 30);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
  }),
  "base64",
);
writeFileSync(
  "m10/holiday.jpg",
  addJpegMetadata(new Uint8Array(plainJpeg), {
    exif: { artist: "Jane Doe", make: "Apple", model: "iPhone 17 Pro", serial: "SN-12345", gps: { lat: 25.2048, lon: 55.2708 }, technical: true },
    comment: "Edited by Jane",
  }),
);
step("fixtures: HEIC and AVIF photos with GPS, serial and XMP; a JPEG with camera settings and personal tags");
const errors = [];
const origins = new Set();
const addonRequests = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  origins.add(new URL(r.url()).origin);
  if (r.url().includes("/addons/")) addonRequests.push(new URL(r.url()).pathname);
});
page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
async function download(trigger) {
  const [d] = await Promise.all([page.waitForEvent("download"), trigger()]);
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}
const go = async (tool) => {
  await page.locator(`aside a[href="/tools/${tool}/"]`).click();
  await page.waitForURL(`**/tools/${tool}/`);
};
const auditRows = () => page.locator("table tbody tr td:first-child span.font-medium").allTextContents();

// ---------------------------------------------------------------- Tool search
await page.goto(base + "/", { waitUntil: "networkidle" });
await page.getByRole("searchbox", { name: "Filter tools" }).fill("iphone");
await page.getByText(/2 matching tools/).waitFor();
const cards = await page.locator("main a[href^='/tools/'] h3").allTextContents();
assert.deepEqual([...cards].sort(), ["HEIC to JPG", "Sanitize Metadata"]);
await page.getByRole("searchbox", { name: "Filter tools" }).fill("");
await page.keyboard.press("Control+k");
const dialog = page.getByRole("dialog", { name: "Search tools" });
await dialog.waitFor();
await page.keyboard.type("remove password");
await page.getByRole("option", { name: /Unlock PDF/, selected: true }).waitFor();
await page.screenshot({ path: "m10-01-search.png" });
await page.keyboard.press("Enter");
await page.waitForURL("**/tools/unlock/");
assert.equal(await dialog.isVisible(), false);
await page.getByRole("button", { name: "Search tools" }).click();
await page.keyboard.type("comb");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowUp");
await page.keyboard.press("Enter");
await page.waitForURL("**/tools/merge/");
step("search: home filter (\"iphone\" → HEIC to JPG, Sanitize); Ctrl+K dialog with arrows and Enter navigates");

// ---------------------------------------------------------------- Sanitize a HEIC
await go("sanitize");
assert.deepEqual(addonRequests, [], "the HEIC decoder isn't downloaded until a HEIC is opened");
await page.locator('input[type="file"]').first().setInputFiles(["m10/IMG_0001.heic"]);
await page.getByText("Serial Number").waitFor();
const preview = page.getByRole("img", { name: "Preview of IMG_0001.heic" });
await page.waitForFunction(() => document.querySelector('img[alt="Preview of IMG_0001.heic"]')?.naturalWidth === 64);
assert.ok(await preview.isVisible());
assert.ok(addonRequests.some((p) => p.endsWith("/libheif.wasm")), "decoder add-on fetched on first use");
// Filters: each shows only its kind, with an explanation.
await page.getByRole("button", { name: /^Revealing \d+/ }).click();
let rows = await auditRows();
assert.ok(rows.includes("Model") && rows.includes("Date Time Original") && !rows.includes("Serial Number") && !rows.includes("Exposure Time"), rows.join());
await page.getByText(/Fingerprints the file/).waitFor();
await page.getByRole("button", { name: /^Technical \d+/ }).click();
rows = await auditRows();
assert.ok(rows.includes("Exposure Time") && rows.includes("F Number") && !rows.includes("Model"), rows.join());
await page.getByRole("button", { name: /^Sensitive \d+/ }).click();
rows = await auditRows();
assert.ok(rows.includes("Serial Number") && rows.includes("User Comment") && rows.includes("Thumbnail preview") && rows.includes("Creator"), rows.join());
await page.getByText(/This file reveals a location/).waitFor();
await page.screenshot({ path: "m10-02-sanitize-heic.png" });
await page.getByRole("button", { name: /^All \d+/ }).click();
await page.getByRole("button", { name: "Strip all metadata" }).click();
await page.getByText("0 metadata tags found").waitFor();
const cleanHeic = await download(() => page.getByRole("button", { name: "Download clean file" }).click());
assert.equal(cleanHeic.name, "IMG_0001-clean.heic");
assert.equal(cleanHeic.bytes.length, heic.length, "stripped in place");
for (const secret of ["F17XK2QJ0D8A", "harbour", "Jane Doe", "iPhone"]) assert.ok(!cleanHeic.bytes.includes(Buffer.from(secret)), secret);
assert.deepEqual(decodeHeic(cleanHeic.bytes), { width: 64, height: 48 });
step("sanitize HEIC: audit (serial, comment, GPS, XMP, thumbnail) with Sensitive/Revealing/Technical filters; preview; strip → 0 tags, decodes");

// ---------------------------------------------------------------- Keep technical data (JPEG)
await page.locator('input[type="file"]').first().setInputFiles(["m10/holiday.jpg"]);
await page.getByText("Serial Number").waitFor();
await page.getByRole("radio", { name: "Keep technical" }).click();
await page.getByRole("button", { name: "Strip revealing metadata" }).click();
await page.getByText("No sensitive or revealing metadata").waitFor();
await page.getByText(/technical tags? kept on purpose/).waitFor();
const cleanJpeg = await download(() => page.getByRole("button", { name: "Download clean file" }).click());
const exif = await exifr.parse(new Uint8Array(cleanJpeg.bytes), { tiff: true, exif: true, gps: true, xmp: true, iptc: true, mergeOutput: true });
assert.ok(exif.ExposureTime > 0 && exif.FNumber === 1.8 && exif.ISO === 64, JSON.stringify(exif));
for (const gone of ["Make", "Model", "Artist", "SerialNumber", "BodySerialNumber", "DateTimeOriginal", "latitude"]) assert.equal(exif[gone], undefined, gone);
assert.ok(!cleanJpeg.bytes.includes(Buffer.from("Edited by Jane")));
await page.screenshot({ path: "m10-03-keep-technical.png" });
step("sanitize JPEG, keep technical: exposure, aperture and ISO kept; make, model, artist, serial, date, GPS and comment removed");

// ---------------------------------------------------------------- AVIF strip still decodes in the browser
await page.locator('input[type="file"]').first().setInputFiles(["m10/sunset.avif"]);
await page.getByText("Serial Number").waitFor();
await page.getByRole("radio", { name: "Everything" }).click();
await page.getByRole("button", { name: "Strip all metadata" }).click();
await page.getByText("0 metadata tags found").waitFor();
const cleanAvif = await download(() => page.getByRole("button", { name: "Download clean file" }).click());
const avifSize = await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/avif" }));
  return [bitmap.width, bitmap.height];
}, cleanAvif.bytes.toString("base64"));
assert.deepEqual(avifSize, [64, 48]);
step("sanitize AVIF: 0 tags and the cleaned file still decodes in Chromium");

// ---------------------------------------------------------------- HEIC to JPG (all three open images)
await go("heic-to-jpg");
await page.getByRole("heading", { name: "3 images" }).waitFor();
await page.getByRole("button", { name: "Convert 3 images to JPG" }).click();
await page.getByText("3 images converted to JPG").waitFor();
await page.screenshot({ path: "m10-04-heic-to-jpg.png" });
const zip = await download(() => page.getByRole("button", { name: "Download all as ZIP" }).click());
const converted = unzipSync(new Uint8Array(zip.bytes));
assert.deepEqual(Object.keys(converted).sort(), ["IMG_0001.jpg", "holiday.jpg", "sunset.jpg"]);
const fromHeic = jpegInfo(converted["IMG_0001.jpg"]);
assert.deepEqual([fromHeic.width, fromHeic.height, fromHeic.app1], [64, 48, false], "HEIC → 64×48 JPEG without EXIF/XMP");
assert.deepEqual([jpegInfo(converted["sunset.jpg"]).width, jpegInfo(converted["holiday.jpg"]).app1], [64, false]);
// PNG, single file, replacing the tab.
await page.getByRole("radio", { name: "PNG" }).click();
await page.getByRole("button", { name: "Convert 3 images to PNG" }).click();
await page.getByText("3 images converted to PNG").waitFor();
step("HEIC to JPG: HEIC, AVIF and JPEG converted in one go; ZIP of metadata-free JPGs at full size; PNG option");

// ---------------------------------------------------------------- Images to PDF with HEIC and AVIF
await go("images-to-pdf");
await page.getByRole("button", { name: "Create PDF from 3 images" }).click();
await page.getByText(/^PDF ready|images\.pdf/).first().waitFor();
const pdf = await download(() => page.getByRole("button", { name: "Download result" }).click());
const doc = await getDocument({ data: new Uint8Array(pdf.bytes) }).promise;
assert.equal(doc.numPages, 3);
for (let i = 1; i <= 3; i++) {
  const { fnArray } = await (await doc.getPage(i)).getOperatorList();
  assert.ok(fnArray.includes(OPS.paintImageXObject), `page ${i} has its image`);
}
const pdfText = Buffer.from(pdf.bytes).toString("latin1");
for (const secret of ["F17XK2QJ0D8A", "SN-12345", "Jane Doe"]) assert.ok(!pdfText.includes(secret), secret);
step("images to PDF: HEIC, AVIF and JPEG become three pages, with none of their metadata");

// ---------------------------------------------------------------- Themes and mobile
const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const p2 = await dark.newPage();
await p2.goto(base + "/tools/sanitize/", { waitUntil: "networkidle" });
await p2.locator('input[type="file"]').first().setInputFiles(["m10/IMG_0001.heic"]);
await p2.getByText("Serial Number").waitFor();
await p2.getByRole("button", { name: /^Sensitive \d+/ }).click();
await p2.waitForTimeout(400);
await p2.screenshot({ path: "m10-05-sanitize-dark.png" });
await p2.keyboard.press("Control+k");
await p2.keyboard.type("conv");
await p2.screenshot({ path: "m10-06-search-dark.png" });

const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p3 = await mob.newPage();
const overflow = {};
for (const [path, file, ready] of [["/", null, "Filter tools"], ["/tools/sanitize/", "m10/IMG_0001.heic", "Serial Number"], ["/tools/heic-to-jpg/", "m10/IMG_0001.heic", "Convert to JPG"]]) {
  await p3.goto(base + path, { waitUntil: "networkidle" });
  if (file) await p3.locator('input[type="file"]').first().setInputFiles([file]);
  await p3.getByText(ready).or(p3.getByRole("searchbox", { name: ready })).or(p3.getByRole("button", { name: ready })).first().waitFor();
  await p3.waitForTimeout(500);
  const name = path === "/" ? "home" : path.split("/")[2];
  await p3.screenshot({ path: `m10-07-${name}-mobile.png`, fullPage: true });
  overflow[name] = await p3.evaluate(() => document.documentElement.scrollWidth - innerWidth);
}
await p3.getByRole("button", { name: "Search tools" }).click();
await p3.getByRole("dialog", { name: "Search tools" }).waitFor();
await p3.screenshot({ path: "m10-08-search-mobile.png" });
console.log("   mobile overflow px:", overflow);
assert.ok(Object.values(overflow).every((px) => px <= 0), "no horizontal scroll on mobile");
step("dark theme and 390 px mobile screenshots");

console.log("errors:", errors.length ? errors : "none");
console.log("origins:", [...origins]);
assert.deepEqual(errors, []);
assert.deepEqual([...origins], [new URL(base).origin]);
await browser.close();
