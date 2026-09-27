import type { PDFDocumentProxy } from "pdfjs-dist";
import type { AnnotationText } from "./redact-search";

interface AnnotationData {
  rect: number[];
  fieldValue?: string | string[] | null;
  contentsObj?: { str?: string };
  textContent?: string[] | null;
}

/**
 * Text that annotations draw on each page (form field values, comments, free text), with their
 * rectangles in top-down page coordinates. pdf.js leaves this out of a page's text content.
 */
export async function annotationTexts(doc: PDFDocumentProxy, pageNumbers: number[]): Promise<AnnotationText[][]> {
  const pages: AnnotationText[][] = [];
  for (const number of pageNumbers) {
    const page = await doc.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const entries: AnnotationText[] = [];
    for (const annotation of (await page.getAnnotations()) as AnnotationData[]) {
      const value = annotation.fieldValue;
      const text = [Array.isArray(value) ? value.join(" ") : value, annotation.contentsObj?.str, annotation.textContent?.join(" ")]
        .filter((s): s is string => typeof s === "string" && s.trim() !== "")
        .join(" ");
      if (!text) continue;
      // Opposite corners; with page rotation they can come out in any order.
      const [x1, y1] = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]);
      const [x2, y2] = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]);
      entries.push({ text, rect: [x1, y1, x2, y2] });
    }
    pages.push(entries);
  }
  return pages;
}
