"use client";

import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PageThumbnail } from "./PageThumbnail";

/** A scrollable row of page thumbnails for choosing the page to work on; badges show per-page counts. */
export function PageStrip({
  doc,
  current,
  onSelect,
  counts = {},
  noun,
}: {
  doc: PDFDocumentProxy;
  current: number;
  onSelect: (index: number) => void;
  /** Items per 0-based page index, shown as a badge. */
  counts?: Record<number, number>;
  /** Singular name of the counted things, e.g. "redaction". */
  noun: string;
}) {
  return (
    <ol className="flex gap-2 overflow-x-auto border-b border-line p-3" aria-label="Choose a page">
      {Array.from({ length: doc.numPages }, (_, i) => {
        const count = counts[i] ?? 0;
        return (
          <li key={i} className="shrink-0">
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-current={i === current ? "page" : undefined}
              aria-label={`Page ${i + 1}${count ? `, ${count} ${noun}${count === 1 ? "" : "s"}` : ""}`}
              className={clsx("relative rounded-lg border-2 p-1", i === current ? "border-brand-text bg-brand-soft" : "border-transparent hover:bg-surface-muted")}
            >
              <PageThumbnail doc={doc} pageNumber={i + 1} width={52} height={68} />
              <span className="mt-0.5 block text-center text-[11px] font-medium text-fg-muted tabular-nums">{i + 1}</span>
              {count > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-brand-fg tabular-nums">{count}</span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
