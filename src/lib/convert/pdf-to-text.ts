import { ProcessingError } from "../errors";
import { joinAcrossPages, LIST_MARKER, NO_TEXT } from "../office/pdf-to-office";
import {
  groupLines,
  groupParagraphs,
  headingLevel,
  removeRunningLines,
  splitColumns,
  weightedMode,
  type Paragraph,
  type Segment,
  type TextPage,
} from "../office/text-layout";

/*
 * PDF -> plain text or Markdown, from the same rebuilt structure as PDF to Word: paragraphs
 * rejoined, headings from their size, lists, columns read one after the other, running headers
 * and footers dropped. Rows with column gaps become Markdown tables.
 */

export interface PdfToTextOptions {
  format: "markdown" | "text";
  /** Mark where each page starts. */
  pageMarkers: boolean;
}

export interface TextResult {
  text: string;
  paragraphs: number;
  headings: number;
  words: number;
}

const textOf = (p: Paragraph) => p.segments.map((s) => s.text).join("");

/** Backslash-escape characters that Markdown would read as formatting. */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/([\\`*_[\]<>|])/g, "\\$1")
    .replace(/^(\s*)([#+-])(\s)/, "$1\\$2$3")
    .replace(/^(\s*\d+)([.)])(\s)/, "$1\\$2$3");
}

/** Segments as Markdown: bold and italic stretches wrapped, with spaces kept outside the markers. */
export function segmentsToMarkdown(segments: Segment[], plainBold = false): string {
  // Join neighbours with the same style first.
  const merged: Segment[] = [];
  for (const s of segments) {
    const last = merged.at(-1);
    const bold = s.bold && !plainBold;
    if (last && last.bold === bold && last.italic === s.italic) last.text += s.text;
    else merged.push({ ...s, bold });
  }
  return merged
    .map((s) => {
      const text = escapeMarkdown(s.text);
      if (!s.text.trim() || (!s.bold && !s.italic)) return text;
      const marker = s.bold && s.italic ? "***" : s.bold ? "**" : "*";
      const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
      return `${lead}${marker}${core}${marker}${trail}`;
    })
    .join("");
}

/** A Markdown table from rows of cells (the first row is the header). */
function markdownTable(rows: string[][]): string {
  const columns = Math.max(...rows.map((r) => r.length));
  const line = (cells: string[]) => `| ${Array.from({ length: columns }, (_, i) => escapeMarkdown(cells[i] ?? "").trim()).join(" | ")} |`;
  return [line(rows[0]), `|${" --- |".repeat(columns)}`, ...rows.slice(1).map(line)].join("\n");
}

export function textPagesToText(pages: TextPage[], pageNumbers: number[], options: PdfToTextOptions): TextResult {
  const markdown = options.format === "markdown";
  const lines = removeRunningLines(
    pages.map((page) => ({ page, lines: splitColumns(page.items, page.width).flatMap((column) => groupLines(column)) })),
  );
  let paragraphs = pages.flatMap((page, i) => groupParagraphs(page, lines[i], i));
  if (!paragraphs.some((p) => textOf(p).trim())) throw new ProcessingError(NO_TEXT, "unsupported");
  if (!options.pageMarkers) paragraphs = joinAcrossPages(paragraphs);
  const bodySize = weightedMode(paragraphs.flatMap((p) => p.segments.map((s): [number, number] => [s.size, s.text.length])));

  const out: string[] = [];
  let headings = 0;
  let count = 0;
  let table: string[][] = [];
  const endTable = () => {
    if (table.length >= 2) out.push(markdownTable(table));
    else if (table.length === 1) out.push(escapeMarkdown(table[0].join(" ")));
    table = [];
  };

  paragraphs.forEach((p, index) => {
    const text = textOf(p).trim();
    if (!text) return;
    if (options.pageMarkers && (index === 0 || paragraphs[index - 1].page !== p.page)) {
      if (markdown) endTable();
      const number = pageNumbers[p.page];
      out.push(markdown ? `<!-- Page ${number} -->` : `--- Page ${number} ---`);
    }
    count++;
    const level = headingLevel(p, bodySize);
    if (level) headings++;

    if (!markdown) {
      out.push(text.replace(LIST_MARKER, (_, space, marker: string) => `${space}${/^[·∙*•●○◦▪▫■□‣⁃–-]$/.test(marker) ? "•" : marker} `));
      return;
    }
    // Rows with column gaps: gather into a table.
    if (text.includes("\t") && !level) {
      table.push(text.split(/\t+/));
      return;
    }
    endTable();
    if (level) {
      out.push(`${"#".repeat(level)} ${segmentsToMarkdown(p.segments, true).trim()}`);
    } else if (p.list) {
      const match = LIST_MARKER.exec(text);
      const marker = match?.[2] ?? "-";
      const numbered = /^\(?(\d{1,3})[.)]$/.exec(marker);
      const segments = p.segments.map((s) => ({ ...s }));
      // Take the marker off the first segment.
      if (match && segments[0]) segments[0].text = segments[0].text.trimStart().slice(match[0].trimStart().length);
      const body = segmentsToMarkdown(segments).trim();
      out.push(numbered ? `${numbered[1]}. ${body}` : `- ${body}`);
    } else {
      out.push(segmentsToMarkdown(p.segments).trim());
    }
  });
  if (markdown) endTable();

  // Consecutive list items stay together; everything else is separated by a blank line.
  let text = "";
  out.forEach((block, i) => {
    const listItem = (b: string) => /^(- |\d+\. )/.test(b) || (!markdown && LIST_MARKER.test(b));
    text += i === 0 ? block : `${listItem(block) && listItem(out[i - 1]) ? "\n" : "\n\n"}${block}`;
  });
  text += "\n";
  return { text, paragraphs: count, headings, words: (text.match(/[\p{L}\p{N}]+/gu) ?? []).length };
}
