// Milestone 13: OCR PDF (Tesseract add-on, served from our own origin) and Translate PDF (the
// browser's built-in Translator API; a stand-in translator is injected where Chromium lacks it).
// Every download is checked with pdf.js. Run via `npm run e2e`; outputs in e2e/.output/.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const mod = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { PDFDocument, StandardFonts, rgb } = await mod("node_modules/@cantoo/pdf-lib/cjs/index.js");
const { getDocument } = await mod("node_modules/pdfjs-dist/legacy/build/pdf.mjs");

const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const step = (s) => console.log("✓", s);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
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

// ---------------------------------------------------------------- Fixtures
mkdirSync("m13", { recursive: true });
await page.goto(base + "/", { waitUntil: "networkidle" });
// A "scan": text drawn into a picture (150 dpi on a Letter page), with no text layer.
const scanPng = Buffer.from(
  (
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 1275;
      c.height = 1650;
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#111";
      g.font = "bold 56px Arial";
      g.fillText("INVOICE 4711", 150, 250);
      g.font = "40px Arial";
      g.fillText("Total due: 1,250.00 EUR", 150, 360);
      g.fillText("Thank you for your business", 150, 430);
      return c.toDataURL("image/png");
    })
  ).split(",")[1],
  "base64",
);
writeFileSync("m13/receipt.png", scanPng);
{
  const doc = await PDFDocument.create({ updateMetadata: false });
  const image = await doc.embedPng(scanPng);
  doc.addPage([612, 792]).drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText("Already searchable", { x: 72, y: 700, size: 18, font });
  writeFileSync("m13/scan.pdf", await doc.save());

  const letter = await PDFDocument.create({ updateMetadata: false });
  const p = letter.addPage([612, 792]);
  p.drawText("Quarterly report", { x: 72, y: 700, size: 22, font: await letter.embedFont(StandardFonts.HelveticaBold), color: rgb(0.1, 0.2, 0.5) });
  const body = await letter.embedFont(StandardFonts.Helvetica);
  p.drawText("The results were good and the whole", { x: 72, y: 660, size: 12, font: body });
  p.drawText("team is happy with them.", { x: 72, y: 645, size: 12, font: body });
  p.drawText("2026", { x: 72, y: 610, size: 12, font: body });
  writeFileSync("m13/letter.pdf", await letter.save());
}
step("fixtures: a scanned page + a text page, a photo of text, and an English letter");

async function pdfText(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: `${repo}/node_modules/pdfjs-dist/standard_fonts/` });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((t) => t.str ?? "").join(" ").replace(/\s+/g, " ").trim());
  }
  await task.destroy();
  return pages;
}
async function download(p, name) {
  const [d] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name, exact: true }).click()]);
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}

// ---------------------------------------------------------------- OCR a scanned PDF
await page.goto(base + "/tools/ocr/", { waitUntil: "networkidle" });
await page.locator('input[type="file"]').first().setInputFiles(["m13/scan.pdf"]);
await page.getByText("1 page already has text.").waitFor();
assert.equal(await page.getByRole("list", { name: "Chosen languages" }).innerText(), "English");
await page.getByRole("combobox", { name: "Add a language" }).selectOption({ label: "German (1.3 MB)" });
await page.getByRole("button", { name: "Remove German" }).click();
await page.getByRole("button", { name: "Recognise text on 1 page" }).click();
await page.getByText("Searchable PDF ready").waitFor({ timeout: 180_000 });
const preview = await page.getByRole("region", { name: "Recognised text" }).innerText();
assert.match(preview, /INVOICE 4711/);
assert.match(preview, /1 page read, 1 skipped/);
await page.screenshot({ path: "m13-01-ocr.png" });
const searchable = await download(page, "Download result");
assert.equal(searchable.name, "scan-ocr.pdf");
const [ocrText, untouched] = await pdfText(searchable.bytes);
assert.match(ocrText, /INVOICE 4711/);
assert.match(ocrText, /Total due: 1,250\.00 EUR/);
assert.match(ocrText, /Thank you for your business/);
assert.equal(untouched, "Already searchable");
const txt = await download(page, ".txt");
assert.equal(txt.name, "scan.txt");
assert.match(txt.bytes.toString("utf8"), /^INVOICE 4711\nTotal due/);
// The engine and model came from our own site, and the service worker kept them for offline use.
const addons = await page.evaluate(async () => (await (await caches.open("docsanitize-addons")).keys()).map((r) => new URL(r.url).pathname));
assert.ok(addons.some((p) => /\/tesseract-[\d.]+\/worker\.min\.js$/.test(p)), addons.join());
assert.ok(addons.some((p) => /\/tesseract-core-[\d.]+\/tesseract-core-.*lstm\.wasm\.js$/.test(p)), addons.join());
assert.ok(addons.some((p) => p.endsWith("/eng.traineddata.gz")) && !addons.some((p) => p.endsWith("/deu.traineddata.gz")), addons.join());
step("OCR: the scanned page gets invisible, searchable text; the page that had text is skipped; .txt matches");

// ---------------------------------------------------------------- OCR a photo
await page.locator('input[type="file"]').first().setInputFiles(["m13/receipt.png"]);
await page.getByRole("tab", { name: /receipt\.png/ }).click();
await page.getByRole("button", { name: "Recognise text on 1 page" }).click();
await page.getByText("Searchable PDF ready").waitFor({ timeout: 180_000 });
const photo = await download(page, "Download result");
assert.equal(photo.name, "receipt-ocr.pdf");
const [photoText] = await pdfText(photo.bytes);
assert.match(photoText, /INVOICE 4711/);
const photoPdf = await PDFDocument.load(photo.bytes, { updateMetadata: false });
assert.equal(photoPdf.getPageCount(), 1);
assert.equal(photoPdf.getAuthor(), undefined);
assert.equal(photoPdf.getProducer(), undefined);
step("OCR: a photo becomes a one-page searchable PDF with no added metadata");

// ---------------------------------------------------------------- A language that can't be downloaded
// The German model is taken out of the build for a moment, so the server answers 404.
{
  const model = readdirSync(`${repo}/out/addons`).find((d) => d.startsWith("tessdata-"));
  const file = `${repo}/out/addons/${model}/deu.traineddata.gz`;
  renameSync(file, `${file}.hidden`);
  const fctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  try {
    const fp = await fctx.newPage();
    const ferrors = [];
    fp.on("pageerror", (e) => ferrors.push(e.message));
    await fp.goto(base + "/tools/ocr/", { waitUntil: "networkidle" });
    await fp.locator('input[type="file"]').first().setInputFiles(["m13/receipt.png"]);
    await fp.getByRole("combobox", { name: "Add a language" }).selectOption("deu");
    await fp.getByRole("button", { name: "Recognise text on 1 page" }).click();
    await fp.getByText("The OCR engine couldn't be loaded").waitFor({ timeout: 60_000 });
    assert.equal(await fp.getByRole("button", { name: "Recognise text on 1 page" }).isEnabled(), true, "ready to try again");
    assert.deepEqual(ferrors, []);
  } finally {
    renameSync(`${file}.hidden`, file);
    await fctx.close();
  }
}
step("OCR: a language that can't be downloaded gives a clear error instead of hanging");

// ---------------------------------------------------------------- Translate without the API
// (Some Chromium builds have the built-in translator; hide it to stand in for Firefox or Safari.)
const nctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await nctx.addInitScript(() => Object.defineProperty(globalThis, "Translator", { value: undefined, configurable: true }));
const np = await nctx.newPage();
watch(np);
await np.goto(base + "/tools/translate/", { waitUntil: "networkidle" });
await np.locator('input[type="file"]').first().setInputFiles(["m13/letter.pdf"]);
await np.getByText("This browser has no built-in translator").waitFor();
assert.equal(await np.getByRole("button", { name: /^Translate to/ }).count(), 0);
await nctx.close();
step("translate: browsers without a built-in translator are told to use Chrome or Edge");

// ---------------------------------------------------------------- Translate with a stand-in translator
const tctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, locale: "en-US" });
await tctx.addInitScript(() => {
  const words = { "Quarterly report": "Quartalsbericht", "The results were good and the whole team is happy with them.": "Die Ergebnisse waren gut und das ganze Team ist damit zufrieden." };
  window.__translated = [];
  const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define("Translator", {
    availability: async () => "downloadable",
    create: async ({ targetLanguage, monitor }) => {
      monitor?.({ addEventListener: (_, fn) => fn({ loaded: 1 }) });
      return {
        translate: async (text) => {
          window.__translated.push(text);
          return targetLanguage === "de" ? (words[text] ?? `DE ${text}`) : `【${text}】`;
        },
        destroy() {},
      };
    },
  });
  define("LanguageDetector", {
    availability: async () => "available",
    create: async () => ({ detect: async () => [{ detectedLanguage: "en", confidence: 0.97 }], destroy() {} }),
  });
});
const tp = await tctx.newPage();
watch(tp);
await tp.goto(base + "/tools/translate/", { waitUntil: "networkidle" });
await tp.locator('input[type="file"]').first().setInputFiles(["m13/letter.pdf", "m13/scan.pdf"]);
await tp.getByRole("tab", { name: /letter\.pdf/ }).click();
await tp.getByText("Detected from the text.").waitFor();
assert.equal(await tp.getByRole("combobox", { name: "From" }).inputValue(), "en");
await tp.getByRole("combobox", { name: "To" }).selectOption("de");
await tp.getByText("Your browser will download this language pack once").waitFor();
await tp.getByRole("button", { name: "Translate to German" }).click();
await tp.getByText("Translated PDF ready").waitFor({ timeout: 60_000 });
await tp.screenshot({ path: "m13-02-translate.png" });
const translated = await download(tp, "Download result");
assert.equal(translated.name, "letter-de.pdf");
const [german] = await pdfText(translated.bytes);
assert.match(german, /Quartalsbericht/);
assert.match(german, /Die Ergebnisse waren gut/);
assert.match(german, /2026/);
assert.ok(!/Quarterly|results|happy/.test(german), german);
assert.deepEqual(await tp.evaluate(() => window.__translated), ["Quarterly report", "The results were good and the whole team is happy with them."], "numbers aren't sent for translation");
const germanTxt = await download(tp, ".txt");
assert.equal(germanTxt.name, "letter-de.txt");
assert.equal(germanTxt.bytes.toString("utf8"), "Quartalsbericht\n\nDie Ergebnisse waren gut und das ganze Team ist damit zufrieden.\n\n2026\n");
step("translate: paragraphs are replaced in place (original text removed), numbers kept, .txt matches");

// A language the PDF fonts can't write: text only.
await tp.getByRole("combobox", { name: "To" }).selectOption("ja");
await tp.getByText("Japanese needs fonts DocSanitize doesn't include yet").waitFor();
await tp.getByRole("button", { name: "Translate to Japanese" }).click();
await tp.getByText("Translation ready").waitFor();
assert.equal(await tp.getByText("Translated PDF ready").count(), 0);
assert.match(await tp.getByRole("region", { name: "Translation preview" }).innerText(), /【Quarterly report】/);
const japanese = await download(tp, ".txt");
assert.match(japanese.bytes.toString("utf8"), /^【Quarterly report】/);
step("translate: languages outside Latin/Greek/Cyrillic give translated text (.txt) with a preview");

// A scan without OCR has nothing to translate.
await tp.getByRole("tab", { name: /scan\.pdf/ }).click();
await tp.getByRole("combobox", { name: "From" }).selectOption("en");
await tp.getByRole("combobox", { name: "To" }).selectOption("de");
await tp.getByRole("textbox", { name: "Pages" }).fill("1");
await tp.getByRole("button", { name: "Translate to German" }).click();
await tp.getByText("this looks like a scan. Run OCR PDF on it first").waitFor();
errors.splice(0, errors.length, ...errors.filter((e) => !e.includes("looks like a scan")));
step("translate: a scan without text points to OCR PDF");

// ---------------------------------------------------------------- Dark + mobile
const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const dp = await dark.newPage();
watch(dp);
await dp.goto(base + "/tools/ocr/", { waitUntil: "networkidle" });
await dp.locator('input[type="file"]').first().setInputFiles(["m13/scan.pdf"]);
await dp.getByRole("button", { name: "Recognise text on 1 page" }).waitFor();
await dp.screenshot({ path: "m13-03-ocr-dark.png" });

const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const mp = await mob.newPage();
watch(mp);
const overflow = {};
for (const tool of ["ocr", "translate"]) {
  await mp.goto(`${base}/tools/${tool}/`, { waitUntil: "networkidle" });
  await mp.locator('input[type="file"]').first().setInputFiles(["m13/scan.pdf"]);
  const ready = tool === "ocr" ? mp.getByRole("button", { name: "Recognise text on 1 page" }) : mp.getByRole("button", { name: /^Translate to/ }).or(mp.getByText("This browser has no built-in translator"));
  await ready.waitFor();
  await mp.waitForTimeout(500);
  await mp.screenshot({ path: `m13-04-${tool}-mobile.png`, fullPage: true });
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
