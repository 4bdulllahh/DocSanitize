import { unzipSync } from "fflate";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { textPagesToDocx, textPagesToXlsx } from "../pdf-to-office";
import {
  cellValue,
  columnBands,
  groupLines,
  groupParagraphs,
  lineCells,
  lineSegments,
  removeRunningLines,
  splitColumns,
  type TextItem,
  type TextPage,
} from "../text-layout";
import { columnName, sheetNames } from "../xlsx";

/** A line of text as pdf.js would report it: one item per word, ~0.5 em per character. */
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

/** Wrapped body text: `rows` lines 14 pt apart. */
function paragraph(words: string, x: number, y: number, rows: number, size = 11): TextItem[] {
  const all = words.split(" ");
  const per = Math.ceil(all.length / rows);
  return Array.from({ length: rows }, (_, r) => line(all.slice(r * per, (r + 1) * per).join(" "), x, y + r * 14, size)).flat();
}

const page = (items: TextItem[], width = 612, height = 792): TextPage => ({ width, height, items });

const LOREM =
  "Privacy tools should run where the files are. Uploading a document to convert it hands a copy to someone else, " +
  "and that copy can outlive the conversion by years in logs and backups that nobody reviews.";

async function docxHtml(bytes: Uint8Array) {
  return (await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })).value;
}

describe("lines", () => {
  it("groups items by baseline, reads left to right and keeps superscripts on their line", () => {
    const lines = groupLines([
      ...line("world", 100, 100),
      ...line("Hello", 40, 100.4),
      { text: "2", x: 132, y: 96, width: 4, size: 7 },
      ...line("Next line", 40, 114),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].items.map((i) => i.text)).toEqual(["Hello", "world", "2"]);
    expect(lines[0].y).toBeCloseTo(100.4);
    expect(lines[0].size).toBe(11);
  });

  it("turns gaps into spaces or tabs and splits styled runs", () => {
    const [l] = groupLines([...line("Name:", 40, 100, 11, { bold: true }), ...line("Jane", 80, 100), ...line("Total", 300, 100)]);
    expect(lineSegments(l)).toEqual([
      { text: "Name:", bold: true, italic: false, size: 11 },
      { text: " Jane\tTotal", bold: false, italic: false, size: 11 },
    ]);
  });
});

describe("paragraphs", () => {
  it("splits on vertical space, indents and short last lines; joins hyphenated words", () => {
    const p = page([
      ...paragraph("The first paragraph wraps onto a second line and then ends here.", 72, 100, 2),
      ...line("It continues with a new para-", 90, 142), // indented first line
      ...line("graph that wraps.", 72, 156),
      ...line("A third one after a gap.", 72, 200),
    ]);
    const paragraphs = groupParagraphs(p, groupLines(p.items), 0);
    expect(paragraphs.map((x) => x.segments.map((s) => s.text).join(""))).toEqual([
      "The first paragraph wraps onto a second line and then ends here.",
      "It continues with a new paragraph that wraps.",
      "A third one after a gap.",
    ]);
  });

  it("keeps table-like rows (with column gaps) as separate lines", () => {
    const p = page([...line("North", 72, 100), ...line("1,200", 300, 100), ...line("South", 72, 116), ...line("800", 300, 116)]);
    const paragraphs = groupParagraphs(p, groupLines(p.items), 0);
    expect(paragraphs.map((x) => x.segments.map((s) => s.text).join(""))).toEqual(["North\t1,200", "South\t800"]);
  });

  it("starts a paragraph at every list marker", () => {
    const p = page([...line("• Apples", 72, 100), ...line("• Pears are also", 72, 114), ...line("quite nice", 84, 128), ...line("2) Plums", 72, 142)]);
    const paragraphs = groupParagraphs(p, groupLines(p.items), 0);
    expect(paragraphs.map((x) => [x.list, x.segments.map((s) => s.text).join("")])).toEqual([
      [true, "• Apples"],
      [true, "• Pears are also quite nice"],
      [true, "2) Plums"],
    ]);
  });

  it("drops running headers, footers and page numbers", () => {
    const pages = [1, 2, 3, 4].map((n) =>
      page([...line("ACME Quarterly Report", 72, 40, 9), ...paragraph(LOREM, 72, 200, 3), ...line(`Page ${n} of 4`, 280, 760, 9), ...line("Unique footer on one page", 72, n === 2 ? 770 : 500)]),
    );
    const kept = removeRunningLines(pages.map((p) => ({ page: p, lines: groupLines(p.items) })));
    const texts = kept.flat().map((l) => l.items.map((i) => i.text).join(" "));
    expect(texts.some((t) => t.includes("ACME") || t.startsWith("Page"))).toBe(false);
    expect(texts.filter((t) => t === "Unique footer on one page")).toHaveLength(4);
  });

  it("reads two-column pages column by column, but leaves tables alone", () => {
    const left = paragraph(`${LOREM} ${LOREM}`, 60, 100, 12);
    const right = paragraph(`${LOREM} ${LOREM}`.toUpperCase(), 330, 100, 12);
    const columns = splitColumns([...left, ...right], 612);
    expect(columns).toHaveLength(2);
    expect(columns[1].every((i) => i.text === i.text.toUpperCase())).toBe(true);

    const table = Array.from({ length: 8 }, (_, r) => [...line(`Item ${r}`, 60, 100 + r * 14), ...line(`${r * 10}`, 400, 100 + r * 14)]).flat();
    expect(splitColumns(table, 612)).toHaveLength(1);
  });
});

describe("PDF to Word", () => {
  it("writes headings, lists and paragraphs that Word-compatible readers understand", async () => {
    const pages = [
      page([
        ...line("Annual Summary", 225, 80, 24, { bold: true }),
        ...line("Background", 72, 130, 15, { bold: true }),
        ...paragraph(LOREM, 72, 160, 3),
        ...line("• First point", 72, 230),
        ...line("• Second point", 72, 244),
      ]),
      page([...line("Findings & results <2025>", 72, 80, 15, { bold: true }), ...paragraph(LOREM, 72, 110, 3)]),
    ];
    const result = textPagesToDocx(pages, { pageBreaks: true });
    expect(result.headings).toBe(3);
    expect(result.preview.slice(0, 2)).toEqual([
      { kind: "h1", text: "Annual Summary" },
      { kind: "h2", text: "Background" },
    ]);

    const html = await docxHtml(result.bytes);
    expect(html).toContain("<h1>");
    expect(html).toContain("Annual Summary");
    expect(html).toContain("<h2><strong>Findings &amp; results &lt;2025&gt;</strong></h2>");
    expect(html).toContain("Privacy tools should run where the files are.");

    const files = unzipSync(result.bytes);
    expect(Object.keys(files).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/document.xml", "word/styles.xml"]);
    const xml = new TextDecoder().decode(files["word/document.xml"]);
    expect(xml).toContain("<w:pageBreakBefore/>");
    expect(xml).toContain('•</w:t><w:tab/><w:t xml:space="preserve">First point');
  });

  it("can flow text across pages instead, rejoining a split paragraph", async () => {
    const pages = [page(paragraph("This sentence starts on the first page and", 72, 100, 1)), page(paragraph("finishes on the second one.", 72, 100, 1))];
    const result = textPagesToDocx(pages, { pageBreaks: false });
    expect(result.paragraphs).toBe(1);
    expect(await docxHtml(result.bytes)).toContain("first page and finishes on the second one.");
  });

  it("explains that scans have no text", () => {
    expect(() => textPagesToDocx([page([])], { pageBreaks: true })).toThrow(/no selectable text/);
  });
});

describe("PDF to Excel", () => {
  const invoice = page([
    ...line("Invoice 2024-117", 72, 60, 16),
    ...line("Item", 72, 100), ...line("Qty", 300, 100), ...line("Amount (USD)", 420, 100),
    ...line("Consulting services", 72, 114), ...line("12", 305, 114), ...line("1,440.00", 430, 114),
    ...line("Hosting", 72, 128), ...line("1", 310, 128), ...line("(15.50)", 435, 128),
    ...line("Part no.", 72, 142), ...line("007", 305, 142), ...line("n/a", 440, 142),
  ]);

  it("parses numbers but keeps codes and text as text", () => {
    expect(cellValue("1,440.00")).toBe(1440);
    expect(cellValue("(15.50)")).toBe(-15.5);
    expect(cellValue("$ 3")).toBe(3);
    expect(cellValue("-2")).toBe(-2);
    expect(cellValue("007")).toBe("007");
    expect(cellValue("12%")).toBe("12%");
    expect(cellValue("2024-117")).toBe("2024-117");
    expect(cellValue("1.234,50")).toBe("1.234,50");
  });

  it("finds columns from whitespace gutters", () => {
    const rows = groupLines(invoice.items).map(lineCells);
    expect(rows[1].map((c) => c.text)).toEqual(["Item", "Qty", "Amount (USD)"]);
    expect(columnBands(rows)).toHaveLength(3);
  });

  it("writes an .xlsx that spreadsheet apps read back cell for cell", () => {
    const result = textPagesToXlsx([invoice, page(line("Thanks!", 72, 100))], [1, 2], { layout: "sheet-per-page" });
    expect(result.sheets).toBe(2);
    const book = XLSX.read(result.bytes, { type: "array" });
    expect(book.SheetNames).toEqual(["Page 1", "Page 2"]);
    expect(XLSX.utils.sheet_to_json(book.Sheets["Page 1"], { header: 1 })).toEqual([
      ["Invoice 2024-117"],
      ["Item", "Qty", "Amount (USD)"],
      ["Consulting services", 12, 1440],
      ["Hosting", 1, -15.5],
      ["Part no.", "007", "n/a"],
    ]);
    expect(Object.keys(unzipSync(result.bytes)).some((f) => f.startsWith("docProps"))).toBe(false);
  });

  it("can put every page on one sheet", () => {
    const result = textPagesToXlsx([invoice, page(line("Thanks!", 72, 100))], [1, 2], { layout: "single-sheet" });
    const rows = XLSX.utils.sheet_to_json(XLSX.read(result.bytes, { type: "array" }).Sheets.PDF, { header: 1, blankrows: true });
    expect(rows.at(-1)).toEqual(["Thanks!"]);
    expect(rows.at(-2)).toEqual([]);
  });

  it("names columns and sheets the way Excel requires", () => {
    expect([0, 25, 26, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "ZZ", "AAA"]);
    expect(sheetNames(["Q1/Q2: [draft]", "", "Summary", "summary", "x".repeat(40)])).toEqual(["Q1 Q2   draft", "Sheet2", "Summary", "summary (2)", "x".repeat(31)]);
  });
});
