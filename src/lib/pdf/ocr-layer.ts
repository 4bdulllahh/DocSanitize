import {
  beginText,
  concatTransformationMatrix,
  endText,
  PDFHexString,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
  type PDFOperator,
} from "@cantoo/pdf-lib";
import { ProcessingError } from "../errors";
import { uprightMatrix } from "./edit/apply";
import { embedGlyphlessFont, GLYPHLESS_ADVANCE, glyphlessHex } from "./glyphless-font";
import { loadPdf, savePdf } from "./load";
import { displaySize, pageGeometry } from "./stamp";

/*
 * Makes scanned pages searchable: recognised words are written as invisible text (render mode 3)
 * exactly over the words in the picture, so readers can search, select and copy them while the
 * page looks the same.
 */

/** A recognised word, in points on the displayed page (top-left origin, rotation applied). */
export interface OcrWord {
  text: string;
  x: number;
  width: number;
  /** Displayed y of the word's baseline. */
  baseline: number;
}

export interface OcrLine {
  /** Font size whose ascent + descent spans the line (ascenders to descenders). */
  size: number;
  /** Right-to-left script (Arabic, Hebrew, …); word text is in reading order. */
  rtl: boolean;
  words: OcrWord[];
}

export interface OcrPageText {
  /** 0-based page index. */
  page: number;
  lines: OcrLine[];
}

const span = (from: number, to: number) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
/** Hebrew, Arabic, Syriac, Thaana, N'Ko … and the Hebrew/Arabic presentation forms. */
const RTL = new RegExp(`[${span(0x0590, 0x08ff)}${span(0xfb1d, 0xfdff)}${span(0xfe70, 0xfefc)}]`);
const LTR_RUN = /[\p{L}\p{N}]/u;

/**
 * A right-to-left word in the order its characters appear on the page. PDF text is stored in
 * drawing order and readers reorder right-to-left runs when text is copied, so Arabic or Hebrew
 * is written reversed; numbers and Latin inside it keep their direction.
 */
export function visualOrder(word: string): string {
  if (!RTL.test(word)) return word;
  const runs: { rtl: boolean; chars: string[] }[] = [];
  for (const ch of Array.from(word)) {
    const rtl = RTL.test(ch) || !LTR_RUN.test(ch);
    const last = runs[runs.length - 1];
    if (last && last.rtl === rtl) last.chars.push(ch);
    else runs.push({ rtl, chars: [ch] });
  }
  return runs
    .reverse()
    .map((run) => (run.rtl ? run.chars.reverse() : run.chars).join(""))
    .join("");
}

/**
 * What to draw for a line, left to right: each word with a space where another word follows,
 * stretched across the gap, so selecting a line highlights all of it and copied text has spaces.
 * Right-to-left words are written in visual order, each over its own box, as such PDFs store them.
 */
export function layoutLine(line: OcrLine): OcrWord[] {
  const sorted = line.words.filter((w) => w.text.trim() && w.width > 0).sort((a, b) => a.x - b.x);
  if (line.rtl) return sorted.map((word) => ({ ...word, text: visualOrder(word.text) }));
  return sorted.map((word, i) => {
    const next = sorted[i + 1];
    return next && next.x > word.x + word.width ? { ...word, text: `${word.text} `, width: next.x - word.x } : word;
  });
}

/** Add invisible text to the given pages. Pages keep their content; nothing else changes. */
export async function addTextLayer(bytes: Uint8Array, pages: OcrPageText[]): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const all = doc.getPages();
  if (pages.some((p) => !all[p.page])) throw new ProcessingError("The recognised text belongs to a page that doesn't exist.", "invalid");
  if (pages.every((p) => p.lines.length === 0)) return savePdf(doc);

  const font = embedGlyphlessFont(doc);
  for (const { page: index, lines } of pages) {
    if (lines.length === 0) continue;
    const page = all[index];
    const geometry = pageGeometry(page);
    const { height } = displaySize(geometry);
    const name = page.node.newFontDictionary("OcrText", font);
    const ops: PDFOperator[] = [beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
    for (const line of lines) {
      if (!(line.size > 0)) continue;
      ops.push(setFontAndSize(name, line.size));
      for (const word of layoutLine(line)) {
        const natural = word.text.length * GLYPHLESS_ADVANCE * line.size;
        ops.push(setCharacterSqueeze((100 * word.width) / natural), setTextMatrix(1, 0, 0, 1, word.x, height - word.baseline), showText(PDFHexString.of(glyphlessHex(word.text))));
      }
    }
    ops.push(endText());
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...uprightMatrix(geometry)), ...ops, popGraphicsState());
  }
  return savePdf(doc);
}
