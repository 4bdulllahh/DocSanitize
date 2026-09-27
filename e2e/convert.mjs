// Milestone 5: Images to PDF, PDF to Images, Compress PDF (checks downloaded bytes and rendered pixels).
// Run via `npm run e2e` (serves ./out); outputs land in e2e/.output/.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const fx = await import(pathToFileURL(`${repo}/src/lib/metadata/__tests__/fixtures.ts`).href);
const { PDFDocument, PDFName, PDFRawStream, StandardFonts, rgb } = await import(pathToFileURL(`${repo}/node_modules/@cantoo/pdf-lib/cjs/index.js`).href);
const { unzipSync } = await import(pathToFileURL(`${repo}/node_modules/fflate/lib/index.cjs`).href);

const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const step = (s) => console.log("✓", s);

const browser = await chromium.launch();

// ---------------------------------------------------------------- Fixtures, drawn with a real canvas
const scratch = await browser.newPage(); // about:blank: makes no requests
async function drawImage(kind, width, height, type, quality) {
  const url = await scratch.evaluate(
    ({ kind, width, height, type, quality }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const g = canvas.getContext("2d");
      const [w, h] = [width, height];
      if (kind === "quadrants") {
        // Stored top-left red, top-right green, bottom-left blue, bottom-right yellow.
        [["#e02020", 0, 0], ["#20c020", w / 2, 0], ["#2040e0", 0, h / 2], ["#f0d020", w / 2, h / 2]].forEach(([c, x, y]) => {
          g.fillStyle = c;
          g.fillRect(x, y, w / 2, h / 2);
        });
      } else if (kind === "half") {
        // Left half navy, right half transparent.
        g.fillStyle = "#263a81";
        g.fillRect(0, 0, w / 2, h);
      } else {
        // A busy "photo": gradients plus thousands of small shapes (seeded, so runs are comparable).
        let seed = 7;
        const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        const grad = g.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, "#4a7fb5");
        grad.addColorStop(1, "#e8b04a");
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 6000; i++) {
          g.fillStyle = `hsla(${rand() * 360}, 70%, ${30 + rand() * 50}%, 0.8)`;
          g.beginPath();
          g.arc(rand() * w, rand() * h, 2 + rand() * 18, 0, Math.PI * 2);
          g.fill();
        }
      }
      return canvas.toDataURL(type, quality);
    },
    { kind, width, height, type, quality },
  );
  return new Uint8Array(Buffer.from(url.split(",")[1], "base64"));
}

/** Colour names at the given [x, y] fractions of an image. */
async function colorsAt(bytes, mime, points) {
  const rgbs = await scratch.evaluate(
    async ({ b64, mime, points }) => {
      const img = new Image();
      img.src = `data:${mime};base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const g = canvas.getContext("2d");
      g.drawImage(img, 0, 0);
      return points.map(([x, y]) => [...g.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data.slice(0, 3)]);
    },
    { b64: Buffer.from(bytes).toString("base64"), mime, points },
  );
  const named = { red: [224, 32, 32], green: [32, 192, 32], blue: [32, 64, 224], yellow: [240, 208, 32], navy: [38, 58, 129], white: [255, 255, 255] };
  return rgbs.map((c) => Object.entries(named).sort(([, a], [, b]) => dist(c, a) - dist(c, b))[0][0]);
}
const dist = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);

const pngSize = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)];
function jpegSize(b) {
  for (let i = 2; i < b.length; ) {
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
}

mkdirSync("m5", { recursive: true });
const quadrants = await drawImage("quadrants", 800, 600, "image/jpeg", 0.95);
// Orientation 6: shown rotated 90° clockwise, so it displays as 600×800.
writeFileSync("m5/photo.jpg", fx.addJpegMetadata(quadrants, { exif: { orientation: 6, artist: "Jane Doe", make: "Canon", serial: "SN-77", gps: { lat: 25.2048, lon: 55.2708 } } }));
writeFileSync("m5/shot.png", fx.addPngMetadata(await drawImage("half", 400, 400, "image/png"), { text: { Author: "Jane Doe" } }));
writeFileSync("m5/pic.webp", await drawImage("quadrants", 640, 480, "image/webp", 0.9));
const photo = await drawImage("photo", 2400, 1800, "image/jpeg", 0.95);

const report = await PDFDocument.create({ updateMetadata: false });
report.setAuthor("Jane Doe");
const reportPage = report.addPage([612, 792]);
reportPage.drawImage(await report.embedJpg(photo), { x: 0, y: 0, width: 612, height: 792 });
reportPage.drawText("Quarterly report", { x: 40, y: 740, size: 28, font: await report.embedFont(StandardFonts.HelveticaBold), color: rgb(1, 1, 1) });
writeFileSync("m5/report.pdf", await report.save());
// Saved the way DocSanitize saves: there is nothing left to gain.
const lean = await PDFDocument.create({ updateMetadata: false });
lean.addPage([300, 300]).drawText("Just text", { x: 20, y: 150, size: 18 });
writeFileSync("m5/lean.pdf", await lean.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false }));
const locked = await PDFDocument.create();
locked.addPage();
locked.encrypt({ userPassword: "pw", ownerPassword: "owner" });
writeFileSync("m5/locked.pdf", await locked.save());
step(`fixtures written (photo PDF ${(readFileSync("m5/report.pdf").length / 1024).toFixed(0)} KB)`);

// ---------------------------------------------------------------- App page
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
const origins = new Set();
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => origins.add(new URL(r.url()).origin));
page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));

const tile = (n) => page.getByRole("button", { name: new RegExp(`^Page ${n}$`) });
const rendered = (loc) => loc.locator("canvas:not(.invisible)").first().waitFor();
async function download(trigger) {
  const [d] = await Promise.all([page.waitForEvent("download"), trigger()]);
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}
const sizesOf = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
const latin1 = (bytes) => Buffer.from(bytes).toString("latin1");

// ---------------------------------------------------------------- Images to PDF
await page.goto(base + "/tools/images-to-pdf/", { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(["m5/photo.jpg", "m5/shot.png", "m5/pic.webp"]);
await page.getByText("600 × 800 px").waitFor(); // the browser applied the EXIF orientation
await page.getByText("640 × 480 px").waitFor();
await page.getByRole("button", { name: "Rotate shot.png clockwise" }).click();
await page.getByText("rotated 90°").waitFor();
await page.screenshot({ path: "m5-01-images-to-pdf.png" });
step("images list: orientation-aware sizes, per-image rotation");

await page.getByRole("radio", { name: "Fit image" }).click();
assert.ok(await page.getByRole("radio", { name: "Landscape" }).isDisabled());
await page.getByRole("button", { name: "Create PDF from 3 images" }).click();
await page.getByText("PDF created").waitFor();
let made = await download(() => page.getByRole("button", { name: "Download result" }).click());
// 96 DPI: 600×800 px -> 450×600 pt; 400×400 -> 300×300; 640×480 -> 480×360.
assert.deepEqual(await sizesOf(made.bytes), [[450, 600], [300, 300], [480, 360]]);
step("fit-to-image pages are sized at 96 DPI");

await page.getByRole("radio", { name: "A4" }).click();
await page.getByRole("radio", { name: "Small" }).click();
await page.getByRole("radio", { name: "None" }).click();
await page.locator('input[value="images.pdf"]').fill("album");
await page.getByRole("button", { name: "Create PDF from 3 images" }).click();
await page.getByText("PDF created").waitFor();
made = await download(() => page.getByRole("button", { name: "Download result" }).click());
assert.equal(made.name, "album.pdf");
assert.deepEqual(await sizesOf(made.bytes), [[595, 842], [595, 842], [842, 595]]);
for (const leak of ["Jane Doe", "Canon", "SN-77", "Exif", "Producer"]) assert.ok(!latin1(made.bytes).includes(leak), `PDF leaks ${leak}`);
step("A4 auto-orientation: portrait, portrait, landscape; no EXIF/GPS/author/producer in the PDF");

await page.getByRole("button", { name: "Open in a new tab" }).click();
await page.getByRole("tab", { name: /album\.pdf/ }).waitFor();

// ---------------------------------------------------------------- PDF to Images (also proves the PDF renders correctly)
await page.locator('aside a[href="/tools/pdf-to-images/"]').click();
await page.waitForURL("**/tools/pdf-to-images/");
await page.getByText(/3\s*of 3 pages selected/).waitFor();
await rendered(tile(3));
await page.getByRole("radio", { name: "PNG" }).click();
assert.equal(await page.getByRole("slider").count(), 0); // no quality for PNG
await page.getByRole("radio", { name: "72 DPI" }).click();
await page.getByText("Page 1 → 595 × 842 px").waitFor();
await page.screenshot({ path: "m5-02-pdf-to-images.png" });
await page.getByRole("button", { name: "Convert 3 pages" }).click();
await page.getByText("3 images ready").waitFor();
const zip = await download(() => page.getByRole("button", { name: "Download all as ZIP" }).click());
assert.equal(zip.name, "album-images.zip");
const images = unzipSync(new Uint8Array(zip.bytes));
assert.deepEqual(Object.keys(images).sort(), ["album-page-1.png", "album-page-2.png", "album-page-3.png"]);
const png = (n) => Buffer.from(images[`album-page-${n}.png`]);
assert.deepEqual(pngSize(png(1)), [595, 842]);
assert.deepEqual(pngSize(png(3)), [842, 595]);
step("PNG export at 72 DPI: 3 files in a ZIP, correct pixel sizes");

// Page 1: the JPEG turned 90° clockwise by its EXIF tag: blue top-left, red top-right, yellow bottom-left, green bottom-right.
assert.deepEqual(await colorsAt(png(1), "image/png", [[0.25, 0.3], [0.75, 0.3], [0.25, 0.7], [0.75, 0.7]]), ["blue", "red", "yellow", "green"]);
// Page 2: left-navy PNG rotated 90° by the user: navy on top; its transparent half shows white paper.
assert.deepEqual(await colorsAt(png(2), "image/png", [[0.5, 0.4], [0.5, 0.6]]), ["navy", "white"]);
// Page 3: the WebP as stored, on a landscape page.
assert.deepEqual(await colorsAt(png(3), "image/png", [[0.3, 0.25], [0.7, 0.25], [0.3, 0.75], [0.7, 0.75]]), ["red", "green", "blue", "yellow"]);
step("rendered pages prove EXIF orientation, user rotation, transparency and WebP decoding");

await page.getByRole("radio", { name: "JPG" }).click();
await page.getByRole("radio", { name: "150 DPI" }).click();
await page.getByPlaceholder("None selected").fill("2");
await page.getByText(/1\s*of 3 pages selected/).waitFor();
await page.getByRole("button", { name: "Convert 1 page" }).click();
await page.getByText("Image ready").waitFor();
const jpg = await download(() => page.getByRole("button", { name: "Download result" }).click());
assert.equal(jpg.name, "album-page-2.jpg");
assert.deepEqual(jpegSize(jpg.bytes), [1240, 1754]);
assert.ok(!latin1(jpg.bytes).includes("Exif"));
step("typed page range + JPG at 150 DPI: 1240×1754 px, no EXIF");

await tile(1).click();
await tile(3).click({ modifiers: ["Shift"] });
assert.equal(await page.getByPlaceholder("None selected").inputValue(), "1-3");
step("click + shift-click selection syncs to the range field");

// ---------------------------------------------------------------- Compress
await page.locator('aside a[href="/tools/compress/"]').click();
await page.waitForURL("**/tools/compress/");
await page.locator('input[type="file"]').setInputFiles(["m5/report.pdf"]);
await rendered(page.locator("figure").first());
await page.getByRole("button", { name: "Compress PDF" }).click();
await page.getByText(/−\d+%/).waitFor();
await rendered(page.locator("figure").nth(1));
await page.screenshot({ path: "m5-03-compress.png" });
const original = readFileSync("m5/report.pdf");
let compressed = await download(() => page.getByRole("button", { name: "Download result" }).click());
assert.equal(compressed.name, "report-compressed.pdf");
const imageWidths = async (bytes) => {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const widths = doc.context
    .enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"))
    .map(([, o]) => o.dict.get(PDFName.of("Width")).asNumber());
  return { widths, author: doc.getAuthor() };
};
let info = await imageWidths(compressed.bytes);
console.log(`   ${(original.length / 1024).toFixed(0)} KB -> ${(compressed.bytes.length / 1024).toFixed(0)} KB, image widths ${info.widths}`);
assert.ok(compressed.bytes.length < original.length * 0.7, "at least 30% smaller");
// Letter at 150 DPI: 11 in × 150 = 1650 px on the long side, so 2400×1800 -> 1650×1238.
assert.deepEqual(info.widths, [1650]);
assert.equal(info.author, "Jane Doe");
step("balanced: photo downscaled to 150 DPI for its page, file much smaller, metadata untouched");

await page.getByRole("radio", { name: /Strong/ }).click();
await page.getByRole("checkbox", { name: /Also remove metadata/ }).check();
await page.getByRole("button", { name: "Compress PDF" }).click();
await page.getByText(/−\d+%/).waitFor();
compressed = await download(() => page.getByRole("button", { name: "Download result" }).click());
info = await imageWidths(compressed.bytes);
assert.deepEqual(info.widths, [1100]);
assert.equal(info.author, undefined);
assert.ok(!latin1(compressed.bytes).includes("Jane Doe"));
step("strong + remove metadata: 100 DPI, author gone");

await page.getByRole("button", { name: "Replace the file in this tab" }).click();
await page.getByRole("tab", { name: /report\.pdf/ }).waitFor();
await page.locator('input[type="file"]').setInputFiles(["m5/lean.pdf", "m5/locked.pdf"]);
await page.getByRole("tab", { name: /lean\.pdf/ }).click();
await page.getByRole("button", { name: "Compress PDF" }).click();
await page.getByText("Already well optimized").waitFor();
assert.equal(await page.getByRole("button", { name: "Download result" }).count(), 0);
await page.getByRole("tab", { name: /locked\.pdf/ }).click();
await page.getByText("Password-protected PDF").waitFor();
step("already-optimal file is left alone; locked PDF points to Unlock");

// ---------------------------------------------------------------- Themes and mobile
const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const p2 = await dark.newPage();
await p2.goto(base + "/tools/images-to-pdf/", { waitUntil: "networkidle" });
await p2.locator('input[type="file"]').setInputFiles(["m5/photo.jpg", "m5/pic.webp"]);
await p2.getByText("640 × 480 px").waitFor();
await p2.getByRole("radio", { name: "Fill page" }).click();
await p2.getByRole("radio", { name: "Large" }).click();
await p2.screenshot({ path: "m5-04-images-dark.png" });
await p2.locator('aside a[href="/tools/compress/"]').click();
await p2.waitForURL("**/tools/compress/");
await p2.locator('input[type="file"]').setInputFiles(["m5/report.pdf"]);
await p2.getByRole("button", { name: "Compress PDF" }).click();
await p2.getByText(/−\d+%/).waitFor();
await p2.locator("figure canvas:not(.invisible)").nth(1).waitFor();
await p2.screenshot({ path: "m5-05-compress-dark.png" });

const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p3 = await mob.newPage();
const overflow = {};
for (const [tool, file] of [["images-to-pdf", "m5/photo.jpg"], ["pdf-to-images", "m5/report.pdf"], ["compress", "m5/report.pdf"]]) {
  await p3.goto(`${base}/tools/${tool}/`, { waitUntil: "networkidle" });
  await p3.locator('input[type="file"]').setInputFiles([file]);
  await p3.getByRole("button", { name: /Create PDF|Convert|Compress PDF/ }).first().waitFor();
  await p3.waitForTimeout(400);
  await p3.screenshot({ path: `m5-06-${tool}-mobile.png`, fullPage: true });
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
