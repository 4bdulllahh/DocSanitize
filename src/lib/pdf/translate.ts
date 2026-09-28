import type { PDFFont } from "@cantoo/pdf-lib";
import type { FontFiles } from "../office/flow";
import type { TextBlock } from "../translate/blocks";
import { fitText, type Measure } from "../translate/layout";
import { applyEdits, fontSet } from "./edit/apply";
import { baselineOffset, type EditResult, type ReplaceObject } from "./edit/types";
import { createPdf } from "./load";

/*
 * Writes translations into a PDF in place of the original text, through Edit PDF's "replace"
 * path: the original text is removed from the page (not just covered), and the translation is
 * laid out in the same space, in the same colour, smaller where it's longer.
 */

export interface TranslatedBlock extends Omit<TextBlock, "lines" | "text"> {
  /** 0-based page index. */
  page: number;
  translation: string;
  color: string;
  background: string;
  sources: ReplaceObject["sources"];
}

export async function translatePdf(bytes: Uint8Array, blocks: TranslatedBlock[], files: FontFiles): Promise<EditResult> {
  // Measure with the fonts the text will be written in (Edit PDF's choice of font per block).
  const fonts = fontSet(await createPdf(), files);
  const measures = new Map<PDFFont, Measure>();
  const measureFor = (font: PDFFont) => {
    if (!measures.has(font)) {
      // Characters the font lacks are written as "?" (and reported by applyEdits).
      const supported = new Set(font.getCharacterSet());
      const drawable = (line: string) => Array.from(line, (ch) => (supported.has(ch.codePointAt(0)!) ? ch : "?")).join("");
      measures.set(font, (line, size) => font.widthOfTextAtSize(drawable(line), size));
    }
    return measures.get(font)!;
  };
  const objects: ReplaceObject[] = [];
  let overflow = false;
  for (const [i, block] of blocks.entries()) {
    const text = block.translation.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const { font } = await fonts.pick({ ...block, text });
    const fitted = fitText(text, block.box, block.size, measureFor(font));
    overflow ||= fitted.overflow;
    const pad = Math.max(1, block.size * 0.08);
    objects.push({
      id: `t${i}`,
      kind: "replace",
      page: block.page,
      x: block.box.x,
      y: block.baseline - baselineOffset(block.font, fitted.size),
      text: fitted.lines.join("\n"),
      font: block.font,
      size: fitted.size,
      bold: block.bold,
      italic: block.italic,
      color: block.color,
      cover: { x: block.box.x - pad, y: block.box.y - pad, width: block.box.width + 2 * pad, height: block.box.height + 2 * pad },
      background: block.background,
      sources: block.sources,
    });
  }
  const result = await applyEdits(bytes, { objects, images: {}, flatten: true }, files);
  if (overflow) result.warnings.unshift("Some translations are much longer than the original, so they may run past their space and overlap what's below.");
  return result;
}
