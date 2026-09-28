"use client";

import { useMemo, useState, type MouseEvent } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { LoaderCircle, Scissors } from "lucide-react";
import { PageTile } from "@/components/pdf/PageTile";
import { usePageSelection } from "@/components/pdf/usePageSelection";
import { usePdfDocument } from "@/components/pdf/usePdfDocument";
import { errorMessage } from "@/lib/errors";
import { extractFromFile } from "@/lib/pdf/client";
import { chunkPages, formatPageRanges, parsePageRanges } from "@/lib/pdf/ranges";
import { withSuffix } from "@/lib/zip";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { Field, INPUT } from "../shared/controls";
import { OutputCard, PRIMARY, type OutputFile } from "../shared/OutputCard";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import { useT } from "@/store/locale";
import { msg } from "@/i18n/msg";
import { Rich } from "@/i18n/Rich";

type Mode = "select" | "ranges" | "fixed" | "each";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "select", label: msg("Select pages"), hint: msg("Pick pages to copy into one new PDF.") },
  { id: "ranges", label: msg("Custom ranges"), hint: msg("Each range becomes its own PDF.") },
  { id: "fixed", label: msg("Fixed size"), hint: msg("A new PDF every N pages.") },
  { id: "each", label: msg("Every page"), hint: msg("One PDF per page.") },
];

export default function SplitPanel({ file }: ToolPanelProps) {
  const pdf = usePdfDocument(file.file);
  if (pdf.status === "loading") return <PdfLoading />;
  if (pdf.status === "error") return <PdfLoadError message={pdf.message} code={pdf.code} />;
  return <Splitter file={file} doc={pdf.doc} />;
}

const rangeLabel = (group: number[]) => {
  const text = formatPageRanges(group);
  return group.length === 1 ? `Page ${text}` : `Pages ${text}`;
};

function Splitter({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const t = useT();
  const pageCount = doc.numPages;
  const [mode, setMode] = useState<Mode>("select");
  const [rangesText, setRangesText] = useState(pageCount > 1 ? `1-${Math.ceil(pageCount / 2)}, ${Math.ceil(pageCount / 2) + 1}-${pageCount}` : "1");
  const [chunk, setChunk] = useState(Math.min(2, pageCount));
  const [busy, setBusy] = useState(false);
  const [outputs, setOutputs] = useState<OutputFile[] | null>(null);
  const selection = usePageSelection(pageCount, [], () => setOutputs(null));
  const { selected } = selection;

  // What will be produced, and any input problem.
  const plan = useMemo((): { groups: number[][]; error?: string } => {
    if (mode === "select") {
      if (selected.length === 0) return { groups: [], error: msg("Select at least one page.") };
      return { groups: [[...selected].sort((a, b) => a - b)] };
    }
    if (mode === "ranges") {
      const parsed = parsePageRanges(rangesText, pageCount);
      return parsed.ok ? { groups: parsed.groups } : { groups: [], error: parsed.error };
    }
    if (mode === "fixed") {
      if (!Number.isInteger(chunk) || chunk < 1) return { groups: [], error: msg("Enter a whole number of pages.") };
      return { groups: chunkPages(pageCount, chunk) };
    }
    return { groups: chunkPages(pageCount, 1) };
  }, [mode, selected, rangesText, chunk, pageCount]);

  // Which part(s) each page lands in, for the grid badges.
  const partsByPage = useMemo(() => {
    const map = new Map<number, number[]>();
    plan.groups.forEach((g, part) => g.forEach((i) => map.set(i, [...(map.get(i) ?? []), part + 1])));
    return map;
  }, [plan.groups]);

  const onTileClick = (index: number, event: MouseEvent) => {
    if (mode !== "select") setMode("select");
    // Clicking a page from another mode starts a fresh selection.
    selection.click(index, event, mode !== "select");
  };

  const run = async () => {
    setBusy(true);
    setOutputs(null);
    const { updateFile } = useWorkspaceStore.getState();
    updateFile(file.id, { status: "processing" });
    try {
      const blobs = await extractFromFile(file.file, plan.groups);
      const single = blobs.length === 1;
      setOutputs(
        blobs.map((blob, i) => ({
          blob,
          name: withSuffix(file.name, single ? `pages-${formatPageRanges(plan.groups[i]).replace(/, /g, "_")}` : `part-${String(i + 1).padStart(String(blobs.length).length, "0")}`),
          detail: rangeLabel(plan.groups[i]),
        })),
      );
      updateFile(file.id, { status: "idle" });
    } catch (error) {
      updateFile(file.id, { status: "error", error: errorMessage(error) });
      toast({ tone: "error", title: msg("Split failed"), description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const baseName = file.name.replace(/\.pdf$/i, "");

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="rounded-xl border border-line bg-surface" aria-label={t("Pages")}>
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <p className="text-sm text-fg-muted">
            {mode === "select" ? (
              <Rich text={t.plural(pageCount, "{count} of {n} page selected", "{count} of {n} pages selected")} values={{ count: <span className="font-semibold text-fg">{selected.length}</span> }} />
            ) : (
              <Rich
                text={plan.groups.length === 1 ? t("{count} file from {pages} pages", { pages: pageCount }) : t("{count} files from {pages} pages", { pages: pageCount })}
                values={{ count: <span className="font-semibold text-fg">{plan.groups.length}</span> }}
              />
            )}
          </p>
          {mode === "select" && (
            <div className="flex gap-3 text-sm">
              <button type="button" className="text-brand-text hover:underline" onClick={selection.selectAll}>
                {t("Select all")}
              </button>
              <button type="button" className="text-brand-text hover:underline disabled:opacity-40" disabled={selected.length === 0} onClick={selection.clear}>
                {t("Clear")}
              </button>
            </div>
          )}
        </header>
        <ol className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3 p-4">
          {Array.from({ length: pageCount }, (_, i) => {
            const parts = partsByPage.get(i);
            const inPlan = Boolean(parts);
            return (
              <li key={i}>
                <PageTile
                  doc={doc}
                  index={i}
                  selected={mode === "select" && inPlan}
                  dimmed={!inPlan}
                  pressed={mode === "select" ? inPlan : undefined}
                  label={parts ? t("Page {page}, in part {parts}", { page: i + 1, parts: t.list(parts.map(String)) }) : t("Page {page}", { page: i + 1 })}
                  onClick={(e) => onTileClick(i, e)}
                  badge={
                    mode !== "select" &&
                    parts && (
                      <span className="absolute start-3 top-3 rounded bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-brand-fg">
                        {t("Part {parts}", { parts: parts.join(", ") })}
                      </span>
                    )
                  }
                />
              </li>
            );
          })}
        </ol>
      </section>

      <div className="order-first space-y-4 lg:sticky lg:top-20 lg:order-0">
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-semibold text-fg">
            <Scissors className="size-4 text-brand-text" aria-hidden="true" />
            {t("Split or extract")}
          </h2>
          <div role="radiogroup" aria-label={t("Split mode")} className="mt-4 grid grid-cols-2 gap-1.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                onClick={() => {
                  setMode(m.id);
                  setOutputs(null);
                }}
                className={clsx(
                  "rounded-lg border px-2.5 py-2 text-sm font-medium transition-colors",
                  mode === m.id ? "border-brand-text bg-brand-soft text-brand-text" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-fg-muted">{MODES.find((m) => m.id === mode)?.hint}</p>

          {mode === "select" && (
            <Field label={t("Pages")} hint={t("e.g. 1-3, 5, 8-")} error={selection.error}>
              <input value={selection.text} onChange={(e) => selection.type(e.target.value)} placeholder={t("Click pages or type ranges")} className={INPUT} />
            </Field>
          )}
          {mode === "ranges" && (
            <Field label={t("Ranges")} hint={t("Comma-separated; “8-” means page 8 to the end.")} error={plan.error}>
              <input
                value={rangesText}
                onChange={(e) => {
                  setRangesText(e.target.value);
                  setOutputs(null);
                }}
                className={INPUT}
              />
            </Field>
          )}
          {mode === "fixed" && (
            <Field label={t("Pages per file")} error={plan.error}>
              <input
                type="number"
                min={1}
                max={pageCount}
                value={Number.isNaN(chunk) ? "" : chunk}
                onChange={(e) => {
                  setChunk(e.target.valueAsNumber);
                  setOutputs(null);
                }}
                className={INPUT}
              />
            </Field>
          )}

          {mode !== "select" && plan.groups.length > 0 && (
            <ul className="mt-4 max-h-40 space-y-1 overflow-y-auto text-sm">
              {plan.groups.slice(0, 50).map((g, i) => (
                <li key={i} className="flex justify-between gap-2 text-fg-muted">
                  <span className="font-medium text-fg">{t("Part {parts}", { parts: i + 1 })}</span>
                  <span className="truncate">{rangeLabel(g)}</span>
                </li>
              ))}
              {plan.groups.length > 50 && <li className="text-fg-subtle">{t("…and {count} more", { count: plan.groups.length - 50 })}</li>}
            </ul>
          )}

          <button type="button" onClick={run} disabled={busy || plan.groups.length === 0} className={clsx(PRIMARY, "mt-5 w-full")}>
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Scissors className="size-4" aria-hidden="true" />}
            {busy ? t("Working…") : mode === "select" ? t("Extract selected pages") : t.plural(plan.groups.length, "Split into {n} file", "Split into {n} files")}
          </button>
          {mode === "select" && plan.error && selected.length === 0 && <p className="mt-2 text-xs text-fg-subtle">{plan.error}</p>}
        </section>

        {outputs && (
          <OutputCard
            title={outputs.length === 1 ? t("Pages extracted") : t.plural(outputs.length, "Split into {n} file", "Split into {n} files")}
            outputs={outputs}
            zipName={`${baseName}-split.zip`}
          />
        )}
      </div>
    </div>
  );
}
