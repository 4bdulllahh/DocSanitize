import type { OcrLine, OcrPageText } from "../pdf/ocr-layer";

/*
 * Tesseract's result for a rendered page -> words in points on the displayed page, for the
 * invisible text layer, and plain text. Only the parts of Tesseract's output that are used.
 */

interface Bbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TesseractPage {
  confidence: number;
  blocks: {
    paragraphs: {
      is_ltr: boolean;
      lines: {
        bbox: Bbox;
        baseline: Bbox;
        rowAttributes?: { row_height: number };
        words: { text: string; confidence: number; bbox: Bbox }[];
      }[];
    }[];
  }[] | null;
}

export interface OcrPageResult extends OcrPageText {
  /** Recognised text: lines, with a blank line between paragraphs. */
  text: string;
  words: number;
  /** Tesseract's mean confidence for the page, 0-100. */
  confidence: number;
}

/** Stray marks (table borders, specks) come back as low-confidence punctuation. */
const isNoise = (word: { text: string; confidence: number }) => !/[\p{L}\p{N}]/u.test(word.text) && word.confidence < 50;

/** `scale` is rendered pixels per point. */
export function readTesseractPage(page: TesseractPage, index: number, scale: number): OcrPageResult {
  const lines: OcrLine[] = [];
  const paragraphs: string[] = [];
  let count = 0;
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      const texts: string[] = [];
      for (const line of paragraph.lines) {
        const words = line.words.filter((w) => w.text.trim() && !isNoise(w));
        if (words.length === 0) continue;
        const { baseline } = line;
        const slope = baseline.x1 !== baseline.x0 ? (baseline.y1 - baseline.y0) / (baseline.x1 - baseline.x0) : 0;
        const height = line.rowAttributes?.row_height || line.bbox.y1 - line.bbox.y0;
        lines.push({
          size: height / scale,
          rtl: !paragraph.is_ltr,
          words: words.map((w) => ({
            text: w.text.trim(),
            x: w.bbox.x0 / scale,
            width: (w.bbox.x1 - w.bbox.x0) / scale,
            baseline: (baseline.y0 + slope * (w.bbox.x0 - baseline.x0)) / scale,
          })),
        });
        texts.push(words.map((w) => w.text.trim()).join(" "));
        count += words.length;
      }
      if (texts.length) paragraphs.push(texts.join("\n"));
    }
  }
  return { page: index, lines, text: paragraphs.join("\n\n"), words: count, confidence: Math.round(page.confidence) };
}

/** Plain text of several pages, each under a "--- Page n ---" line when there's more than one. */
export function joinPageTexts(pages: { page: number; text: string }[]): string {
  if (pages.length === 1) return `${pages[0].text}\n`;
  return `${pages.map((p) => `--- Page ${p.page + 1} ---\n\n${p.text}`).join("\n\n")}\n`;
}
