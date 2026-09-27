"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { errorMessage } from "@/lib/errors";
import { extractFromFile } from "@/lib/pdf/client";
import { renderPageToImage } from "@/lib/pdf/rasterize";
import { openPdfForRendering } from "@/lib/pdf/render";

interface Preview {
  key: string;
  urls: string[];
  error?: string;
}

/**
 * A live, exact preview: the first `pages` pages are stamped by the real code with the current
 * options (whenever `key` changes, debounced) and shown as images. The previous images stay up
 * until the new ones are ready, so the preview never flickers.
 */
export function useStampPreview(file: File, pages: number, key: string, stamp: (firstPages: Blob) => Promise<Blob>) {
  const [base, setBase] = useState<{ file: File; blob: Blob } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const run = useEffectEvent(stamp);

  useEffect(() => {
    let active = true;
    extractFromFile(file, [Array.from({ length: pages }, (_, i) => i)])
      .then(([blob]) => active && setBase({ file, blob }))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [file, pages]);

  const firstPages = base?.file === file ? base.blob : null;
  useEffect(() => {
    if (!firstPages) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const opened = await openPdfForRendering(await run(firstPages));
        try {
          const urls: string[] = [];
          for (let n = 1; n <= opened.doc.numPages; n++) {
            const image = await renderPageToImage(opened.doc, n, { dpi: 96, format: "png", quality: 1 });
            urls.push(URL.createObjectURL(image.blob));
          }
          if (active) setPreview({ key, urls });
          else urls.forEach((u) => URL.revokeObjectURL(u));
        } finally {
          opened.destroy();
        }
      } catch (error) {
        if (active) setPreview((prev) => ({ key, urls: prev?.urls ?? [], error: errorMessage(error) }));
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [firstPages, key]);

  // Release each set of images once it's replaced (or the panel closes).
  useEffect(() => () => preview?.urls.forEach((u) => URL.revokeObjectURL(u)), [preview]);

  return { urls: preview?.urls ?? [], error: preview?.key === key ? preview.error : undefined, updating: preview?.key !== key };
}

export function StampPreview({ urls, error, updating }: ReturnType<typeof useStampPreview>) {
  return (
    <section className="rounded-xl border border-line bg-surface" aria-label="Live preview">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">
        <span>Live preview</span>
        {updating && <LoaderCircle className="size-3.5 animate-spin" aria-label="Updating preview" />}
      </div>
      <div className="grid gap-4 bg-surface-muted p-4 sm:grid-cols-2">
        {urls.length === 0 && !error && <div className="aspect-[3/4] animate-pulse rounded bg-surface sm:col-span-2 sm:mx-auto sm:w-1/2" />}
        {urls.map((url, i) => (
          <figure key={url} className="flex flex-col items-center gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL of a rendered page */}
            <img src={url} alt={`Preview of page ${i + 1}`} className="max-h-[30rem] w-auto max-w-full bg-white shadow-elev-1" />
            <figcaption className="text-xs text-fg-subtle tabular-nums">Page {i + 1}</figcaption>
          </figure>
        ))}
      </div>
      {error && (
        <p className="border-t border-line px-4 py-2 text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
