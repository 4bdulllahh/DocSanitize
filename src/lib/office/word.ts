import { rgb } from "@cantoo/pdf-lib";
import mammoth from "mammoth";
import { ProcessingError } from "../errors";
import { isJpeg, stripJpeg } from "../metadata/jpeg";
import { isPng } from "../metadata/png";
import { DEFAULT_STRIP_OPTIONS } from "../metadata/types";
import { PAGE_SIZES } from "../pdf/images";
import { renderFlow, type Align, type Block, type FontFiles, type InlineRun, type ParagraphBlock, type TableBlock } from "./flow";

/*
 * Word (.docx) -> PDF. mammoth parses the document into a tree (paragraphs, runs, tables, images,
 * notes); we map that tree onto flow blocks and typeset it. Headers, footers and comments are not
 * part of mammoth's tree, so they're left out.
 */

export interface OfficeToPdfOptions {
  pageSize: "a4" | "letter";
}

export interface ConversionResult {
  bytes: Uint8Array;
  pages: number;
  /** Things that couldn't be carried over, in plain words. */
  warnings: string[];
}

const BODY_SIZE = 11;
const MARGIN = 72;
const HEADING_SIZES = [20, 16, 13.5, 12, 11, 11];
const BULLETS = ["•", "◦", "▪"];

// Just the parts of mammoth's document tree we read.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Element = any;

/** Run formatting inherited by nested elements; `caps` upper-cases the text. */
type RunStyle = Omit<InlineRun, "text"> & { caps?: boolean };

const styled = ({ caps, ...style }: RunStyle, text: string): InlineRun => ({ ...style, text: caps ? text.toUpperCase() : text });

interface State {
  blocks: Block[];
  /** List item counters per nesting level, and whether that level is numbered. */
  counters: { n: number; ordered: boolean }[];
  notes: Element[];
  skippedImages: number;
}

export async function docxToPdf(bytes: Uint8Array, options: OfficeToPdfOptions, fonts: FontFiles, name = "This file"): Promise<ConversionResult> {
  // Encrypted Office files (and legacy .doc) are OLE containers, not zip packages.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new ProcessingError(`“${name}” is password-protected or in the old .doc format. Save it as an unprotected .docx first.`, "unsupported");
  }
  let document: Element;
  try {
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await mammoth.convertToHtml(
      // mammoth's browser build reads `arrayBuffer`, its Node build (unit tests) `buffer`.
      { arrayBuffer: data, buffer: data } as { arrayBuffer: ArrayBuffer },
      {
        // We only want the parsed tree; skip mammoth's own image encoding.
        convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })),
        transformDocument: (doc: Element) => (document = doc),
      },
    );
  } catch {
    throw new ProcessingError(`“${name}” couldn't be read as a Word document.`, "corrupt");
  }

  const state: State = { blocks: [], counters: [], notes: [], skippedImages: 0 };
  for (const child of document.children) await convertBlock(child, state, document);

  if (state.notes.length) {
    state.blocks.push({ type: "paragraph", runs: [{ text: "Notes", bold: true }], size: 13.5, spaceBefore: 18, spaceAfter: 6, keepWithNext: 30 });
    for (const [i, note] of state.notes.entries()) {
      const paragraphs: ParagraphBlock[] = [];
      for (const child of note.body ?? []) if (child.type === "paragraph") paragraphs.push(...(await paragraphBlocks(child, state, document, true)).filter(isParagraph));
      const first = paragraphs[0] ?? { type: "paragraph", runs: [] };
      state.blocks.push({ ...first, size: 9.5, indent: 18, marker: `${i + 1}.`, spaceAfter: 3 }, ...paragraphs.slice(1).map((p) => ({ ...p, size: 9.5, indent: 18 })));
    }
  }

  const [width, height] = PAGE_SIZES[options.pageSize];
  const result = await renderFlow(state.blocks, { pageWidth: width, pageHeight: height, margin: MARGIN, fonts, size: BODY_SIZE });
  const warnings: string[] = [];
  if (state.skippedImages) warnings.push(`${state.skippedImages} image${state.skippedImages === 1 ? " is" : "s are"} in a format that can't be placed in a PDF here (only JPEG and PNG are).`);
  if (result.missingCharacters) warnings.push(missingCharactersWarning(result.missingCharacters));
  return { bytes: result.bytes, pages: result.pages, warnings };
}

export const missingCharactersWarning = (n: number) =>
  `${n.toLocaleString()} character${n === 1 ? "" : "s"} (for example Chinese, Japanese, Arabic or emoji) aren't covered by the built-in font and show as “?”.`;

const isParagraph = (b: Block): b is ParagraphBlock => b.type === "paragraph";

async function convertBlock(element: Element, state: State, document: Element) {
  if (element.type === "paragraph") state.blocks.push(...(await paragraphBlocks(element, state, document)));
  else if (element.type === "table") state.blocks.push(await tableBlock(element, state, document));
}

function alignment(value: string | null): Align | undefined {
  if (value === "center") return "center";
  if (value === "right" || value === "end") return "right";
  if (value === "both" || value === "distribute") return "justify";
  return undefined;
}

function listMarker(numbering: { level: string; isOrdered: boolean }, counters: State["counters"]): string {
  const level = Math.min(8, Number(numbering.level) || 0);
  counters.length = level + 1; // deeper levels restart
  // Switching between a bulleted and a numbered list starts counting again.
  if (counters[level]?.ordered !== numbering.isOrdered) counters[level] = { n: 0, ordered: numbering.isOrdered };
  const n = ++counters[level].n;
  if (!numbering.isOrdered) return BULLETS[level % BULLETS.length];
  if (level % 3 === 1) return `${String.fromCharCode(96 + (((n - 1) % 26) + 1))}.`;
  if (level % 3 === 2) return `${roman(n)}.`;
  return `${n}.`;
}

function roman(n: number): string {
  const numerals: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [value, symbol] of numerals) for (; n >= value; n -= value) out += symbol;
  return out;
}

/**
 * One Word paragraph -> paragraph blocks. Line breaks, page breaks and pictures inside the paragraph
 * split it, since the flow engine lays out whole paragraphs.
 */
async function paragraphBlocks(p: Element, state: State, document: Element, inNote = false): Promise<Block[]> {
  const style: string = p.styleName ?? "";
  const heading = /^heading\s*(\d)/i.exec(style);
  const level = heading ? Math.min(6, Number(heading[1])) : /^title$/i.test(style) ? 0 : null;
  const size = level === 0 ? 26 : level ? HEADING_SIZES[level - 1] : BODY_SIZE;

  let marker: string | undefined;
  let indent = p.indent?.start ? Number(p.indent.start) / 20 : 0;
  if (p.numbering && !inNote) {
    marker = listMarker(p.numbering, state.counters);
    indent = Math.max(indent, 22 * (Number(p.numbering.level || 0) + 1));
  } else if (!inNote && p.children.length) {
    state.counters.length = 0;
  }

  const base: Omit<ParagraphBlock, "runs"> = {
    type: "paragraph",
    size,
    align: alignment(p.alignment),
    indent: indent > 0 ? Math.min(indent, 200) : undefined,
    spaceBefore: level !== null ? 12 : 0,
    spaceAfter: level !== null ? 4 : marker ? 2 : 6,
    keepWithNext: level !== null ? 30 : undefined,
  };
  const out: Block[] = [];
  let runs: InlineRun[] = [];
  let first = true;
  const flush = (last: boolean) => {
    if (runs.length || last) {
      out.push({ ...base, runs, marker: first ? marker : undefined, spaceBefore: first ? base.spaceBefore : 0, spaceAfter: last ? base.spaceAfter : 0 });
      first = false;
    }
    runs = [];
  };

  const walk = async (children: Element[], inherited: RunStyle) => {
    for (const child of children) {
      switch (child.type) {
        case "run": {
          await walk(child.children, {
            ...inherited,
            bold: child.isBold || level !== null || /^strong$/i.test(child.styleName ?? "") || inherited.bold,
            italic: child.isItalic || /^emphasis$/i.test(child.styleName ?? "") || inherited.italic,
            underline: child.isUnderline || inherited.underline,
            strike: child.isStrikethrough,
            size: child.fontSize ?? undefined,
            script: child.verticalAlignment === "superscript" ? "super" : child.verticalAlignment === "subscript" ? "sub" : undefined,
            caps: child.isAllCaps || inherited.caps,
          });
          break;
        }
        case "text": {
          runs.push(styled(inherited, child.value));
          break;
        }
        case "tab":
          runs.push(styled(inherited, "    "));
          break;
        case "hyperlink":
          await walk(child.children, { ...inherited, href: child.href ?? undefined });
          break;
        case "noteReference": {
          const note = document.notes?.resolve?.(child);
          if (note) {
            state.notes.push(note);
            runs.push({ text: String(state.notes.length), script: "super" });
          }
          break;
        }
        case "checkbox":
          runs.push(styled(inherited, child.checked ? "[x] " : "[ ] "));
          break;
        case "break":
          if (child.breakType === "page") {
            flush(false);
            out.push({ type: "pageBreak" });
          } else {
            flush(false);
          }
          break;
        case "image": {
          const image = await readImage(child);
          if (image) {
            flush(false);
            out.push({ type: "image", ...image, align: base.align === "justify" ? undefined : base.align });
          } else {
            state.skippedImages++;
          }
          break;
        }
        default:
          if (Array.isArray(child.children)) await walk(child.children, inherited);
      }
    }
  };
  await walk(p.children, {});
  flush(true);
  return out;
}

async function readImage(image: Element): Promise<{ bytes: Uint8Array; format: "jpeg" | "png" } | null> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await image.readAsArrayBuffer());
  } catch {
    return null;
  }
  // Photos pasted into Word keep their camera metadata; don't carry it into the PDF.
  if (isJpeg(bytes)) return { bytes: await stripJpeg(bytes, DEFAULT_STRIP_OPTIONS, false).catch(() => bytes), format: "jpeg" };
  if (isPng(bytes)) return { bytes, format: "png" };
  return null;
}

async function tableBlock(table: Element, state: State, document: Element): Promise<TableBlock> {
  const rows: TableBlock["rows"] = [];
  const cellParagraphs = async (children: Element[]): Promise<ParagraphBlock[]> => {
    const out: ParagraphBlock[] = [];
    for (const child of children) {
      if (child.type === "paragraph") {
        const blocks = await paragraphBlocks(child, state, document);
        state.skippedImages += blocks.filter((b) => b.type === "image").length; // pictures in cells aren't placed
        out.push(...blocks.filter(isParagraph).map((b) => ({ ...b, size: Math.min(b.size ?? BODY_SIZE, 13), spaceBefore: 0, spaceAfter: 2 })));
      } else if (child.type === "table") {
        // Nested tables are flattened into their text.
        for (const row of child.children) for (const cell of row.children) out.push(...(await cellParagraphs(cell.children)));
      }
    }
    return out;
  };
  for (const row of table.children) {
    if (row.type !== "tableRow") continue;
    const cells = [];
    for (const cell of row.children) cells.push({ paragraphs: await cellParagraphs(cell.children), colSpan: cell.colSpan ?? 1 });
    rows.push({ cells, header: Boolean(row.isHeader) });
  }
  return { type: "table", rows, repeatHeader: true, headerFill: rgb(0.93, 0.93, 0.93) };
}
