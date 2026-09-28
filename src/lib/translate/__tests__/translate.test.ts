import { PDFDocument, rgb, StandardFonts } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { liberationSans } from "../../office/__tests__/fixtures";
import { readPhrases } from "../../pdf/edit/page-text";
import { translatePdf, type TranslatedBlock } from "../../pdf/translate";
import { groupLines, hasWords, joinLines, type Line } from "../blocks";
import { chunks } from "../browser";
import { translateLanguage } from "../languages";
import { fitText, wrapText } from "../layout";

const line = (str: string, x: number, baseline: number, width: number, size = 10, bold = false): Line => ({
  str,
  x,
  y: baseline - 0.8 * size,
  width,
  height: size,
  size,
  baseline,
  font: "sans",
  bold,
  italic: false,
  sources: [],
});

describe("grouping lines into blocks", () => {
  it("joins a paragraph's lines and keeps headings, columns and short last lines apart", () => {
    const blocks = groupLines([
      line("A heading", 50, 50, 80, 16, true),
      line("First paragraph goes on and", 50, 80, 200),
      line("Right column text", 320, 80, 150),
      line("on across three lines of text", 50, 92, 205),
      line("Right column, more", 320, 92, 140),
      line("and ends here.", 50, 104, 90),
      line("Second paragraph starts here", 50, 116, 200),
      line("Footer 3", 50, 400, 40),
    ]);
    expect(blocks.map((b) => b.text)).toEqual([
      "A heading",
      "First paragraph goes on and on across three lines of text and ends here.",
      "Right column text Right column, more",
      "Second paragraph starts here",
      "Footer 3",
    ]);
    const para = blocks[1];
    expect(para.box).toEqual({ x: 50, y: 72, width: 205, height: 34 });
    expect(para.baseline).toBe(80);
    expect(para.lines).toHaveLength(3);
  });

  it("rejoins hyphenated words and skips blocks without words", () => {
    expect(joinLines(["an exam-", "ple of hyphen-", "Ation", "self-", "Service"])).toBe("an example of hyphen- Ation self- Service");
    expect(hasWords("Page 3")).toBe(true);
    expect(hasWords("12.50 €")).toBe(false);
    expect(hasWords("数据")).toBe(true);
  });
});

describe("fitting translated text", () => {
  // 0.5 em per character.
  const measure = (text: string, size: number) => text.length * size * 0.5;

  it("wraps at the original width and shrinks only when needed", () => {
    expect(wrapText("aaa bbb ccc", 7, (l) => l.length <= 7)).toEqual(["aaa bbb", "ccc"]);
    expect(wrapText("一二三四五", 2, (l) => l.length <= 2)).toEqual(["一二", "三四", "五"]);
    // Two lines of 20 characters at size 10 fit in two lines' space.
    expect(fitText("x".repeat(19) + " " + "y".repeat(19), { width: 100, height: 24 }, 10, measure)).toEqual({ size: 10, lines: ["x".repeat(19), "y".repeat(19)], overflow: false });
    const shrunk = fitText("word ".repeat(12).trim(), { width: 100, height: 12 }, 10, measure);
    expect(shrunk.size).toBeLessThan(10);
    expect(shrunk.size).toBeGreaterThanOrEqual(6);
    expect(fitText("word ".repeat(80).trim(), { width: 100, height: 12 }, 10, measure).overflow).toBe(true);
  });

  it("splits long paragraphs at sentences for the translator", () => {
    const text = "One sentence here. ".repeat(80).trim();
    const parts = chunks(text, 200);
    expect(parts.every((p) => p.length <= 200)).toBe(true);
    expect(parts.join(" ")).toBe(text);
    expect(chunks("short")).toEqual(["short"]);
  });

  it("maps browser and detector codes to supported languages", () => {
    expect(translateLanguage("de-AT")?.code).toBe("de");
    expect(translateLanguage("iw")?.code).toBe("he");
    expect(translateLanguage("zh-TW")?.code).toBe("zh-Hant");
    expect(translateLanguage("zh-CN")?.pdf).toBe(false);
    expect(translateLanguage("xx")).toBeUndefined();
  });
});

describe("translated PDF", () => {
  it("replaces each block's text with its translation, removing the original", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Quarterly report", { x: 40, y: 250, size: 16, font, color: rgb(0.1, 0.2, 0.5) });
    page.drawText("The results were good and the", { x: 40, y: 220, size: 10, font });
    page.drawText("team is happy with them.", { x: 40, y: 208, size: 10, font });
    page.drawText("42", { x: 40, y: 180, size: 10, font });
    const bytes = await doc.save();

    const task = getDocument({ data: bytes.slice() });
    const pdf = await task.promise;
    const phrases = await readPhrases(await pdf.getPage(1));
    await task.destroy();
    const blocks = groupLines(phrases);
    expect(blocks.map((b) => b.text)).toEqual(["Quarterly report", "The results were good and the team is happy with them.", "42"]);

    const translations: Record<string, string> = {
      "Quarterly report": "Quartalsbericht",
      "The results were good and the team is happy with them.": "Die Ergebnisse waren gut und das Team ist damit sehr zufrieden, wirklich sehr zufrieden.",
    };
    const translated: TranslatedBlock[] = blocks
      .filter((b) => hasWords(b.text))
      .map(({ lines, text, ...b }) => ({ ...b, page: 0, translation: translations[text], color: "#1a3380", background: "#ffffff", sources: lines.flatMap((l) => l.sources) }));
    const result = await translatePdf(bytes, translated, liberationSans());
    expect(result.warnings).toEqual([]);

    const out = getDocument({ data: result.bytes.slice() });
    const outDoc = await out.promise;
    const text = (await (await outDoc.getPage(1)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
    await out.destroy();
    expect(text).toContain("Quartalsbericht");
    expect(text).toContain("Die Ergebnisse waren gut");
    expect(text).toContain("42");
    expect(text).not.toContain("Quarterly");
    expect(text).not.toContain("results");
  });
});
