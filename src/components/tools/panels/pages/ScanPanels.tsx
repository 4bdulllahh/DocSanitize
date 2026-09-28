"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, Crop, FileX2, LoaderCircle, ScanSearch, Wand2 } from "lucide-react";
import { PageStage } from "@/components/pdf/PageStage";
import { PageStrip } from "@/components/pdf/PageStrip";
import { usePageSelection } from "@/components/pdf/usePageSelection";
import { cropFile, deletePagesOfFile } from "@/lib/pdf/client";
import type { Box } from "@/lib/pdf/edit/types";
import type { WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { FidelityNote } from "../shared/ConversionParts";
import { Field, INPUT, Segmented, Slider } from "../shared/controls";
import { OutputCard, PRIMARY, SECONDARY } from "../shared/OutputCard";
import { DocGate, Layout, PageGrid, SelectionSummary, ToolCard, useApply, usePageField } from "../shared/toolkit";
import { usePageSizes } from "./PagePanels";
import { scanPages, type PageScan } from "./scan";
import { useT } from "@/store/locale";
import { msg } from "@/i18n/msg";

const all = (n: number) => Array.from({ length: n }, (_, i) => i);
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const mm = (pt: number) => Math.round((pt / 72) * 25.4 * 10) / 10;
const pt = (mmValue: number) => (mmValue / 25.4) * 72;

/** Scan pages in the background; results arrive together with the document they belong to. */
function usePageScan(doc: PDFDocumentProxy, run: boolean) {
  const [state, setState] = useState<{ doc: PDFDocumentProxy; done: number; results: Map<number, PageScan> | null } | null>(null);
  useEffect(() => {
    if (!run) return;
    const controller = new AbortController();
    scanPages(doc, all(doc.numPages), (done) => setState({ doc, done, results: null }), controller.signal)
      .then((results) => !controller.signal.aborted && setState({ doc, done: doc.numPages, results }))
      .catch(() => {});
    return () => controller.abort();
  }, [doc, run]);
  return state?.doc === doc ? state : null;
}

// ---------------------------------------------------------------------------- Crop

export function CropPanel({ file }: ToolPanelProps) {
  return <DocGate file={file}>{(doc) => <Cropper file={file} doc={doc} />}</DocGate>;
}

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move";
const HANDLES: Exclude<Edge, "move">[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MIN = 0.05;

function Cropper({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const t = useT();
  const { busy, output, setOutput, apply } = useApply(file, "cropped");
  const sizes = usePageSizes(doc);
  const [current, setCurrent] = useState(0);
  const [box, setBox] = useState<Box>({ x: 0.08, y: 0.08, width: 0.84, height: 0.84 });
  const [target, setTarget] = useState<"all" | "this" | "pages">("all");
  const range = usePageField(doc.numPages);
  const [auto, setAuto] = useState(false);
  const [padding, setPadding] = useState(6); // mm kept around the content
  const scan = usePageScan(doc, auto);
  const drag = useRef<{ edge: Edge; x: number; y: number; start: Box } | null>(null);
  const size = sizes?.[current];

  const changed = () => setOutput(null);
  /** A page's automatic crop, as fractions, with the padding around its content. */
  const autoBox = (index: number): Box | null => {
    const content = scan?.results?.get(index)?.content;
    const s = sizes?.[index];
    if (!content || !s) return null;
    const [px, py] = [pt(padding) / s.width, pt(padding) / s.height];
    const x = clamp(content.x - px, 0, 1);
    const y = clamp(content.y - py, 0, 1);
    return { x, y, width: clamp(content.x + content.width + px, 0, 1) - x, height: clamp(content.y + content.height + py, 0, 1) - y };
  };
  const shown = auto ? autoBox(current) : box;

  const begin = (edge: Edge, event: PointerEvent<HTMLElement>) => {
    if (auto) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { edge, x: event.clientX, y: event.clientY, start: box };
  };
  const move = (event: PointerEvent<HTMLElement>, stage: { width: number; height: number }) => {
    const d = drag.current;
    if (!d) return;
    const dx = (event.clientX - d.x) / stage.width;
    const dy = (event.clientY - d.y) / stage.height;
    const s = d.start;
    let [left, top, right, bottom] = [s.x, s.y, s.x + s.width, s.y + s.height];
    if (d.edge === "move") {
      const mx = clamp(dx, -left, 1 - right);
      const my = clamp(dy, -top, 1 - bottom);
      [left, right, top, bottom] = [left + mx, right + mx, top + my, bottom + my];
    } else {
      if (d.edge.includes("w")) left = clamp(left + dx, 0, right - MIN);
      if (d.edge.includes("e")) right = clamp(right + dx, left + MIN, 1);
      if (d.edge.includes("n")) top = clamp(top + dy, 0, bottom - MIN);
      if (d.edge.includes("s")) bottom = clamp(bottom + dy, top + MIN, 1);
    }
    setBox({ x: left, y: top, width: right - left, height: bottom - top });
    changed();
  };

  /** Margins in mm on the current page, as editable numbers. */
  const margin = (side: "top" | "right" | "bottom" | "left") => {
    if (!size) return 0;
    const b = box;
    const value = { top: b.y * size.height, left: b.x * size.width, right: (1 - b.x - b.width) * size.width, bottom: (1 - b.y - b.height) * size.height }[side];
    return mm(value);
  };
  const setMargin = (side: "top" | "right" | "bottom" | "left", value: number) => {
    if (!size || !Number.isFinite(value)) return;
    const f = side === "top" || side === "bottom" ? pt(value) / size.height : pt(value) / size.width;
    let [left, top, right, bottom] = [box.x, box.y, box.x + box.width, box.y + box.height];
    if (side === "left") left = clamp(f, 0, right - MIN);
    if (side === "right") right = clamp(1 - f, left + MIN, 1);
    if (side === "top") top = clamp(f, 0, bottom - MIN);
    if (side === "bottom") bottom = clamp(1 - f, top + MIN, 1);
    setBox({ x: left, y: top, width: right - left, height: bottom - top });
    changed();
  };

  const pages = target === "all" ? all(doc.numPages) : target === "this" ? [current] : (range.pages ?? []);
  const run = () =>
    apply(async () => {
      const crops = auto
        ? all(doc.numPages).flatMap((i) => {
            const b = autoBox(i);
            const s = sizes![i];
            return b ? [{ page: i, box: { x: b.x * s.width, y: b.y * s.height, width: b.width * s.width, height: b.height * s.height } }] : [];
          })
        : pages.map((i) => {
            const s = sizes![i];
            return { page: i, box: { x: box.x * s.width, y: box.y * s.height, width: box.width * s.width, height: box.height * s.height } };
          });
      if (!crops.length) throw new Error(msg("There's nothing to crop."));
      return cropFile(file.file, crops);
    });
  const scanning = auto && !scan?.results;

  return (
    <Layout
      main={
        <section className="min-w-0 rounded-xl border border-line bg-surface" aria-label={t("Page")}>
          {doc.numPages > 1 && <PageStrip doc={doc} current={current} onSelect={setCurrent} counts={{}} countLabel={(n) => String(n)} />}
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
            <button type="button" className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40" disabled={current === 0} onClick={() => setCurrent(current - 1)} aria-label={t("Previous page")}>
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-fg-muted tabular-nums">
              {t("Page {page} of {count}", { page: current + 1, count: doc.numPages })}
            </span>
            <button type="button" className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40" disabled={current === doc.numPages - 1} onClick={() => setCurrent(current + 1)} aria-label={t("Next page")}>
              <ChevronRight className="size-4" />
            </button>
            {size && shown && (
              <span className="ms-auto text-fg-subtle tabular-nums">
                {t("Result: {width} × {height} mm", { width: mm(shown.width * size.width), height: mm(shown.height * size.height) })}
              </span>
            )}
          </div>
          <div className="bg-surface-muted p-3 sm:p-5">
            <PageStage doc={doc} index={current}>
              {(stage) =>
                shown ? (
                  <div className="absolute inset-0 overflow-hidden" aria-label={t("Crop area")} role="group">
                    <div
                      className={clsx("absolute border-2 border-brand shadow-[0_0_0_9999px_rgb(0_0_0/0.45)]", !auto && "cursor-move touch-none")}
                      style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.width * 100}%`, height: `${shown.height * 100}%` }}
                      onPointerDown={(e) => begin("move", e)}
                      onPointerMove={(e) => move(e, stage)}
                      onPointerUp={() => (drag.current = null)}
                      onPointerCancel={() => (drag.current = null)}
                    >
                      {!auto &&
                        HANDLES.map((h) => (
                          <span
                            key={h}
                            onPointerDown={(e) => begin(h, e)}
                            onPointerMove={(e) => move(e, stage)}
                            onPointerUp={() => (drag.current = null)}
                            aria-hidden="true"
                            className="absolute size-3.5 -translate-1/2 touch-none rounded-sm border-2 border-surface bg-brand"
                            style={{
                              left: h.includes("w") ? "0%" : h.includes("e") ? "100%" : "50%",
                              top: h.includes("n") ? "0%" : h.includes("s") ? "100%" : "50%",
                              cursor: `${h === "n" || h === "s" ? "ns" : h === "e" || h === "w" ? "ew" : h === "ne" || h === "sw" ? "nesw" : "nwse"}-resize`,
                            }}
                          />
                        ))}
                    </div>
                  </div>
                ) : (
                  auto && scan?.results && <p className="absolute inset-x-0 top-1/2 text-center text-sm text-fg-muted">{t("This page is empty; it isn't cropped.")}</p>
                )
              }
            </PageStage>
          </div>
        </section>
      }
      actions={
        <>
          <ToolCard icon={Crop} title={t("Crop pages")}>
            <Segmented
              label={t("How")}
              value={auto ? "auto" : "manual"}
              onChange={(v) => {
                if (v === "manual" && auto) {
                  const b = autoBox(current);
                  if (b) setBox(b);
                }
                setAuto(v === "auto");
                changed();
              }}
              options={[
                { id: "manual", label: t("Draw the area") },
                { id: "auto", label: t("Remove white margins") },
              ]}
            />
            {auto ? (
              <>
                {scanning ? (
                  <p className="mt-3 flex items-center gap-2 text-sm text-fg-muted">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    {t("Finding the content on page {page} of {count}…", { page: Math.min((scan?.done ?? 0) + 1, doc.numPages), count: doc.numPages })}
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-fg-muted">
                    <Wand2 className="me-1 inline size-4 text-brand-text" aria-hidden="true" />
                    {t("Each page is trimmed to its own content.")}
                  </p>
                )}
                <Slider label={t("Keep around the content")} value={padding} min={0} max={30} format={(v) => `${v} mm`} onChange={(v) => (setPadding(v), changed())} />
              </>
            ) : (
              <>
                <p className="mt-3 text-sm text-fg-muted">{t("Drag the frame or its handles, or type the margins to cut.")}</p>
                <div className="grid grid-cols-2 gap-x-3">
                  {(["top", "bottom", "left", "right"] as const).map((side) => (
                    <Field key={side} label={`${side[0].toUpperCase()}${side.slice(1)} (mm)`}>
                      <input type="number" min={0} step={1} value={margin(side)} onChange={(e) => setMargin(side, e.target.valueAsNumber)} className={INPUT} />
                    </Field>
                  ))}
                </div>
                <Segmented
                  label={t("Apply to")}
                  value={target}
                  onChange={(v) => (setTarget(v), changed())}
                  options={[
                    { id: "all", label: t("All pages") },
                    { id: "this", label: t("This page") },
                    { id: "pages", label: t("Pages…") },
                  ]}
                />
                {target === "pages" && (
                  <Field label={t("Pages")} error={range.error}>
                    <input value={range.text} onChange={(e) => (range.setText(e.target.value), changed())} placeholder="e.g. 1-3, 5" className={INPUT} />
                  </Field>
                )}
              </>
            )}
            <FidelityNote>{t("Cropping hides the edges of the page; what's outside the frame is still in the file. To remove content for good, use Redact.")}</FidelityNote>
            <button type="button" onClick={run} disabled={busy || !sizes || scanning || (!auto && (!pages.length || Boolean(range.error)))} className={clsx(PRIMARY, "mt-5 w-full")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Crop className="size-4" aria-hidden="true" />}
              {busy ? t("Cropping…") : auto ? t("Crop all pages") : t.plural(pages.length, "Crop {n} page", "Crop {n} pages")}
            </button>
          </ToolCard>
          {output && <OutputCard title={t("Pages cropped")} outputs={[output]} replaceFileId={file.id} />}
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------- Remove blank pages

export function RemoveBlankPanel({ file }: ToolPanelProps) {
  return <DocGate file={file}>{(doc) => <BlankRemover file={file} doc={doc} />}</DocGate>;
}

/** Share of dark pixels a page may have and still count as blank. */
const THRESHOLDS = { strict: 0.00002, normal: 0.0003, scanned: 0.004 } as const;
type Sensitivity = keyof typeof THRESHOLDS;

function BlankRemover({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const t = useT();
  const { busy, output, setOutput, apply } = useApply(file, "no-blanks");
  const scan = usePageScan(doc, true);
  const [sensitivity, setSensitivity] = useState<Sensitivity>("normal");
  const selection = usePageSelection(doc.numPages, [], () => setOutput(null));
  const results = scan?.results ?? null;
  const blanks = (level: Sensitivity) => (results ? [...results].filter(([, s]) => !s.text && s.ink <= THRESHOLDS[level]).map(([i]) => i) : []);

  // Once the scan is done, select the blank pages it found.
  const [selectedFor, setSelectedFor] = useState<Map<number, PageScan> | null>(null);
  if (results && selectedFor !== results) {
    setSelectedFor(results);
    selection.select(blanks(sensitivity));
  }

  const chosen = new Set(selection.selected);
  const everything = chosen.size === doc.numPages;

  return (
    <Layout
      main={
        <PageGrid
          doc={doc}
          header={results ? <SelectionSummary count={chosen.size} total={doc.numPages} action="remove" onAll={selection.selectAll} onClear={selection.clear} /> : <p className="text-sm text-fg-muted">{t("Looking at the pages…")}</p>}
          tile={(i) => ({
            selected: chosen.has(i),
            dimmed: chosen.has(i),
            label: chosen.has(i) ? t("Page {page}, will be removed", { page: i + 1 }) : t("Page {page}", { page: i + 1 }),
            badge: blanks(sensitivity).includes(i) && <span className="absolute top-3 left-3 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">{t("Blank")}</span>,
          })}
          onTileClick={(i, e) => selection.click(i, e)}
        />
      }
      actions={
        <>
          <ToolCard icon={ScanSearch} title={t("Remove blank pages")}>
            {!results ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-fg-muted">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                {t("Checking page {page} of {count}…", { page: Math.min((scan?.done ?? 0) + 1, doc.numPages), count: doc.numPages })}
              </p>
            ) : (
              <>
                <p className="mt-1 text-sm text-fg-muted">
                  {t.plural(blanks(sensitivity).length, "Found {n} blank page.", "Found {n} blank pages.")} {t("Pages with any text are never counted as blank. Click pages to change what's removed.")}
                </p>
                <Segmented
                  label={t("What counts as blank")}
                  value={sensitivity}
                  onChange={(v) => {
                    setSensitivity(v);
                    selection.select(blanks(v));
                  }}
                  options={[
                    { id: "strict", label: t("Perfectly white") },
                    { id: "normal", label: t("Nearly white") },
                    { id: "scanned", label: t("Scanned") },
                  ]}
                />
                <p className="mt-2 text-xs text-fg-subtle">{t("“Scanned” allows specks and shadows from a scanner.")}</p>
              </>
            )}
            {everything && <p className="mt-2 text-xs text-danger-text">{t("Every page is selected; keep at least one.")}</p>}
            <button type="button" onClick={() => apply(() => deletePagesOfFile(file.file, selection.selected))} disabled={busy || !results || !chosen.size || everything} className={clsx(PRIMARY, "mt-5 w-full")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <FileX2 className="size-4" aria-hidden="true" />}
              {busy ? t("Removing…") : chosen.size ? t.plural(chosen.size, "Remove {n} page", "Remove {n} pages") : t("No pages to remove")}
            </button>
          </ToolCard>
          {output && <OutputCard title={t("Blank pages removed")} outputs={[output]} replaceFileId={file.id} />}
          {results && !chosen.size && !output && (
            <button type="button" className={clsx(SECONDARY, "w-full")} onClick={() => (setSensitivity("scanned"), selection.select(blanks("scanned")))}>
              {t("Try the “Scanned” setting")}
            </button>
          )}
        </>
      }
    />
  );
}
