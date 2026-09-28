import { describe, expect, it } from "vitest";
import { searchTools, TOOLS } from "../tools";

const top = (query: string) => searchTools(query)[0]?.id;

describe("tool search", () => {
  it("finds tools by name, including partial words", () => {
    expect(top("merge")).toBe("merge");
    expect(top("compr")).toBe("compress");
    expect(top("pdf to word")).toBe("pdf-to-word");
    expect(top("HEIC")).toBe("heic-to-jpg");
  });

  it("finds tools by what people call the task", () => {
    expect(top("combine")).toBe("merge");
    expect(top("password")).toBe("protect");
    expect(top("remove password")).toBe("unlock");
    expect(top("gps")).toBe("sanitize");
    expect(top("black out")).toBe("redact");
    expect(top("signature")).toBe("sign");
    expect(searchTools("iphone").map((t) => t.id).slice(0, 2).sort()).toEqual(["heic-to-jpg", "sanitize"]);
  });

  it("finds the page and form tools", () => {
    expect(top("rotate")).toBe("rotate");
    expect(top("blank")).toBe("remove-blank");
    expect(top("fill form")).toBe("fill-pdf");
    expect(top("bates")).toBe("bates");
    expect(top("black and white")).toBe("grayscale");
    expect(top("a4")).toBe("resize-pages");
    expect(top("table of contents")).toBe("bookmarks");
    expect(top("header")).toBe("header-footer");
    expect(top("delete pages")).toBe("delete-pages");
    expect(top("trim margins")).toBe("crop");
  });

  it("finds OCR and translation", () => {
    expect(top("ocr")).toBe("ocr");
    expect(top("searchable")).toBe("ocr");
    expect(top("image to text")).toBe("ocr");
    expect(top("translate")).toBe("translate");
    expect(top("spanish")).toBe("translate");
  });

  it("finds the inspect tools", () => {
    expect(top("personal data")).toBe("find-pii");
    expect(top("gdpr")).toBe("find-pii");
    expect(top("fake redaction")).toBe("inspect-pdf");
    expect(top("tracked changes")).toBe("inspect-office");
    expect(top("photoshopped")).toBe("image-forensics");
    expect(top("sha256")).toBe("check-file");
    expect(top("md5")).toBe("check-file");
    expect(top("phishing")).toBe("check-links");
    expect(top("qr code")).toBe("check-links");
  });

  it("finds the conversion and compare tools", () => {
    expect(top("pdf to powerpoint")).toBe("pdf-to-pptx");
    expect(top("pptx to pdf")).toBe("pptx-to-pdf");
    expect(top("markdown to pdf")).toBe("text-to-pdf");
    expect(top("html to pdf")).toBe("text-to-pdf");
    expect(top("pdf to txt")).toBe("pdf-to-text");
    expect(top("pdf to markdown")).toBe("pdf-to-text");
    expect(top("resize image")).toBe("convert-image");
    expect(top("webp")).toBe("convert-image");
    expect(top("favicon")).toBe("convert-image");
    expect(top("compare")).toBe("compare-pdf");
    expect(top("diff")).toBe("compare-pdf");
  });

  it("needs every word to match, and lists all tools for an empty query", () => {
    expect(searchTools("xyzzy")).toEqual([]);
    expect(searchTools("merge xyzzy")).toEqual([]);
    expect(searchTools("  ")).toHaveLength(TOOLS.filter((t) => t.status === "ready").length);
  });
});
