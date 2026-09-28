// Milestone 7: Protect, Unlock, Redact (verifies downloads with pdf.js and pdf-lib, not just the UI).
// Run via `npm run e2e` (serves ./out); outputs land in e2e/.output/.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const mod = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { PDFDocument, PDFName, StandardFonts } = await mod("node_modules/@cantoo/pdf-lib/cjs/index.js");
const { getDocument } = await mod("node_modules/pdfjs-dist/legacy/build/pdf.mjs");

const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const step = (s) => console.log("✓", s);

/** Open with pdf.js like a reader: page texts, author, and print permission. */
async function readPdf(bytes, password) {
  const task = getDocument({ data: new Uint8Array(bytes), password, standardFontDataUrl: `${repo}/node_modules/pdfjs-dist/standard_fonts/` });
  try {
    const doc = await task.promise;
    const texts = [];
    for (let i = 1; i <= doc.numPages; i++) texts.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim());
    const permissions = await doc.getPermissions();
    return { texts, author: (await doc.getMetadata()).info.Author, canPrint: !permissions || Array.from(permissions).includes(4) };
  } finally {
    await task.destroy();
  }
}

// ---------------------------------------------------------------- Fixtures
mkdirSync("m7", { recursive: true });
{
  const doc = await PDFDocument.create();
  doc.setAuthor("Jane Doe");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText("Name: Jane Doe", { x: 72, y: 700, size: 14, font });
  p1.drawText("Email: jane@example.org", { x: 72, y: 680, size: 14, font });
  p1.drawText("Account 4411-2233-9087", { x: 72, y: 660, size: 14, font });
  const field = doc.getForm().createTextField("signer");
  field.setText("Jane Doe");
  field.addToPage(p1, { x: 72, y: 560, width: 200, height: 24 });
  doc.addPage([612, 792]).drawText("Jane Doe approved the plan.", { x: 72, y: 700, size: 14, font });
  doc.addPage([612, 792]).drawText("Public appendix", { x: 72, y: 700, size: 14, font });
  writeFileSync("m7/report.pdf", await doc.save());
}
for (const name of ["aes256.pdf", "owner-only.pdf"]) copyFileSync(`${repo}/src/lib/pdf/__tests__/encrypted/${name}`, `m7/${name}`);
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

// ---------------------------------------------------------------- Protect
await page.goto(base + "/tools/protect/", { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(["m7/report.pdf"]);
await page.locator("canvas:not(.invisible)").first().waitFor();
await page.getByRole("textbox", { name: "Password", exact: true }).fill("password");
await page.getByText("This is one of the most common passwords.").waitFor();
await page.getByRole("textbox", { name: "Confirm password" }).fill("passw");
await page.getByText("The passwords don't match.").waitFor();
assert.ok(await page.getByRole("button", { name: "Protect PDF" }).isDisabled());
await page.getByRole("button", { name: "Generate a strong password" }).click();
const password = await page.getByRole("textbox", { name: "Password", exact: true }).inputValue();
assert.match(password, /^[\w]{5}(-[\w]{5}){3}$/);
await page.getByText(/^Very strong/).waitFor();
await page.getByRole("checkbox", { name: "Allow printing" }).uncheck();
await page.getByRole("textbox", { name: "Permissions password (optional)" }).fill(password);
await page.getByText("Use a different password from the one that opens the file.").waitFor();
await page.getByRole("textbox", { name: "Permissions password (optional)" }).fill("owner-secret-99");
await page.getByRole("button", { name: "Protect PDF" }).click();
await page.getByText("Protected", { exact: true }).waitFor();
await page.screenshot({ path: "m7-01-protect.png" });
const locked = await download(() => page.getByRole("button", { name: "Download result" }).click());
assert.equal(locked.name, "report-protected.pdf");
await assert.rejects(readPdf(locked.bytes), { name: "PasswordException" });
const opened = await readPdf(locked.bytes, password);
assert.deepEqual(opened.texts.slice(1), ["Jane Doe approved the plan.", "Public appendix"]);
assert.equal(opened.canPrint, false);
assert.match(locked.bytes.toString("latin1"), /\/V 5/);
step("protect: strength + mismatch feedback, generated password, AES-256, printing blocked, opens only with the password");

// ---------------------------------------------------------------- Unlock (chained)
await page.getByRole("button", { name: "Open in a new tab" }).click();
await page.getByRole("tab", { name: /report-protected\.pdf/ }).waitFor();
await go("unlock");
await page.getByText("Password needed to open").waitFor();
await page.getByText("Encrypted with AES-256.").waitFor();
await page.getByRole("textbox", { name: "Password", exact: true }).fill("not it");
await page.getByRole("button", { name: "Unlock PDF" }).click();
await page.getByText("That password isn't right.").waitFor();
await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
await page.getByRole("button", { name: "Unlock PDF" }).click();
await page.getByText("Unlocked", { exact: true }).waitFor();
await page.locator("section[aria-label='Result preview'] canvas:not(.invisible)").first().waitFor();
await page.screenshot({ path: "m7-02-unlock.png" });
const unlocked = await download(() => page.getByRole("button", { name: "Download result" }).click());
assert.equal(unlocked.name, "report-protected-unlocked.pdf");
const reopened = await readPdf(unlocked.bytes);
assert.equal(reopened.author, "Jane Doe");
assert.equal(reopened.canPrint, true);
assert.equal(reopened.texts[2], "Public appendix");
await page.getByRole("button", { name: "Replace the file in this tab" }).click();
await page.getByText("This PDF isn't password-protected").waitFor();
step("unlock: wrong password explained inline; right one gives an unencrypted copy with metadata intact; tab replaced");

await page.locator('input[type="file"]').setInputFiles(["m7/owner-only.pdf"]);
await page.getByText("Restricted PDF").waitFor();
await page.getByText(/blocks printing/).waitFor();
await page.getByRole("button", { name: "Remove restrictions" }).click();
await page.getByText("Unlocked", { exact: true }).waitFor();
const freed = await download(() => page.getByRole("button", { name: "Download result" }).click());
assert.equal((await readPdf(freed.bytes)).canPrint, true);
step("unlock: restriction-only PDF is freed without a password");

// ---------------------------------------------------------------- Redact
await go("redact");
await page.getByRole("tab", { name: /^report\.pdf/ }).click();
await page.getByRole("group", { name: /Page 1: drag to draw/ }).waitFor();
await page.getByLabel("Find text to redact").fill("jane doe");
await page.getByRole("button", { name: "Mark all" }).click();
await page.getByText("Marked 3 matches on pages 1-2.").waitFor(); // two in the text, one in the form field

// Draw a box over the account number line (baseline 660 pt of 792 -> ~16.7% from the top).
const overlay = page.getByRole("group", { name: /Page 1: drag to draw/ });
await overlay.locator("xpath=..").locator("canvas:not(.invisible)").waitFor();
const box = await overlay.boundingBox();
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
await page.mouse.move(...at(0.1, 0.145));
await page.mouse.down();
await page.mouse.move(...at(0.55, 0.175), { steps: 8 });
await page.mouse.up();
await page.getByText(/4\s*boxes on pages 1-2/).waitFor();

// A stray box on page 3, removed again with the keyboard.
await page.getByRole("button", { name: /^Page 3/ }).first().click();
const overlay3 = page.getByRole("group", { name: /Page 3: drag to draw/ });
const box3 = await overlay3.boundingBox();
await page.mouse.move(box3.x + 100, box3.y + 300);
await page.mouse.down();
await page.mouse.move(box3.x + 250, box3.y + 360, { steps: 5 });
await page.mouse.up();
await page.getByText(/5\s*boxes on pages 1-3/).waitFor();
await page.getByRole("button", { name: /Redaction 1 on page 3/ }).click();
await page.keyboard.press("Delete");
await page.getByText(/4\s*boxes on pages 1-2/).waitFor();
await page.getByRole("button", { name: /^Page 1/ }).first().click();
await page.screenshot({ path: "m7-03-redact-marked.png" });
step("redact: search marks all 3 occurrences (text and form field); drawn box added; stray box removed with Delete");

await page.getByRole("button", { name: "Apply redactions" }).click();
await page.getByText("Verified: the 2 redacted pages contain no text.").waitFor();
await page.getByText("“jane doe” no longer appears anywhere in the file.").waitFor();
await page.screenshot({ path: "m7-04-redact-done.png" });
const redacted = await download(() => page.getByRole("button", { name: "Download result" }).click());
assert.equal(redacted.name, "report-redacted.pdf");
const check = await readPdf(redacted.bytes);
assert.deepEqual(check.texts, ["", "", "Public appendix"]);
assert.equal(check.author, undefined);
const flat = await PDFDocument.load(redacted.bytes);
assert.deepEqual(flat.getForm().getFields(), []);
for (const secret of ["Jane", "4411", "jane@example.org"]) assert.ok(!redacted.bytes.toString("latin1").includes(secret), `${secret} left in the file`);
// The form field showed "Jane Doe" too: its area must be black in the flattened page image.
const image = flat.getPage(0).node.Resources().lookup(PDFName.of("XObject")).lookup(PDFName.of("Im0")).contents;
const pixels = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/jpeg;base64,${b64}`;
  await img.decode();
  const canvas = Object.assign(document.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight });
  const g = canvas.getContext("2d");
  g.drawImage(img, 0, 0);
  const at = (fx, fy) => [...g.getImageData(Math.floor(fx * canvas.width), Math.floor(fy * canvas.height), 1, 1).data.slice(0, 3)];
  // Field: x 72..272 pt, y 560..584 pt of a 612 x 792 page (from the bottom).
  return { field: at(172 / 612, (792 - 572) / 792), background: at(0.8, 0.8) };
}, Buffer.from(image).toString("base64"));
assert.ok(pixels.field.every((v) => v < 40), `form field area not blacked out: ${pixels.field}`);
assert.ok(pixels.background.every((v) => v > 215), `page background not white: ${pixels.background}`);
step("redact: pages 1-2 flattened with no text, form field blacked out and removed, author removed, page 3 untouched");

// ---------------------------------------------------------------- Themes and mobile
const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const p2 = await dark.newPage();
await p2.goto(base + "/tools/redact/", { waitUntil: "networkidle" });
await p2.locator('input[type="file"]').setInputFiles(["m7/report.pdf"]);
await p2.getByLabel("Find text to redact").fill("Jane Doe");
await p2.getByRole("button", { name: "Mark all" }).click();
await p2.getByText(/Marked 3 matches/).waitFor();
await p2.getByRole("button", { name: /Redaction 1 on page 1/ }).click();
await p2.waitForTimeout(300);
await p2.screenshot({ path: "m7-05-redact-dark.png" });
await p2.goto(base + "/tools/unlock/", { waitUntil: "networkidle" });
await p2.locator('input[type="file"]').setInputFiles(["m7/aes256.pdf"]);
await p2.getByText("Password needed to open").waitFor();
await p2.screenshot({ path: "m7-06-unlock-dark.png" });

const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p3 = await mob.newPage();
const overflow = {};
for (const [tool, file, ready] of [["protect", "m7/report.pdf", "Protect PDF"], ["unlock", "m7/aes256.pdf", "Unlock PDF"], ["redact", "m7/report.pdf", "Apply redactions"]]) {
  await p3.goto(`${base}/tools/${tool}/`, { waitUntil: "networkidle" });
  await p3.locator('input[type="file"]').setInputFiles([file]);
  await p3.getByRole("button", { name: ready }).first().waitFor();
  await p3.waitForTimeout(400);
  await p3.screenshot({ path: `m7-07-${tool}-mobile.png`, fullPage: true });
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
