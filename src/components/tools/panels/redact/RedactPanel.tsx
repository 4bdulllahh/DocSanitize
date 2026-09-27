"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, CircleCheck, EyeOff, LoaderCircle, Search, Square, Trash2, TriangleAlert, X } from "lucide-react";
import { PageThumbnail } from "@/components/pdf/PageThumbnail";
import { usePdfDocument } from "@/components/pdf/usePdfDocument";
import { errorMessage } from "@/lib/errors";
import { createId } from "@/lib/files";
import { extractText } from "@/lib/office/extract";
import type { TextPage } from "@/lib/office/text-layout";
import { redactFile } from "@/lib/pdf/client";
import { formatPageRanges } from "@/lib/pdf/ranges";
import { renderPageToImage } from "@/lib/pdf/rasterize";
import type { RedactedPage } from "@/lib/pdf/redact";
import { annotationTexts } from "@/lib/pdf/annotations";
import { findAnnotationBoxes, findTextBoxes, type AnnotationText, type Box } from "@/lib/pdf/redact-search";
import { withSuffix } from "@/lib/zip";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { FidelityNote } from "../shared/ConversionParts";
import { INPUT, Segmented } from "../shared/controls";
import { OutputCard, PRIMARY, SECONDARY } from "../shared/OutputCard";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";

interface RedactBox extends Box {
  id: string;
}

/** Boxes per 0-based page index. */
type Boxes = Record<number, RedactBox[]>;

const BOX_FILL = "rgba(0, 0, 0, 0.82)";

export default function RedactPanel({ file }: ToolPanelProps) {
  const pdf = usePdfDocument(file.file);
  if (pdf.status === "loading") return <PdfLoading />;
  if (pdf.status === "error") return <PdfLoadError message={pdf.message} code={pdf.code} />;
  return <Redactor file={file} doc={pdf.doc} />;
}

function useElementWidth(ref: RefObject<HTMLElement | null>): number {
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

const allPages = (doc: PDFDocumentProxy) => Array.from({ length: doc.numPages }, (_, i) => i + 1);

function Redactor({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const pageCount = doc.numPages;
  const [boxes, setBoxes] = useState<Boxes>({});
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const pageText = useRef<{ text: TextPage[]; annotations: AnnotationText[][] } | null>(null);
  const [dpi, setDpi] = useState<"150" | "200" | "300">("200");
  const [removeMetadata, setRemoveMetadata] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ blob: Blob; pages: number[]; query: string } | null>(null);

  const markedPages = Object.keys(boxes)
    .map(Number)
    .filter((i) => boxes[i].length > 0)
    .sort((a, b) => a - b);
  const total = markedPages.reduce((n, i) => n + boxes[i].length, 0);

  const update = (fn: (prev: Boxes) => Boxes) => {
    setBoxes(fn);
    setResult(null);
  };
  const addBoxes = (page: number, added: Box[]) => update((prev) => ({ ...prev, [page]: [...(prev[page] ?? []), ...added.map((b) => ({ ...b, id: createId() }))] }));
  const removeBox = (page: number, id: string) => {
    update((prev) => ({ ...prev, [page]: (prev[page] ?? []).filter((b) => b.id !== id) }));
    setSelected(null);
  };

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      pageText.current ??= { text: await extractText(doc, allPages(doc), undefined, false), annotations: await annotationTexts(doc, allPages(doc)) };
      const { text, annotations } = pageText.current;
      // Page text, plus form fields and comments, which are drawn on the page too.
      const found = text.map((page, i) => [...findTextBoxes(page, query), ...findAnnotationBoxes(annotations[i], query, page.width, page.height)]);
      const count = found.reduce((n, b) => n + b.length, 0);
      const pages = found.map((b, i) => (b.length ? i : -1)).filter((i) => i >= 0);
      if (count > 0) {
        update((prev) => {
          const next = { ...prev };
          found.forEach((b, i) => b.length && (next[i] = [...(next[i] ?? []), ...b.map((box) => ({ ...box, id: createId() }))]));
          return next;
        });
        setCurrent(pages[0]);
      }
      setSearchNote(count ? `Marked ${count} match${count === 1 ? "" : "es"} on ${pages.length === 1 ? "page" : "pages"} ${formatPageRanges(pages)}.` : `No selectable text matches “${query.trim()}”.`);
    } catch (error) {
      toast({ tone: "error", title: "Search failed", description: errorMessage(error) });
    } finally {
      setSearching(false);
    }
  };

  const apply = async () => {
    const { updateFile } = useWorkspaceStore.getState();
    setProgress({ done: 0, total: markedPages.length });
    updateFile(file.id, { status: "processing", error: undefined });
    try {
      const rendered: RedactedPage[] = [];
      for (const [n, index] of markedPages.entries()) {
        const viewport = (await doc.getPage(index + 1)).getViewport({ scale: 1 });
        const image = await renderPageToImage(doc, index + 1, { dpi: Number(dpi), format: "jpeg", quality: 0.92 }, (ctx, w, h) => {
          ctx.fillStyle = "#000";
          for (const b of boxes[index]) ctx.fillRect(Math.floor(b.x * w), Math.floor(b.y * h), Math.ceil(b.width * w) + 1, Math.ceil(b.height * h) + 1);
        });
        rendered.push({ index, image: new Uint8Array(await image.blob.arrayBuffer()), width: viewport.width, height: viewport.height });
        setProgress({ done: n + 1, total: markedPages.length });
      }
      const blob = await redactFile(file.file, rendered, { removeMetadata });
      setResult({ blob, pages: markedPages, query: query.trim() });
      updateFile(file.id, { status: "idle" });
    } catch (error) {
      updateFile(file.id, { status: "error", error: errorMessage(error) });
      toast({ tone: "error", title: "Redaction failed", description: errorMessage(error) });
    } finally {
      setProgress(null);
    }
  };

  const pageBoxes = boxes[current] ?? [];
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="min-w-0 rounded-xl border border-line bg-surface" aria-label="Pages">
        <ol className="flex gap-2 overflow-x-auto border-b border-line p-3" aria-label="Choose a page">
          {Array.from({ length: pageCount }, (_, i) => {
            const count = boxes[i]?.length ?? 0;
            return (
              <li key={i} className="shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setCurrent(i);
                    setSelected(null);
                  }}
                  aria-current={i === current ? "page" : undefined}
                  aria-label={`Page ${i + 1}${count ? `, ${count} redaction${count === 1 ? "" : "s"}` : ""}`}
                  className={clsx("relative rounded-lg border-2 p-1", i === current ? "border-brand-text bg-brand-soft" : "border-transparent hover:bg-surface-muted")}
                >
                  <PageThumbnail doc={doc} pageNumber={i + 1} width={52} height={68} />
                  <span className="mt-0.5 block text-center text-[11px] font-medium text-fg-muted tabular-nums">{i + 1}</span>
                  {count > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white tabular-nums">{count}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-sm">
          <button type="button" className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40" disabled={current === 0} onClick={() => setCurrent(current - 1)} aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-fg-muted tabular-nums">
            Page {current + 1} of {pageCount}
          </span>
          <button type="button" className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40" disabled={current === pageCount - 1} onClick={() => setCurrent(current + 1)} aria-label="Next page">
            <ChevronRight className="size-4" />
          </button>
          <span className="flex-1" />
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-fg-muted hover:bg-surface-muted hover:text-fg" onClick={() => addBoxes(current, [{ x: 0, y: 0, width: 1, height: 1 }])}>
            <Square className="size-3.5" aria-hidden="true" />
            Cover whole page
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40"
            disabled={pageBoxes.length === 0}
            onClick={() => update((prev) => ({ ...prev, [current]: [] }))}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Clear page
          </button>
        </div>
        <div className="bg-surface-muted p-3 sm:p-5">
          <PageEditor
            doc={doc}
            index={current}
            boxes={pageBoxes}
            selected={selected}
            onSelect={setSelected}
            onAdd={(box) => addBoxes(current, [box])}
            onRemove={(id) => removeBox(current, id)}
          />
          <p className="mt-3 text-center text-xs text-fg-subtle">Drag on the page to draw a box. Select a box to remove it (or press Delete).</p>
        </div>
      </section>

      <div className="order-first space-y-4 lg:sticky lg:top-20 lg:order-0">
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-semibold text-fg">
            <EyeOff className="size-4 text-brand-text" aria-hidden="true" />
            Redact PDF
          </h2>
          <FidelityNote>
            Pages with boxes become flat images: what&apos;s under a box is permanently gone, and the rest of those pages can no longer be selected or
            searched. Other pages are untouched.
          </FidelityNote>

          <form onSubmit={search} className="mt-4">
            <label htmlFor="redact-search" className="text-sm font-medium text-fg">
              Find text to redact
            </label>
            <div className="mt-1 flex gap-2">
              <input id="redact-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, email, number…" className={clsx(INPUT, "mt-0")} />
              <button type="submit" disabled={searching || !query.trim()} className={clsx(SECONDARY, "shrink-0 px-3")}>
                {searching ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
                Mark all
              </button>
            </div>
            {searchNote && (
              <p className="mt-1.5 text-xs text-fg-muted" aria-live="polite">
                {searchNote}
              </p>
            )}
          </form>

          <div className="mt-4 flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2 text-sm">
            <span className="text-fg-muted">
              {total === 0 ? (
                "Nothing marked yet"
              ) : (
                <>
                  <span className="font-semibold text-fg">{total}</span> box{total === 1 ? "" : "es"} on {markedPages.length === 1 ? "page" : "pages"} {formatPageRanges(markedPages)}
                </>
              )}
            </span>
            {total > 0 && (
              <button type="button" className="text-brand-text hover:underline" onClick={() => update(() => ({}))}>
                Clear all
              </button>
            )}
          </div>

          <Segmented
            label="Resolution of redacted pages"
            value={dpi}
            onChange={(v) => {
              setDpi(v);
              setResult(null);
            }}
            options={[
              { id: "150", label: "150 DPI" },
              { id: "200", label: "200 DPI" },
              { id: "300", label: "300 DPI" },
            ]}
          />
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
              <span className="block text-xs text-fg-muted">Author, title, dates and more can name what you redacted.</span>
            </span>
          </label>

          <button type="button" onClick={apply} disabled={total === 0 || progress !== null} className={clsx(PRIMARY, "mt-5 w-full")}>
            {progress ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <EyeOff className="size-4" aria-hidden="true" />}
            {progress ? (progress.done < progress.total ? `Flattening page ${progress.done + 1} of ${progress.total}…` : "Finishing…") : "Apply redactions"}
          </button>
        </section>

        {result && (
          <>
            <RedactionCheck blob={result.blob} pages={result.pages} query={result.query} />
            <OutputCard title="Redacted" outputs={[{ name: withSuffix(file.name, "redacted"), blob: result.blob }]} replaceFileId={file.id} />
          </>
        )}
      </div>
    </div>
  );
}

function clamp(n: number) {
  return Math.min(1, Math.max(0, n));
}

function PageEditor({
  doc,
  index,
  boxes,
  selected,
  onSelect,
  onAdd,
  onRemove,
}: {
  doc: PDFDocumentProxy;
  index: number;
  boxes: RedactBox[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (box: Box) => void;
  onRemove: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const available = useElementWidth(containerRef);
  const [size, setSize] = useState<{ index: number; w: number; h: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Box | null>(null);

  useEffect(() => {
    let active = true;
    doc
      .getPage(index + 1)
      .then((page) => {
        const { width, height } = page.getViewport({ scale: 1 });
        if (active) setSize({ index, w: width, h: height });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [doc, index]);

  const aspect = size?.index === index ? size.h / size.w : 1.294;
  const width = Math.min(available, 760);
  const height = Math.round(width * aspect);

  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = point(event);
    setDraft({ ...start.current, width: 0, height: 0 });
    onSelect(null);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const p = point(event);
    const s = start.current;
    setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), width: Math.abs(p.x - s.x), height: Math.abs(p.y - s.y) });
  };
  const onPointerUp = () => {
    // Ignore clicks and tiny slips: at least 4 × 4 screen pixels.
    if (start.current && draft && draft.width * width >= 4 && draft.height * height >= 4) onAdd(draft);
    start.current = null;
    setDraft(null);
  };

  const style = (b: Box) => ({ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.width * 100}%`, height: `${b.height * 100}%` });
  const onBoxKey = (event: KeyboardEvent, id: string) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      onRemove(id);
    }
  };

  return (
    <div ref={containerRef} className="w-full">
      {width > 0 && (
        <div className="relative mx-auto" style={{ width, height }}>
          <PageThumbnail key={index} doc={doc} pageNumber={index + 1} width={width} height={height} />
          <div
            className="absolute inset-0 cursor-crosshair touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-label={`Page ${index + 1}: drag to draw a redaction box`}
            role="group"
          >
            {boxes.map((b, i) => (
              <div
                key={b.id}
                role="button"
                tabIndex={0}
                aria-label={`Redaction ${i + 1} on page ${index + 1}${selected === b.id ? ", selected" : ""}`}
                aria-pressed={selected === b.id}
                onClick={() => onSelect(b.id)}
                onKeyDown={(e) => onBoxKey(e, b.id)}
                className={clsx("absolute cursor-pointer outline-none", selected === b.id ? "ring-2 ring-brand-border ring-offset-1 ring-offset-surface" : "focus-visible:ring-2 focus-visible:ring-brand-border")}
                style={{ ...style(b), backgroundColor: BOX_FILL }}
              />
            ))}
            {boxes
              .filter((b) => b.id === selected)
              .map((b) => (
                <button
                  key="delete"
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onRemove(b.id)}
                  aria-label="Remove the selected redaction"
                  className="absolute z-10 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-danger text-white shadow-elev-2"
                  style={{ left: `${(b.x + b.width) * 100}%`, top: `${b.y * 100}%` }}
                >
                  <X className="size-3.5" />
                </button>
              ))}
            {draft && <div className="pointer-events-none absolute border-2 border-dashed border-brand-border" style={{ ...style(draft), backgroundColor: "rgba(0, 0, 0, 0.35)" }} />}
          </div>
        </div>
      )}
    </div>
  );
}

/** Re-open the result like any reader would and confirm the redacted pages carry no text. */
function RedactionCheck({ blob, pages, query }: { blob: Blob; pages: number[]; query: string }) {
  const pdf = usePdfDocument(blob);
  const [check, setCheck] = useState<{ blob: Blob; textOnRedacted: number; stillFound: number[] } | null>(null);

  useEffect(() => {
    if (pdf.status !== "ready") return;
    let active = true;
    Promise.all([extractText(pdf.doc, allPages(pdf.doc), undefined, false), annotationTexts(pdf.doc, allPages(pdf.doc))])
      .then(([texts, annotations]) => {
        const textOnRedacted = pages.reduce((n, i) => n + texts[i].items.filter((item) => item.text.trim()).length + annotations[i].length, 0);
        const found = (t: TextPage, i: number) => findTextBoxes(t, query).length + findAnnotationBoxes(annotations[i], query, t.width, t.height).length;
        const stillFound = query ? texts.map((t, i) => (found(t, i) ? i : -1)).filter((i) => i >= 0) : [];
        if (active) setCheck({ blob, textOnRedacted, stillFound });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pdf, blob, pages, query]);

  if (!check || check.blob !== blob) {
    return (
      <section className="flex items-center gap-2 rounded-xl border border-line bg-surface p-4 text-sm text-fg-muted">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        Verifying the result…
      </section>
    );
  }
  const clean = check.textOnRedacted === 0;
  return (
    <section className={clsx("rounded-xl border p-4 text-sm", clean ? "border-success/40 bg-success-soft" : "border-danger/40 bg-danger-soft")} aria-live="polite">
      <p className="flex items-start gap-2 font-medium text-fg">
        {clean ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />}
        {clean
          ? `Verified: the redacted ${pages.length === 1 ? "page contains" : `${pages.length} pages contain`} no text.`
          : `${check.textOnRedacted} text items remain on redacted pages. Don't share this file.`}
      </p>
      {query && (
        <p className="mt-1.5 pl-6 text-fg-muted">
          {check.stillFound.length === 0 ? (
            <>“{query}” no longer appears anywhere in the file.</>
          ) : (
            <>
              “{query}” still appears on {check.stillFound.length === 1 ? "page" : "pages"} {formatPageRanges(check.stillFound)}.
            </>
          )}
        </p>
      )}
    </section>
  );
}
