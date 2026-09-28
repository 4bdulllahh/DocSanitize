import type { TextPage } from "../office/text-layout";
import { findAnnotationBoxes, pageTextIndex, spanBoxes, type AnnotationText, type Box } from "../pdf/redact-search";
import { findPii, type PiiKind } from "./pii";

/** Personal data found on a PDF page, with the boxes that cover it (fractions of the page). */
export interface PiiFinding {
  id: string;
  kind: PiiKind;
  value: string;
  /** 0-based page index. */
  page: number;
  /** The words around it, for recognising it in the list. */
  context: string;
  /** Found in a form field or comment rather than the page text. */
  inAnnotation: boolean;
  boxes: Box[];
}

const CONTEXT = 32;

function around(text: string, start: number, end: number): string {
  const before = text.slice(Math.max(0, start - CONTEXT), start);
  const after = text.slice(end, end + CONTEXT);
  return `${start > CONTEXT ? "…" : ""}${before}[[${text.slice(start, end)}]]${after}${end + CONTEXT < text.length ? "…" : ""}`.replace(/\s+/g, " ");
}

/** Scan the text and annotations of pages (as read by extractText and annotationTexts). */
export function findPiiInPages(pages: TextPage[], annotations: AnnotationText[][], kinds?: PiiKind[]): PiiFinding[] {
  const findings: PiiFinding[] = [];
  pages.forEach((page, p) => {
    const index = pageTextIndex(page);
    for (const m of findPii(index.text, kinds)) {
      findings.push({ id: `${p}:t${m.start}`, kind: m.kind, value: m.value, page: p, context: around(index.text, m.start, m.end), inAnnotation: false, boxes: spanBoxes(page, index, m.start, m.end) });
    }
    (annotations[p] ?? []).forEach((annotation, a) => {
      for (const m of findPii(annotation.text, kinds)) {
        findings.push({
          id: `${p}:a${a}:${m.start}`,
          kind: m.kind,
          value: m.value,
          page: p,
          context: around(annotation.text, m.start, m.end),
          inAnnotation: true,
          boxes: findAnnotationBoxes([annotation], m.value, page.width, page.height),
        });
      }
    });
  });
  return findings;
}
