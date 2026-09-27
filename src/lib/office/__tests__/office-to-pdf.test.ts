import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { addJpegMetadata, TINY_JPEG } from "../../metadata/__tests__/fixtures";
import { renderFlow } from "../flow";
import { inspectWorkbook, MAX_ROWS, workbookToPdf } from "../sheet";
import { docxToPdf } from "../word";
import { liberationSans, sampleDocx } from "./fixtures";

const fonts = liberationSans();

/** Text of each page, as a PDF reader extracts it. */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const doc = await task.promise;
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    // pdf.js inserts its own spaces for gaps; line ends become spaces too.
    texts.push(content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? " " : "") : "")).join("").replace(/\s+/g, " "));
  }
  await task.destroy(); // pdf.js 6: destroy() lives on the loading task
  return texts;
}

function xlsxBytes(sheets: Record<string, XLSX.WorkSheet>, hidden: string[] = []): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const [name, sheet] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, sheet, name);
  book.Workbook = { Sheets: book.SheetNames.map((name) => ({ name, Hidden: hidden.includes(name) ? 1 : 0 })) };
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
}

describe("Word to PDF", () => {
  const photo = addJpegMetadata(TINY_JPEG, { exif: { artist: "Jane Doe", gps: { lat: 25.2, lon: 55.27 } } });

  it("carries over headings, styled text, lists, tables, notes and page breaks", async () => {
    const result = await docxToPdf(sampleDocx(photo), { pageSize: "a4" }, fonts);
    expect(result.pages).toBe(2);
    const [first, second] = await pageTexts(result.bytes);
    for (const text of ["Quarterly Plan", "Goals", "Plain, bold, italic and underlined text.", "Visit the project", "Centred line", "Budget"]) {
      expect(first).toContain(text);
    }
    expect(first).toMatch(/• First bullet/);
    expect(first).toMatch(/◦ Nested bullet/);
    expect(first).toMatch(/1\. Step one 2\. Step two/);
    expect(first).toMatch(/Item Q1 Q2 Hosting 120 140 Merged total: 260/);
    expect(first).toContain("Привет, Ελληνικά, ??");
    expect(second).toContain("Appendix on its own page");
    expect(second).toMatch(/Notes 1\. Translations were checked by hand\./);
    expect(result.warnings).toEqual([expect.stringMatching(/^2 characters .* show as “\?”/)]);
  });

  it("adds a clickable link, embeds the photo without its EXIF, and no producer metadata", async () => {
    const { bytes } = await docxToPdf(sampleDocx(photo), { pageSize: "letter" }, fonts);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    const annots = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    const uris = annots.asArray().map((ref) => ((doc.context.lookup(ref) as PDFDict).lookup(PDFName.of("A")) as PDFDict).lookup(PDFName.of("URI")) as PDFString);
    expect(uris.map((u) => u.decodeText())).toContain("https://example.org/plan");
    const raw = new TextDecoder("latin1").decode(bytes);
    expect(raw).toContain("/DCTDecode");
    expect(raw).not.toContain("Jane Doe");
    expect(raw).not.toContain("Exif");
    expect(doc.getProducer()).toBeUndefined();
  });

  it("flows long documents across pages", async () => {
    const result = await docxToPdf(sampleDocx(photo, 60), { pageSize: "a4" }, fonts);
    expect(result.pages).toBeGreaterThan(3);
    const texts = await pageTexts(result.bytes);
    expect(texts.join(" ")).toContain("Filler paragraph 60.");
  });

  it("explains files it can't open", async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    await expect(docxToPdf(ole, { pageSize: "a4" }, fonts, "secret.docx")).rejects.toThrow(/password-protected or in the old \.doc format/);
    await expect(docxToPdf(new TextEncoder().encode("hello"), { pageSize: "a4" }, fonts, "notes.docx")).rejects.toThrow(/“notes\.docx” couldn't be read/);
  });
});

describe("Excel to PDF", () => {
  const sales = XLSX.utils.aoa_to_sheet([
    ["Region", "Units", "Revenue", "Secret", "Updated"],
    ["North", 1200, 1234.5, "hidden!", new Date(Date.UTC(2025, 0, 31))],
    ["South", 800, 99, "hidden!", new Date(Date.UTC(2025, 1, 28))],
    ["Total across all regions", null, null, null, null],
  ]);
  sales["!cols"] = [{ wch: 14 }, { wch: 8 }, { wch: 12 }, { hidden: true }, { wch: 12 }];
  sales["!merges"] = [{ s: { r: 3, c: 0 }, e: { r: 3, c: 2 } }];
  for (const ref of ["C2", "C3"]) sales[ref].z = '"$"#,##0.00';
  const wide = XLSX.utils.aoa_to_sheet([Array.from({ length: 40 }, (_, i) => `Column ${i + 1} heading`), Array.from({ length: 40 }, (_, i) => i)]);

  it("lists sheets with their size and visibility", () => {
    const bytes = xlsxBytes({ Sales: sales, Wide: wide, Scratch: XLSX.utils.aoa_to_sheet([["x"]]) }, ["Scratch"]);
    expect(inspectWorkbook(bytes)).toEqual([
      { name: "Sales", rows: 4, columns: 5, hidden: false },
      { name: "Wide", rows: 2, columns: 40, hidden: false },
      { name: "Scratch", rows: 1, columns: 1, hidden: true },
    ]);
  });

  it("renders formatted values, skips hidden columns and honours merges", async () => {
    const bytes = xlsxBytes({ Sales: sales });
    const result = await workbookToPdf(bytes, { sheets: ["Sales"], pageSize: "a4", orientation: "auto", headerRow: true }, fonts);
    const [text] = await pageTexts(result.bytes);
    expect(text).toMatch(/Sales Region Units Revenue Updated North 1200 \$1,234\.50 1\/31\/25/);
    expect(text).toContain("Total across all regions");
    expect(text).not.toContain("hidden!");
    expect((await PDFDocument.load(result.bytes)).getPage(0).getWidth()).toBeCloseTo(595.28);
  });

  it("splits sheets too wide for the page into column groups, in landscape", async () => {
    const result = await workbookToPdf(xlsxBytes({ Wide: wide }), { sheets: ["Wide"], pageSize: "letter", orientation: "auto", headerRow: true }, fonts);
    const texts = await pageTexts(result.bytes);
    expect(texts.length).toBeGreaterThan(1);
    expect(texts[1]).toMatch(/^Wide \(columns [A-Z]+–[A-Z]+\)/);
    expect(texts.join(" ")).toContain("Column 40 heading");
    expect((await PDFDocument.load(result.bytes)).getPage(0).getWidth()).toBe(792);
  });

  it("repeats the header row on every page of a long table", async () => {
    const long = XLSX.utils.aoa_to_sheet([["Invoice", "Amount"], ...Array.from({ length: 150 }, (_, i) => [`INV-${1000 + i}`, i * 3])]);
    const result = await workbookToPdf(xlsxBytes({ Long: long }), { sheets: ["Long"], pageSize: "a4", orientation: "portrait", headerRow: true }, fonts);
    const texts = await pageTexts(result.bytes);
    expect(texts.length).toBeGreaterThan(1);
    for (const text of texts) expect(text).toContain("Invoice Amount");
    expect(texts.at(-1)).toContain("INV-1149");
  });

  it("caps huge sheets and says so", async () => {
    const huge = XLSX.utils.aoa_to_sheet(Array.from({ length: MAX_ROWS + 10 }, (_, i) => [i]));
    const result = await workbookToPdf(xlsxBytes({ Huge: huge }), { sheets: ["Huge"], pageSize: "a4", orientation: "auto", headerRow: false }, fonts);
    expect(result.warnings[0]).toMatch(/more than 5,000 rows/);
  }, 30_000);

  it("reads CSV too", async () => {
    const csv = new TextEncoder().encode("name,city\nZoë,Zürich\n");
    const result = await workbookToPdf(csv, { sheets: inspectWorkbook(csv).map((s) => s.name), pageSize: "a4", orientation: "auto", headerRow: true }, fonts);
    expect((await pageTexts(result.bytes))[0]).toContain("Zoë Zürich");
  });
});

describe("flow layout", () => {
  it("breaks words longer than a line instead of overflowing", async () => {
    const result = await renderFlow([{ type: "paragraph", runs: [{ text: "x".repeat(400) }] }], { pageWidth: 300, pageHeight: 400, margin: 36, fonts, size: 11 });
    const [text] = await pageTexts(result.bytes);
    expect(text.replace(/ /g, "")).toBe("x".repeat(400));
  });
});
