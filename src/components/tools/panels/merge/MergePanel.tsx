"use client";

import { useEffect, useEffectEvent, useState } from "react";
import clsx from "clsx";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Combine, GripVertical, LoaderCircle, Lock, Plus } from "lucide-react";
import { PageThumbnail } from "@/components/pdf/PageThumbnail";
import { usePdfDocument } from "@/components/pdf/usePdfDocument";
import { errorMessage } from "@/lib/errors";
import { formatBytes } from "@/lib/files";
import { mergeFiles } from "@/lib/pdf/client";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { OutputCard, PRIMARY, type OutputFile } from "../shared/OutputCard";
import { useT } from "@/store/locale";
import { msg } from "@/i18n/msg";

export default function MergePanel({ files }: ToolPanelProps) {
  const t = useT();
  const moveFile = useWorkspaceStore((s) => s.moveFile);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // Page count per file once opened; null means it couldn't be opened (e.g. password-protected).
  const [pageCounts, setPageCounts] = useState<Record<string, number | null>>({});
  const [outputName, setOutputName] = useState("merged.pdf");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<OutputFile | null>(null);

  const unreadable = (id: string) => pageCounts[id] === null;
  const included = files.filter((f) => !excluded.has(f.id) && !unreadable(f.id));
  const totalPages = included.reduce((n, f) => n + (pageCounts[f.id] ?? 0), 0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) {
      moveFile(String(active.id), String(over.id));
      setOutput(null);
    }
  };

  const toggle = (id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setOutput(null);
  };

  const merge = async () => {
    setBusy(true);
    setOutput(null);
    try {
      const name = /\.pdf$/i.test(outputName.trim()) ? outputName.trim() : `${outputName.trim() || "merged"}.pdf`;
      const blob = await mergeFiles(included.map((f) => ({ name: f.name, file: f.file })));
      setOutput({ name, blob, detail: t("{pages} pages from {files} files", { pages: totalPages, files: included.length }) });
    } catch (error) {
      toast({ tone: "error", title: msg("Merge failed"), description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  if (files.length < 2) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
        <Plus className="size-8 text-fg-subtle" aria-hidden="true" />
        <p className="font-semibold text-fg">{t("Add at least one more PDF")}</p>
        <p className="max-w-sm text-sm text-fg-muted">
          {t("Drop more PDFs anywhere on this page, or use “Add files” above. Every open PDF appears here in tab order.")}
        </p>
      </div>
    );
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="rounded-xl border border-line bg-surface" aria-labelledby="merge-heading">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
          <div>
            <h2 id="merge-heading" className="font-semibold text-fg">
              {t("Merge order")}
            </h2>
            <p className="mt-0.5 text-sm text-fg-muted">{t("Drag to reorder. Untick a file to leave it out.")}</p>
          </div>
          <p className="text-sm text-fg-subtle">
            {t("{included} of {total} files · {pages} pages", { included: included.length, total: files.length, pages: totalPages })}
          </p>
        </header>
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
          <SortableContext items={files.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <ol className="divide-y divide-line">
              {files.map((f, i) => (
                <MergeRow
                  key={f.id}
                  file={f}
                  position={i + 1}
                  included={!excluded.has(f.id) && !unreadable(f.id)}
                  onToggle={() => toggle(f.id)}
                  onOpened={(n) => setPageCounts((prev) => (prev[f.id] === n ? prev : { ...prev, [f.id]: n }))}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      </section>

      <div className="order-first space-y-4 lg:sticky lg:top-20 lg:order-0">
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-semibold text-fg">
            <Combine className="size-4 text-brand-text" aria-hidden="true" />
            {t("Merge PDFs")}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">{t("The merged file gets no author, producer or date metadata.")}</p>
          <label className="mt-4 block text-sm">
            <span className="font-medium text-fg">{t("File name")}</span>
            <input
              value={outputName}
              onChange={(e) => {
                setOutputName(e.target.value);
                setOutput(null);
              }}
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-fg outline-none focus:border-brand-border"
            />
          </label>
          <button type="button" onClick={merge} disabled={busy || included.length < 2} className={clsx(PRIMARY, "mt-4 w-full")}>
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Combine className="size-4" aria-hidden="true" />}
            {busy ? t("Merging…") : t("Merge {count} PDFs", { count: included.length })}
          </button>
          {included.length < 2 && <p className="mt-2 text-xs text-fg-subtle">{t("Select at least two files.")}</p>}
        </section>
        {output && <OutputCard title={t("Merged")} outputs={[output]} />}
      </div>
    </div>
  );
}

function MergeRow({
  file,
  position,
  included,
  onToggle,
  onOpened,
}: {
  file: WorkspaceFile;
  position: number;
  included: boolean;
  onToggle: () => void;
  onOpened: (pageCount: number | null) => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: file.id });
  const pdf = usePdfDocument(file.file);
  const pages = pdf.status === "ready" ? pdf.doc.numPages : null;
  const report = useEffectEvent(onOpened);
  useEffect(() => {
    if (pdf.status !== "loading") report(pdf.status === "ready" ? pdf.doc.numPages : null);
  }, [pdf]);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        "relative flex items-center gap-3 bg-surface px-3 py-3 sm:px-5",
        isDragging && "z-10 shadow-elev-2",
        !included && "opacity-50",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t("Reorder {name}, position {position}", { name: file.name, position })}
        className="cursor-grab touch-none rounded p-1 text-fg-subtle hover:bg-surface-muted hover:text-fg active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <span className="w-5 text-end text-sm font-medium text-fg-subtle tabular-nums">{position}</span>
      <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-muted">
        {pdf.status === "ready" ? (
          <PageThumbnail doc={pdf.doc} pageNumber={1} width={48} height={56} />
        ) : pdf.status === "error" ? (
          <Lock className="size-4 text-fg-subtle" aria-hidden="true" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{file.name}</p>
        <p className={clsx("text-xs", pdf.status === "error" ? "text-danger-text" : "text-fg-subtle")}>
          {pdf.status === "error" ? t.dynamic(pdf.message) : `${pages === null ? "…" : t.plural(pages, "{n} page", "{n} pages")} · ${formatBytes(file.size)}`}
        </p>
      </div>
      <input
        type="checkbox"
        checked={included}
        disabled={pdf.status === "error"}
        onChange={onToggle}
        aria-label={t("Include {name}", { name: file.name })}
        className="size-4 accent-brand"
      />
    </li>
  );
}
