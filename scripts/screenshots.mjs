// Regenerates the README screenshots in docs/screenshots/ from the built site.
//   npm run build && node scripts/screenshots.mjs
// Needs the Chromium used by the e2e tests (`npx playwright-core install chromium`).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mod = (path) => import(pathToFileURL(join(root, path)).href);
const { PDFDocument, StandardFonts, rgb } = await mod("node_modules/@cantoo/pdf-lib/cjs/index.js");
const fx = await mod("src/lib/metadata/__tests__/fixtures.ts");

const OUT = join(root, "docs", "screenshots");
const TMP = join(root, "e2e", ".output", "screenshots");
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const port = "3124";
const base = `http://localhost:${port}`;
const require = createRequire(import.meta.url);
const serveBin = join(dirname(require.resolve("serve/package.json")), "build", "main.js");
const server = spawn(process.execPath, [serveBin, join(root, "out"), "-l", port, "--no-clipboard"], { stdio: "ignore" });
for (let i = 0; ; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    // not up yet
  }
  if (i > 50) throw new Error("The static server didn't start. Run `npm run build` first.");
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch();

// ---------------------------------------------------------------- Sample files
const gen = await browser.newPage();
const photo = await gen.evaluate(async () => {
  const c = new OffscreenCanvas(1200, 800);
  const g = c.getContext("2d");
  const sky = g.createLinearGradient(0, 0, 0, 800);
  sky.addColorStop(0, "#f6b26b");
  sky.addColorStop(0.55, "#f9d9a8");
  sky.addColorStop(1, "#8fb3d9");
  g.fillStyle = sky;
  g.fillRect(0, 0, 1200, 800);
  g.fillStyle = "#fff4d6";
  g.beginPath();
  g.arc(820, 330, 90, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#3b5b86";
  g.beginPath();
  g.moveTo(0, 620);
  g.bezierCurveTo(300, 480, 520, 700, 820, 560);
  g.bezierCurveTo(1000, 480, 1120, 560, 1200, 540);
  g.lineTo(1200, 800);
  g.lineTo(0, 800);
  g.fill();
  g.fillStyle = "#263a81";
  g.fillRect(0, 700, 1200, 100);
  const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
});
const exif = { artist: "Jane Doe", make: "Apple", model: "iPhone 17 Pro", serial: "F2LXK9", gps: { lat: 25.197197, lon: 55.274376 } };
const jpeg = fx.addJpegMetadata(new Uint8Array(photo), { exif, xmp: fx.SAMPLE_XMP, comment: "Edited on Jane's MacBook" });

async function reportPdf(pages) {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const colors = [rgb(0.15, 0.23, 0.51), rgb(0.06, 0.73, 0.51), rgb(0.96, 0.62, 0.04), rgb(0.55, 0.36, 0.96)];
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawRectangle({ x: 0, y: 742, width: 595, height: 100, color: colors[i % colors.length] });
    page.drawText(i === 0 ? "Services Agreement" : `Section ${i}`, { x: 56, y: 780, size: 28, font: bold, color: rgb(1, 1, 1) });
    for (let l = 0; l < 26; l++) {
      const width = 380 + ((l * 37 + i * 11) % 100);
      page.drawRectangle({ x: 56, y: 690 - l * 22, width, height: 7, color: rgb(0.8, 0.8, 0.82) });
    }
    page.drawRectangle({ x: 56, y: 90, width: 220, height: 120, color: colors[(i + 1) % colors.length], opacity: 0.25 });
    page.drawText(`${i + 1}`, { x: 290, y: 40, size: 11, font: regular, color: rgb(0.4, 0.4, 0.4) });
  }
  return doc.save();
}
writeFileSync(join(TMP, "IMG_2041.jpg"), jpeg);
writeFileSync(join(TMP, "agreement.pdf"), await reportPdf(3));
writeFileSync(join(TMP, "handbook.pdf"), await reportPdf(10));
const file = (name) => join(TMP, name);

// PNG screenshot -> WebP, encoded by the browser.
async function save(png, name) {
  const webp = await gen.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    c.getContext("2d").drawImage(bitmap, 0, 0);
    const blob = await c.convertToBlob({ type: "image/webp", quality: 0.86 });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, Array.from(png));
  writeFileSync(join(OUT, name), new Uint8Array(webp));
  console.log(`screenshots: ${name} (${Math.round(webp.length / 1024)} KB)`);
}

async function open(colorScheme, viewport = { width: 1440, height: 900 }, extra = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme, deviceScaleFactor: 1, ...extra });
  return ctx.newPage();
}

// ---------------------------------------------------------------- Scenes
// 1. Sanitize: a photo that gives away where it was taken.
{
  const page = await open("light");
  await page.goto(`${base}/tools/sanitize/`, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').setInputFiles([file("IMG_2041.jpg")]);
  await page.getByText("This file reveals a location:").waitFor();
  await page.waitForTimeout(500);
  await save(await page.screenshot(), "sanitize-light.webp");
  await page.context().close();
}

// 2. Home page.
{
  const page = await open("light");
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await save(await page.screenshot(), "home-light.webp");
  await page.context().close();
}

// 3. Organize: a ten-page document in the dark theme.
{
  const page = await open("dark");
  await page.goto(`${base}/tools/organize/`, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').setInputFiles([file("handbook.pdf")]);
  await page.locator("canvas:not(.invisible)").nth(7).waitFor();
  await page.waitForTimeout(500);
  await save(await page.screenshot(), "organize-dark.webp");
  await page.context().close();
}

// 4. Watermark with its live preview.
{
  const page = await open("light");
  await page.goto(`${base}/tools/watermark/`, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').first().setInputFiles([file("agreement.pdf")]);
  await page.getByRole("img", { name: "Preview of page 1" }).waitFor();
  await page.getByRole("textbox", { name: "Text" }).fill("CONFIDENTIAL");
  await page.getByRole("checkbox", { name: "Repeat across the page" }).check();
  await page.waitForTimeout(400);
  await page.getByLabel("Updating preview").waitFor({ state: "detached" });
  await save(await page.screenshot(), "watermark-light.webp");
  await page.context().close();
}

// 5. E-Sign: a typed signature placed on the page, dark theme.
{
  const page = await open("dark");
  await page.goto(`${base}/tools/sign/`, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').first().setInputFiles([file("agreement.pdf")]);
  await page.getByRole("radio", { name: "Type" }).click();
  await page.getByRole("textbox", { name: "Your name" }).fill("Jane Doe");
  await page.getByRole("button", { name: "Save signature", exact: true }).click();
  // A new signature lands near the foot of the page.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(500);
  await save(await page.screenshot(), "sign-dark.webp");
  await page.context().close();
}

// 6. Phone: home and sanitize side by side.
{
  const shots = [];
  for (const [path, action] of [
    ["/", null],
    ["/tools/sanitize/", async (page) => {
      await page.locator('input[type="file"]').setInputFiles([file("IMG_2041.jpg")]);
      await page.getByText("This file reveals a location:").waitFor();
    }],
  ]) {
    const page = await open("light", { width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.goto(base + path, { waitUntil: "networkidle" });
    if (action) await action(page);
    await page.waitForTimeout(400);
    shots.push(Array.from(await page.screenshot()));
    await page.context().close();
  }
  const png = await gen.evaluate(async (shots) => {
    const bitmaps = await Promise.all(shots.map((s) => createImageBitmap(new Blob([new Uint8Array(s)], { type: "image/png" }))));
    const gap = 80;
    const w = bitmaps[0].width;
    const h = bitmaps[0].height;
    const c = new OffscreenCanvas(w * 2 + gap * 3, h + gap * 2);
    const g = c.getContext("2d");
    bitmaps.forEach((b, i) => {
      const x = gap + i * (w + gap);
      g.save();
      g.shadowColor = "rgba(0,0,0,0.18)";
      g.shadowBlur = 40;
      g.shadowOffsetY = 12;
      g.beginPath();
      g.roundRect(x, gap, w, h, 48);
      g.fillStyle = "#fff";
      g.fill();
      g.restore();
      g.save();
      g.beginPath();
      g.roundRect(x, gap, w, h, 48);
      g.clip();
      g.drawImage(b, x, gap);
      g.restore();
    });
    const blob = await c.convertToBlob({ type: "image/png" });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, shots);
  await save(new Uint8Array(png), "phone.webp");
}

await browser.close();
server.kill();
