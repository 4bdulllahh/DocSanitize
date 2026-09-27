import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TextItem as PdfjsTextItem } from "pdfjs-dist/types/src/display/api";
import type { TextItem, TextPage } from "./text-layout";

type Matrix = [number, number, number, number, number, number];

const multiply = (m: number[], n: number[]): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

interface FontStyle {
  bold: boolean;
  italic: boolean;
}

/**
 * Bold/italic per pdf.js font id. Text content only reports generic families, but once a page's
 * operator list is built, pdf.js has the real fonts (flags and PostScript names such as "Arial-BoldMT").
 */
async function fontStyles(page: PDFPageProxy, fontIds: Set<string>): Promise<Map<string, FontStyle>> {
  const styles = new Map<string, FontStyle>();
  try {
    await page.getOperatorList();
  } catch {
    return styles;
  }
  for (const id of fontIds) {
    if (!page.commonObjs.has(id)) continue;
    const font = page.commonObjs.get(id) as { name?: string; bold?: boolean; black?: boolean; italic?: boolean };
    const name = font.name ?? "";
    styles.set(id, {
      bold: Boolean(font.bold || font.black) || /bold|black|heavy|semibold|demi/i.test(name),
      italic: Boolean(font.italic) || /italic|oblique/i.test(name),
    });
  }
  return styles;
}

/** Positioned text of the given pages (1-based), in top-down coordinates with page rotation applied. */
export async function extractText(doc: PDFDocumentProxy, pageNumbers: number[], onPage?: (done: number) => void): Promise<TextPage[]> {
  const pages: TextPage[] = [];
  for (const [index, number] of pageNumbers.entries()) {
    const page = await doc.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const textItems = content.items.filter((item): item is PdfjsTextItem => "str" in item && item.str.length > 0);
    const styles = await fontStyles(page, new Set(textItems.map((item) => item.fontName)));

    const items: TextItem[] = [];
    for (const item of textItems) {
      const [a, b, c, d, x, y] = multiply(viewport.transform, item.transform);
      // Only horizontal, left-to-right text; rotated labels and vertical text are skipped.
      if (a <= 0 || Math.abs(b) > Math.abs(a) * 0.05) continue;
      const size = Math.hypot(c, d);
      if (!(size > 0)) continue;
      items.push({ text: item.str, x, y, width: item.width, size, ...styles.get(item.fontName) });
    }
    pages.push({ width: viewport.width, height: viewport.height, items });
    page.cleanup();
    onPage?.(index + 1);
  }
  return pages;
}
