// Milestone 18: Batch Process (steps run over every open file; presets, order checks, saved steps,
// failures, signing, OCR and audio in a batch). Checks the downloaded bytes. Run via `npm run e2e`.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const mod = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { PDFDocument, StandardFonts } = await mod("node_modules/@cantoo/pdf-lib/cjs/index.js");
const { unzipSync } = await mod("node_modules/fflate/lib/index.cjs");
const { getDocument } = await mod("node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const metaFx = await mod("src/lib/metadata/__tests__/fixtures.ts");
const officeFx = await mod("src/lib/office/__tests__/fixtures.ts");

const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const step = (s) => console.log("✓", s);
const latin = (bytes) => Buffer.from(bytes).toString("latin1");

async function pageTexts(bytes, password) {
  const task = getDocument({ data: new Uint8Array(bytes), password, useSystemFonts: false, standardFontDataUrl: `${repo}/node_modules/pdfjs-dist/standard_fonts/` });
  const doc = await task.promise;
  const texts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const { items } = await (await doc.getPage(i)).getTextContent();
    texts.push(items.map((it) => it.str).join(" ").replace(/\s+/g, " "));
  }
  await task.destroy();
  return texts;
}

// ---------------------------------------------------------------- Fixtures
const browser = await chromium.launch();
const gen = await browser.newPage();
const render = (type, text) =>
  gen
    .evaluate(
      async ([type, text]) => {
        const c = new OffscreenCanvas(1200, 500);
        const g = c.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, 1200, 500);
        g.fillStyle = "#111";
        g.font = "bold 72px sans-serif";
        g.fillText(text, 80, 270);
        const blob = await c.convertToBlob({ type, quality: 0.92 });
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      },
      [type, text],
    )
    .then((a) => new Uint8Array(a));
const photo = await render("image/jpeg", "Holiday photo");
const scan = await render("image/png", "INVOICE NUMBER 4471");
await gen.close();

mkdirSync("m18", { recursive: true });
async function makePdf(name, pages, author) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) doc.addPage([595, 842]).drawText(`${name} page ${i}`, { x: 72, y: 760, size: 18, font });
  if (author) {
    doc.setAuthor(author);
    doc.setTitle("Internal draft");
  }
  writeFileSync(`m18/${name}.pdf`, await doc.save());
}
await makePdf("alpha", 3, "Jane Doe");
await makePdf("beta", 2, "Jane Doe");
writeFileSync("m18/holiday.jpg", metaFx.addJpegMetadata(photo, { exif: { artist: "Jane Doe", make: "Apple", model: "iPhone 17 Pro", gps: { lat: 25.197197, lon: 55.274376 } } }));
writeFileSync("m18/plan.docx", officeFx.sampleDocx(photo));
writeFileSync("m18/broken.pdf", "%PDF-1.7\nthis is not really a PDF\n");
writeFileSync("m18/scan.png", scan);
{
  // One second of a 440 Hz tone, 16-bit mono WAV.
  const rate = 8000;
  const data = Buffer.alloc(rate * 2);
  for (let i = 0; i < rate; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync("m18/tone.wav", Buffer.concat([header, data]));
}
copyFileSync(`${repo}/src/lib/sign/__tests__/fixtures/legacy-3des.p12`, "m18/id.p12");
step("fixtures: two PDFs with an author, a GPS-tagged photo, a Word file, a broken PDF, a scan, a WAV, a certificate");

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
const main = (p = page) => p.locator("main");
const open = async (files, p = page) => {
  await p.goto(`${base}/tools/batch/`, { waitUntil: "networkidle" });
  await main(p).locator('input[type="file"]').first().setInputFiles(files);
  await p.getByRole("heading", { name: "Steps" }).waitFor();
};
async function download(name, p = page) {
  const [d] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name, exact: true }).click()]);
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}
const stepCard = (n) => main().getByRole("listitem", { name: new RegExp(`^Step ${n}:`) });
const fileRow = (name) => main().getByRole("list", { name: "Open files" }).getByRole("listitem").filter({ hasText: name });
const addStep = async (name) => {
  await page.getByRole("button", { name: "Add a step" }).click();
  await main().getByRole("button", { name: new RegExp(`^${name}`) }).click();
};

// ---------------------------------------------------------------- A preset over mixed files
await open(["m18/alpha.pdf", "m18/beta.pdf", "m18/holiday.jpg", "m18/plan.docx"]);
await page.getByRole("button", { name: /^Numbered bundle/ }).click();
assert.equal(await main().getByRole("listitem", { name: /^Step \d:/ }).count(), 3);
assert.match(await stepCard(2).textContent(), /Bates numbers.*DOC-000001 onwards.*4 files/);
assert.match(await fileRow("alpha.pdf").textContent(), /2 steps/);
assert.match(await fileRow("holiday.jpg").textContent(), /3 steps, becomes PDF/);
await addStep("Watermark");
await main().getByRole("textbox", { name: "Text", exact: true }).fill("DRAFT");
assert.match(await stepCard(4).textContent(), /“DRAFT”/);
await page.getByRole("button", { name: "Run on 4 files" }).click();
await page.getByText("4 files ready").waitFor({ timeout: 120_000 });
await page.screenshot({ path: "m18-01-batch.png", fullPage: true });
const zip = unzipSync(new Uint8Array((await download("Download all as ZIP")).bytes));
assert.deepEqual(Object.keys(zip), ["alpha.pdf", "beta.pdf", "holiday.pdf", "plan.pdf"]);
const texts = {};
for (const [name, bytes] of Object.entries(zip)) {
  texts[name] = await pageTexts(bytes);
  assert.ok(!latin(bytes).includes("Jane Doe"), `${name}: author removed`);
  assert.ok(!latin(bytes).includes("Internal draft"), `${name}: title removed`);
  assert.ok(texts[name].every((t) => t.includes("DRAFT")), `${name}: watermark on every page`);
}
assert.match(texts["alpha.pdf"][0], /alpha page 1.*DOC-000001|DOC-000001.*alpha page 1/);
assert.match(texts["alpha.pdf"][2], /DOC-000003/);
assert.match(texts["beta.pdf"][0], /DOC-000004/);
assert.match(texts["beta.pdf"][1], /DOC-000005/);
assert.match(texts["holiday.pdf"][0], /DOC-000006/);
assert.match(texts["plan.pdf"][0], /DOC-000007/);
assert.ok(texts["plan.pdf"].join(" ").includes("Quarterly Plan"), "the Word file became a PDF");
assert.ok(!latin(zip["holiday.pdf"]).includes("iPhone"), "no camera details from the photo");
step("preset “Numbered bundle” + watermark: 4 files → PDFs, Bates numbers run on across files, metadata gone");

// ---------------------------------------------------------------- Order checks, choosing files, protect
await page.getByRole("button", { name: "Clear" }).click();
await addStep("Password-protect");
await addStep("Page numbers");
assert.match(await stepCard(2).textContent(), /move this step before Password-protect/);
assert.match(await stepCard(1).textContent(), /Choose a password/);
assert.ok(await page.getByRole("button", { name: "Run on 2 files" }).isDisabled());
await page.getByRole("button", { name: "Move Page numbers up" }).click();
assert.ok(!(await stepCard(1).textContent()).includes("move this step"));
await stepCard(2).getByRole("button", { name: /^Password-protect/ }).click();
await main().getByLabel("Password to open").fill("open-sesame");
await fileRow("beta.pdf").getByRole("checkbox").uncheck();
assert.match(await fileRow("beta.pdf").textContent(), /Left out/);
assert.match(await fileRow("holiday.jpg").textContent(), /Nothing to do/);
await page.getByRole("button", { name: "Run on 1 file" }).click();
await page.getByText("1 file ready").waitFor({ timeout: 60_000 });
const locked = await download("Download result");
assert.equal(locked.name, "alpha.pdf");
assert.match(latin(locked.bytes), /\/Encrypt/);
await assert.rejects(pageTexts(locked.bytes), /password/i);
assert.match((await pageTexts(locked.bytes, "open-sesame"))[2], /Page 3 of 3/);
step("a step after Password-protect is refused until moved; files can be left out; the result opens with the password");

// ---------------------------------------------------------------- Save and open the steps
const saved = await download("Save steps");
assert.equal(saved.name, "batch-steps.json");
const recipe = JSON.parse(saved.bytes.toString("utf8"));
assert.deepEqual(
  recipe.steps.map((s) => s.type),
  ["page-numbers", "protect"],
);
assert.ok(!saved.bytes.toString("utf8").includes("open-sesame"), "the password isn't saved");
writeFileSync("m18/steps.json", saved.bytes);
await page.getByRole("button", { name: "Clear" }).click();
await main().getByLabel("Saved steps file").setInputFiles("m18/steps.json");
await stepCard(2).waitFor();
assert.match(await stepCard(2).textContent(), /Password-protect[\s\S]*Choose a password/);
step("steps save to a JSON file without the password, and open again");

// ---------------------------------------------------------------- A failing file doesn't stop the others
await open(["m18/alpha.pdf", "m18/beta.pdf", "m18/broken.pdf"]);
await addStep("Grayscale");
await page.getByRole("button", { name: "Run on 3 files" }).click();
await page.getByText("1 file couldn't be finished").waitFor({ timeout: 60_000 });
assert.match(await main().getByRole("alert").textContent(), /broken\.pdf at Grayscale: .+/);
await page.getByText("2 files ready").waitFor();
step("a broken PDF is reported at its step while the other files finish");

// ---------------------------------------------------------------- Signing in a batch
await page.getByRole("button", { name: "Clear" }).click();
await fileRow("broken.pdf").getByRole("checkbox").uncheck();
await addStep("Digital signature");
assert.match(await stepCard(1).textContent(), /Open or create a certificate/);
await main().locator('input[type="file"][accept*=".p12"]').setInputFiles("m18/id.p12");
await main().getByLabel("Password", { exact: true }).fill("fixture");
await page.getByRole("button", { name: "Open certificate" }).click();
await page.getByRole("button", { name: "Run on 2 files" }).click();
await page.getByText("2 files ready").waitFor({ timeout: 60_000 });
const signed = unzipSync(new Uint8Array((await download("Download all as ZIP")).bytes));
assert.deepEqual(Object.keys(signed), ["alpha.pdf", "beta.pdf"]);
for (const bytes of Object.values(signed)) assert.match(latin(bytes), /\/SubFilter\s*\/ETSI\.CAdES\.detached/);
writeFileSync("m18/beta-signed.pdf", signed["beta.pdf"]);
await page.goto(`${base}/tools/verify-signatures/`, { waitUntil: "networkidle" });
await main().locator('input[type="file"]').first().setInputFiles("m18/beta-signed.pdf");
await page.getByText("Signed, and unchanged since").waitFor({ timeout: 60_000 });
step("Digital signature in a batch signs each PDF with the opened certificate; Verify Signatures accepts it");

// ---------------------------------------------------------------- OCR and audio in one batch
await open(["m18/scan.png", "m18/tone.wav"]);
await addStep("Convert to PDF");
await addStep("Make searchable");
await addStep("Convert to audio");
assert.match(await fileRow("scan.png").textContent(), /2 steps, becomes PDF/);
assert.match(await fileRow("tone.wav").textContent(), /1 step/);
await page.getByRole("button", { name: "Run on 2 files" }).click();
await page.getByText("2 files ready").waitFor({ timeout: 240_000 });
const mixed = unzipSync(new Uint8Array((await download("Download all as ZIP")).bytes));
assert.deepEqual(Object.keys(mixed), ["scan.pdf", "tone.mp3"]);
assert.match((await pageTexts(mixed["scan.pdf"]))[0], /INVOICE.*4471/);
const mp3 = mixed["tone.mp3"];
assert.ok(latin(mp3.slice(0, 3)) === "ID3" || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0), "an MP3 stream");
// The LAME info frame always names the codec library (as in the media suite); nothing else is added.
assert.ok(!/Lav[fc]\d/.test(latin(mp3).replace(/Lavc59\.37\.100/g, "")), "no encoder tag");
step("one batch: a scan becomes a searchable PDF (OCR) and a WAV becomes an MP3");

// ---------------------------------------------------------------- Dark and mobile
const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const dp = await dark.newPage();
watch(dp);
await open(["m18/alpha.pdf", "m18/holiday.jpg"], dp);
await dp.getByRole("button", { name: /^Share safely/ }).click();
await dp.getByRole("button", { name: /^Remove metadata/ }).click();
await dp.screenshot({ path: "m18-02-batch-dark.png", fullPage: true });

const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const mp = await mob.newPage();
watch(mp);
await open(["m18/alpha.pdf", "m18/holiday.jpg"], mp);
await mp.screenshot({ path: "m18-03-batch-mobile-empty.png", fullPage: true });
await mp.getByRole("button", { name: /^Draft copies/ }).click();
await mp.getByRole("button", { name: "Add a step" }).click();
await mp.waitForTimeout(300);
await mp.screenshot({ path: "m18-04-batch-mobile.png", fullPage: true });
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
console.log("   mobile overflow px:", overflow);
assert.ok(overflow <= 0, "no horizontal scroll on mobile");
step("dark theme and 390 px mobile screenshots");

console.log("errors:", errors.length ? errors : "none");
console.log("origins:", [...origins]);
assert.deepEqual(errors, []);
assert.deepEqual([...origins], [new URL(base).origin]);
await browser.close();
