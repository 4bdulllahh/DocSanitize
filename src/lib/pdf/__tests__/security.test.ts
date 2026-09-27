import { readFileSync } from "node:fs";
import { PDFDocument, PDFString, StandardFonts } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { inspectEncryption, protectPdf, unlockPdf, type ProtectOptions } from "../security";

// Encrypted by pypdf (see encrypted/make-fixtures.py): real-world files encrypt every string.
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./encrypted/${name}`, import.meta.url)));

async function sourcePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setAuthor("Jane Doe");
  doc.setTitle("Merger plan");
  const page = doc.addPage([300, 300]);
  page.drawText("SECRET TEXT 42", { x: 20, y: 150, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  const link = doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 10, 10], A: { Type: "Action", S: "URI", URI: PDFString.of("https://secret.example.org/deal") } });
  page.node.addAnnot(doc.context.register(link));
  return doc.save({ useObjectStreams: false });
}

/** Open with pdf.js, as a PDF reader would. */
async function read(bytes: Uint8Array, password?: string) {
  const task = getDocument({ data: bytes.slice(), password });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const info = (await doc.getMetadata()).info as Record<string, string>;
    return {
      author: info.Author,
      title: info.Title,
      text: (await page.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(""),
      links: (await page.getAnnotations()).map((a) => a.url),
    };
  } finally {
    await task.destroy();
  }
}

const allowAll: Omit<ProtectOptions, "userPassword"> = { allowPrinting: true, allowCopying: true, allowModifying: true };
const EXPECTED = { author: "Jane Doe", text: "SECRET TEXT 42", links: ["https://secret.example.org/deal"] };

describe("protect", () => {
  it("encrypts with AES-256 and keeps every string secret", async () => {
    const out = await protectPdf(await sourcePdf(), { userPassword: "correct horse", ...allowAll });
    const raw = Buffer.from(out).toString("latin1");
    expect(raw).toMatch(/\/V 5/);
    expect(raw).toMatch(/\/R 6/);
    // Nothing readable without the password: not the title, author (UTF-16 hex) or link.
    const utf16 = (s: string) => Buffer.from(`﻿${s}`, "utf16le").swap16().toString("hex");
    expect(raw.toLowerCase()).not.toContain(utf16("Jane Doe"));
    expect(raw).not.toContain("secret.example.org");
    await expect(read(out)).rejects.toMatchObject({ name: "PasswordException" });
    expect(await read(out, "correct horse")).toMatchObject({ ...EXPECTED, title: "Merger plan" });
  });

  it("writes the chosen restrictions", async () => {
    const out = await protectPdf(await sourcePdf(), { userPassword: "pw", ownerPassword: "boss", allowPrinting: false, allowCopying: false, allowModifying: true });
    expect((await inspectEncryption(out)).restrictions).toEqual(["printing", "copying text and images"]);
  });

  it("refuses an empty password and files that are already protected", async () => {
    await expect(protectPdf(await sourcePdf(), { userPassword: "", ...allowAll })).rejects.toThrow(/Choose a password/);
    await expect(protectPdf(fixture("aes256.pdf"), { userPassword: "x", ...allowAll })).rejects.toMatchObject({ code: "encrypted" });
  });
});

describe("unlock", () => {
  it.each(["aes256.pdf", "aes128.pdf", "rc4.pdf"])("decrypts %s with the open password, keeping info, text and links", async (name) => {
    const info = await inspectEncryption(fixture(name));
    expect(info).toMatchObject({ encrypted: true, needsPassword: true });
    const out = await unlockPdf(fixture(name), "open sesame");
    expect((await inspectEncryption(out)).encrypted).toBe(false);
    expect(await read(out)).toMatchObject({ ...EXPECTED, links: ["https://example.org/merger"], title: "Merger plan — confidential" });
  });

  it("names the cipher", async () => {
    expect((await inspectEncryption(fixture("aes256.pdf"))).algorithm).toBe("AES-256");
    expect((await inspectEncryption(fixture("aes128.pdf"))).algorithm).toBe("AES-128");
    expect((await inspectEncryption(fixture("rc4.pdf"))).algorithm).toBe("RC4 128-bit");
  });

  it("accepts the owner password too", async () => {
    expect((await read(await unlockPdf(fixture("aes256.pdf"), "boss"))).author).toBe("Jane Doe");
  });

  it("removes restrictions from files that open without a password", async () => {
    const info = await inspectEncryption(fixture("owner-only.pdf"));
    expect(info).toMatchObject({ encrypted: true, needsPassword: false });
    expect(info.restrictions).toContain("printing");
    const out = await unlockPdf(fixture("owner-only.pdf"));
    expect((await inspectEncryption(out)).encrypted).toBe(false);
  });

  it("round-trips our own protected files, including document info kept in a cross-reference stream", async () => {
    const locked = await protectPdf(await sourcePdf(), { userPassword: "pw", ...allowAll });
    const out = await unlockPdf(locked, "pw");
    expect(await read(out)).toMatchObject({ ...EXPECTED, title: "Merger plan" });
    expect(Buffer.from(out).toString("latin1")).not.toContain("/Encrypt");
  });

  it("explains wrong, missing and pointless passwords", async () => {
    await expect(unlockPdf(fixture("aes256.pdf"), "guess")).rejects.toMatchObject({ code: "encrypted", message: "That password isn't right." });
    await expect(unlockPdf(fixture("aes256.pdf"))).rejects.toThrow(/needs its password/);
    await expect(unlockPdf(await sourcePdf())).rejects.toThrow(/isn't password-protected/);
  });
});
