// Milestone 8: Watermark, Page numbers, E-Sign (verifies downloads with pdf.js, including positions).
// Run via `npm run e2e` (serves ./out); outputs land in e2e/.output/.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const mod = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { PDFDocument, StandardFonts, degrees } = await mod("node_modules/@cantoo/pdf-lib/cjs/index.js");
const { getDocument, OPS } = await mod("node_modules/pdfjs-dist/legacy/build/pdf.mjs");

const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const step = (s) => console.log("✓", s);

const multiply = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

/** Per page: displayed size, text items (position, angle) and painted image rectangles, as a reader sees them. */
async function inspect(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: `${repo}/node_modules/pdfjs-dist/standard_fonts/` });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const text = (await page.getTextContent()).items.filter((it) => it.str?.trim()).map((it) => {
      const [a, b, , , u, v] = multiply(viewport.transform, it.transform);
      return { str: it.str, u, v, width: it.width, angle: (Math.atan2(-b, a) * 180) / Math.PI };
    });
    const { fnArray, argsArray } = await page.getOperatorList();
    const stack = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const images = [];
    const textDraws = fnArray.filter((fn) => fn === OPS.showText).length;
    fnArray.forEach((fn, k) => {
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
      else if (fn === OPS.transform) ctm = multiply(ctm, argsArray[k]);
      else if (fn === OPS.paintImageXObject) {
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => viewport.convertToViewportPoint(ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]));
        const us = pts.map((p) => p[0]);
        const vs = pts.map((p) => p[1]);
        images.push({ x: Math.min(...us) / viewport.width, y: Math.min(...vs) / viewport.height, width: (Math.max(...us) - Math.min(...us)) / viewport.width, height: (Math.max(...vs) - Math.min(...vs)) / viewport.height });
      }
    });
    pages.push({ width: viewport.width, height: viewport.height, text, images, textDraws });
  }
  await task.destroy();
  return pages;
}

// ---------------------------------------------------------------- Fixtures
mkdirSync("m8", { recursive: true });
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Contract page ${i + 1}`, { x: 72, y: 700, size: 20, font });
    if (i === 1) page.setRotation(degrees(90));
  }
  writeFileSync("m8/contract.pdf", await doc.save());
}
step("fixtures written (page 2 is rotated 90°)");

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
const previewSettled = async () => {
  await page.getByRole("img", { name: "Preview of page 1" }).waitFor();
  await page.getByLabel("Updating preview").waitFor({ state: "detached" });
};

// ---------------------------------------------------------------- Watermark
await page.goto(base + "/tools/watermark/", { waitUntil: "networkidle" });
await page.locator('input[type="file"]').first().setInputFiles(["m8/contract.pdf"]);
await previewSettled();
const firstPreview = await page.getByRole("img", { name: "Preview of page 1" }).getAttribute("src");
await page.getByRole("textbox", { name: "Text" }).fill("DRAFT");
await page.getByRole("radio", { name: "Red" }).or(page.getByRole("button", { name: "Red" })).click();
await page.getByRole("checkbox", { name: "Repeat across the page" }).check();
await page.getByPlaceholder("All pages").fill("1-2");
await previewSettled();
assert.notEqual(await page.getByRole("img", { name: "Preview of page 1" }).getAttribute("src"), firstPreview, "preview updated");
await page.screenshot({ path: "m8-01-watermark.png" });
await page.getByRole("button", { name: "Add watermark" }).click();
await page.getByText("Watermark added").waitFor();
const marked = await download(() => page.getByRole("button", { name: "Download result" }).click());
assert.equal(marked.name, "contract-watermarked.pdf");
const wm = await inspect(marked.bytes);
for (const p of wm.slice(0, 2)) {
  // Every tile is one text-drawing operation (tiles clipped at the edges included); +1 for the page's own text.
  assert.ok(p.textDraws - 1 >= 6, `tiled: ${p.textDraws - 1} tiles`);
  const drafts = p.text.filter((t) => t.str.includes("DRAFT"));
  for (const d of drafts) assert.ok(Math.abs(d.angle - 45) < 1, `45° as displayed, got ${d.angle}`);
}
assert.equal(wm[2].text.some((t) => t.str.includes("DRAFT")), false);
step("watermark: live preview updates; tiled red DRAFT at 45° (also on the rotated page), page 3 untouched");

// ---------------------------------------------------------------- Page numbers
await go("page-numbers");
await previewSettled();
await page.getByRole("checkbox", { name: "Skip the first page (cover)" }).check();
await previewSettled();
await page.screenshot({ path: "m8-02-page-numbers.png" });
await page.getByRole("button", { name: "Add page numbers" }).click();
await page.getByText("Page numbers added").waitFor();
const numbered = await inspect((await download(() => page.getByRole("button", { name: "Download result" }).click())).bytes);
assert.equal(numbered[0].text.some((t) => t.str.startsWith("Page ")), false);
for (const [i, p] of numbered.slice(1).entries()) {
  const label = p.text.find((t) => t.str.startsWith("Page "));
  assert.equal(label.str, `Page ${i + 1} of 2`);
  assert.ok(Math.abs(label.angle) < 0.5, "upright");
  assert.ok(Math.abs(label.u + label.width / 2 - p.width / 2) < 2, "centred");
  assert.ok(label.v > p.height - 45 && label.v < p.height - 25, `near the bottom: ${label.v} of ${p.height}`);
}
step("page numbers: cover skipped; 'Page n of 2' upright at the bottom centre, including the rotated page");

// ---------------------------------------------------------------- E-Sign
await go("sign");
await page.getByRole("img", { name: /Signature pad/ }).waitFor();
// Quick strokes in one task make React run the stroke updater during render, after the pointer
// event is gone; 1.0.0 read the event there and crashed the page ("This page couldn't load").
await page.evaluate(() => {
  const pad = document.querySelector('canvas[aria-label^="Signature pad"]');
  const r = pad.getBoundingClientRect();
  const fire = (type, x, y) => pad.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: type === "pointermove" ? -1 : 0, buttons: 1, isPrimary: true, clientX: r.left + x, clientY: r.top + y }));
  for (let k = 0; k < 3; k++) {
    fire("pointerdown", 40 + k * 60, 60);
    fire("pointermove", 80 + k * 60, 80);
    fire("pointerup", 80 + k * 60, 80);
  }
});
await page.getByRole("button", { name: "Clear the pad" }).click();
step("sign: quick strokes don't crash the signature pad");
const pad =await page.getByRole("img", { name: /Signature pad/ }).boundingBox();
await page.mouse.move(pad.x + 40, pad.y + pad.height * 0.6);
await page.mouse.down();
for (let k = 0; k <= 24; k++) await page.mouse.move(pad.x + 40 + k * 9, pad.y + pad.height * (0.6 - 0.25 * Math.sin(k / 3)));
await page.mouse.up();
await page.getByRole("button", { name: "Save" }).click();
const placed = page.getByRole("button", { name: /^Signature/ });
await placed.waitFor();
await page.getByText(/1\s*placed on page 1/).waitFor();

// Move it by dragging, then enlarge it with its corner handle.
const stage = await page.getByRole("group", { name: "Page 1: placed signatures" }).boundingBox();
let box = await placed.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 - 250, box.y + box.height / 2 - 120, { steps: 10 });
await page.mouse.up();
box = await placed.boundingBox();
await page.mouse.move(box.x + box.width + 2, box.y + box.height + 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width + 60, box.y + box.height + 60, { steps: 6 });
await page.mouse.up();
box = await placed.boundingBox();
const expected = { x: (box.x - stage.x) / stage.width, y: (box.y - stage.y) / stage.height, width: box.width / stage.width, height: box.height / stage.height };
await page.getByRole("button", { name: "Add today's date" }).click();
await page.getByText(/2\s*placed on page 1/).waitFor();

// A typed signature, also placed on the rotated page 2.
await page.getByRole("button", { name: "Create another signature" }).click();
await page.getByRole("radio", { name: "Type" }).click();
await page.getByRole("textbox", { name: "Your name" }).fill("Jane Doe");
await page.getByRole("button", { name: "Save" }).click();
await page.getByText(/3\s*placed on page 1/).waitFor(); // a new signature is placed right away
await page.getByRole("button", { name: /^Page 2/ }).first().click();
await page.getByRole("button", { name: "Place signature 2 on page 2" }).click();
await page.getByText(/4\s*placed on pages 1-2/).waitFor();
await page.screenshot({ path: "m8-03-sign.png" });
await page.getByRole("button", { name: "Sign PDF" }).click();
await page.getByText("Signed", { exact: true }).waitFor();
const signed = await download(() => page.getByRole("button", { name: "Download result" }).click());
assert.equal(signed.name, "contract-signed.pdf");
const sg = await inspect(signed.bytes);
const [drawn] = sg[0].images;
for (const k of ["x", "y", "width", "height"]) assert.ok(Math.abs(drawn[k] - expected[k]) < 0.01, `signature ${k}: pdf ${drawn[k].toFixed(3)} vs screen ${expected[k].toFixed(3)}`);
// Formatted in the browser, as the app does (its locale can differ from Node's).
const today = await page.evaluate(() => new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }));
assert.ok(sg[0].text.some((t) => t.str === today && Math.abs(t.angle) < 0.5), "date stamped upright");
assert.equal(sg[1].images.length, 1);
assert.ok(sg[1].images[0].width > sg[1].images[0].height, "typed signature is wider than tall on the rotated page too");
assert.equal(sg[2].images.length, 0);
step("sign: drawn signature moved + resized lands exactly where shown; date stamped; typed signature on the rotated page");

// ---------------------------------------------------------------- Themes and mobile
const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const p2 = await dark.newPage();
await p2.goto(base + "/tools/sign/", { waitUntil: "networkidle" });
await p2.locator('input[type="file"]').first().setInputFiles(["m8/contract.pdf"]);
await p2.getByRole("radio", { name: "Type" }).click();
await p2.getByRole("textbox", { name: "Your name" }).fill("Jane Doe");
await p2.waitForTimeout(300);
await p2.screenshot({ path: "m8-04-sign-dark.png" });
await p2.goto(base + "/tools/watermark/", { waitUntil: "networkidle" });
await p2.locator('input[type="file"]').first().setInputFiles(["m8/contract.pdf"]);
await p2.getByRole("img", { name: "Preview of page 1" }).waitFor();
await p2.screenshot({ path: "m8-05-watermark-dark.png" });

const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p3 = await mob.newPage();
const overflow = {};
for (const [tool, ready] of [["watermark", "Add watermark"], ["page-numbers", "Add page numbers"], ["sign", "Sign PDF"]]) {
  await p3.goto(`${base}/tools/${tool}/`, { waitUntil: "networkidle" });
  await p3.locator('input[type="file"]').first().setInputFiles(["m8/contract.pdf"]);
  await p3.getByRole("button", { name: ready }).waitFor();
  await p3.waitForTimeout(600);
  await p3.screenshot({ path: `m8-06-${tool}-mobile.png`, fullPage: true });
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
