import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, StandardFonts } from "@cantoo/pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { createCertificateFile } from "../certificate";
import { parseSignedData } from "../cms";
import { parseDer, toHex } from "../der";
import { signPdf } from "../pdf-sign";
import { verifyPdfSignatures } from "../pdf-verify";
import { readCertificateFile } from "../pkcs12";

const fontDir = new URL("../../../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url);
const fonts = { regular: readFileSync(new URL("LiberationSans-Regular.ttf", fontDir)), bold: readFileSync(new URL("LiberationSans-Bold.ttf", fontDir)) };
const NOW = new Date("2026-09-28T18:15:03Z");
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));

async function samplePdf(pages = 2, rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Contract page ${i + 1}`, { x: 72, y: 700, size: 18, font });
    if (rotate) page.setRotation({ type: "degrees", angle: rotate } as never);
  }
  return doc.save();
}

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

let p12: Uint8Array;
beforeAll(async () => {
  p12 = await createCertificateFile({ name: "Jane Doe", email: "jane@example.com", organization: "Doe & Co", country: "gb", years: 2, password: "s3cret" });
});

describe("certificates", () => {
  it("creates a self-signed certificate in a password-locked .p12", () => {
    const file = readCertificateFile(p12, "s3cret");
    expect(file.certificate.subject).toMatchObject({ CN: "Jane Doe", E: "jane@example.com", O: "Doe & Co", C: "GB" });
    expect(file.certificate.issuer).toEqual(file.certificate.subject);
    expect(file.certificate.key).toBe("RSA 2048-bit");
    expect(file.certificate.keyUsage).toEqual(["digital signature", "non-repudiation"]);
    expect(file.certificate.notAfter.getUTCFullYear() - file.certificate.notBefore.getUTCFullYear()).toBe(2);
    expect(file.chain).toEqual([]);
    expect(parseDer(file.key).children.length).toBeGreaterThanOrEqual(3);
  });

  it("reads .p12 files from other tools: AES, legacy 3DES, ECDSA, with a CA chain", () => {
    for (const name of ["chain-aes.p12", "legacy-3des.p12"]) {
      const file = readCertificateFile(fixture(name), "fixture");
      expect(file.certificate.subject).toMatchObject({ CN: "Max Mustermann", O: "Muster GmbH", E: "max@example.com" });
      expect(file.certificate.issuer.CN).toBe("Fixture Root CA");
      expect(file.chain.map((c) => c.subject.CN)).toEqual(["Fixture Root CA"]);
      expect(file.certificate.key).toBe("RSA 2048-bit");
    }
    const ec = readCertificateFile(fixture("ec-p256.p12"), "fixture");
    expect(ec.certificate.key).toBe("ECDSA P-256");
  });

  it("refuses a wrong password", () => {
    expect(() => readCertificateFile(p12, "nope")).toThrow(/password/);
    expect(() => readCertificateFile(Uint8Array.of(1, 2, 3), "x")).toThrow(/certificate file/);
  });
});

describe("signing and verifying", () => {
  it("signs invisibly as an incremental update and verifies", async () => {
    const original = await samplePdf();
    const signed = await signPdf(original, { certificate: p12, password: "s3cret", reason: "I approve", location: "London", now: NOW });
    // The original bytes are untouched; the signature follows them.
    expect(signed.subarray(0, original.length)).toEqual(original);
    const tail = text(signed.subarray(original.length));
    expect(tail).toMatch(/\/SubFilter \/ETSI\.CAdES\.detached/);
    expect(tail).toMatch(/\/Rect \[ 0 0 0 0 \]/);
    expect(tail).not.toMatch(/Producer|ModDate|pdf-lib/);

    const report = await verifyPdfSignatures(signed);
    expect(report.signatures).toHaveLength(1);
    const [sig] = report.signatures;
    expect(sig).toMatchObject({ intact: true, problem: null, kind: "signature", changesAfter: "none", reason: "I approve", location: "London", page: null, certificateValidThen: true });
    expect(sig.signer).toMatchObject({ name: "Jane Doe", email: "jane@example.com", organization: "Doe & Co", selfSigned: true, key: "RSA 2048-bit" });
    expect(sig.signedAt).toBe(NOW.toISOString());
    expect(sig.signer?.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  it("writes PAdES signed attributes", async () => {
    const signed = await signPdf(await samplePdf(), { certificate: p12, password: "s3cret", now: NOW });
    const hex = /\/Contents <([0-9A-F]+)0*>/.exec(text(signed))![1];
    const cms = parseSignedData(Uint8Array.from(Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex")));
    const [signer] = cms.signers;
    expect(signer.hasSigningCertificate).toBe(true);
    expect(signer.signingTime).toBeNull();
    expect(toHex(signer.messageDigest!)).toHaveLength(64);
    expect(cms.certificates).toHaveLength(1);
  });

  it("detects a change after signing", async () => {
    const signed = await signPdf(await samplePdf(), { certificate: p12, password: "s3cret", now: NOW });
    // Change one byte inside the signed range (the binary comment after the header).
    const tampered = signed.slice();
    tampered[11] ^= 1;
    const [sig] = (await verifyPdfSignatures(tampered)).signatures;
    expect(sig.intact).toBe(false);
    expect(sig.problem).toMatch(/changed after it was signed/);
  });

  it("notices additions after signing, and keeps earlier signatures valid when signing again", async () => {
    const once = await signPdf(await samplePdf(), { certificate: p12, password: "s3cret", now: NOW });
    const doc = await PDFDocument.load(once, { updateMetadata: false, forIncrementalUpdate: true });
    doc.getPage(0).drawText("Added later", { x: 72, y: 100 });
    const edited = new Uint8Array([...once, ...(await doc.saveIncremental(doc.context.snapshot!, { useObjectStreams: false }))]);
    const [changed] = (await verifyPdfSignatures(edited)).signatures;
    expect(changed).toMatchObject({ intact: true, changesAfter: "changed" });

    const twice = await signPdf(once, { certificate: p12, password: "s3cret", reason: "Countersigned", now: NOW });
    const report = await verifyPdfSignatures(twice);
    expect(report.signatures.map((s) => [s.intact, s.changesAfter, s.reason])).toEqual([
      [true, "covered", null],
      [true, "none", "Countersigned"],
    ]);
    expect(report.revisions).toBe(3);
    expect(report.signatures.map((s) => s.field)).toEqual(["Signature1", "Signature2"]);
  });

  it("draws a visible signature box upright on rotated pages", async () => {
    for (const rotate of [0, 90, 270]) {
      const signed = await signPdf(await samplePdf(2, rotate), { certificate: p12, password: "s3cret", reason: "Approved", appearance: { page: 1, anchor: "bottom-right" }, fonts, now: NOW });
      const doc = await PDFDocument.load(signed, { updateMetadata: false });
      const page = doc.getPage(1);
      const annots = page.node.Annots()!.asArray();
      const widget = doc.context.lookup(annots[annots.length - 1]) as never as { lookup: (n: PDFName) => unknown };
      const rect = (widget.lookup(PDFName.of("Rect")) as { asArray(): { asNumber(): number }[] }).asArray().map((n) => n.asNumber());
      const [w, h] = [rect[2] - rect[0], rect[3] - rect[1]];
      expect(rotate % 180 ? [h, w] : [w, h]).toEqual([220, 72]);
      const [sig] = (await verifyPdfSignatures(signed)).signatures;
      expect(sig).toMatchObject({ intact: true, page: 2 });
    }
  });

  it("certifies, and then refuses to certify twice", async () => {
    const certified = await signPdf(await samplePdf(), { certificate: p12, password: "s3cret", certify: 2, now: NOW });
    const [sig] = (await verifyPdfSignatures(certified)).signatures;
    expect(sig).toMatchObject({ kind: "certification", certification: 2, intact: true });
    await expect(signPdf(certified, { certificate: p12, password: "s3cret", certify: 2 })).rejects.toThrow(/Only the first signature/);
    const locked = await signPdf(await samplePdf(), { certificate: p12, password: "s3cret", certify: 1, now: NOW });
    await expect(signPdf(locked, { certificate: p12, password: "s3cret" })).rejects.toThrow(/no changes allowed/);
  });

  it("signs with an ECDSA key", async () => {
    const signed = await signPdf(await samplePdf(), { certificate: fixture("ec-p256.p12"), password: "fixture", now: NOW });
    const [sig] = (await verifyPdfSignatures(signed)).signatures;
    expect(sig).toMatchObject({ intact: true, signer: { name: "Erika EC", key: "ECDSA P-256", selfSigned: true } });
  });

  it("verifies PDFs signed by another tool (pyHanko), RSA with a CA chain and ECDSA", async () => {
    const rsa = await verifyPdfSignatures(fixture("pyhanko-rsa.pdf"));
    expect(rsa.signatures).toHaveLength(1);
    expect(rsa.signatures[0]).toMatchObject({ field: "MaxSig", intact: true, reason: "Genehmigt", location: "Berlin", page: 1, changesAfter: "none" });
    expect(rsa.signatures[0].signer).toMatchObject({ name: "Max Mustermann", issuer: "Fixture Root CA", selfSigned: false });
    expect(rsa.signatures[0].chain).toMatchObject([{ name: "Fixture Root CA", selfSigned: true }]);
    const ec = (await verifyPdfSignatures(fixture("pyhanko-ec.pdf"))).signatures[0];
    expect(ec).toMatchObject({ field: "ErikaSig", intact: true, page: null, signer: { name: "Erika EC", key: "ECDSA P-256" } });

    // Countersigning another tool's file keeps its signature valid.
    const both = await verifyPdfSignatures(await signPdf(fixture("pyhanko-rsa.pdf"), { certificate: p12, password: "s3cret", now: NOW }));
    expect(both.signatures.map((s) => [s.field, s.intact, s.changesAfter])).toEqual([
      ["MaxSig", true, "covered"],
      ["Signature1", true, "none"],
    ]);
  });

  it("reports a PDF without signatures", async () => {
    expect(await verifyPdfSignatures(await samplePdf())).toEqual({ signatures: [], revisions: 1 });
  });
});
