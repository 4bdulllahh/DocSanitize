import { ProcessingError } from "../errors";
import { writeDocx, type DocParagraph } from "./docx";
import {
  groupLines,
  groupParagraphs,
  headingLevel,
  pageRows,
  removeRunningLines,
  splitColumns,
  weightedMode,
  type Paragraph,
  type TextPage,
} from "./text-layout";
import { writeXlsx, type CellValue } from "./xlsx";

const NO_TEXT = "This PDF has no selectable text — it's probably a scan or made of images. Text recognition (OCR) isn't supported yet.";

export type PreviewBlock = { kind: "h1" | "h2" | "h3" | "li" | "p"; text: string };

export interface PdfToWordOptions {
  /** Start each PDF page on a new Word page. */
  pageBreaks: boolean;
}

export interface WordResult {
  bytes: Uint8Array;
  paragraphs: number;
  headings: number;
  /** The first blocks, for an in-app preview. */
  preview: PreviewBlock[];
}

const PREVIEW_BLOCKS = 40;
const LIST_MARKER = /^(\s*)([•●○◦▪▫■□‣⁃∙·*–-]|\(?(?:\d{1,3}|[a-z]|[ivxlcdm]{1,5})[.)])\s+/i;

const textOf = (p: Paragraph) => p.segments.map((s) => s.text).join("");

/** Rebuild paragraphs, headings and lists from the pages' text and write them as a .docx. */
export function textPagesToDocx(pages: TextPage[], options: PdfToWordOptions): WordResult {
  const lines = removeRunningLines(
    pages.map((page) => ({ page, lines: splitColumns(page.items, page.width).flatMap((column) => groupLines(column)) })),
  );
  let paragraphs = pages.flatMap((page, i) => groupParagraphs(page, lines[i], i));
  if (!paragraphs.some((p) => textOf(p).trim())) throw new ProcessingError(NO_TEXT, "unsupported");

  if (!options.pageBreaks) paragraphs = joinAcrossPages(paragraphs);
  const bodySize = weightedMode(paragraphs.flatMap((p) => p.segments.map((s): [number, number] => [s.size, s.text.length])));
  // Left text margin per page, to express indents relative to it.
  const margins = pages.map((_, i) => Math.min(...lines[i].map((l) => l.x), Infinity));

  let headings = 0;
  const preview: PreviewBlock[] = [];
  const docParagraphs = paragraphs.map((p, index): DocParagraph => {
    const level = headingLevel(p, bodySize);
    if (level) headings++;
    const segments = p.segments.map((s) => ({ ...s }));
    if (p.list && segments[0]) {
      // A tab after the marker lines the text up on the hanging indent.
      segments[0].text = segments[0].text.replace(LIST_MARKER, (_, space, marker: string) => `${space}${/^[·∙*]$/.test(marker) ? "•" : marker}\t`);
    }
    const indent = p.x - margins[p.page];
    const text = segments.map((s) => s.text).join("");
    if (preview.length < PREVIEW_BLOCKS && text.trim()) {
      preview.push({ kind: level ? (`h${level}` as const) : p.list ? "li" : "p", text: text.replace(/\t/g, " ").trim() });
    }
    const pageStart = index > 0 && paragraphs[index - 1].page !== p.page;
    return {
      runs: segments.map((s) => ({ text: s.text, bold: s.bold, italic: s.italic, size: Math.round(s.size * 2) / 2 })),
      style: level ? `Heading${level}` : p.list ? "ListParagraph" : undefined,
      align: p.centered ? "center" : undefined,
      indent: !p.list && !p.centered && indent > 12 && indent < pages[p.page].width / 2 ? Math.round(indent) : undefined,
      pageBreakBefore: options.pageBreaks && pageStart,
    };
  });

  const first = pages[0];
  return {
    bytes: writeDocx(docParagraphs, { width: first.width, height: first.height }),
    paragraphs: docParagraphs.length,
    headings,
    preview,
  };
}

/** Merge a paragraph split by a page break: no closing punctuation, next page starts in lower case. */
function joinAcrossPages(paragraphs: Paragraph[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const p of paragraphs) {
    const prev = out.at(-1);
    const prevText = prev ? textOf(prev).trimEnd() : "";
    if (prev && prev.page !== p.page && !prev.list && !p.list && /[\p{L},]$/u.test(prevText) && /^\s*\p{Ll}/u.test(textOf(p)) && Math.abs(prev.size - p.size) < 0.5) {
      const last = prev.segments.at(-1)!;
      if (!/\s$/.test(last.text)) last.text += " ";
      prev.segments.push(...p.segments);
      prev.lines += p.lines;
    } else {
      out.push(p);
    }
  }
  return out;
}

export interface PdfToExcelOptions {
  /** One worksheet per page, or everything on one sheet. */
  layout: "sheet-per-page" | "single-sheet";
}

export interface ExcelResult {
  bytes: Uint8Array;
  sheets: number;
  rows: number;
  /** The first rows of the first sheet, for an in-app preview. */
  preview: CellValue[][];
}

/** Turn each page's text into rows and columns (without running headers/footers) and write them as an .xlsx. */
export function textPagesToXlsx(pages: TextPage[], pageNumbers: number[], options: PdfToExcelOptions): ExcelResult {
  const lines = removeRunningLines(pages.map((page) => ({ page, lines: groupLines(page.items) })));
  const perPage = lines.map(pageRows);
  if (perPage.every((rows) => rows.length === 0)) throw new ProcessingError(NO_TEXT, "unsupported");

  const sheets =
    options.layout === "single-sheet"
      ? [{ name: "PDF", rows: perPage.flatMap((rows, i) => (i > 0 && rows.length ? [[], ...rows] : rows)) }]
      : perPage.map((rows, i) => ({ name: `Page ${pageNumbers[i]}`, rows }));
  return {
    bytes: writeXlsx(sheets),
    sheets: sheets.length,
    rows: sheets.reduce((n, s) => n + s.rows.length, 0),
    preview: (sheets.find((s) => s.rows.length > 0)?.rows ?? []).slice(0, 25),
  };
}
