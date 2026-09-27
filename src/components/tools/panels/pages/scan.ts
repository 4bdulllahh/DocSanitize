import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Box } from "@/lib/pdf/edit/types";
import { withRenderSlot } from "@/lib/pdf/render";

/*
 * Looking at rendered pages: where the content is (for cropping white margins) and how much ink
 * there is (for finding blank pages). Pages are rendered small; that's plenty for both.
 */

export interface PageScan {
  /** Content area as fractions of the displayed page, or null when the page is empty. */
  content: Box | null;
  /** Fraction of pixels that are noticeably dark. */
  ink: number;
  /** Whether the page has any text (a text layer counts even if faint). */
  text: boolean;
}

const WIDTH = 300;
/** Pixels darker than this (0-255 luminance) count as content. */
const INK = 225;

export async function scanPage(doc: PDFDocumentProxy, index: number): Promise<PageScan> {
  return withRenderSlot(async () => {
    const page = await doc.getPage(index + 1);
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: WIDTH / natural.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let [minX, minY, maxX, maxY] = [width, height, -1, -1];
    let dark = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        // Transparent areas are the white paper.
        const alpha = data[i + 3] / 255;
        const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * alpha + 255 * (1 - alpha);
        if (lum < INK) {
          dark++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const text = (await page.getTextContent()).items.some((item) => "str" in item && item.str.trim() !== "");
    canvas.width = canvas.height = 0;
    return {
      content: maxX < 0 ? null : { x: minX / width, y: minY / height, width: (maxX - minX + 1) / width, height: (maxY - minY + 1) / height },
      ink: dark / (width * height),
      text,
    };
  });
}

/** Scan pages one at a time, reporting progress. Stops early if `signal` is aborted. */
export async function scanPages(doc: PDFDocumentProxy, pages: number[], onProgress: (done: number) => void, signal: AbortSignal): Promise<Map<number, PageScan>> {
  const results = new Map<number, PageScan>();
  for (const [k, index] of pages.entries()) {
    if (signal.aborted) break;
    results.set(index, await scanPage(doc, index));
    onProgress(k + 1);
  }
  return results;
}
