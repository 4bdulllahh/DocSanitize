"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { LoaderCircle } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { withRenderSlot } from "@/lib/pdf/render";

interface Props {
  doc: PDFDocumentProxy;
  /** 1-based page number. */
  pageNumber: number;
  /** Extra clockwise rotation to show (applied with CSS, so it's instant). */
  rotation?: number;
  /** Size of the box the page is fitted into, in CSS pixels. */
  width: number;
  height: number;
  className?: string;
}

/**
 * Renders one page once it scrolls into view. The page is fitted (after rotation) inside a
 * fixed box, so the layout never shifts as thumbnails load.
 */
export function PageThumbnail({ doc, pageNumber, rotation = 0, width, height, className }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    withRenderSlot(async () => {
      if (cancelled) return;
      const page = await doc.getPage(pageNumber);
      const natural = page.getViewport({ scale: 1 });
      // Render at the resolution the largest orientation needs, capped for memory.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = (Math.max(width, height) * dpr) / Math.max(natural.width, natural.height);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      task = page.render({ canvas, viewport });
      await task.promise;
      if (!cancelled) setSize({ w: natural.width, h: natural.height });
    }).catch(() => {
      // Cancelled or failed renders just leave the placeholder in place.
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, doc, pageNumber, width, height]);

  // Fit the page inside the box once rotated.
  const odd = Math.abs(rotation / 90) % 2 === 1;
  let display = { w: 0, h: 0 };
  if (size) {
    const maxW = odd ? height : width;
    const maxH = odd ? width : height;
    const fit = Math.min(maxW / size.w, maxH / size.h);
    display = { w: size.w * fit, h: size.h * fit };
  }

  return (
    <div ref={boxRef} className={clsx("relative shrink-0", className)} style={{ width, height }}>
      {!size && (
        <div className="absolute inset-0 flex items-center justify-center">
          <LoaderCircle className="size-5 animate-spin text-fg-subtle" aria-hidden="true" />
        </div>
      )}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={clsx("absolute top-1/2 left-1/2 bg-white shadow-elev-1 transition-transform duration-200", !size && "invisible")}
        style={{
          width: display.w,
          height: display.h,
          transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
        }}
      />
    </div>
  );
}
