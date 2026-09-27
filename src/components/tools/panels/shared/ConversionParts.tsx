"use client";

import type { ReactNode } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { PageThumbnail } from "@/components/pdf/PageThumbnail";
import { usePdfDocument } from "@/components/pdf/usePdfDocument";

/** Upfront note that a conversion is approximate, listing what does and doesn't carry over. */
export function FidelityNote({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 flex gap-2.5 rounded-lg bg-surface-muted p-3 text-xs text-fg-muted">
      <Info className="mt-px size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <section className="rounded-xl border border-warning/40 bg-warning-soft p-4" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-medium text-fg">
        <TriangleAlert className="size-4 text-warning" aria-hidden="true" />
        Some content couldn&apos;t be converted exactly
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-9 text-sm text-fg-muted">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </section>
  );
}

const PREVIEW_PAGES = 6;

/** The first pages of a PDF the tool produced, so the result can be checked before downloading. */
export function PdfResultPreview({ blob, pages }: { blob: Blob; pages: number }) {
  const pdf = usePdfDocument(blob);
  return (
    <section className="rounded-xl border border-line bg-surface" aria-label="Result preview">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">
        <span>Result preview</span>
        <span className="normal-case tracking-normal">
          {pages} page{pages === 1 ? "" : "s"}
        </span>
      </div>
      <ol className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4 bg-surface-muted p-4">
        {pdf.status === "ready" &&
          Array.from({ length: Math.min(pages, PREVIEW_PAGES) }, (_, i) => (
            <li key={i} className="flex flex-col items-center gap-1.5">
              <PageThumbnail doc={pdf.doc} pageNumber={i + 1} width={140} height={180} />
              <span className="text-xs text-fg-subtle tabular-nums">{i + 1}</span>
            </li>
          ))}
      </ol>
      {pages > PREVIEW_PAGES && <p className="border-t border-line px-4 py-2 text-xs text-fg-subtle">…and {pages - PREVIEW_PAGES} more. Open the result in a new tab to see every page.</p>}
    </section>
  );
}
