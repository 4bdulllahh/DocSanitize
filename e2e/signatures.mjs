// Milestone 17: Digital Signature (certificates: create, open, sign, certify) and Verify Signatures.
// Certificate files and a pyHanko-signed PDF come from src/lib/sign/__tests__/fixtures. Run via `npm run e2e`.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const mod = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { PDFDocument, StandardFonts } = await mod("node_modules/@cantoo/pdf-lib/cjs/index.js");
const { getDocument } = await mod("node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const forge = (await mod("node_modules/node-forge/lib/index.js")).default;

const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const step = (s) => console.log("✓", s);
const fixtures = `${repo}/src/lib/sign/__tests__/fixtures`;

// ---------------------------------------------------------------- Fixtures
mkdirSync("m17", { recursive: true });
{
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) doc.addPage([612, 792]).drawText(`Service agreement, page ${i}`, { x: 72, y: 700, size: 18, font });
  writeFileSync("m17/agreement.pdf", await doc.save());
}
for (const name of ["legacy-3des.p12", "pyhanko-rsa.pdf"]) copyFileSync(`${fixtures}/${name}`, `m17/${name}`);
const agreement = readFileSync("m17/agreement.pdf");
step("fixtures: a 2-page agreement, a legacy (3DES) .p12 with a CA chain, a PDF signed by pyHanko");

const text = (bytes) => Buffer.from(bytes).toString("latin1");

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
const main = (p = page) => p.locator("main");
const open = async (tool, files, p = page) => {
  await p.goto(`${base}/tools/${tool}/`, { waitUntil: "networkidle" });
  await main(p).locator('input[type="file"]').first().setInputFiles(files);
};
async function download(name = "Download result", p = page) {
  const [d] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name, exact: true }).click()]);
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}

// ---------------------------------------------------------------- Create a certificate and sign
await open("digital-signature", ["m17/agreement.pdf"]);
const signButton = page.getByRole("button", { name: "Open a certificate first" });
await signButton.waitFor();
assert.ok(await signButton.isDisabled());
await page.getByRole("button", { name: "Don't have one? Create a certificate" }).click();
await main().getByRole("textbox", { name: "Your name" }).fill("Jane Doe");
await main().getByRole("textbox", { name: "Email (optional)" }).fill("jane@example.com");
await main().getByLabel("Password", { exact: true }).fill("s3cret-pw");
await main().getByLabel("Repeat password").fill("s3cret-pw");
await page.getByRole("button", { name: "Create", exact: true }).click();
const certCard = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your certificate" }) });
await page.getByText("Itself (self-signed)").waitFor({ timeout: 60_000 });
assert.match(await certCard.innerText(), /Jane Doe[\s\S]*jane@example\.com[\s\S]*RSA 2048-bit/);
const p12 = await download("Download Jane-Doe.p12");
assert.equal(p12.name, "Jane-Doe.p12");
const parsed = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(p12.bytes.toString("binary")), false, "s3cret-pw");
const certBag = parsed.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag][0];
assert.equal(certBag.cert.subject.getField("CN").value, "Jane Doe");
assert.equal(parsed.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag].length, 1);
writeFileSync("m17/jane.p12", p12.bytes);
step("a certificate is created on the device, shown as self-signed, and downloads as a standard .p12");

await main().getByRole("combobox", { name: "Reason (optional)" }).fill("I approve this document");
await main().getByRole("textbox", { name: "Location (optional)" }).fill("London");
await page.getByLabel("Signature box").waitFor();
await page.getByText("Page 2 of 2").waitFor();
await page.screenshot({ path: "m17-01-sign.png", fullPage: true });
await page.getByRole("button", { name: "Sign PDF" }).click();
await page.getByText("Signed PDF ready").waitFor({ timeout: 60_000 });
await page.getByText("Checked: the signature is valid and covers the whole document.").waitFor({ timeout: 60_000 });
const signed = await download();
assert.equal(signed.name, "agreement-signed.pdf");
assert.deepEqual(signed.bytes.subarray(0, agreement.length), agreement, "the original bytes are untouched");
const tail = text(signed.bytes.subarray(agreement.length));
assert.match(tail, /\/SubFilter \/ETSI\.CAdES\.detached/);
assert.doesNotMatch(tail, /Producer|ModDate|Creator/);
{
  const task = getDocument({ data: new Uint8Array(signed.bytes), standardFontDataUrl: `${repo}/node_modules/pdfjs-dist/standard_fonts/` });
  const pdf = await task.promise;
  const annots = await (await pdf.getPage(2)).getAnnotations();
  assert.ok(annots.some((a) => a.fieldType === "Sig" && a.rect[2] - a.rect[0] === 220), "a visible signature field on page 2");
  await task.destroy();
}
writeFileSync("m17/signed.pdf", signed.bytes);
step("signed with a visible box on page 2: an incremental update, checked by reading it back; pdf.js sees the signature field");

// ---------------------------------------------------------------- Verify it
await open("verify-signatures", ["m17/signed.pdf"]);
await page.getByText("Signed, and unchanged since").waitFor({ timeout: 60_000 });
const card = page.getByRole("region", { name: "Signed by Jane Doe" });
const cardText = await card.innerText();
for (const t of ["The signed content hasn't changed", "I approve this document", "London", "On page 2", "self-signed"]) assert.ok(cardText.includes(t), `${t} in ${cardText}`);
await card.getByText("Certificate", { exact: true }).click();
await card.getByText("Itself (self-signed)").waitFor();
await page.screenshot({ path: "m17-02-verify.png", fullPage: true });
step("Verify Signatures: valid, unchanged, signer, reason, place and page shown; self-signed flagged");

// ---------------------------------------------------------------- Countersign with an opened .p12 (legacy 3DES, CA chain)
await open("digital-signature", ["m17/signed.pdf"]);
await page.getByText("This PDF already has 1 digital signature").waitFor({ timeout: 60_000 });
assert.ok(await page.getByRole("radio", { name: "Certify" }).isDisabled(), "only the first signature can certify");
await main().locator('input[type="file"][accept*=".p12"]').setInputFiles("m17/legacy-3des.p12");
await main().getByLabel("Password", { exact: true }).fill("wrong");
await page.getByRole("button", { name: "Open certificate" }).click();
await page.getByText("That password doesn't open this certificate file.").waitFor();
await main().locator("input[type=password]").fill("fixture");
await page.getByRole("button", { name: "Open certificate" }).click();
await page.getByText("Max Mustermann").waitFor({ timeout: 30_000 });
assert.match(await page.locator("main").innerText(), /Issued by\s+Fixture Root CA/);
await page.getByRole("radio", { name: "Invisible" }).click();
await page.getByRole("button", { name: "Sign PDF" }).click();
await page.getByText("Checked: the signature is valid and covers the whole document.").waitFor({ timeout: 60_000 });
const twice = await download();
assert.deepEqual(twice.bytes.subarray(0, signed.bytes.length), signed.bytes, "the first signature's bytes are untouched");
writeFileSync("m17/twice.pdf", twice.bytes);
await open("verify-signatures", ["m17/twice.pdf"]);
await page.getByText("2 signatures, all valid").waitFor({ timeout: 60_000 });
assert.match(await page.getByRole("region", { name: "Signed by Jane Doe" }).innerText(), /a later signature covers it/);
assert.match(await page.getByRole("region", { name: "Signed by Max Mustermann" }).innerText(), /Invisible/);
step("countersigned with a legacy .p12 (wrong password refused, CA shown); both signatures valid");

// ---------------------------------------------------------------- Other signers, tampering, changes after signing
await open("verify-signatures", ["m17/pyhanko-rsa.pdf"]);
await page.getByText("Signed, and unchanged since").waitFor({ timeout: 60_000 });
assert.match(await page.getByRole("region", { name: "Signed by Max Mustermann" }).innerText(), /Genehmigt[\s\S]*Berlin/);

const tampered = Buffer.from(signed.bytes);
tampered[11] ^= 1;
writeFileSync("m17/tampered.pdf", tampered);
await open("verify-signatures", ["m17/tampered.pdf"]);
await page.getByText("The signature isn't valid").waitFor({ timeout: 60_000 });
assert.match(await page.getByRole("region", { name: "Signed by Jane Doe" }).innerText(), /changed after it was signed/);

writeFileSync("m17/appended.pdf", Buffer.concat([signed.bytes, Buffer.from("\n% added later\n")]));
await open("verify-signatures", ["m17/appended.pdf"]);
await page.getByText("Signed, but changed since").waitFor({ timeout: 60_000 });
const asSigned = await download("Download the version this signature covers");
assert.deepEqual(asSigned.bytes, signed.bytes, "the version that was signed, byte for byte");
step("a pyHanko signature verifies; a flipped byte breaks the signature; additions after signing are flagged and the signed version recovered");

// ---------------------------------------------------------------- Certify
await open("digital-signature", ["m17/agreement.pdf"]);
await main().locator('input[type="file"][accept*=".p12"]').setInputFiles("m17/jane.p12");
await main().getByLabel("Password", { exact: true }).fill("s3cret-pw");
await page.getByRole("button", { name: "Open certificate" }).click();
await page.getByText("Itself (self-signed)").waitFor({ timeout: 30_000 });
await page.getByRole("radio", { name: "Certify" }).click();
await page.getByLabel("Allowed after certifying").selectOption("1");
await page.getByRole("button", { name: "Certify PDF" }).click();
await page.getByText("Checked: the signature is valid and covers the whole document.").waitFor({ timeout: 60_000 });
writeFileSync("m17/certified.pdf", (await download()).bytes);
await open("verify-signatures", ["m17/certified.pdf"]);
await page.getByText("Signed, and unchanged since").waitFor({ timeout: 60_000 });
assert.match(await page.getByRole("region", { name: "Certified by Jane Doe" }).innerText(), /no changes are allowed/);
await open("digital-signature", ["m17/certified.pdf"]);
await main().locator('input[type="file"][accept*=".p12"]').setInputFiles("m17/jane.p12");
await main().getByLabel("Password", { exact: true }).fill("s3cret-pw");
await page.getByRole("button", { name: "Open certificate" }).click();
await page.getByRole("button", { name: "Sign PDF" }).click();
await page.getByText(/certified with no changes allowed/).first().waitFor({ timeout: 30_000 });
step("certify (no changes allowed): verified as a certification, and further signing is refused");

// ---------------------------------------------------------------- Dark and mobile
const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const dp = await dark.newPage();
watch(dp);
await open("verify-signatures", ["m17/twice.pdf"], dp);
await dp.getByText("2 signatures, all valid").waitFor({ timeout: 60_000 });
await dp.screenshot({ path: "m17-03-verify-dark.png", fullPage: true });

const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const mp = await mob.newPage();
watch(mp);
const overflow = {};
for (const [tool, input, ready] of [
  ["digital-signature", ["m17/agreement.pdf"], "Open a certificate first"],
  ["verify-signatures", ["m17/twice.pdf"], null],
]) {
  await open(tool, input, mp);
  if (ready) await mp.getByRole("button", { name: ready }).waitFor();
  else await mp.getByText("2 signatures, all valid").waitFor({ timeout: 60_000 });
  await mp.waitForTimeout(500);
  await mp.screenshot({ path: `m17-04-${tool}-mobile.png`, fullPage: true });
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
