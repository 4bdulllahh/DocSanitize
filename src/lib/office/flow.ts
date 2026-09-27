import fontkit from "@cantoo/fontkit";
import { PDFString, rgb, type PDFDocument, type PDFFont, type PDFPage, type RGB } from "@cantoo/pdf-lib";
import { createPdf, savePdf } from "../pdf/load";

/*
 * A small typesetting engine: paragraphs, lists, tables and images flowed onto pages with pdf-lib.
 * Word and Excel conversion build `Block`s; this module measures, wraps and paginates them.
 */

export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Points; defaults to the block's size. */
  size?: number;
  script?: "super" | "sub";
  /** Makes the run a clickable link (http, https and mailto only). */
  href?: string;
}

export type Align = "left" | "center" | "right" | "justify";

export interface ParagraphBlock {
  type: "paragraph";
  runs: InlineRun[];
  align?: Align;
  /** Default size for runs without one, in points. */
  size?: number;
  /** Left indent in points. */
  indent?: number;
  /** Drawn in the indent, before the first line (a list bullet or number). */
  marker?: string;
  spaceBefore?: number;
  spaceAfter?: number;
  /** Keep at least this many points of the following content on the same page (headings). */
  keepWithNext?: number;
}

export interface TableCellBlock {
  paragraphs: ParagraphBlock[];
  colSpan?: number;
}

export interface TableBlock {
  type: "table";
  rows: { cells: TableCellBlock[]; header?: boolean }[];
  /** Final column widths in points; computed from the content when omitted. */
  columnWidths?: number[];
  padding?: number;
  /** Repeat the header rows at the top of every page the table continues on. */
  repeatHeader?: boolean;
  /** Fill for header rows. */
  headerFill?: RGB;
}

export interface ImageBlock {
  type: "image";
  bytes: Uint8Array;
  format: "jpeg" | "png";
  align?: Align;
}

export interface PageBreakBlock {
  type: "pageBreak";
}

export type Block = ParagraphBlock | TableBlock | ImageBlock | PageBreakBlock;

export interface FontFiles {
  regular: Uint8Array;
  bold: Uint8Array;
  italic: Uint8Array;
  boldItalic: Uint8Array;
}

export interface FlowOptions {
  pageWidth: number;
  pageHeight: number;
  margin: number;
  fonts: FontFiles;
  /** Body text size in points. */
  size: number;
}

export interface FlowResult {
  bytes: Uint8Array;
  pages: number;
  /** Characters the embedded font can't show; they're drawn as "?". */
  missingCharacters: number;
}

const TEXT = rgb(0.07, 0.07, 0.07);
const LINK = rgb(0.06, 0.33, 0.8);
const BORDER = rgb(0.72, 0.72, 0.72);
const LINE_HEIGHT = 1.25;

interface Fonts {
  get(bold?: boolean, italic?: boolean): PDFFont;
  /** Replace characters the font lacks with "?". */
  clean(text: string): string;
  missing: number;
}

async function embedFonts(doc: PDFDocument, files: FontFiles): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const [regular, bold, italic, boldItalic] = await Promise.all(
    [files.regular, files.bold, files.italic, files.boldItalic].map((bytes) => doc.embedFont(bytes, { subset: true })),
  );
  const supported = new Set(regular.getCharacterSet());
  const fonts: Fonts = {
    get: (b, i) => (b ? (i ? boldItalic : bold) : i ? italic : regular),
    missing: 0,
    clean: (text) =>
      Array.from(text.replace(/[\t\u00A0]/g, " "), (ch) => {
        if (ch === " " || supported.has(ch.codePointAt(0)!)) return ch;
        // Invisible formatting characters are simply dropped.
        if (/[\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/.test(ch)) return "";
        fonts.missing++;
        return "?";
      }).join(""),
  };
  return fonts;
}

/** One line (or image, or table row) ready to draw at a given position. */
interface Entry {
  height: number;
  draw: (page: PDFPage, x: number, top: number) => void;
  /** Vertical space, dropped at the top of a page. */
  spacer?: boolean;
  pageBreak?: boolean;
  /** Needs this much room below it on the same page. */
  keep?: number;
  /** Header rows to redraw when this table row starts a new page. */
  headers?: Entry[];
}

interface Token {
  text: string;
  space: boolean;
  run: InlineRun;
  font: PDFFont;
  size: number;
  width: number;
}

interface Line {
  tokens: Token[];
  width: number;
  height: number;
  ascent: number;
}

function tokenize(block: ParagraphBlock, fonts: Fonts, baseSize: number): Token[] {
  const tokens: Token[] = [];
  for (const run of block.runs) {
    const font = fonts.get(run.bold, run.italic);
    const nominal = run.size ?? block.size ?? baseSize;
    const size = run.script ? nominal * 0.65 : nominal;
    for (const part of fonts.clean(run.text).split(/( +)/)) {
      if (!part) continue;
      tokens.push({ text: part, space: part.startsWith(" "), run: { ...run, size: nominal }, font, size, width: font.widthOfTextAtSize(part, size) });
    }
  }
  return tokens;
}

/** Break a token that is wider than a whole line into pieces that fit. */
function splitToken(token: Token, maxWidth: number): Token[] {
  const pieces: Token[] = [];
  let text = "";
  for (const ch of Array.from(token.text)) {
    const next = text + ch;
    if (text && token.font.widthOfTextAtSize(next, token.size) > maxWidth) {
      pieces.push({ ...token, text, width: token.font.widthOfTextAtSize(text, token.size) });
      text = ch;
    } else {
      text = next;
    }
  }
  if (text) pieces.push({ ...token, text, width: token.font.widthOfTextAtSize(text, token.size) });
  return pieces;
}

function wrap(tokens: Token[], width: number, baseSize: number): Line[] {
  const lines: Line[] = [];
  let current: Token[] = [];
  let used = 0;
  const finish = () => {
    while (current.at(-1)?.space) current.pop();
    const size = current.length ? Math.max(...current.map((t) => t.run.size ?? baseSize)) : baseSize;
    lines.push({ tokens: current, width: current.reduce((w, t) => w + t.width, 0), height: size * LINE_HEIGHT, ascent: size * 0.95 });
    current = [];
    used = 0;
  };

  // Words are runs of non-space tokens (one word can mix styles), so lines only break at spaces.
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].space) {
      if (current.length) {
        current.push(tokens[i]);
        used += tokens[i].width;
      }
      i++;
      continue;
    }
    let j = i;
    let wordWidth = 0;
    while (j < tokens.length && !tokens[j].space) wordWidth += tokens[j++].width;
    const word = tokens.slice(i, j);
    if (used + wordWidth > width && current.some((t) => !t.space)) finish();
    if (wordWidth > width) {
      for (const piece of word.flatMap((t) => splitToken(t, width))) {
        if (used + piece.width > width && current.length) finish();
        current.push(piece);
        used += piece.width;
      }
    } else {
      current.push(...word);
      used += wordWidth;
    }
    i = j;
  }
  if (current.length || lines.length === 0) finish();
  return lines;
}

interface Context {
  doc: PDFDocument;
  fonts: Fonts;
  size: number;
}

function drawLine(ctx: Context, page: PDFPage, line: Line, x: number, baseline: number, extraPerSpace: number) {
  let cursor = x;
  for (const token of line.tokens) {
    const advance = token.width + (token.space ? extraPerSpace * token.text.length : 0);
    if (!token.space || token.run.underline || token.run.strike || token.run.href) {
      const nominal = token.run.size ?? ctx.size;
      const shift = token.run.script === "super" ? nominal * 0.33 : token.run.script === "sub" ? -nominal * 0.15 : 0;
      const y = page.getHeight() - baseline + shift;
      const color = token.run.href ? LINK : TEXT;
      if (!token.space) page.drawText(token.text, { x: cursor, y, size: token.size, font: token.font, color });
      const thickness = Math.max(0.5, token.size / 18);
      if (token.run.underline || token.run.href) page.drawLine({ start: { x: cursor, y: y - token.size * 0.12 }, end: { x: cursor + advance, y: y - token.size * 0.12 }, thickness, color });
      if (token.run.strike) page.drawLine({ start: { x: cursor, y: y + token.size * 0.3 }, end: { x: cursor + advance, y: y + token.size * 0.3 }, thickness, color });
      if (token.run.href && /^(https?:|mailto:)/i.test(token.run.href)) addLink(ctx.doc, page, token.run.href, cursor, y - token.size * 0.25, advance, token.size * 1.1);
    }
    cursor += advance;
  }
}

function addLink(doc: PDFDocument, page: PDFPage, href: string, x: number, y: number, width: number, height: number) {
  const annot = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [x, y, x + width, y + height],
    Border: [0, 0, 0],
    A: { Type: "Action", S: "URI", URI: PDFString.of(href) },
  });
  page.node.addAnnot(doc.context.register(annot));
}

/** Lay out a paragraph into entries for a column `width` points wide. */
function paragraphEntries(ctx: Context, block: ParagraphBlock, width: number): Entry[] {
  const size = block.size ?? ctx.size;
  const indent = block.indent ?? 0;
  const available = Math.max(20, width - indent);
  const lines = wrap(tokenize(block, ctx.fonts, size), available, size);
  const align = block.align ?? "left";
  const entries: Entry[] = [];
  if (block.spaceBefore) entries.push({ height: block.spaceBefore, draw: () => {}, spacer: true });
  lines.forEach((line, index) => {
    const last = index === lines.length - 1;
    const spaces = line.tokens.filter((t) => t.space).reduce((n, t) => n + t.text.length, 0);
    const extra = align === "justify" && !last && spaces > 0 ? (available - line.width) / spaces : 0;
    const offset = align === "center" ? (available - line.width) / 2 : align === "right" ? available - line.width : 0;
    entries.push({
      height: line.height,
      keep: index === lines.length - 1 ? block.keepWithNext : undefined,
      draw: (page, x, top) => {
        const baseline = top + line.ascent;
        if (index === 0 && block.marker) {
          const marker = ctx.fonts.clean(block.marker);
          const font = ctx.fonts.get();
          const markerWidth = font.widthOfTextAtSize(marker, size);
          page.drawText(marker, { x: x + indent - markerWidth - size * 0.5, y: page.getHeight() - baseline, size, font, color: TEXT });
        }
        drawLine(ctx, page, line, x + indent + offset, baseline, extra);
      },
    });
  });
  if (block.spaceAfter) entries.push({ height: block.spaceAfter, draw: () => {}, spacer: true });
  return entries;
}

async function imageEntries(ctx: Context, block: ImageBlock, width: number, maxHeight: number): Promise<Entry[]> {
  let image;
  try {
    image = block.format === "jpeg" ? await ctx.doc.embedJpg(block.bytes) : await ctx.doc.embedPng(block.bytes);
  } catch {
    return []; // An unreadable picture is left out rather than failing the whole document.
  }
  // Pixels at 96 DPI, shrunk to fit the column and the page.
  const natural = { w: image.width * 0.75, h: image.height * 0.75 };
  const scale = Math.min(1, width / natural.w, maxHeight / natural.h);
  const w = natural.w * scale;
  const h = natural.h * scale;
  const offset = block.align === "center" ? (width - w) / 2 : block.align === "right" ? width - w : 0;
  return [
    { height: h + 6, draw: (page, x, top) => page.drawImage(image, { x: x + offset, y: page.getHeight() - top - h, width: w, height: h }) },
  ];
}

function naturalWidth(ctx: Context, cell: TableCellBlock): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const p of cell.paragraphs) {
    const tokens = tokenize(p, ctx.fonts, p.size ?? ctx.size);
    const words = tokens.filter((t) => !t.space).map((t) => t.width);
    min = Math.max(min, ...words);
    max = Math.max(max, tokens.reduce((w, t) => w + t.width, 0) + (p.indent ?? 0));
  }
  return { min, max };
}

function tableEntries(ctx: Context, table: TableBlock, width: number, pageContentHeight: number): Entry[] {
  const pad = table.padding ?? 4;
  const columns = Math.max(1, ...table.rows.map((r) => r.cells.reduce((n, c) => n + (c.colSpan ?? 1), 0)));
  let widths = table.columnWidths;
  if (!widths) {
    const max = new Array<number>(columns).fill(0);
    const min = new Array<number>(columns).fill(0);
    for (const row of table.rows) {
      let col = 0;
      for (const cell of row.cells) {
        if ((cell.colSpan ?? 1) === 1 && col < columns) {
          const n = naturalWidth(ctx, cell);
          max[col] = Math.max(max[col], n.max + 2 * pad);
          min[col] = Math.max(min[col], Math.min(n.min + 2 * pad, width / columns));
        }
        col += cell.colSpan ?? 1;
      }
    }
    // Share the width in proportion to each column's natural width, never below its longest word.
    const desired = max.map((m) => Math.max(m, 24));
    const total = desired.reduce((a, b) => a + b, 0);
    widths = desired.map((d) => (d / total) * width);
    const deficit = widths.reduce((sum, w, i) => sum + Math.max(0, min[i] - w), 0);
    if (deficit > 0) {
      const slack = widths.reduce((sum, w, i) => sum + Math.max(0, w - min[i]), 0);
      widths = widths.map((w, i) => (w < min[i] ? min[i] : w - ((w - min[i]) / slack) * deficit));
    }
  }

  const entries: Entry[] = [];
  const headers: Entry[] = [];
  for (const row of table.rows) {
    let col = 0;
    const cells = row.cells.map((cell) => {
      const span = Math.max(1, cell.colSpan ?? 1);
      const x = widths.slice(0, col).reduce((a, b) => a + b, 0);
      const w = widths.slice(col, col + span).reduce((a, b) => a + b, 0);
      col += span;
      const lines = cell.paragraphs.flatMap((p) => paragraphEntries(ctx, { ...p, spaceBefore: 0 }, w - 2 * pad)).filter((e, i, all) => !(e.spacer && i === all.length - 1));
      return { x, w, lines };
    });
    const totalWidth = widths.reduce((a, b) => a + b, 0);

    // Rows taller than a page are sliced; each slice is drawn as its own row.
    const limit = pageContentHeight - 2 * pad - headers.reduce((h, e) => h + e.height, 0) - 1;
    const cursors = cells.map(() => 0);
    let first = true;
    while (first || cells.some((c, i) => cursors[i] < c.lines.length)) {
      const slice = cells.map((c, i) => {
        const taken: Entry[] = [];
        let h = 0;
        while (cursors[i] < c.lines.length && (taken.length === 0 || h + c.lines[cursors[i]].height <= limit)) {
          h += c.lines[cursors[i]].height;
          taken.push(c.lines[cursors[i]++]);
        }
        return { ...c, lines: taken, height: h };
      });
      first = false;
      const height = Math.max(...slice.map((c) => c.height), ctx.size * LINE_HEIGHT) + 2 * pad;
      const entry: Entry = {
        height,
        headers: table.repeatHeader && !row.header ? [...headers] : undefined,
        draw: (page, x, top) => {
          const bottom = page.getHeight() - top - height;
          if (row.header && table.headerFill) page.drawRectangle({ x, y: bottom, width: totalWidth, height, color: table.headerFill });
          for (const cell of slice) {
            page.drawRectangle({ x: x + cell.x, y: bottom, width: cell.w, height, borderColor: BORDER, borderWidth: 0.5 });
            let y = top + pad;
            for (const line of cell.lines) {
              line.draw(page, x + cell.x + pad, y);
              y += line.height;
            }
          }
        },
      };
      entries.push(entry);
      if (row.header) headers.push(entry);
    }
  }
  return entries;
}

/** Typeset blocks into a new PDF. The PDF carries no producer, creator or dates. */
export async function renderFlow(blocks: Block[], options: FlowOptions): Promise<FlowResult> {
  const doc = await createPdf();
  const fonts = await embedFonts(doc, options.fonts);
  const ctx: Context = { doc, fonts, size: options.size };
  const { pageWidth, pageHeight, margin } = options;
  const contentWidth = pageWidth - 2 * margin;
  const contentHeight = pageHeight - 2 * margin;

  const entries: Entry[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph") entries.push(...paragraphEntries(ctx, block, contentWidth));
    else if (block.type === "table") entries.push(...tableEntries(ctx, block, contentWidth, contentHeight));
    else if (block.type === "image") entries.push(...(await imageEntries(ctx, block, contentWidth, contentHeight - 6)));
    else entries.push({ height: 0, draw: () => {}, pageBreak: true });
  }

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = margin;
  const bottom = pageHeight - margin;
  const newPage = () => {
    page = doc.addPage([pageWidth, pageHeight]);
    y = margin;
  };
  for (const entry of entries) {
    if (entry.pageBreak) {
      newPage();
      continue;
    }
    if (entry.spacer) {
      if (y > margin) y = Math.min(y + entry.height, bottom);
      continue;
    }
    const needed = entry.height + (entry.keep ?? 0);
    if (y > margin && y + needed > bottom) {
      newPage();
      for (const header of entry.headers ?? []) {
        header.draw(page, margin, y);
        y += header.height;
      }
    }
    entry.draw(page, margin, y);
    y += entry.height;
  }

  return { bytes: await savePdf(doc), pages: doc.getPageCount(), missingCharacters: fonts.missing };
}
