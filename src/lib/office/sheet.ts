import { rgb } from "@cantoo/pdf-lib";
import * as XLSX from "xlsx";
import { ProcessingError } from "../errors";
import { PAGE_SIZES } from "../pdf/images";
import { renderFlow, type Block, type FontFiles, type ParagraphBlock, type TableBlock } from "./flow";
import { columnName } from "./xlsx";
import { missingCharactersWarning, type ConversionResult } from "./word";

/*
 * Spreadsheet (.xlsx, .xls, .ods, .csv) -> PDF: each chosen sheet becomes a paginated table.
 * Formatted cell text (dates, currency, percentages) comes from the workbook's own number formats.
 */

export interface SheetSummary {
  name: string;
  rows: number;
  columns: number;
  hidden: boolean;
}

export interface SheetToPdfOptions {
  /** Names of the sheets to include, in workbook order. */
  sheets: string[];
  pageSize: "a4" | "letter";
  orientation: "auto" | "portrait" | "landscape";
  /** Treat the first row as a header: shaded and repeated on every page. */
  headerRow: boolean;
}

const MARGIN = 36;
const FONT_SIZE = 9;
/** Excel column widths are in characters of the default font; about 5.3 pt each at 9 pt. */
const POINTS_PER_CHAR = 5.3;
const MIN_SCALE = 0.62;
/** Beyond this, a sheet is cut off (with a warning) rather than producing thousands of pages. */
export const MAX_ROWS = 5000;

/** CSV and other text files: UTF-8, or Windows-1252 when the bytes aren't valid UTF-8. */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function readWorkbook(bytes: Uint8Array, name: string): XLSX.WorkBook {
  // Workbooks are zip (xlsx, ods) or OLE (xls) containers; anything else is read as text.
  const container = (bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf);
  // cellStyles also reads column widths and hidden rows/columns.
  const options: XLSX.ParsingOptions = { cellDates: true, cellStyles: true, dense: true };
  try {
    return container ? XLSX.read(bytes, { ...options, type: "array" }) : XLSX.read(decodeText(bytes), { ...options, type: "string" });
  } catch (error) {
    if (error instanceof Error && /password|encrypt/i.test(error.message)) {
      throw new ProcessingError(`“${name}” is password-protected. Save an unprotected copy first.`, "unsupported");
    }
    throw new ProcessingError(`“${name}” couldn't be read as a spreadsheet.`, "corrupt");
  }
}

/** The rows and columns that actually hold something. */
function usedRange(sheet: XLSX.WorkSheet): XLSX.Range | null {
  if (!sheet["!ref"]) return null;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const data = sheet["!data"];
  let rows = -1;
  let cols = -1;
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = data?.[r];
    if (!row) continue;
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (row[c] && XLSX.utils.format_cell(row[c]).trim()) {
        rows = r;
        cols = Math.max(cols, c);
      }
    }
  }
  return rows < 0 ? null : { s: range.s, e: { r: rows, c: cols } };
}

export function inspectWorkbook(bytes: Uint8Array, name = "This file"): SheetSummary[] {
  const book = readWorkbook(bytes, name);
  return book.SheetNames.map((sheetName, i) => {
    const range = usedRange(book.Sheets[sheetName]);
    return {
      name: sheetName,
      rows: range ? range.e.r - range.s.r + 1 : 0,
      columns: range ? range.e.c - range.s.c + 1 : 0,
      hidden: Boolean(book.Workbook?.Sheets?.[i]?.Hidden),
    };
  });
}

interface Grid {
  /** Visible rows of visible cells; null = covered by a merge. */
  rows: ({ text: string; numeric: boolean; span: number } | null)[][];
  /** Visible columns: sheet letter and width in points (at 9 pt). */
  columns: { letter: string; width: number }[];
  truncated: boolean;
}

function sheetGrid(sheet: XLSX.WorkSheet): Grid | null {
  const range = usedRange(sheet);
  if (!range) return null;
  const data = sheet["!data"] ?? [];
  const colInfo = sheet["!cols"] ?? [];
  const rowInfo = sheet["!rows"] ?? [];
  const visibleCols: number[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) if (!colInfo[c]?.hidden) visibleCols.push(c);
  const visibleRows: number[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) if (!rowInfo[r]?.hidden) visibleRows.push(r);
  const truncated = visibleRows.length > MAX_ROWS;

  // Merged areas: the top-left cell spans the merged (visible) columns; the rest are covered.
  const spans = new Map<string, number>();
  const covered = new Set<string>();
  for (const m of sheet["!merges"] ?? []) {
    const cols = visibleCols.filter((c) => c >= m.s.c && c <= m.e.c);
    for (let r = m.s.r; r <= m.e.r; r++) {
      cols.forEach((c, i) => (i === 0 ? spans.set(`${r}:${c}`, cols.length) : covered.add(`${r}:${c}`)));
    }
  }

  const rows = visibleRows.slice(0, MAX_ROWS).map((r) =>
    visibleCols.map((c) => {
      if (covered.has(`${r}:${c}`)) return null;
      const cell = data[r]?.[c];
      const text = cell ? XLSX.utils.format_cell(cell).trim() : "";
      return { text, numeric: cell?.t === "n" || cell?.t === "d", span: spans.get(`${r}:${c}`) ?? 1 };
    }),
  );

  const columns = visibleCols.map((c, i) => {
    const info = colInfo[c];
    const chars = info?.wch ?? (info?.wpx ? info.wpx / 7 : info?.width);
    // Without stored widths, size columns to their longest value.
    const content = Math.max(...rows.map((row) => (row[i] && row[i]!.span === 1 ? row[i]!.text.length : 0)), 4) + 3;
    const width = (chars ?? Math.min(content, 45)) * POINTS_PER_CHAR;
    return { letter: columnName(c), width: Math.min(Math.max(width, 18), 320) };
  });
  return { rows, columns, truncated };
}

export async function workbookToPdf(bytes: Uint8Array, options: SheetToPdfOptions, fonts: FontFiles, name = "This file"): Promise<ConversionResult> {
  const book = readWorkbook(bytes, name);
  const chosen = book.SheetNames.filter((n) => options.sheets.includes(n));
  if (chosen.length === 0) throw new ProcessingError("Choose at least one sheet.", "invalid");

  const grids = chosen.map((n) => ({ name: n, grid: sheetGrid(book.Sheets[n]) }));
  const [short, long] = PAGE_SIZES[options.pageSize];
  const widest = Math.max(0, ...grids.map(({ grid }) => grid?.columns.reduce((w, c) => w + c.width, 0) ?? 0));
  const landscape = options.orientation === "landscape" || (options.orientation === "auto" && widest > short - 2 * MARGIN);
  const [pageWidth, pageHeight] = landscape ? [long, short] : [short, long];
  const contentWidth = pageWidth - 2 * MARGIN;

  const blocks: Block[] = [];
  const warnings: string[] = [];
  grids.forEach(({ name: sheetName, grid }, index) => {
    if (index > 0) blocks.push({ type: "pageBreak" });
    blocks.push({ type: "paragraph", runs: [{ text: sheetName, bold: true }], size: 12, spaceAfter: 8 });
    if (!grid) {
      blocks.push({ type: "paragraph", runs: [{ text: "This sheet is empty.", italic: true }], size: FONT_SIZE });
      return;
    }
    if (grid.truncated) warnings.push(`“${sheetName}” has more than ${MAX_ROWS.toLocaleString()} rows; only the first ${MAX_ROWS.toLocaleString()} are included.`);

    // Shrink to fit the page width; if that would make text too small, split the columns into groups.
    const total = grid.columns.reduce((w, c) => w + c.width, 0);
    const scale = Math.min(1, Math.max(MIN_SCALE, contentWidth / total));
    const groups: number[][] = [[]];
    let used = 0;
    grid.columns.forEach((col, i) => {
      const w = col.width * scale;
      if (used + w > contentWidth + 0.5 && groups.at(-1)!.length) {
        groups.push([]);
        used = 0;
      }
      groups.at(-1)!.push(i);
      used += Math.min(w, contentWidth);
    });

    groups.forEach((group, g) => {
      if (g > 0) {
        blocks.push({ type: "pageBreak" });
        const label = `${sheetName} (columns ${grid.columns[group[0]].letter}–${grid.columns[group.at(-1)!].letter})`;
        blocks.push({ type: "paragraph", runs: [{ text: label, bold: true }], size: 12, spaceAfter: 8 });
      }
      blocks.push(tableFor(grid, group, scale, contentWidth, options.headerRow));
    });
  });

  const result = await renderFlow(blocks, { pageWidth, pageHeight, margin: MARGIN, fonts, size: FONT_SIZE });
  if (result.missingCharacters) warnings.push(missingCharactersWarning(result.missingCharacters));
  return { bytes: result.bytes, pages: result.pages, warnings };
}

function tableFor(grid: Grid, group: number[], scale: number, contentWidth: number, headerRow: boolean): TableBlock {
  const size = FONT_SIZE * scale;
  const inGroup = new Set(group);
  const rows = grid.rows.map((row, r) => {
    const cells: TableBlock["rows"][number]["cells"] = [];
    for (const c of group) {
      const cell = row[c];
      if (cell === null) {
        // Covered by a merge starting in an earlier group: keep the grid aligned with an empty cell.
        if (!group.some((g) => g < c && row[g] && g + row[g]!.span > c)) cells.push({ paragraphs: [] });
        continue;
      }
      // A merge can't reach past the end of this column group.
      let span = 1;
      while (span < cell.span && inGroup.has(c + span)) span++;
      const paragraph: ParagraphBlock = { type: "paragraph", runs: [{ text: cell.text, bold: headerRow && r === 0 }], size, align: cell.numeric ? "right" : undefined };
      cells.push({ paragraphs: cell.text ? [paragraph] : [], colSpan: span });
    }
    return { cells, header: headerRow && r === 0 };
  });
  return {
    type: "table",
    rows,
    columnWidths: group.map((c) => Math.min(grid.columns[c].width * scale, contentWidth)),
    padding: 3 * scale,
    repeatHeader: headerRow,
    headerFill: rgb(0.93, 0.93, 0.93),
  };
}
