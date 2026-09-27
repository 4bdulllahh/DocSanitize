"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PageThumbnail } from "./PageThumbnail";

export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export interface StageSize {
  /** Displayed size on screen, in CSS pixels. */
  width: number;
  height: number;
  /** The page's displayed size in points (rotation applied). */
  pageWidth: number;
  pageHeight: number;
}

/**
 * One page, as large as its container allows (up to `maxWidth`), with an overlay layer exactly
 * covering it for placing things. Overlay content is given the stage size.
 */
export function PageStage({ doc, index, maxWidth = 760, children }: { doc: PDFDocumentProxy; index: number; maxWidth?: number; children?: (size: StageSize) => ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const available = useElementWidth(containerRef);
  const [page, setPage] = useState<{ index: number; width: number; height: number } | null>(null);

  useEffect(() => {
    let active = true;
    doc
      .getPage(index + 1)
      .then((p) => {
        const { width, height } = p.getViewport({ scale: 1 });
        if (active) setPage({ index, width, height });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [doc, index]);

  const known = page?.index === index ? page : null;
  const width = Math.min(available, maxWidth);
  const height = Math.round(width * (known ? known.height / known.width : 1.294));

  return (
    <div ref={containerRef} className="w-full">
      {width > 0 && (
        <div className="relative mx-auto" style={{ width, height }}>
          <PageThumbnail key={index} doc={doc} pageNumber={index + 1} width={width} height={height} />
          {known && children?.({ width, height, pageWidth: known.width, pageHeight: known.height })}
        </div>
      )}
    </div>
  );
}
