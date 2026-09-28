"use client";

import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { readPhrases, type PagePhrase } from "@/lib/pdf/edit/page-text";

export { sampleColors, type PagePhrase } from "@/lib/pdf/edit/page-text";

/** The page's text as editable phrases; null while loading. */
export function usePageText(doc: PDFDocumentProxy, index: number, enabled: boolean): PagePhrase[] | null {
  const [result, setResult] = useState<{ doc: PDFDocumentProxy; index: number; phrases: PagePhrase[] } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    doc
      .getPage(index + 1)
      .then(readPhrases)
      .then((phrases) => !cancelled && setResult({ doc, index, phrases }))
      .catch(() => !cancelled && setResult({ doc, index, phrases: [] }));
    return () => {
      cancelled = true;
    };
  }, [doc, index, enabled]);
  return result && result.doc === doc && result.index === index ? result.phrases : null;
}
