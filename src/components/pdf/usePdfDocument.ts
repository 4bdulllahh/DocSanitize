"use client";

import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { errorMessage, ProcessingError, type ProcessingErrorCode } from "@/lib/errors";
import { openPdfForRendering } from "@/lib/pdf/render";

export type PdfDocumentState =
  | { status: "loading" }
  | { status: "ready"; doc: PDFDocumentProxy }
  | { status: "error"; message: string; code?: ProcessingErrorCode };

/** Open a PDF with pdf.js for as long as the component is mounted. */
export function usePdfDocument(blob: Blob): PdfDocumentState {
  const [result, setResult] = useState<{ blob: Blob; state: PdfDocumentState } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const opening = openPdfForRendering(blob);
    opening
      .then(({ doc }) => !cancelled && setResult({ blob, state: { status: "ready", doc } }))
      .catch((error: unknown) => {
        if (cancelled) return;
        setResult({
          blob,
          state: {
            status: "error",
            message: errorMessage(error),
            code: error instanceof ProcessingError ? error.code : undefined,
          },
        });
      });
    return () => {
      cancelled = true;
      opening.then((opened) => opened.destroy()).catch(() => {});
    };
  }, [blob]);

  return result?.blob === blob ? result.state : { status: "loading" };
}
