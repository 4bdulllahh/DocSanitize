import { removePageText } from "./edit/apply";
import type { ReplaceObject } from "./edit/types";
import { loadPdf, savePdf } from "./load";

/*
 * PDF -> PowerPoint: a copy of the PDF with the text that becomes slide text boxes taken out, so
 * the page picture behind the boxes doesn't show it twice. Only used for rendering.
 */

export interface StrippedPdf {
  bytes: Uint8Array;
  /** Per page, per line: whether its text was removed (lines that weren't stay in the picture). */
  removed: boolean[][];
}

/** `pages[i]`: the lines on page i, each as the pdf.js runs it's made of. */
export async function stripText(bytes: Uint8Array, pages: ReplaceObject["sources"][][]): Promise<StrippedPdf> {
  const doc = await loadPdf(bytes);
  const removed = doc.getPages().map((page, i) => (pages[i]?.length ? removePageText(page, pages[i]) : []));
  return { bytes: await savePdf(doc), removed };
}
