"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ArrowLeftRight, ChevronLeft, ChevronRight, CircleCheck, Copy, GitCompareArrows, LoaderCircle, Plus } from "lucide-react";
import { PageThumbnail } from "@/components/pdf/PageThumbnail";
import { usePdfDocument } from "@/components/pdf/usePdfDocument";
import type { Change } from "@/lib/convert/compare";
import { changesReport } from "@/lib/convert/compare";
import { changeMarks, comparePdfs, type ComparedDocuments } from "@/lib/convert/client";
import { diffPixels } from "@/lib/convert/visual-diff";
import { msg } from "@/i18n/msg";
import { errorMessage } from "@/lib/errors";
import { editFile } from "@/lib/pdf/client";
import { withRenderSlot } from "@/lib/pdf/render";
import { withSuffix } from "@/lib/zip";
import { useT } from "@/store/locale";
import { toast } from "@/store/toast";
import type { WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { ProgressBar } from "../shared/ConversionParts";
import { Field, INPUT, Segmented } from "../shared/controls";
import { OutputCard, PRIMARY, SECONDARY, type OutputFile } from "../shared/OutputCard";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import { copyText } from "../inspect/CheckFilePanel";

/** Compare two open PDFs: first tab is the original, second the changed version (both can be picked). */
export default function ComparePanel({ files }: ToolPanelProps) {
  const [ids, setIds] = useState<[string, string] | null>(null);
  const t = useT();
  if (files.length < 2) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
        <Plus className="size-8 text-fg-subtle" aria-hidden="true" />
        <p className="font-semibold text-fg">{t("Add the other version")}</p>
        <p className="max-w-sm text-sm text-fg-muted">{t("Drop a second PDF anywhere on this page, or use “Add files” above. The first tab is taken as the original.")}</p>
      </div>
    );
  }
  const byId = (id: string | undefined) => files.find((f) => f.id === id);
  const before = byId(ids?.[0]) ?? files[0];
  const after = byId(ids?.[1]) ?? files.find((f) => f.id !== before.id)!;

  const picker = (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-semibold text-fg">
        <GitCompareArrows className="size-4 text-brand-text" aria-hidden="true" />
        {t("Compare PDFs")}
      </h2>
      <Field label={t("Original")}>
        <select value={before.id} onChange={(e) => setIds([e.target.value, e.target.value === after.id ? before.id : after.id])} className={INPUT}>
          {files.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("Changed version")}>
        <select value={after.id} onChange={(e) => setIds([e.target.value === before.id ? after.id : before.id, e.target.value])} className={INPUT}>
          {files.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </Field>
      <button type="button" onClick={() => setIds([after.id, before.id])} className={clsx(SECONDARY, "mt-3 w-full")}>
        <ArrowLeftRight className="size-4" aria-hidden="true" />
        {t("Swap")}
      </button>
    </section>
  );
  return <Loader key={`${before.id}:${before.revision}|${after.id}:${after.revision}`} before={before} after={after} picker={picker} />;
}

function Loader({ before, after, picker }: { before: WorkspaceFile; after: WorkspaceFile; picker: React.ReactNode }) {
  const a = usePdfDocument(before.file);
  const b = usePdfDocument(after.file);
  const t = useT();
  if (a.status === "loading" || b.status === "loading") return <PdfLoading label={t("Opening both PDFs")} />;
  if (a.status === "error") return <PdfLoadError title={t("Couldn't open “{name}”", { name: before.name })} message={a.message} code={a.code} />;
  if (b.status === "error") return <PdfLoadError title={t("Couldn't open “{name}”", { name: after.name })} message={b.message} code={b.code} />;
  return <Comparer before={before} after={after} docA={a.doc} docB={b.doc} picker={picker} />;
}

type Mode = "text" | "visual";

function Comparer({ before, after, docA, docB, picker }: { before: WorkspaceFile; after: WorkspaceFile; docA: PDFDocumentProxy; docB: PDFDocumentProxy; picker: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>("text");
  const t = useT();
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ComparedDocuments | null>(null);
  const [selected, setSelected] = useState(0);
  const [outputs, setOutputs] = useState<OutputFile[] | null>(null);
  const [marking, setMarking] = useState(false);

  const compare = async () => {
    setProgress(0);
    setResult(null);
    setOutputs(null);
    try {
      const comparison = await comparePdfs(docA, docB, (done, total) => setProgress(done / total));
      setResult(comparison);
      setSelected(0);
    } catch (error) {
      toast({ tone: "error", title: msg("Comparison failed"), description: errorMessage(error) });
    } finally {
      setProgress(null);
    }
  };

  const report = () => changesReport(result!, { before: before.name, after: after.name }, t);
  const copyList = () => copyText(report(), t("List copied"));

  const markCopies = async () => {
    if (!result) return;
    setMarking(true);
    try {
      const made: OutputFile[] = [];
      for (const [side, file] of [["before", before], ["after", after]] as const) {
        const objects = changeMarks(result, side, t);
        if (!objects.length) continue;
        const { blob } = await editFile(file.file, { objects, images: {}, flatten: false });
        made.push({ name: withSuffix(file.name, side === "before" ? "removed-marked" : "changes-marked"), blob, detail: side === "before" ? t("Removed and changed text in red") : t("Added in green, changed in amber, notes for removals") });
      }
      made.push({ name: withSuffix(after.name, "changes", ".txt"), blob: new Blob([report()], { type: "text/plain" }), detail: t("The list of changes") });
      setOutputs(made);
    } catch (error) {
      toast({ tone: "error", title: msg("Couldn't mark the copies"), description: errorMessage(error) });
    } finally {
      setMarking(false);
    }
  };

  const change = result?.changes[selected];
  const counts = result && {
    added: result.changes.filter((c) => c.kind === "added").length,
    removed: result.changes.filter((c) => c.kind === "removed").length,
    changed: result.changes.filter((c) => c.kind === "changed").length,
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
        {mode === "visual" ? (
          <VisualDiff docA={docA} docB={docB} />
        ) : result ? (
          result.changes.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface px-6 py-14 text-center">
              <CircleCheck className="size-8 text-success" aria-hidden="true" />
              <p className="font-semibold text-fg">{t("The text is the same")}</p>
              <p className="max-w-md text-sm text-fg-muted">{t("All {count} words match. Layout, pictures or formatting can still differ: try the picture comparison.", { count: result.unchanged })}</p>
            </div>
          ) : (
            <>
              {change && <PagePair change={change} result={result} docA={docA} docB={docB} />}
              <ChangeList changes={result.changes} selected={selected} onSelect={setSelected} />
            </>
          )
        ) : (
          <div className="flex min-h-72 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center text-sm text-fg-muted">
            <GitCompareArrows className="size-8 text-fg-subtle" aria-hidden="true" />
            <p className="font-medium text-fg">
              “{before.name}” ({t.plural(docA.numPages, "{n} page", "{n} pages")}) {t.dir === "rtl" ? "←" : "→"} “{after.name}” ({t.plural(docB.numPages, "{n} page", "{n} pages")})
            </p>
            <p className="max-w-sm">{t("Words added, removed and changed are listed and highlighted on both versions. Everything happens in your browser.")}</p>
          </div>
        )}
      </div>

      <div className="order-first space-y-4 lg:sticky lg:top-20 lg:order-0">
        {picker}
        <section className="rounded-xl border border-line bg-surface p-5">
          <Segmented
            label={t("Compare")}
            value={mode}
            onChange={setMode}
            options={[
              { id: "text", label: t("Text") },
              { id: "visual", label: t("Pictures") },
            ]}
          />
          {mode === "text" ? (
            <>
              <p className="mt-3 text-xs text-fg-muted">{t("Compares the words, ignoring how lines wrap. Scanned PDFs need OCR PDF first.")}</p>
              {progress !== null ? (
                <ProgressBar label={t("Reading both documents…")} fraction={progress} />
              ) : (
                <button type="button" onClick={compare} className={clsx(PRIMARY, "mt-4 w-full")}>
                  <GitCompareArrows className="size-4" aria-hidden="true" />
                  {result ? t("Compare again") : t("Compare text")}
                </button>
              )}
              {result && counts && (
                <div className="mt-4 space-y-3">
                  <p className="text-sm text-fg" role="status">
                    {result.changes.length === 0
                      ? t("No differences in the text.")
                      : t.plural(result.changes.length, "{n} change: {added} added, {removed} removed, {changed} changed.", "{n} changes: {added} added, {removed} removed, {changed} changed.", counts)}
                  </p>
                  {result.changes.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={copyList} className={SECONDARY}>
                        <Copy className="size-4" aria-hidden="true" />
                        {t("Copy the list")}
                      </button>
                      <button type="button" onClick={markCopies} disabled={marking} className={SECONDARY}>
                        {marking && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                        {t("Mark changes")}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="mt-3 text-xs text-fg-muted">{t("Each page pair is drawn and compared pixel by pixel; differences show in red. Good for drawings, stamps and layout changes.")}</p>
          )}
        </section>
        {outputs && mode === "text" && <OutputCard title={t("Marked copies ready")} outputs={outputs} zipName={withSuffix(after.name, "comparison", ".zip")} />}
      </div>
    </div>
  );
}

const KIND_STYLE: Record<Change["kind"], { label: string; badge: string }> = {
  added: { label: msg("Added"), badge: "bg-success/15 text-success-text" },
  removed: { label: msg("Removed"), badge: "bg-danger/10 text-danger-text" },
  changed: { label: msg("Changed"), badge: "bg-warning-soft text-fg" },
};

const LIST_LIMIT = 500;
const clip = (text: string) => (text.length > 240 ? `${text.slice(0, 240)}…` : text);

function ChangeList({ changes, selected, onSelect }: { changes: Change[]; selected: number; onSelect: (i: number) => void }) {
  const t = useT();
  return (
    <section className="rounded-xl border border-line bg-surface" aria-label={t("Changes")}>
      <div className="border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">{t("Changes")}</div>
      <ol className="max-h-[32rem] divide-y divide-line overflow-y-auto">
        {changes.slice(0, LIST_LIMIT).map((c, i) => (
          <li key={i}>
            <button type="button" onClick={() => onSelect(i)} aria-current={i === selected} className={clsx("flex w-full items-start gap-3 px-4 py-2.5 text-start text-sm", i === selected ? "bg-brand-soft" : "hover:bg-surface-muted")}>
              <span className={clsx("mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", KIND_STYLE[c.kind].badge)}>{t(KIND_STYLE[c.kind].label)}</span>
              <span className="min-w-0 flex-1 break-words">
                {c.before && <del className="text-danger-text">{clip(c.before)}</del>}
                {c.before && c.after && " → "}
                {c.after && <ins className="text-success-text no-underline">{clip(c.after)}</ins>}
              </span>
              <span className="shrink-0 text-xs text-fg-subtle tabular-nums">{t("p. {page}", { page: c.kind === "removed" ? c.beforePage + 1 : c.afterPage + 1 })}</span>
            </button>
          </li>
        ))}
      </ol>
      {changes.length > LIST_LIMIT && <p className="border-t border-line px-4 py-2 text-xs text-fg-subtle">{t("The first {limit} are listed; “Copy the list” has all {count}.", { limit: LIST_LIMIT, count: changes.length })}</p>}
    </section>
  );
}

const PAGE_WIDTH = 300;

/** Both versions' pages for the selected change, with every change on them highlighted. */
function PagePair({ change, result, docA, docB }: { change: Change; result: ComparedDocuments; docA: PDFDocumentProxy; docB: PDFDocumentProxy }) {
  const t = useT();
  const sides = [
    { label: t("Original"), doc: docA, page: change.beforePage, size: result.sizes.before[change.beforePage], words: result.changes.flatMap((c) => c.beforeWords), tone: "bg-danger/35", current: change.beforeWords },
    { label: t("Changed version"), doc: docB, page: change.afterPage, size: result.sizes.after[change.afterPage], words: result.changes.flatMap((c) => c.afterWords), tone: "bg-success/40", current: change.afterWords },
  ];
  return (
    <section className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2" aria-label={t("Pages with the change")}>
      {sides.map((side) => {
        if (!side.size) return null;
        const height = Math.round((PAGE_WIDTH * side.size.height) / side.size.width);
        const current = new Set(side.current);
        return (
          <figure key={side.label} className="flex flex-col items-center gap-2">
            <figcaption className="text-xs font-medium text-fg-muted">
              {side.label} · {t("page {page}", { page: side.page + 1 })}
            </figcaption>
            <div className="relative bg-white shadow-sm" style={{ width: PAGE_WIDTH, height }} dir="ltr">
              <PageThumbnail key={side.page} doc={side.doc} pageNumber={side.page + 1} width={PAGE_WIDTH} height={height} />
              {side.words
                .filter((w) => w.page === side.page)
                .flatMap((w, i) =>
                  w.boxes.map((b, j) => (
                    <span
                      key={`${i}-${j}`}
                      aria-hidden="true"
                      className={clsx("absolute rounded-[1px] mix-blend-multiply", side.tone, current.has(w) && "outline-2 outline-offset-1 outline-brand")}
                      style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.width * 100}%`, height: `${b.height * 100}%` }}
                    />
                  )),
                )}
            </div>
          </figure>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------------------- Pictures

const DIFF_WIDTH = 800;

/** A page drawn into a canvas of the given size (white where the page doesn't reach). */
async function pagePixels(doc: PDFDocumentProxy, number: number, width: number, height: number): Promise<Uint8ClampedArray> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  if (number <= doc.numPages) {
    await withRenderSlot(async () => {
      const page = await doc.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      const scale = width / natural.width;
      const layer = document.createElement("canvas");
      const viewport = page.getViewport({ scale });
      layer.width = Math.ceil(viewport.width);
      layer.height = Math.ceil(viewport.height);
      await page.render({ canvas: layer, viewport, background: "#ffffff" }).promise;
      ctx.drawImage(layer, 0, 0);
      layer.width = layer.height = 0;
      page.cleanup();
    });
  }
  const data = ctx.getImageData(0, 0, width, height).data;
  canvas.width = canvas.height = 0;
  return data;
}

async function pageSize(doc: PDFDocumentProxy, number: number) {
  if (number > doc.numPages) return null;
  const v = (await doc.getPage(number)).getViewport({ scale: 1 });
  return { width: v.width, height: v.height };
}

function VisualDiff({ docA, docB }: { docA: PDFDocumentProxy; docB: PDFDocumentProxy }) {
  const pages = Math.max(docA.numPages, docB.numPages);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<{ page: number; changed: number; width: number; height: number; data: Uint8ClampedArray } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const size = (await pageSize(docB, page)) ?? (await pageSize(docA, page));
      if (!size || cancelled) return;
      const width = DIFF_WIDTH;
      const height = Math.round((DIFF_WIDTH * size.height) / size.width);
      const [a, b] = await Promise.all([pagePixels(docA, page, width, height), pagePixels(docB, page, width, height)]);
      if (cancelled) return;
      const diff = diffPixels(a, b, width, height);
      setState({ page, changed: diff.changed, width, height, data: diff.data });
    })().catch((error: unknown) => toast({ tone: "error", title: msg("Couldn't compare this page"), description: errorMessage(error) }));
    return () => {
      cancelled = true;
    };
  }, [docA, docB, page]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state) return;
    canvas.width = state.width;
    canvas.height = state.height;
    canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(state.data), state.width, state.height), 0, 0);
  }, [state]);

  const ready = state?.page === page;
  const missing = page > docA.numPages ? t("This page is only in the changed version.") : page > docB.numPages ? t("This page is only in the original.") : null;
  return (
    <section className="rounded-xl border border-line bg-surface" aria-label={t("Picture comparison")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded p-1.5 text-fg-muted hover:bg-surface-muted disabled:opacity-40" aria-label={t("Previous page")}>
            <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          </button>
          <span className="text-sm text-fg tabular-nums">{t("Page {page} of {count}", { page, count: pages })}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} className="rounded p-1.5 text-fg-muted hover:bg-surface-muted disabled:opacity-40" aria-label={t("Next page")}>
            <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          </button>
        </div>
        <p className="text-sm text-fg-muted" role="status">
          {!ready ? t("Comparing…") : missing ?? (state.changed === 0 ? t("No visible differences") : state.changed < 0.001 ? t("Under 0.1% of the page differs") : t("{percent}% of the page differs", { percent: (state.changed * 100).toFixed(1) }))}
        </p>
      </div>
      <div className="flex justify-center bg-surface-muted p-4">
        <canvas ref={canvasRef} className={clsx("h-auto max-w-full bg-white shadow-sm", !ready && "opacity-50")} aria-label={t("Page {page}, differences in red", { page })} role="img" />
      </div>
    </section>
  );
}
