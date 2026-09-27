"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Images, LoaderCircle, X } from "lucide-react";
import { PageTile } from "@/components/pdf/PageTile";
import { usePageSelection } from "@/components/pdf/usePageSelection";
import { usePdfDocument } from "@/components/pdf/usePdfDocument";
import { errorMessage } from "@/lib/errors";
import { canEncode, RASTER_FORMATS, rasterSize, renderPageToImage, type RasterFormat } from "@/lib/pdf/rasterize";
import { withSuffix } from "@/lib/zip";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { Field, INPUT, Segmented } from "../shared/controls";
import { OutputCard, PRIMARY, SECONDARY, type OutputFile } from "../shared/OutputCard";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";

type Dpi = "72" | "150" | "300";

export default function PdfToImagesPanel({ file }: ToolPanelProps) {
  const pdf = usePdfDocument(file.file);
  if (pdf.status === "loading") return <PdfLoading />;
  if (pdf.status === "error") return <PdfLoadError message={pdf.message} code={pdf.code} />;
  return <Converter file={file} doc={pdf.doc} />;
}

function Converter({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const pageCount = doc.numPages;
  const [format, setFormat] = useState<RasterFormat>("jpeg");
  const [dpi, setDpi] = useState<Dpi>("150");
  const [quality, setQuality] = useState(85);
  const [webp] = useState(() => canEncode("webp"));
  const [firstPage, setFirstPage] = useState<{ w: number; h: number } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outputs, setOutputs] = useState<OutputFile[] | null>(null);
  const selection = usePageSelection(
    pageCount,
    Array.from({ length: pageCount }, (_, i) => i),
    () => setOutputs(null),
  );
  const selectedSet = useMemo(() => new Set(selection.selected), [selection.selected]);
  const cancelled = useRef(false);

  // Page 1's size, for the pixel-size estimate.
  useEffect(() => {
    let active = true;
    doc
      .getPage(1)
      .then((page) => {
        const { width, height } = page.getViewport({ scale: 1 });
        if (active) setFirstPage({ w: width, h: height });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [doc]);

  // Stop rendering if the panel goes away mid-conversion.
  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

  const change = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setOutputs(null);
  };

  const run = async () => {
    const pages = selection.selected;
    const { updateFile } = useWorkspaceStore.getState();
    const target = RASTER_FORMATS[format];
    const digits = String(pageCount).length;
    cancelled.current = false;
    setOutputs(null);
    setProgress({ done: 0, total: pages.length });
    updateFile(file.id, { status: "processing", progress: 0 });
    const results: OutputFile[] = [];
    let capped = false;
    try {
      for (const [n, index] of pages.entries()) {
        if (cancelled.current) break;
        const image = await renderPageToImage(doc, index + 1, { dpi: Number(dpi), format, quality: quality / 100 });
        capped ||= image.capped;
        results.push({
          blob: image.blob,
          name: withSuffix(file.name, `page-${String(index + 1).padStart(digits, "0")}`, target.extension),
          detail: `Page ${index + 1} · ${image.width} × ${image.height} px`,
        });
        setProgress({ done: n + 1, total: pages.length });
        updateFile(file.id, { status: "processing", progress: Math.round(((n + 1) / pages.length) * 100) });
      }
      updateFile(file.id, { status: "idle", progress: undefined });
      if (cancelled.current) {
        toast({ tone: "info", title: "Conversion cancelled" });
        return;
      }
      setOutputs(results);
      if (capped) {
        toast({
          tone: "warning",
          title: "Some pages were rendered smaller",
          description: "They were too large for your browser at this resolution, so they were scaled down to fit.",
        });
      }
    } catch (error) {
      updateFile(file.id, { status: "error", error: errorMessage(error) });
      toast({ tone: "error", title: "Conversion failed", description: errorMessage(error) });
    } finally {
      setProgress(null);
    }
  };

  const busy = progress !== null;
  const estimate = firstPage && rasterSize(firstPage.w, firstPage.h, Number(dpi));
  const count = selection.selected.length;
  const baseName = file.name.replace(/\.pdf$/i, "");

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="rounded-xl border border-line bg-surface" aria-label="Pages">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <p className="text-sm text-fg-muted">
            <span className="font-semibold text-fg">{count}</span> of {pageCount} pages selected
          </p>
          <div className="flex gap-3 text-sm">
            <button type="button" className="text-brand-text hover:underline disabled:opacity-40" disabled={busy} onClick={selection.selectAll}>
              Select all
            </button>
            <button type="button" className="text-brand-text hover:underline disabled:opacity-40" disabled={busy || count === 0} onClick={selection.clear}>
              Clear
            </button>
          </div>
        </header>
        <ol className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3 p-4">
          {Array.from({ length: pageCount }, (_, i) => {
            const selected = selectedSet.has(i);
            return (
              <li key={i}>
                <PageTile
                  doc={doc}
                  index={i}
                  selected={selected}
                  dimmed={!selected}
                  pressed={selected}
                  label={`Page ${i + 1}`}
                  onClick={(e) => !busy && selection.click(i, e)}
                />
              </li>
            );
          })}
        </ol>
      </section>

      <div className="order-first space-y-4 lg:sticky lg:top-20 lg:order-0">
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-semibold text-fg">
            <Images className="size-4 text-brand-text" aria-hidden="true" />
            Convert to images
          </h2>
          <p className="mt-1 text-sm text-fg-muted">Each selected page becomes one image file.</p>

          <Segmented
            label="Format"
            value={format}
            onChange={change(setFormat)}
            disabled={busy}
            hint={webp ? undefined : "Your browser can't create WebP images."}
            options={(Object.keys(RASTER_FORMATS) as RasterFormat[]).map((id) => ({
              id,
              label: RASTER_FORMATS[id].label,
              disabled: id === "webp" && !webp,
            }))}
          />
          <Segmented
            label="Resolution"
            value={dpi}
            onChange={change(setDpi)}
            disabled={busy}
            hint={estimate ? `Page 1 → ${estimate.width.toLocaleString()} × ${estimate.height.toLocaleString()} px${estimate.capped ? " (reduced to fit browser limits)" : ""}` : undefined}
            options={[
              { id: "72", label: "72 DPI" },
              { id: "150", label: "150 DPI" },
              { id: "300", label: "300 DPI" },
            ]}
          />
          {RASTER_FORMATS[format].lossy && (
            <label className="mt-4 block text-sm">
              <span className="flex justify-between font-medium text-fg">
                Quality <span className="font-normal text-fg-muted tabular-nums">{quality}%</span>
              </span>
              <input
                type="range"
                min={40}
                max={100}
                step={5}
                value={quality}
                disabled={busy}
                onChange={(e) => change(setQuality)(e.target.valueAsNumber)}
                className="mt-2 w-full accent-brand"
              />
            </label>
          )}
          <Field label="Pages" hint="Click pages or type ranges, e.g. 1-3, 5, 8-" error={selection.error}>
            <input value={selection.text} disabled={busy} onChange={(e) => selection.type(e.target.value)} placeholder="None selected" className={INPUT} />
          </Field>

          {busy ? (
            <div className="mt-5 space-y-2">
              <div className="flex items-center gap-2 text-sm text-fg-muted" aria-live="polite">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                Rendering page {Math.min(progress.done + 1, progress.total)} of {progress.total}…
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
              <button type="button" onClick={() => {
                  cancelled.current = true;
                }} className={clsx(SECONDARY, "w-full")}>
                <X className="size-4" aria-hidden="true" />
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={run} disabled={count === 0} className={clsx(PRIMARY, "mt-5 w-full")}>
              <Images className="size-4" aria-hidden="true" />
              {count === 1 ? "Convert 1 page" : `Convert ${count} pages`}
            </button>
          )}
        </section>

        {outputs && (
          <OutputCard
            title={outputs.length === 1 ? "Image ready" : `${outputs.length} images ready`}
            outputs={outputs}
            zipName={`${baseName}-images.zip`}
          />
        )}
      </div>
    </div>
  );
}
