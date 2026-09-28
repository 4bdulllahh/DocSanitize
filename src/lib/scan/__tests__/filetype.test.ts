import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { tinyPng } from "../../metadata/__tests__/fixtures";
import { checkFile, detectType, zipEntryNames } from "../filetype";
import { hashAll, matchHash, md5 } from "../hash";

const enc = (s: string) => new TextEncoder().encode(s);
const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0]);
const ids = (name: string, bytes: Uint8Array) => checkFile(name, bytes).findings.map((f) => `${f.severity}:${f.id}`);
const RLO = String.fromCharCode(0x202e);

describe("file type detection", () => {
  it("recognises formats from their contents", () => {
    expect(detectType(enc("%PDF-1.7\n"))?.name).toBe("PDF document");
    expect(detectType(tinyPng())?.name).toBe("PNG image");
    expect(detectType(exe)?.category).toBe("program");
    const docx = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8("<w/>") });
    expect(detectType(docx)?.name).toBe("Word document");
    expect(zipEntryNames(docx)).toEqual(["[Content_Types].xml", "word/document.xml"]);
    expect(detectType(zipSync({ "a.txt": strToU8("hi") }))?.name).toBe("ZIP archive");
    expect(detectType(enc("<!DOCTYPE html><html>"))?.name).toBe("Web page (HTML)");
    expect(detectType(enc("#!/bin/sh\nrm -rf /"))?.category).toBe("program");
    expect(detectType(enc("name,age\nAna,4\n"))?.name).toBe("Plain text");
    expect(detectType(new Uint8Array([1, 2, 3, 0, 250, 251, 0, 9]))).toBeNull();
  });

  it("flags disguised programs and misleading names", () => {
    expect(ids("invoice.pdf", exe)).toEqual(["high:mismatch", "high:program"]);
    expect(ids("invoice.pdf.exe", exe)).toEqual(["high:double", "high:program"]);
    expect(ids(`invoice${RLO}fdp.exe`, exe)).toEqual(["high:bidi", "high:program"]);
    expect(checkFile(`invoice${RLO}fdp.exe`, exe).findings[0].items![0]).toBe("invoice⟨hidden direction character⟩fdp.exe");
    expect(ids("photo.jpg", tinyPng())).toEqual(["medium:mismatch"]);
    expect(ids("photo.png", tinyPng())).toEqual([]);
    expect(ids("report.docm", zipSync({ "[Content_Types].xml": strToU8("<T/>"), "word/document.xml": strToU8("<w/>"), "word/vbaProject.bin": new Uint8Array(4) }))).toEqual(["medium:macros"]);
    expect(ids("files.zip", zipSync({ "readme.txt": strToU8("hi"), "setup.exe": exe }))).toEqual(["high:zip-programs", "info:zip"]);
    expect(ids("logo.svg", enc('<svg onload="alert(1)"></svg>'))).toEqual(["medium:active"]);
  });
});

describe("hashes", () => {
  it("computes MD5 like everyone else", () => {
    expect(md5(new Uint8Array())).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5(enc("The quick brown fox jumps over the lazy dog"))).toBe("9e107d9d372bb6826bd81d3542a419d6");
    const big = new Uint8Array(100_003).map((_, i) => (i * 31) & 255);
    expect(md5(big)).toBe(createHash("md5").update(big).digest("hex"));
  });

  it("computes SHA hashes and matches a pasted value", async () => {
    const hashes = await hashAll(enc("abc"));
    expect(hashes["SHA-256"]).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashes["SHA-1"]).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(matchHash(hashes, " BA7816BF 8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD ")).toBe("SHA-256");
    expect(matchHash(hashes, "900150983cd24fb0d6963f7d28e17f72")).toBe("MD5");
    expect(matchHash(hashes, "deadbeef")).toBeNull();
  });
});
