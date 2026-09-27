"use client";

import { useState, type ChangeEvent, type ReactNode } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ImagePlus, ListOrdered, LoaderCircle, Stamp, X } from "lucide-react";
import { usePdfDocument } from "@/components/pdf/usePdfDocument";
import { errorMessage } from "@/lib/errors";
import { isJpeg } from "@/lib/metadata/jpeg";
import { isPng } from "@/lib/metadata/png";
import { numberPagesOfFile, stampLabelsOnFile, watermarkFile } from "@/lib/pdf/client";
import { pageLabels, type PageNumberOptions, type WatermarkOptions } from "@/lib/pdf/markup";
import { parsePageRanges } from "@/lib/pdf/ranges";
import { withSuffix } from "@/lib/zip";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { AnchorPicker, ColorField, Field, INPUT, Segmented, Slider, type AnchorId } from "../shared/controls";
import { OutputCard, PRIMARY, SECONDARY, type OutputFile } from "../shared/OutputCard";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import { StampPreview, useStampPreview } from "../shared/StampPreview";

const COLORS = [
  { value: "#6b7280", name: "Grey" },
  { value: "#b91c1c", name: "Red" },
  { value: "#263a81", name: "Navy" },
  { value: "#111111", name: "Black" },
  { value: "#047857", name: "Green" },
];

/** Parse an optional page-range field; empty means every page. */
function usePageField(pageCount: number) {
  const [text, setText] = useState("");
  const parsed = text.trim() ? parsePageRanges(text, pageCount) : null;
  const pages = parsed?.ok ? [...new Set(parsed.groups.flat())] : undefined;
  return { text, setText, pages, error: parsed && !parsed.ok ? parsed.error : undefined };
}

/** Runs the final stamping for the whole file. */
function useApply(file: WorkspaceFile, suffix: string) {
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<OutputFile | null>(null);
  const apply = async (make: () => Promise<Blob>) => {
    const { updateFile } = useWorkspaceStore.getState();
    setBusy(true);
    setOutput(null);
    updateFile(file.id, { status: "processing", error: undefined });
    try {
      setOutput({ name: withSuffix(file.name, suffix), blob: await make() });
      updateFile(file.id, { status: "idle" });
    } catch (error) {
      updateFile(file.id, { status: "error", error: errorMessage(error) });
      toast({ tone: "error", title: "Couldn't update the PDF", description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };
  return { busy, output, setOutput, apply };
}

function Layout({ preview, actions }: { preview: ReactNode; actions: ReactNode }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0">{preview}</div>
      <div className="order-first space-y-4 lg:sticky lg:top-20 lg:order-0">{actions}</div>
    </div>
  );
}

/** Opens the PDF, showing loading and error states, then renders the tool with it. */
function DocGate({ file, children }: { file: WorkspaceFile; children: (doc: PDFDocumentProxy) => ReactNode }) {
  const pdf = usePdfDocument(file.file);
  if (pdf.status === "loading") return <PdfLoading />;
  if (pdf.status === "error") return <PdfLoadError message={pdf.message} code={pdf.code} />;
  return children(pdf.doc);
}

// ---------------------------------------------------------------------------- Watermark

export function WatermarkPanel({ file }: ToolPanelProps) {
  return <DocGate file={file}>{(doc) => <Watermarker file={file} doc={doc} />}</DocGate>;
}

interface WatermarkImage {
  id: string;
  name: string;
  bytes: Uint8Array;
  format: "png" | "jpeg";
  url: string;
}

function Watermarker({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const [kind, setKind] = useState<"text" | "image">("text");
  const [text, setText] = useState("CONFIDENTIAL");
  const [bold, setBold] = useState(true);
  const [size, setSize] = useState(64);
  const [color, setColor] = useState(COLORS[0].value);
  const [opacity, setOpacity] = useState(25);
  const [angle, setAngle] = useState<"0" | "30" | "45" | "90">("45");
  const [position, setPosition] = useState<AnchorId>("center");
  const [tile, setTile] = useState(false);
  const [image, setImage] = useState<WatermarkImage | null>(null);
  const [imageScale, setImageScale] = useState(40);
  const [behind, setBehind] = useState(false);
  const range = usePageField(doc.numPages);
  const { busy, output, setOutput, apply } = useApply(file, "watermarked");

  const options: WatermarkOptions = {
    kind,
    text,
    bold,
    size,
    color,
    opacity: opacity / 100,
    angle: Number(angle),
    position: tile ? "tile" : position,
    image: image ? { bytes: image.bytes, format: image.format } : undefined,
    imageScale: imageScale / 100,
    behind,
    pages: range.pages,
  };
  const previewPages = Math.min(2, doc.numPages);
  const key = JSON.stringify({ ...options, image: image?.id, pages: undefined, preview: range.pages?.filter((p) => p < previewPages) });
  const preview = useStampPreview(file.file, previewPages, key, (firstPages) => {
    // The previewed pages follow the page selection (an empty list would mean "all pages").
    const shown = range.pages?.filter((p) => p < previewPages);
    return shown?.length === 0 ? Promise.resolve(firstPages) : watermarkFile(firstPages, { ...options, pages: shown });
  });

  const set = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setOutput(null);
  };

  const chooseImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    const bytes = new Uint8Array(await chosen.arrayBuffer());
    const format = isPng(bytes) ? "png" : isJpeg(bytes) ? "jpeg" : null;
    if (!format) {
      toast({ tone: "error", title: "Use a PNG or JPEG image", description: `“${chosen.name}” isn't one.` });
      return;
    }
    if (image) URL.revokeObjectURL(image.url);
    setImage({ id: `${chosen.name}:${chosen.size}:${chosen.lastModified}`, name: chosen.name, bytes, format, url: URL.createObjectURL(chosen) });
    setOutput(null);
  };

  const ready = kind === "text" ? text.trim().length > 0 : image !== null;
  return (
    <Layout
      preview={<StampPreview {...preview} />}
      actions={
        <>
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="flex items-center gap-2 font-semibold text-fg">
              <Stamp className="size-4 text-brand-text" aria-hidden="true" />
              Watermark
            </h2>
            <Segmented label="Watermark" value={kind} onChange={set(setKind)} options={[{ id: "text", label: "Text" }, { id: "image", label: "Image" }]} />
            {kind === "text" ? (
              <>
                <Field label="Text">
                  <input value={text} onChange={(e) => set(setText)(e.target.value)} className={INPUT} maxLength={120} />
                </Field>
                <Slider label="Size" value={size} min={12} max={144} step={2} format={(v) => `${v} pt`} onChange={set(setSize)} />
                <label className="mt-3 flex cursor-pointer items-center gap-3 text-sm text-fg">
                  <input type="checkbox" checked={bold} onChange={(e) => set(setBold)(e.target.checked)} className="size-4 accent-brand" />
                  Bold
                </label>
                <ColorField label="Colour" value={color} onChange={set(setColor)} presets={COLORS} />
              </>
            ) : (
              <div className="mt-4">
                <p className="text-sm font-medium text-fg">Image</p>
                {image ? (
                  <div className="mt-1.5 flex items-center gap-3 rounded-lg border border-line p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                    <img src={image.url} alt="" className="size-10 rounded bg-surface-muted object-contain" />
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{image.name}</span>
                    <button
                      type="button"
                      onClick={() => {
                        URL.revokeObjectURL(image.url);
                        setImage(null);
                        setOutput(null);
                      }}
                      aria-label="Remove the image"
                      className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <label className={clsx(SECONDARY, "mt-1.5 w-full cursor-pointer")}>
                    <ImagePlus className="size-4" aria-hidden="true" />
                    Choose a PNG or JPEG
                    <input type="file" accept="image/png,image/jpeg" onChange={chooseImage} className="sr-only" />
                  </label>
                )}
                <Slider label="Width" value={imageScale} min={10} max={100} step={5} format={(v) => `${v}% of the page`} onChange={set(setImageScale)} />
              </div>
            )}
            <Slider label="Opacity" value={opacity} min={5} max={100} step={5} format={(v) => `${v}%`} onChange={set(setOpacity)} />
            <Segmented
              label="Angle"
              value={angle}
              onChange={set(setAngle)}
              options={[
                { id: "0", label: "0°" },
                { id: "30", label: "30°" },
                { id: "45", label: "45°" },
                { id: "90", label: "90°" },
              ]}
            />
            <div className="flex items-end justify-between gap-4">
              {!tile && <AnchorPicker label="Position" value={position} onChange={set(setPosition)} />}
              <label className={clsx("flex cursor-pointer items-center gap-3 text-sm text-fg", tile ? "mt-4" : "mb-1")}>
                <input type="checkbox" checked={tile} onChange={(e) => set(setTile)(e.target.checked)} className="size-4 accent-brand" />
                Repeat across the page
              </label>
            </div>
            <label className="mt-4 flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={behind} onChange={(e) => set(setBehind)(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-brand" />
              <span>
                <span className="block text-sm font-medium text-fg">Place behind the content</span>
                <span className="block text-xs text-fg-muted">Text stays readable; hidden on pages with a solid background (e.g. scans).</span>
              </span>
            </label>
            <Field label="Pages" hint={`Leave empty for all ${doc.numPages} pages.`} error={range.error}>
              <input value={range.text} onChange={(e) => set(range.setText)(e.target.value)} placeholder="All pages" className={INPUT} />
            </Field>
            <button type="button" onClick={() => apply(() => watermarkFile(file.file, options))} disabled={busy || !ready || Boolean(range.error)} className={clsx(PRIMARY, "mt-5 w-full")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Stamp className="size-4" aria-hidden="true" />}
              {busy ? "Adding watermark…" : "Add watermark"}
            </button>
          </section>
          {output && <OutputCard title="Watermark added" outputs={[output]} replaceFileId={file.id} />}
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------- Page numbers

export function PageNumbersPanel({ file }: ToolPanelProps) {
  return <DocGate file={file}>{(doc) => <Numberer file={file} doc={doc} />}</DocGate>;
}

const FORMATS = [
  { id: "{n}", label: "1" },
  { id: "{n} / {total}", label: "1 / 9" },
  { id: "Page {n}", label: "Page 1" },
  { id: "Page {n} of {total}", label: "Page 1 of 9" },
];
const MARGINS = { small: 18, medium: 30, large: 48 } as const;
const EDGE_ANCHORS: AnchorId[] = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"];

function Numberer({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const [format, setFormat] = useState("Page {n} of {total}");
  const [position, setPosition] = useState<AnchorId>("bottom-center");
  const [margin, setMargin] = useState<keyof typeof MARGINS>("medium");
  const [size, setSize] = useState(10);
  const [color, setColor] = useState("#111111");
  const [start, setStart] = useState(1);
  const range = usePageField(doc.numPages);
  const { busy, output, setOutput, apply } = useApply(file, "numbered");

  const options: PageNumberOptions = { format, position, margin: MARGINS[margin], size, color, start: Number.isFinite(start) ? start : 1, pages: range.pages };
  const formatError = format.includes("{n}") ? undefined : "Include {n} where the number goes.";
  // Labels are worked out for the whole document, so the preview shows the real numbers.
  const labels = formatError ? null : pageLabels(options, doc.numPages);
  const previewPages = Math.min(2, doc.numPages);
  const preview = useStampPreview(file.file, previewPages, JSON.stringify({ options, labels: labels?.slice(0, previewPages) }), (firstPages) =>
    labels ? stampLabelsOnFile(firstPages, labels.slice(0, previewPages), options) : Promise.resolve(firstPages),
  );

  const set = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setOutput(null);
  };
  const skipFirst = range.text.trim() === "2-";

  return (
    <Layout
      preview={<StampPreview {...preview} />}
      actions={
        <>
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="flex items-center gap-2 font-semibold text-fg">
              <ListOrdered className="size-4 text-brand-text" aria-hidden="true" />
              Page numbers
            </h2>
            <Segmented label="Style" value={FORMATS.some((f) => f.id === format) ? format : ""} onChange={set(setFormat)} options={FORMATS} columns={2} />
            <Field label="Format" hint="{n} is the page number, {total} the last number." error={formatError}>
              <input value={format} onChange={(e) => set(setFormat)(e.target.value)} className={INPUT} maxLength={60} />
            </Field>
            <AnchorPicker label="Position" value={position} onChange={set(setPosition)} allowed={EDGE_ANCHORS} />
            <Segmented
              label="Distance from the edge"
              value={margin}
              onChange={set(setMargin)}
              options={[
                { id: "small", label: "Small" },
                { id: "medium", label: "Medium" },
                { id: "large", label: "Large" },
              ]}
            />
            <Slider label="Size" value={size} min={7} max={24} format={(v) => `${v} pt`} onChange={set(setSize)} />
            <ColorField label="Colour" value={color} onChange={set(setColor)} presets={COLORS} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="First number">
                <input type="number" min={0} value={Number.isFinite(start) ? start : ""} onChange={(e) => set(setStart)(e.target.valueAsNumber)} className={INPUT} />
              </Field>
              <Field label="Pages" error={range.error}>
                <input value={range.text} onChange={(e) => set(range.setText)(e.target.value)} placeholder="All" className={INPUT} />
              </Field>
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-3 text-sm text-fg">
              <input type="checkbox" checked={skipFirst} onChange={(e) => set(range.setText)(e.target.checked ? "2-" : "")} className="size-4 accent-brand" />
              Skip the first page (cover)
            </label>
            <button type="button" onClick={() => apply(() => numberPagesOfFile(file.file, options))} disabled={busy || Boolean(formatError || range.error)} className={clsx(PRIMARY, "mt-5 w-full")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ListOrdered className="size-4" aria-hidden="true" />}
              {busy ? "Numbering…" : "Add page numbers"}
            </button>
          </section>
          {output && <OutputCard title="Page numbers added" outputs={[output]} replaceFileId={file.id} />}
        </>
      }
    />
  );
}
