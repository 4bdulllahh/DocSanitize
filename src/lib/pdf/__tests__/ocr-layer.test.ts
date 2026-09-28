import fontkit from "@cantoo/fontkit";
import { degrees, PDFDocument } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultOcrLanguage, OCR_LANGUAGES } from "../../ocr/languages";
import { glyphlessHex, glyphlessTrueType } from "../glyphless-font";
import { addTextLayer, layoutLine, visualOrder, type OcrLine } from "../ocr-layer";

async function blankPdf(pages: { size: [number, number]; rotate?: number }[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const { size, rotate } of pages) doc.addPage(size).setRotation(degrees(rotate ?? 0));
  return doc.save();
}

type Item = { str: string; transform: number[]; width: number };
async function textOf(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const pages: { text: string; items: { str: string; x: number; y: number; width: number }[] }[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.filter((it) => "str" in it) as (Item & { hasEOL: boolean })[];
      pages.push({
        text: items.map((it) => it.str + (it.hasEOL ? "\n" : "")).join(""),
        items: items
          .filter((it) => it.str.trim())
          .map((it) => {
            const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
            return { str: it.str, x, y, width: it.width };
          }),
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

const line = (baseline: number, words: [string, number, number][], size = 20, rtl = false): OcrLine => ({
  size,
  rtl,
  words: words.map(([text, x, width]) => ({ text, x, width, baseline })),
});

describe("glyphless font", () => {
  it("is a valid TrueType font with two empty glyphs half an em wide", () => {
    const font = fontkit.create(glyphlessTrueType() as unknown as Buffer) as unknown as {
      numGlyphs: number;
      unitsPerEm: number;
      ascent: number;
      descent: number;
      getGlyph(id: number): { advanceWidth: number; path: { commands: unknown[] } };
    };
    expect(font.numGlyphs).toBe(2);
    expect(font.unitsPerEm).toBe(1000);
    expect([font.ascent, font.descent]).toEqual([800, -200]);
    expect(font.getGlyph(1).advanceWidth).toBe(500);
    expect(font.getGlyph(1).path.commands).toEqual([]);
  });

  it("writes UTF-16 code units, surrogate pairs included", () => {
    expect(glyphlessHex("Aé")).toBe("004100E9");
    expect(glyphlessHex("😀")).toBe("D83DDE00");
  });
});

describe("OCR text layer", () => {
  it("spaces words out to the next word, left to right", () => {
    const words = layoutLine(line(100, [["world", 80, 50], ["Hello", 10, 50], ["!", 140, 5]]));
    expect(words.map((w) => [w.text, w.x, w.width])).toEqual([
      ["Hello ", 10, 70],
      ["world ", 80, 60],
      ["!", 140, 5],
    ]);
    // Right-to-left words are stored in drawing order; digits and Latin keep theirs.
    expect(layoutLine(line(100, [["אב", 80, 20], ["גד", 10, 20]], 20, true)).map((w) => [w.text, w.x])).toEqual([["דג", 10], ["בא", 80]]);
    expect(visualOrder("שלום123")).toBe("123םולש");
    expect(visualOrder("(abc)")).toBe("(abc)");
  });

  it("adds searchable text at the words' positions, in any script", async () => {
    const bytes = await blankPdf([{ size: [600, 800] }]);
    const out = await addTextLayer(bytes, [
      {
        page: 0,
        lines: [
          line(100, [["Invoice", 50, 90], ["total:", 150, 60], ["€42", 220, 40]]),
          line(140, [["Привет", 50, 80], ["мир", 140, 40]]),
          line(180, [["你好世界", 50, 80]]),
          line(220, [["مرحبا", 150, 60], ["بالعالم", 50, 80]], 20, true),
        ],
      },
    ]);
    const [page] = await textOf(out);
    expect(page.text).toContain("Invoice total: €42");
    expect(page.text).toContain("Привет мир");
    expect(page.text).toContain("你好世界");
    // Readers get right-to-left words back in reading order, each where it was seen.
    const arabic = page.items.filter((i) => i.y === 220).map((i) => [i.str, Math.round(i.x)]);
    expect(arabic).toEqual([["بالعالم", 50], ["مرحبا", 150]]);
    const invoice = page.items.find((i) => i.str.startsWith("Invoice"))!;
    expect(invoice.x).toBeCloseTo(50, 1);
    expect(invoice.y).toBeCloseTo(100, 1);
    const chinese = page.items.find((i) => i.str === "你好世界")!;
    expect(chinese.width).toBeCloseTo(80, 1);
  });

  it("follows page rotation and skips pages without text", async () => {
    const bytes = await blankPdf([{ size: [600, 800] }, { size: [600, 800], rotate: 90 }]);
    const out = await addTextLayer(bytes, [
      { page: 0, lines: [] },
      { page: 1, lines: [line(60, [["Sideways", 700, 100]])] },
    ]);
    const [first, second] = await textOf(out);
    expect(first.items).toEqual([]);
    const item = second.items.find((i) => i.str === "Sideways")!;
    // Displayed page is 800 × 600; the word is where it was seen.
    expect(item.x).toBeCloseTo(700, 1);
    expect(item.y).toBeCloseTo(60, 1);
    await expect(addTextLayer(bytes, [{ page: 5, lines: [] }])).rejects.toThrow(/doesn't exist/);
  });
});

describe("OCR languages", () => {
  const require = createRequire(import.meta.url);
  it("lists each model with its real download size", () => {
    for (const { code, mb } of OCR_LANGUAGES) {
      const dir = dirname(require.resolve(`@tesseract.js-data/${code}/package.json`));
      const size = statSync(join(dir, "4.0.0_best_int", `${code}.traineddata.gz`)).size / 1048576;
      expect(Math.abs(size - mb), code).toBeLessThan(0.1);
    }
    expect(new Set(OCR_LANGUAGES.map((l) => l.code)).size).toBe(OCR_LANGUAGES.length);
    const deps = JSON.parse(readFileSync("package.json", "utf8")).dependencies;
    for (const { code } of OCR_LANGUAGES) expect(deps[`@tesseract.js-data/${code}`], code).toBeDefined();
  });

  it("preselects the browser's language", () => {
    expect(defaultOcrLanguage("de-AT")).toBe("deu");
    expect(defaultOcrLanguage("zh-TW")).toBe("chi_tra");
    expect(defaultOcrLanguage("zh-CN")).toBe("chi_sim");
    expect(defaultOcrLanguage("sw")).toBe("eng");
    expect(defaultOcrLanguage(undefined)).toBe("eng");
  });
});
