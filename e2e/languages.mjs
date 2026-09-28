// Milestone 19: interface languages. Picking a language, right-to-left Arabic, remembering the
// choice across reloads, following the browser's language, phone width without sideways scroll,
// translated toasts and titles. Run via `npm run e2e -- languages`.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const step = (s) => console.log("✓", s);
const arabic = /[؀-ۿ]/;
const browser = await chromium.launch();
const errors = [];
const origins = new Set();

async function open(options) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", locale: "en-US", ...options });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => origins.add(new URL(r.url()).origin));
  return { ctx, page };
}
const htmlAttrs = (page) => page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }));
const h1 = (page) => page.locator("h1").first().innerText();
const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= 390);
const pick = (page, code) => page.locator('select[aria-label]').first().selectOption(code);

// ---------------------------------------------------------------- English by default, then Arabic
const { ctx, page } = await open();
await page.goto(base + "/", { waitUntil: "networkidle" });
assert.deepEqual(await htmlAttrs(page), { lang: "en", dir: "ltr" });
assert.equal(await h1(page), "Your documents never leave this device.");
step("English by default for an English browser");

await pick(page, "ar");
await page.waitForFunction(() => document.documentElement.dir === "rtl");
assert.deepEqual(await htmlAttrs(page), { lang: "ar", dir: "rtl" });
assert.equal(await h1(page), "مستنداتك لا تغادر هذا الجهاز أبدًا.");
assert.equal(await page.evaluate(() => localStorage.getItem("docsanitize:language")), "ar");
// The sidebar sits on the right in right-to-left.
const nav = await page.locator("aside").first().boundingBox();
assert.ok(nav && nav.x > 1100 && nav.x + nav.width <= 1440, `sidebar should be fully visible on the right, x=${nav?.x}`);
await page.screenshot({ path: "m19-01-home-ar.png" });
step("Arabic: right-to-left, translated, sidebar on the right, choice saved");

await page.reload({ waitUntil: "networkidle" });
assert.deepEqual(await htmlAttrs(page), { lang: "ar", dir: "rtl" });
assert.ok(arabic.test(await h1(page)));
step("the choice survives a reload");

// A tool page: heading, tab title, and a toast built from a template.
await page.goto(base + "/tools/merge/", { waitUntil: "networkidle" });
assert.equal(await h1(page), "دمج ملفات PDF");
assert.ok(arabic.test(await page.title()), `title: ${await page.title()}`);
mkdirSync("fixtures", { recursive: true });
writeFileSync("fixtures/notes.docx", "PK");
await page.locator('input[type="file"]').setInputFiles(["fixtures/notes.docx"]);
await page.getByText("لا يمكن فتح «notes.docx» هنا").waitFor();
await page.screenshot({ path: "m19-02-merge-ar.png" });
step("tool page, tab title and toast are translated");

// Back to English.
await pick(page, "en");
await page.waitForFunction(() => document.documentElement.dir === "ltr");
assert.equal(await h1(page), "Merge PDF");
await ctx.close();
step("switching back to English restores left-to-right");

// ---------------------------------------------------------------- Following the browser
const de = await open({ locale: "de-DE" });
await de.page.goto(base + "/", { waitUntil: "networkidle" });
assert.deepEqual(await htmlAttrs(de.page), { lang: "de", dir: "ltr" });
assert.equal(await h1(de.page), "Ihre Dokumente verlassen dieses Gerät nie.");
await de.page.goto(base + "/tools/organize/", { waitUntil: "networkidle" });
assert.equal(await de.page.evaluate(() => localStorage.getItem("docsanitize:language")), null);
await de.page.screenshot({ path: "m19-03-organize-de.png" });
await de.ctx.close();
step("a German browser gets German without anything being saved");

const fr = await open({ locale: "fr-FR" });
await fr.page.goto(base + "/tools/sanitize/", { waitUntil: "networkidle" });
await fr.page.getByText("Déposez un fichier ici ou").first().waitFor();
await fr.ctx.close();
const es = await open({ locale: "es-MX" });
await es.page.goto(base + "/tools/sanitize/", { waitUntil: "networkidle" });
await es.page.getByText("Suelta un archivo aquí o").first().waitFor();
await es.ctx.close();
step("French and Spanish browsers get their language");

// ---------------------------------------------------------------- Phone width
// Measured against the fixed 390px: a phone browser widens innerWidth to fit overflowing content.
const PHONE_PATHS = ["/", "/tools/sanitize/", "/tools/batch/", "/tools/digital-signature/", "/tools/redact/"];
for (const locale of ["en-US", "de-DE", "es-ES", "fr-FR"]) {
  const phone = await open({ viewport: { width: 390, height: 844 }, locale, isMobile: true, hasTouch: true });
  for (const path of PHONE_PATHS) {
    await phone.page.goto(base + path, { waitUntil: "networkidle" });
    assert.equal(await noSidewaysScroll(phone.page), true, `${path} scrolls sideways at 390px (${locale})`);
  }
  await phone.ctx.close();
}
for (const colorScheme of ["light", "dark"]) {
  const phone = await open({ viewport: { width: 390, height: 844 }, colorScheme, locale: "ar-EG", isMobile: true, hasTouch: true });
  for (const path of PHONE_PATHS) {
    await phone.page.goto(base + path, { waitUntil: "networkidle" });
    assert.equal((await htmlAttrs(phone.page)).dir, "rtl");
    assert.equal(await noSidewaysScroll(phone.page), true, `${path} scrolls sideways at 390px (ar, ${colorScheme})`);
  }
  await phone.page.goto(base + "/", { waitUntil: "networkidle" });
  await phone.page.screenshot({ path: `m19-04-phone-ar-${colorScheme}.png` });
  await phone.page.goto(base + "/tools/sanitize/", { waitUntil: "networkidle" });
  await phone.page.screenshot({ path: `m19-05-phone-sanitize-ar-${colorScheme}.png` });
  await phone.page.getByRole("button", { name: "فتح قائمة الأدوات" }).click();
  await phone.page.waitForTimeout(400);
  const drawer = await phone.page.locator("aside").boundingBox();
  assert.ok(drawer && Math.round(drawer.x + drawer.width) === 390, `drawer should open from the right, x=${drawer?.x}`);
  await phone.page.screenshot({ path: `m19-06-phone-menu-ar-${colorScheme}.png` });
  await phone.ctx.close();
}
step("every language fits 390px without sideways scroll; Arabic in light and dark, menu from the right");

await browser.close();
assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
assert.deepEqual([...origins], [new URL(base).origin], `requests left the site: ${[...origins].join(", ")}`);
step("no console errors; every request stayed on this site");
