"use client";

import { useState, type ReactNode } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ArrowRight, LoaderCircle, Shrink, TriangleAlert } from "lucide-react";
import { PageThumbnail } from "@/components/pdf/PageThumbnail";
import { usePdfDocument } from "@/components/pdf/usePdfDocument";
import { errorMessage } from "@/lib/errors";
import { formatBytes } from "@/lib/files";
import { compressFile } from "@/lib/pdf/client";
import { COMPRESS_PRESETS, type CompressPreset } from "@/lib/pdf/compress";
import { withSuffix } from "@/lib/zip";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { OutputCard, PRIMARY } from "../shared/OutputCard";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";

const PRESETS: { id: CompressPreset; label: string; description: string }[] = [
  { id: "light", label: "Light", description: `Hardly visible changes. Images kept up to ${COMPRESS_PRESETS.light.dpi} DPI.` },
  { id: "balanced", label: "Balanced", description: `Good for email and sharing. Images up to ${COMPRESS_PRESETS.balanced.dpi} DPI.` },
  { id: "strong", label: "Strong", description: `Smallest file. Images up to ${COMPRESS_PRESETS.strong.dpi} DPI; photos look softer.` },
];

interface Result {
  blob: Blob;
  images: number;
  recompressed: number;
  keptOriginal: boolean;
}

export default function CompressPanel({ file }: ToolPanelProps) {
  const pdf = usePdfDocument(file.file);
  if (pdf.status === "loading") return <PdfLoading />;
  if (pdf.status === "error") return <PdfLoadError message={pdf.message} code={pdf.code} />;
  return <Compressor file={file} doc={pdf.doc} />;
}

function Compressor({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const [preset, setPreset] = useState<CompressPreset>("balanced");
  const [removeMetadata, setRemoveMetadata] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    const { updateFile } = useWorkspaceStore.getState();
    updateFile(file.id, { status: "processing", error: undefined });
    try {
      setResult(await compressFile(file.file, { ...COMPRESS_PRESETS[preset], removeMetadata }));
      updateFile(file.id, { status: "idle" });
    } catch (error) {
      updateFile(file.id, { status: "error", error: errorMessage(error) });
      toast({ tone: "error", title: "Compression failed", description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const shrunk = result && !result.keptOriginal ? result : null;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="rounded-xl border border-line bg-surface" aria-label="Preview">
        <div className="border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">Preview · page 1</div>
        <div className="grid gap-4 bg-surface-muted p-4 sm:grid-cols-2">
          <PreviewPane label="Original" size={file.size}>
            <PageThumbnail doc={doc} pageNumber={1} width={260} height={340} />
          </PreviewPane>
          {shrunk ? (
            <PreviewPane label="Compressed" size={shrunk.blob.size}>
              <ResultThumbnail blob={shrunk.blob} />
            </PreviewPane>
          ) : (
            <div className="hidden items-center justify-center rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-fg-subtle sm:flex">
              {busy ? "Compressing…" : "The compressed page appears here, so you can check the image quality."}
            </div>
          )}
        </div>
      </section>

      <div className="order-first space-y-4 lg:sticky lg:top-20 lg:order-0">
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-semibold text-fg">
            <Shrink className="size-4 text-brand-text" aria-hidden="true" />
            Compress PDF
          </h2>
          <p className="mt-1 text-sm text-fg-muted">Downscales and re-encodes photos, and repacks the file. Text and vector graphics stay sharp.</p>

          <fieldset className="mt-4 space-y-2">
            <legend className="mb-1.5 text-sm font-medium text-fg">Compression level</legend>
            {PRESETS.map((p) => (
              <label
                key={p.id}
                className={clsx(
                  "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
                  preset === p.id ? "border-brand-text bg-brand-soft" : "border-line hover:border-line-strong",
                )}
              >
                <input
                  type="radio"
                  name="compress-level"
                  value={p.id}
                  checked={preset === p.id}
                  onChange={() => {
                    setPreset(p.id);
                    setResult(null);
                  }}
                  className="mt-0.5 size-4 shrink-0 accent-brand"
                />
                <span>
                  <span className="flex items-center gap-2 text-sm font-medium text-fg">
                    {p.label}
                    {p.id === "balanced" && (
                      <span className="rounded bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-brand-fg">Recommended</span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-fg-muted">{p.description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="mt-4 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={removeMetadata}
              onChange={(e) => {
                setRemoveMetadata(e.target.checked);
                setResult(null);
              }}
              className="mt-0.5 size-4 shrink-0 accent-brand"
            />
            <span>
              <span className="block text-sm font-medium text-fg">Also remove metadata</span>
              <span className="block text-xs text-fg-muted">Author, dates, XMP, attachments and scripts, as Sanitize does.</span>
            </span>
          </label>

          <button type="button" onClick={run} disabled={busy} className={clsx(PRIMARY, "mt-5 w-full")}>
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Shrink className="size-4" aria-hidden="true" />}
            {busy ? "Compressing…" : "Compress PDF"}
          </button>
        </section>

        {result && <SavingsCard before={file.size} result={result} strongest={preset === "strong"} />}
        {shrunk && (
          <OutputCard
            title="Compressed"
            outputs={[{ name: withSuffix(file.name, "compressed"), blob: shrunk.blob }]}
            replaceFileId={file.id}
          />
        )}
      </div>
    </div>
  );
}

function SavingsCard({ before, result, strongest }: { before: number; result: Result; strongest: boolean }) {
  if (result.keptOriginal) {
    return (
      <section className="rounded-xl border border-warning/40 bg-warning-soft p-5" aria-live="polite">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
          <div>
            <p className="font-medium text-fg">Already well optimized</p>
            <p className="mt-1 text-sm text-fg-muted">
              Compressing didn&apos;t make this PDF smaller, so your file is unchanged.
              {result.images === 0
                ? " It has no photos to shrink."
                : strongest
                  ? " Its images are already compact."
                  : " Try a stronger level."}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const after = result.blob.size;
  const saved = Math.round((1 - after / before) * 100);
  return (
    <section className="rounded-xl border border-line bg-surface p-5" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={clsx("text-3xl font-semibold tabular-nums", saved > 0 ? "text-success-text" : "text-fg")}>
          {saved > 0 ? `−${saved}%` : "±0%"}
        </p>
        <p className="flex items-center gap-1.5 text-sm text-fg-muted tabular-nums">
          {formatBytes(before)}
          <ArrowRight className="size-3.5" aria-label="to" />
          <span className="font-medium text-fg">{formatBytes(after)}</span>
        </p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-success" style={{ width: `${Math.min(100, (after / before) * 100)}%` }} />
      </div>
      <p className="mt-3 text-sm text-fg-muted">
        {result.recompressed === 0
          ? "No images needed shrinking; the file was repacked."
          : `${result.recompressed} of ${result.images} image${result.images === 1 ? "" : "s"} recompressed.`}
        {saved <= 0 && " Metadata was removed."}
      </p>
    </section>
  );
}

function PreviewPane({ label, size, children }: { label: string; size: number; children: ReactNode }) {
  return (
    <figure className="flex flex-col items-center gap-2">
      {children}
      <figcaption className="text-xs text-fg-muted">
        <span className="font-medium text-fg">{label}</span> · {formatBytes(size)}
      </figcaption>
    </figure>
  );
}

function ResultThumbnail({ blob }: { blob: Blob }) {
  const pdf = usePdfDocument(blob);
  if (pdf.status !== "ready") return <div style={{ width: 260, height: 340 }} />;
  return <PageThumbnail doc={pdf.doc} pageNumber={1} width={260} height={340} />;
}
