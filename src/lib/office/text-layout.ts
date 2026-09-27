/*
 * Rebuilding document structure from positioned text (pdf.js text content). Pure functions, so
 * the heuristics are unit-testable with synthetic pages.
 */

/** A piece of text as placed on a page: top-down page coordinates in points, page rotation applied. */
export interface TextItem {
  text: string;
  /** Left edge. */
  x: number;
  /** Baseline, measured from the top of the page. */
  y: number;
  width: number;
  /** Font size. */
  size: number;
  bold?: boolean;
  italic?: boolean;
}

export interface TextPage {
  width: number;
  height: number;
  items: TextItem[];
}

export interface TextLine {
  /** Items in reading order (left to right). */
  items: TextItem[];
  x: number;
  right: number;
  y: number;
  /** Dominant font size. */
  size: number;
}

export interface Segment {
  text: string;
  bold: boolean;
  italic: boolean;
  size: number;
}

/** Group a page's items into lines, top to bottom. */
export function groupLines(items: TextItem[]): TextLine[] {
  const sorted = items.filter((i) => i.text.trim() && i.size > 0).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextItem[][] = [];
  // Compare against the line's largest text, so a superscript sorted first doesn't become the reference.
  let anchor: TextItem | null = null;
  for (const item of sorted) {
    const line = lines.at(-1);
    // Same line when the baselines are within ~45% of the larger font size (allows super/subscripts).
    if (line && anchor && Math.abs(item.y - anchor.y) <= Math.max(1.5, 0.45 * Math.max(item.size, anchor.size))) {
      line.push(item);
      if (item.size > anchor.size) anchor = item;
    } else {
      lines.push([item]);
      anchor = item;
    }
  }
  return lines.map((line) => {
    const inOrder = [...line].sort((a, b) => a.x - b.x);
    const sizes = weightedMode(inOrder.map((i) => [i.size, i.text.length]));
    // The baseline of the dominant text, not of a stray superscript.
    const main = inOrder.find((i) => Math.abs(i.size - sizes) < 0.01) ?? inOrder[0];
    return {
      items: inOrder,
      x: inOrder[0].x,
      right: Math.max(...inOrder.map((i) => i.x + i.width)),
      y: main.y,
      size: sizes,
    };
  });
}

/** The value carrying the most weight, e.g. the font size used for the most characters. */
export function weightedMode(pairs: [number, number][]): number {
  const totals = new Map<number, number>();
  for (const [value, weight] of pairs) {
    const key = Math.round(value * 2) / 2;
    totals.set(key, (totals.get(key) ?? 0) + weight);
  }
  let best = pairs[0]?.[0] ?? 0;
  let bestWeight = -1;
  for (const [value, weight] of totals) {
    if (weight > bestWeight) [best, bestWeight] = [value, weight];
  }
  return best;
}

/**
 * Split a two-column page into its columns (left first) so lines aren't interleaved. Looks for a
 * vertical gutter in the middle of the page that almost nothing crosses, and only splits when the
 * lines on both sides are long: tables have gutters too, but their cells are short.
 */
export function splitColumns(items: TextItem[], pageWidth: number): TextItem[][] {
  const text = items.filter((i) => i.text.trim());
  if (text.length < 20) return [items];
  const lo = Math.floor(pageWidth * 0.3);
  const hi = Math.ceil(pageWidth * 0.7);
  const coverage = new Array<number>(hi - lo).fill(0);
  for (const i of text) {
    for (let x = Math.max(lo, Math.floor(i.x)); x < Math.min(hi, Math.ceil(i.x + i.width)); x++) coverage[x - lo]++;
  }
  // The widest run of (nearly) uncovered positions, e.g. a full-width title may cross it.
  const tolerated = Math.max(1, Math.floor(text.length * 0.03));
  let best: [number, number] | null = null;
  let start: number | null = null;
  coverage.concat(Infinity).forEach((count, i) => {
    if (count <= tolerated && start === null) start = i;
    if (count > tolerated && start !== null) {
      if (!best || i - start > best[1] - best[0]) best = [start, i];
      start = null;
    }
  });
  if (!best || best[1] - best[0] < 8) return [items];
  const gutter = lo + (best[0] + best[1]) / 2;

  const left = items.filter((i) => i.x + i.width / 2 < gutter);
  const right = items.filter((i) => i.x + i.width / 2 >= gutter);
  const long = (side: TextItem[], width: number) => {
    const lines = groupLines(side);
    if (lines.length < 5) return false;
    const widths = lines.map((l) => l.right - l.x).sort((a, b) => a - b);
    return widths[Math.floor(widths.length / 2)] > width * 0.5;
  };
  const leftEdge = Math.min(...left.map((i) => i.x));
  const rightEdge = Math.max(...right.map((i) => i.x + i.width));
  return long(left, gutter - leftEdge) && long(right, rightEdge - gutter) ? [left, right] : [items];
}

const isSpace = (s: string) => /\s$/.test(s);

/**
 * A line's text as styled segments. Gaps wider than a normal word space become spaces; gaps wider
 * than `tabGap` × font size become tabs (column breaks).
 */
export function lineSegments(line: TextLine, tabGap = 3): Segment[] {
  const segments: Segment[] = [];
  let prevRight: number | null = null;
  for (const item of line.items) {
    let text = item.text;
    if (prevRight !== null) {
      const gap = item.x - prevRight;
      const last = segments.at(-1)!;
      if (gap > tabGap * item.size) {
        last.text = last.text.trimEnd();
        text = `\t${text.trimStart()}`;
      } else if (gap > 0.15 * item.size && !isSpace(last.text) && !/^\s/.test(text)) {
        text = ` ${text}`;
      }
    }
    prevRight = Math.max(prevRight ?? -Infinity, item.x + item.width);
    const last = segments.at(-1);
    const style = { bold: Boolean(item.bold), italic: Boolean(item.italic), size: item.size };
    if (last && last.bold === style.bold && last.italic === style.italic && Math.abs(last.size - style.size) < 0.25) last.text += text;
    else segments.push({ text, ...style });
  }
  return segments;
}

export const lineText = (line: TextLine, tabGap?: number) => lineSegments(line, tabGap).map((s) => s.text).join("");

// ---------------------------------------------------------------------------- Headers and footers

const PAGE_NUMBER = /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$|^[-–—]\s*\d{1,4}\s*[-–—]$/i;

/**
 * Drop running headers/footers: lines in the top or bottom 8% of the page that are page numbers,
 * or whose text (digits ignored) repeats on at least half of the pages (3 pages minimum).
 */
export function removeRunningLines(pages: { page: TextPage; lines: TextLine[] }[]): TextLine[][] {
  const inMargin = (page: TextPage, line: TextLine) => line.y < page.height * 0.08 || line.y > page.height * 0.92;
  const key = (line: TextLine) => lineText(line).replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
  const counts = new Map<string, number>();
  for (const { page, lines } of pages) {
    const seen = new Set(lines.filter((l) => inMargin(page, l)).map(key));
    for (const k of seen) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const repeating = (k: string) => pages.length >= 3 && (counts.get(k) ?? 0) >= Math.max(3, pages.length / 2);
  return pages.map(({ page, lines }) =>
    lines.filter((line) => !(inMargin(page, line) && (PAGE_NUMBER.test(lineText(line).trim()) || repeating(key(line))))),
  );
}

// ---------------------------------------------------------------------------- Paragraphs

const BULLET = /^\s*([•●○◦▪▫■□‣⁃∙·*–-])\s+/;
const NUMBERED = /^\s*(\(?(\d{1,3}|[a-z]|[ivxlcdm]{1,5})[.)])\s+/i;

export interface Paragraph {
  segments: Segment[];
  /** Dominant font size. */
  size: number;
  x: number;
  lines: number;
  list: boolean;
  centered: boolean;
  /** Index of the page it starts on. */
  page: number;
}

function joinSegments(target: Segment[], next: Segment[]) {
  const last = target.at(-1);
  const first = next[0];
  if (last && first) {
    // "infor-" + "mation" -> "information"; otherwise lines are joined with a space.
    if (/[a-z]-$/i.test(last.text) && /^[a-z]/.test(first.text)) last.text = last.text.slice(0, -1);
    else if (!isSpace(last.text)) first.text = ` ${first.text}`;
  }
  for (const s of next) {
    const prev = target.at(-1);
    if (prev && prev.bold === s.bold && prev.italic === s.italic && Math.abs(prev.size - s.size) < 0.25) prev.text += s.text;
    else target.push({ ...s });
  }
}

/** Group lines into paragraphs using vertical gaps, size changes, indents, list markers and short last lines. */
export function groupParagraphs(page: TextPage, lines: TextLine[], pageIndex: number): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const widest = Math.max(0, ...lines.map((l) => l.right));
  let current: Paragraph | null = null;
  let prev: TextLine | null = null;

  const isCentered = (line: TextLine) => {
    const center = (line.x + line.right) / 2;
    return Math.abs(center - page.width / 2) < page.width * 0.03 && line.right - line.x < page.width * 0.7 && line.x > page.width * 0.12;
  };

  for (const line of lines) {
    const text = lineText(line);
    const listStart = BULLET.test(text) || NUMBERED.test(text);
    const segments = lineSegments(line);
    let breakBefore = true;
    if (current && prev) {
      const gap = line.y - prev.y;
      const bigger = Math.max(line.size, prev.size);
      const allBold = (l: TextLine) => l.items.every((i) => i.bold);
      const prevText = lineText(prev).trimEnd();
      breakBefore =
        // Lines with column gaps are table rows: keep each on its own.
        prevText.includes("\t") ||
        text.includes("\t") ||
        gap > bigger * 1.75 || // blank space between paragraphs
        gap < 0 || // text flowing back up: a new column
        Math.abs(line.size - prev.size) > prev.size * 0.15 ||
        listStart ||
        allBold(prev) !== allBold(line) ||
        isCentered(prev) !== isCentered(line) ||
        (!current.list && line.x > prev.x + line.size * 1.2) || // indented first line
        (/[.!?:]["”’)]?$/.test(prevText) && prev.right < widest - line.size * 4); // short last line
    }

    if (breakBefore || !current) {
      current = { segments: [], size: line.size, x: line.x, lines: 0, list: listStart, centered: isCentered(line), page: pageIndex };
      paragraphs.push(current);
      current.segments.push(...segments.map((s) => ({ ...s })));
    } else {
      joinSegments(current.segments, segments);
      current.x = Math.min(current.x, line.x);
      current.centered &&= isCentered(line);
    }
    current.lines++;
    prev = line;
  }
  for (const p of paragraphs) p.size = weightedMode(p.segments.map((s) => [s.size, s.text.length]));
  return paragraphs;
}

export type HeadingLevel = 1 | 2 | 3;

/** Heading level from the size relative to body text, or bold short standalone lines. */
export function headingLevel(p: Paragraph, bodySize: number): HeadingLevel | null {
  const text = p.segments.map((s) => s.text).join("").trim();
  // Lists and table rows (column gaps) are never headings.
  if (p.list || text.includes("\t") || p.lines > 3 || text.length > 200 || !/\p{L}/u.test(text)) return null;
  const ratio = p.size / bodySize;
  if (ratio >= 1.6) return 1;
  if (ratio >= 1.3) return 2;
  if (ratio >= 1.12) return 3;
  const bold = p.segments.every((s) => s.bold || !s.text.trim());
  if (bold && p.lines === 1 && text.length <= 80 && !/[.:,;]$/.test(text)) return 3;
  return null;
}

// ---------------------------------------------------------------------------- Tables

export interface Cell {
  x0: number;
  x1: number;
  text: string;
}

/** Split a line into cells wherever the gap is wider than a word space. */
export function lineCells(line: TextLine): Cell[] {
  const cells: Cell[] = [];
  for (const item of line.items) {
    const last = cells.at(-1);
    const gap = last ? item.x - last.x1 : Infinity;
    if (last && gap <= 0.9 * item.size) {
      last.text += (gap > 0.15 * item.size && !isSpace(last.text) && !/^\s/.test(item.text) ? " " : "") + item.text;
      last.x1 = Math.max(last.x1, item.x + item.width);
    } else {
      cells.push({ x0: item.x, x1: item.x + item.width, text: item.text });
    }
  }
  return cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, " ").trim() })).filter((c) => c.text);
}

/**
 * Column bands for a page: x ranges separated by vertical "rivers" of whitespace that (almost) no
 * multi-cell row crosses. A header spanning two columns doesn't merge them, because a few crossings
 * are tolerated.
 */
export function columnBands(rows: Cell[][]): [number, number][] {
  const multi = rows.filter((r) => r.length >= 2);
  if (multi.length === 0) return [];
  const minX = Math.floor(Math.min(...multi.flatMap((r) => r.map((c) => c.x0))));
  const maxX = Math.ceil(Math.max(...multi.flatMap((r) => r.map((c) => c.x1))));
  const coverage = new Array<number>(maxX - minX + 1).fill(0);
  for (const row of multi) {
    for (const cell of row) {
      for (let x = Math.floor(cell.x0); x < Math.ceil(cell.x1); x++) coverage[x - minX]++;
    }
  }
  const tolerated = Math.floor(multi.length * 0.1);
  const bands: [number, number][] = [];
  let start: number | null = null;
  coverage.forEach((count, i) => {
    if (count > tolerated && start === null) start = i;
    if (count <= tolerated && start !== null) {
      bands.push([start + minX, i + minX]);
      start = null;
    }
  });
  if (start !== null) bands.push([start + minX, maxX]);
  return bands;
}

const NUMBER = /^(\()?([-+−])?\s?([$€£¥])?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\))?$/;

/** "1,234.50" -> 1234.5, "(12)" -> -12, "$ 3" -> 3. Anything else (IDs with leading zeros, dates, %) stays text. */
export function cellValue(text: string): string | number {
  const m = NUMBER.exec(text.trim());
  if (!m) return text;
  const [, open, sign, , whole, fraction, close] = m;
  if (Boolean(open) !== Boolean(close)) return text;
  const digits = whole.replace(/,/g, "");
  if (digits.length > 1 && digits.startsWith("0") && !fraction) return text; // 007, 02134
  if (digits.length + (fraction?.length ?? 0) > 15) return text; // beyond double precision
  const value = Number(digits + (fraction ?? ""));
  return open || sign === "-" || sign === "−" ? -value : value;
}

/** A page's text as spreadsheet rows, columns aligned across the page. */
export function pageRows(lines: TextLine[]): (string | number | null)[][] {
  const rows = lines.map(lineCells).filter((r) => r.length > 0);
  const bands = columnBands(rows);
  const bandOf = (x: number) => {
    let index = 0;
    bands.forEach(([start], i) => {
      if (x >= start - 1) index = i;
    });
    return index;
  };
  return rows.map((cells) => {
    const row: (string | null)[] = [];
    for (const cell of cells) {
      const c = bandOf(cell.x0);
      row[c] = row[c] ? `${row[c]} ${cell.text}` : cell.text;
    }
    return Array.from(row, (v) => (v == null ? null : cellValue(v)));
  });
}
