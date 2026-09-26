// Milestone 2: multi-tab workspace, dropzone, drag & drop, paste, tab keyboard/reorder, unload warning.
// Run via `npm run e2e` (serves ./out); outputs land in e2e/.output/.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await ctx.newPage();
const errors = [];
const origins = new Set();
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => origins.add(new URL(r.url()).origin));

const tabs = () => page.locator('[role="tab"]');
const tabNames = () => tabs().allInnerTexts();
const activeName = () => page.locator('[role="tab"][aria-selected="true"]').innerText();
const toastTexts = () => page.locator('[aria-live="polite"] [role="status"], [aria-live="polite"] [role="alert"]').allInnerTexts();
const step = (s) => console.log("✓", s);

await page.goto(base + "/tools/sanitize/", { waitUntil: "networkidle" });
await page.getByText("Drop a file here or").waitFor();
await page.screenshot({ path: "m2-01-empty.png" });
step("empty dropzone shown");

// A real 640x400 PNG, drawn in the page.
const pngB64 = await page.evaluate(async () => {
  const c = new OffscreenCanvas(640, 400);
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 640, 400);
  grad.addColorStop(0, "#263a81"); grad.addColorStop(1, "#10b981");
  g.fillStyle = grad; g.fillRect(0, 0, 640, 400);
  g.fillStyle = "#fff"; g.font = "bold 48px sans-serif"; g.fillText("vacation.png", 150, 215);
  const blob = await c.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
});
// Real files on disk so lastModified is stable (in-memory payloads get a fresh timestamp each time).
const { mkdirSync, writeFileSync } = await import("node:fs");
mkdirSync("fixtures", { recursive: true });
writeFileSync("fixtures/contract-final.pdf", "%PDF-1.4 %%EOF");
writeFileSync("fixtures/vacation.png", Buffer.from(pngB64, "base64"));
writeFileSync("fixtures/notes.docx", "PK");
writeFileSync("fixtures/third.pdf", "%PDF");
writeFileSync("fixtures/a-really-long-file-name-that-should-truncate-nicely-in-the-tab.pdf", "%PDF");
const pdf = "fixtures/contract-final.pdf";
const png = "fixtures/vacation.png";
const docx = "fixtures/notes.docx";

// 1. Browse: two accepted + one rejected
await page.locator('input[type="file"]').setInputFiles([pdf, png, docx]);
await tabs().first().waitFor();
assert.deepEqual(await tabNames(), ["contract-final.pdf", "vacation.png"]);
assert.equal(await activeName(), "contract-final.pdf");
assert.ok((await toastTexts()).some((t) => t.includes("notes.docx") && t.includes("can’t be opened here")));
await page.screenshot({ path: "m2-02-tabs-pdf.png" });
step("browse opens accepted files as tabs, rejects .docx with a toast");

// 2. Duplicate is skipped and focused
await page.getByRole("button", { name: "Dismiss notification" }).first().click();
await page.getByRole("tab", { name: /vacation/ }).click();
await page.locator('input[type="file"]').setInputFiles([pdf]);
await page.waitForTimeout(100);
assert.equal((await tabNames()).length, 2);
assert.equal(await activeName(), "contract-final.pdf");
assert.ok((await toastTexts()).some((t) => t.includes("1 file already open")));
step("duplicate skipped, existing tab focused, info toast");

// 3. Image preview
await page.getByRole("tab", { name: /vacation/ }).click();
await page.getByText("640 × 400 px").waitFor();
await page.screenshot({ path: "m2-03-image-preview.png" });
step("image preview renders with dimensions");

// 4. Keyboard navigation
await page.getByRole("tab", { name: /vacation/ }).focus();
await page.keyboard.press("ArrowRight"); // wraps to first
assert.equal(await activeName(), "contract-final.pdf");
await page.keyboard.press("End");
assert.equal(await activeName(), "vacation.png");
step("arrow/Home/End keyboard navigation");

// 5. Window-wide drag & drop with overlay
const dt = await page.evaluateHandle(() => {
  const d = new DataTransfer();
  d.items.add(new File(["%PDF-1.7\n%%EOF"], "invoice-2026.pdf", { type: "application/pdf" }));
  return d;
});
await page.dispatchEvent("main", "dragenter", { dataTransfer: dt });
await page.getByText("Drop to open in Sanitize Metadata").waitFor();
await page.screenshot({ path: "m2-04-drop-overlay.png" });
await page.dispatchEvent("main", "drop", { dataTransfer: dt });
await page.getByRole("tab", { name: /invoice-2026/ }).waitFor();
assert.equal(await page.getByText("Drop to open in Sanitize Metadata").count(), 0);
assert.equal(await activeName(), "invoice-2026.pdf");
step("window drop shows overlay, opens file, overlay clears");

// 6. Paste
await page.evaluate(() => {
  const d = new DataTransfer();
  d.items.add(new File(["x"], "pasted.webp", { type: "image/webp" }));
  window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true }));
});
await page.getByRole("tab", { name: /pasted\.webp/ }).waitFor();
step("paste opens file");

// 7. Reorder by dragging tab
const before = await tabNames();
await page.getByRole("tab", { name: /pasted\.webp/ }).dragTo(page.getByRole("tab", { name: /contract-final/ }));
const after = await tabNames();
assert.equal(after[0], "pasted.webp", `reorder failed: ${after}`);
console.log("   order:", before.join(" | "), "→", after.join(" | "));
step("drag to reorder tabs");

// 8. Switch tool (client-side nav): tabs persist, image shows incompatible notice
await page.locator('aside a[href="/tools/merge/"]').click();
await page.waitForURL("**/tools/merge/");
assert.equal((await tabNames()).length, 4);
await page.getByRole("tab", { name: /vacation/ }).click();
await page.getByText("Merge PDF can't open Image files.").waitFor();
await page.screenshot({ path: "m2-05-incompatible.png" });
step("tabs persist across tools; incompatible notice with alternatives");

// 9. Unload warning while files are open
let dialogType = null;
page.once("dialog", async (d) => { dialogType = d.type(); await d.dismiss(); });
await page.close({ runBeforeUnload: true });
await new Promise((r) => setTimeout(r, 500));
assert.equal(dialogType, "beforeunload");
step("beforeunload warning when files are open");

// 10. Close via Delete and Close all (fresh page)
const p2 = await ctx.newPage();
p2.on("pageerror", (e) => errors.push(e.message));
await p2.goto(base + "/tools/sanitize/", { waitUntil: "networkidle" });
await p2.locator('input[type="file"]').setInputFiles([pdf, png]);
await p2.getByRole("tab", { name: /contract/ }).focus();
await p2.keyboard.press("Delete");
assert.deepEqual(await p2.locator('[role="tab"]').allInnerTexts(), ["vacation.png"]);
assert.equal(await p2.evaluate(() => document.activeElement?.textContent), "vacation.png");
await p2.locator('input[type="file"]').setInputFiles([pdf]);
await p2.getByRole("button", { name: "Close all" }).click();
await p2.getByText("Drop a file here or").waitFor();
step("Delete key closes tab & moves focus; Close all returns to dropzone");

// 11. Dark + mobile screenshots
const dark = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const p3 = await dark.newPage();
await p3.goto(base + "/tools/sanitize/", { waitUntil: "networkidle" });
await p3.locator('input[type="file"]').setInputFiles([pdf, png, "fixtures/a-really-long-file-name-that-should-truncate-nicely-in-the-tab.pdf"]);
await p3.getByRole("tab", { name: /vacation/ }).click();
await p3.getByText("640 × 400 px").waitFor();
await p3.screenshot({ path: "m2-06-dark.png" });
const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
const p4 = await mob.newPage();
await p4.goto(base + "/tools/sanitize/", { waitUntil: "networkidle" });
await p4.screenshot({ path: "m2-07-mobile-empty.png" });
await p4.locator('input[type="file"]').setInputFiles([pdf, png, "fixtures/third.pdf"]);
await p4.screenshot({ path: "m2-08-mobile-tabs.png", fullPage: true });
console.log("   mobile overflow px:", await p4.evaluate(() => document.documentElement.scrollWidth - innerWidth));

console.log("errors:", errors.length ? errors : "none");
console.log("origins:", [...origins]);
await browser.close();
