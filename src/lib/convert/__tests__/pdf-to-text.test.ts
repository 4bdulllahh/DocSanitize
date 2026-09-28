import { describe, expect, it } from "vitest";
import type { TextItem, TextPage } from "../../office/text-layout";
import { escapeMarkdown, segmentsToMarkdown, textPagesToText } from "../pdf-to-text";

function line(text: string, x: number, y: number, size = 11, style: Partial<TextItem> = {}): TextItem[] {
  const items: TextItem[] = [];
  let cursor = x;
  for (const word of text.split(" ")) {
    const width = word.length * size * 0.5;
    items.push({ text: word, x: cursor, y, width, size, ...style });
    cursor += width + size * 0.28;
  }
  return items;
}

const page = (items: TextItem[]): TextPage => ({ width: 612, height: 792, items });

const doc = [
  page([
    ...line("Quarterly report", 72, 80, 22, { bold: true }),
    ...line("Sales rose by a third, which is good news.", 72, 120),
    ...line("The team credits the new catalogue.", 72, 134),
    ...line("• Faster delivery", 72, 170),
    ...line("• Lower prices", 72, 184),
    // A table: rows with wide column gaps.
    ...line("Region", 72, 230),
    ...line("Sales", 300, 230),
    ...line("North", 72, 244),
    ...line("120", 300, 244),
  ]),
  page([...line("Second page text with *stars*.", 72, 80)]),
];

describe("PDF to Markdown", () => {
  it("writes headings, paragraphs, lists and tables", () => {
    const result = textPagesToText(doc, [1, 2], { format: "markdown", pageMarkers: false });
    expect(result.text).toBe(
      [
        "# Quarterly report",
        "",
        "Sales rose by a third, which is good news. The team credits the new catalogue.",
        "",
        "- Faster delivery",
        "- Lower prices",
        "",
        "| Region | Sales |",
        "| --- | --- |",
        "| North | 120 |",
        "",
        "Second page text with \\*stars\\*.",
        "",
      ].join("\n"),
    );
    expect(result.headings).toBe(1);
    expect(result.paragraphs).toBe(7);
  });

  it("marks pages when asked", () => {
    const md = textPagesToText(doc, [4, 5], { format: "markdown", pageMarkers: true }).text;
    expect(md.startsWith("<!-- Page 4 -->\n\n# Quarterly report")).toBe(true);
    expect(md).toContain("<!-- Page 5 -->");
    const txt = textPagesToText(doc, [4, 5], { format: "text", pageMarkers: true }).text;
    expect(txt).toContain("--- Page 5 ---\n\nSecond page text with *stars*.");
    expect(txt).toContain("• Faster delivery\n• Lower prices");
    expect(txt).toContain("Region\tSales");
  });

  it("wraps bold and italic without swallowing spaces", () => {
    expect(
      segmentsToMarkdown([
        { text: "Plain ", bold: false, italic: false, size: 11 },
        { text: "strong ", bold: true, italic: false, size: 11 },
        { text: "both", bold: true, italic: true, size: 11 },
      ]),
    ).toBe("Plain **strong** ***both***");
    expect(escapeMarkdown("# not a heading")).toBe("\\# not a heading");
    expect(escapeMarkdown("1. not a list")).toBe("1\\. not a list");
  });

  it("explains scanned PDFs", () => {
    expect(() => textPagesToText([page([])], [1], { format: "text", pageMarkers: false })).toThrow(/OCR PDF/);
  });
});
