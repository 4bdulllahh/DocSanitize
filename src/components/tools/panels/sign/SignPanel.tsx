"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { CalendarDays, ChevronLeft, ChevronRight, LoaderCircle, Plus, Signature, Trash2, X } from "lucide-react";
import { PageStage, type StageSize } from "@/components/pdf/PageStage";
import { PageStrip } from "@/components/pdf/PageStrip";
import { usePdfDocument } from "@/components/pdf/usePdfDocument";
import { errorMessage } from "@/lib/errors";
import { createId } from "@/lib/files";
import { signFile } from "@/lib/pdf/client";
import type { Placement } from "@/lib/pdf/markup";
import { formatPageRanges } from "@/lib/pdf/ranges";
import { withSuffix } from "@/lib/zip";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { FidelityNote } from "../shared/ConversionParts";
import { OutputCard, PRIMARY, SECONDARY, type OutputFile } from "../shared/OutputCard";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import { SignatureCreator, useSignatures, type SignatureAsset } from "./SignatureCreator";

type Placed = Placement & { id: string };
type Rect = Pick<Placement, "x" | "y" | "width" | "height">;

export default function SignPanel({ file }: ToolPanelProps) {
  const pdf = usePdfDocument(file.file);
  if (pdf.status === "loading") return <PdfLoading />;
  if (pdf.status === "error") return <PdfLoadError message={pdf.message} code={pdf.code} />;
  return <Signer file={file} doc={pdf.doc} />;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function Signer({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const { assets, add, remove } = useSignatures();
  const [creating, setCreating] = useState(assets.length === 0);
  const [placements, setPlacements] = useState<Placed[]>([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<OutputFile | null>(null);

  const change = (fn: (prev: Placed[]) => Placed[]) => {
    setPlacements(fn);
    setOutput(null);
  };

  /** Add something to the current page, `widthPt` points wide, in the lower right where signatures go. */
  const place = async (item: { kind: "image"; image: string } | { kind: "text"; text: string }, widthPt: number, heightPt: number) => {
    const { width, height } = (await doc.getPage(current + 1)).getViewport({ scale: 1 });
    const w = Math.min(0.9, widthPt / width);
    const h = Math.min(0.9, (heightPt * (w / (widthPt / width))) / height);
    const id = createId();
    change((prev) => [...prev, { ...item, id, page: current, x: clamp(0.62, 0, 1 - w), y: clamp(0.78, 0, 1 - h), width: w, height: h }]);
    setSelected(id);
  };
  const placeSignature = (asset: SignatureAsset) => place({ kind: "image", image: asset.id }, 180, 180 * (asset.height / asset.width));
  const placeDate = () => {
    const text = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    // About half an em per character of Liberation Sans, at 12 pt.
    place({ kind: "text", text }, text.length * 12 * 0.52, 12 * 1.2);
  };

  const apply = async () => {
    const { updateFile } = useWorkspaceStore.getState();
    setBusy(true);
    setOutput(null);
    updateFile(file.id, { status: "processing", error: undefined });
    try {
      const images = Object.fromEntries(assets.filter((a) => placements.some((p) => p.kind === "image" && p.image === a.id)).map((a) => [a.id, a.png]));
      const blob = await signFile(file.file, placements, images);
      setOutput({ name: withSuffix(file.name, "signed"), blob });
      updateFile(file.id, { status: "idle" });
    } catch (error) {
      updateFile(file.id, { status: "error", error: errorMessage(error) });
      toast({ tone: "error", title: "Signing failed", description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const counts: Record<number, number> = {};
  for (const p of placements) counts[p.page] = (counts[p.page] ?? 0) + 1;
  const pages = Object.keys(counts).map(Number).sort((a, b) => a - b);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="min-w-0 rounded-xl border border-line bg-surface" aria-label="Pages">
        <PageStrip
          doc={doc}
          current={current}
          onSelect={(i) => {
            setCurrent(i);
            setSelected(null);
          }}
          counts={counts}
          noun="placement"
        />
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
          <button type="button" className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40" disabled={current === 0} onClick={() => setCurrent(current - 1)} aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-fg-muted tabular-nums">
            Page {current + 1} of {doc.numPages}
          </span>
          <button type="button" className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40" disabled={current === doc.numPages - 1} onClick={() => setCurrent(current + 1)} aria-label="Next page">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="bg-surface-muted p-3 sm:p-5" onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
          <PageStage doc={doc} index={current}>
            {(stage) => (
              <div className="absolute inset-0" onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)} role="group" aria-label={`Page ${current + 1}: placed signatures`}>
                {placements
                  .filter((p) => p.page === current)
                  .map((p) => (
                    <PlacedItem
                      key={p.id}
                      placement={p}
                      asset={p.kind === "image" ? assets.find((a) => a.id === p.image) : undefined}
                      stage={stage}
                      selected={selected === p.id}
                      onSelect={() => setSelected(p.id)}
                      onChange={(next) => change((prev) => prev.map((q) => (q.id === p.id ? { ...q, ...next } : q)))}
                      onRemove={() => {
                        change((prev) => prev.filter((q) => q.id !== p.id));
                        setSelected(null);
                      }}
                    />
                  ))}
              </div>
            )}
          </PageStage>
          <p className="mt-3 text-center text-xs text-fg-subtle">Drag to move, drag the corner to resize. Arrow keys nudge the selected item; Delete removes it.</p>
        </div>
      </section>

      <div className="order-first space-y-4 lg:sticky lg:top-20 lg:order-0">
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-semibold text-fg">
            <Signature className="size-4 text-brand-text" aria-hidden="true" />
            Sign
          </h2>
          <FidelityNote>
            Adds a visible signature to the page. It isn&apos;t a certificate-based digital signature. Signatures stay in this browser tab only and are
            forgotten when you close it.
          </FidelityNote>

          {assets.length > 0 && (
            <ul className="mt-4 space-y-2" aria-label="Your signatures">
              {assets.map((asset, i) => (
                <li key={asset.id} className="flex items-center gap-2 rounded-lg border border-line p-2">
                  <span className="flex h-12 flex-1 items-center justify-center rounded bg-white px-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                    <img src={asset.url} alt={`Signature ${i + 1}`} className="max-h-10 max-w-full object-contain" />
                  </span>
                  <button type="button" onClick={() => placeSignature(asset)} className={clsx(PRIMARY, "px-3 py-2")} aria-label={`Place signature ${i + 1} on page ${current + 1}`}>
                    <Plus className="size-4" aria-hidden="true" />
                    Place
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      remove(asset.id);
                      change((prev) => prev.filter((p) => !(p.kind === "image" && p.image === asset.id)));
                    }}
                    className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg"
                    aria-label={`Delete signature ${i + 1}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {creating ? (
            <SignatureCreator
              onDone={(asset) => {
                setCreating(false);
                if (asset) {
                  add(asset);
                  void placeSignature(asset);
                }
              }}
            />
          ) : (
            <button type="button" onClick={() => setCreating(true)} className={clsx(SECONDARY, "mt-3 w-full")}>
              <Signature className="size-4" aria-hidden="true" />
              {assets.length ? "Create another signature" : "Create a signature"}
            </button>
          )}
          <button type="button" onClick={placeDate} className={clsx(SECONDARY, "mt-2 w-full")}>
            <CalendarDays className="size-4" aria-hidden="true" />
            Add today&apos;s date
          </button>

          <p className="mt-4 rounded-lg bg-surface-muted px-3 py-2 text-sm text-fg-muted">
            {placements.length === 0 ? (
              "Nothing placed yet"
            ) : (
              <>
                <span className="font-semibold text-fg">{placements.length}</span> placed on {pages.length === 1 ? "page" : "pages"} {formatPageRanges(pages)}
              </>
            )}
          </p>
          <button type="button" onClick={apply} disabled={busy || placements.length === 0} className={clsx(PRIMARY, "mt-4 w-full")}>
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Signature className="size-4" aria-hidden="true" />}
            {busy ? "Signing…" : "Sign PDF"}
          </button>
        </section>
        {output && <OutputCard title="Signed" outputs={[output]} replaceFileId={file.id} />}
      </div>
    </div>
  );
}

function PlacedItem({
  placement,
  asset,
  stage,
  selected,
  onSelect,
  onChange,
  onRemove,
}: {
  placement: Placed;
  asset?: SignatureAsset;
  stage: StageSize;
  selected: boolean;
  onSelect: () => void;
  onChange: (next: Partial<Rect>) => void;
  onRemove: () => void;
}) {
  const drag = useRef<{ mode: "move" | "resize"; x: number; y: number; start: Rect } | null>(null);
  const { x, y, width, height } = placement;

  const begin = (mode: "move" | "resize", event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { mode, x: event.clientX, y: event.clientY, start: { x, y, width, height } };
    onSelect();
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (event.clientX - d.x) / stage.width;
    const dy = (event.clientY - d.y) / stage.height;
    if (d.mode === "move") {
      onChange({ x: clamp(d.start.x + dx, 0, 1 - d.start.width), y: clamp(d.start.y + dy, 0, 1 - d.start.height) });
    } else {
      // Keep the aspect ratio; stay on the page.
      const ratio = d.start.height / d.start.width;
      const w = clamp(d.start.width + dx, 0.03, Math.min(1 - d.start.x, (1 - d.start.y) / ratio));
      onChange({ width: w, height: w * ratio });
    }
  };
  const end = () => (drag.current = null);

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      onRemove();
    } else if (moves[event.key]) {
      event.preventDefault();
      const [dx, dy] = moves[event.key];
      onChange({ x: clamp(x + dx, 0, 1 - width), y: clamp(y + dy, 0, 1 - height) });
    }
  };

  const label = placement.kind === "image" ? "Signature" : `Date: ${placement.text}`;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${label}${selected ? ", selected" : ""}`}
      aria-pressed={selected}
      onPointerDown={(e) => begin("move", e)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onFocus={onSelect}
      onKeyDown={onKeyDown}
      className={clsx("absolute cursor-move touch-none outline-none select-none", selected ? "ring-2 ring-brand-border" : "hover:ring-1 hover:ring-brand-border")}
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }}
    >
      {placement.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- local blob URL
        asset && <img src={asset.url} alt="" draggable={false} className="pointer-events-none size-full" />
      ) : (
        // Text drawn at the box height, in a sans font like the Liberation Sans used in the PDF.
        <span className="pointer-events-none flex size-full items-center overflow-visible font-[Arial,Helvetica,sans-serif] leading-none whitespace-nowrap text-[#0d0d1a]" style={{ fontSize: height * stage.height * 0.72 }}>
          {placement.text}
        </span>
      )}
      {selected && (
        <>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onRemove}
            aria-label={`Remove ${label.toLowerCase()}`}
            className="absolute -top-3 -right-3 flex size-6 items-center justify-center rounded-full bg-danger text-white shadow-elev-2"
          >
            <X className="size-3.5" />
          </button>
          <span
            onPointerDown={(e) => begin("resize", e)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            aria-hidden="true"
            className="absolute -right-1.5 -bottom-1.5 size-3.5 cursor-nwse-resize rounded-sm border-2 border-surface bg-brand"
          />
        </>
      )}
    </div>
  );
}
