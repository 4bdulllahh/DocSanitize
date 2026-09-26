"use client";

import { useEffect, useState, type MouseEvent } from "react";
import clsx from "clsx";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Download, LoaderCircle, Redo2, RotateCcw, RotateCw, Save, Trash2, Undo2, Undo } from "lucide-react";
import { PageThumbnail } from "@/components/pdf/PageThumbnail";
import { usePdfDocument } from "@/components/pdf/usePdfDocument";
import { downloadBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { rearrangeFile } from "@/lib/pdf/client";
import { withSuffix } from "@/lib/zip";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import { PRIMARY, SECONDARY } from "../shared/OutputCard";
import { usePageHistory, type PageItem } from "./usePageHistory";

export default function OrganizePanel({ file }: ToolPanelProps) {
  const pdf = usePdfDocument(file.file);
  if (pdf.status === "loading") return <PdfLoading />;
  if (pdf.status === "error") return <PdfLoadError message={pdf.message} code={pdf.code} />;
  return <Organizer file={file} doc={pdf.doc} />;
}

const TILE_W = 136;
const TILE_H = 176;

function Organizer({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const { pages, commit, undo, redo, reset, canUndo, canRedo } = usePageHistory(doc.numPages);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [busy, setBusy] = useState<"tab" | "download" | null>(null);

  const kept = pages.filter((p) => !p.deleted);
  const changed = pages.some((p, i) => p.index !== i || p.rotate % 360 !== 0 || p.deleted);
  const targets = selected.size > 0 ? selected : null;

  const update = (ids: Set<string> | null, change: (p: PageItem) => PageItem) =>
    commit(pages.map((p) => (ids?.has(p.id) ? change(p) : p)));
  const rotate = (ids: Set<string>, by: number) => update(ids, (p) => ({ ...p, rotate: p.rotate + by }));
  const setDeleted = (ids: Set<string>, deleted: boolean) => update(ids, (p) => ({ ...p, deleted }));

  const select = (id: string, event: MouseEvent) => {
    const next = new Set(event.ctrlKey || event.metaKey ? selected : []);
    if (event.shiftKey && anchor) {
      const [a, b] = [pages.findIndex((p) => p.id === anchor), pages.findIndex((p) => p.id === id)].sort((x, y) => x - y);
      for (const p of pages.slice(a, b + 1)) next.add(p.id);
    } else if ((event.ctrlKey || event.metaKey) && next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
    if (!event.shiftKey) setAnchor(id);
  };

  // Keyboard shortcuts: undo/redo and Delete for the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && targets) {
        e.preventDefault();
        const allDeleted = pages.every((p) => !targets.has(p.id) || p.deleted);
        commit(pages.map((p) => (targets.has(p.id) ? { ...p, deleted: !allDeleted } : p)));
      } else if (e.key === "Escape") {
        setSelected(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages, targets, commit, undo, redo]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // Long-press on touch screens, so swiping over the grid still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    // Space picks up/drops; Enter stays free for selecting.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = pages.findIndex((p) => p.id === active.id);
    const to = pages.findIndex((p) => p.id === over.id);
    commit(arrayMove(pages, from, to));
  };

  const apply = async (mode: "tab" | "download") => {
    setBusy(mode);
    const { updateFile, replaceFileContent } = useWorkspaceStore.getState();
    updateFile(file.id, { status: "processing" });
    try {
      const blob = await rearrangeFile(file.file, kept.map(({ index, rotate }) => ({ index, rotate })));
      if (mode === "download") {
        downloadBlob(blob, withSuffix(file.name, "organized"));
        updateFile(file.id, { status: "idle" });
      } else {
        replaceFileContent(file.id, blob);
        toast({ tone: "success", title: "Changes applied", description: `${file.name} now has ${kept.length} page${kept.length === 1 ? "" : "s"}.` });
      }
    } catch (error) {
      updateFile(file.id, { status: "error", error: errorMessage(error) });
      toast({ tone: "error", title: "Couldn't apply changes", description: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-line bg-surface" aria-label="Pages">
      <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-t-xl border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <p className="mr-2 text-sm text-fg-muted" aria-live="polite">
          {selected.size > 0 ? (
            <>
              <span className="font-semibold text-fg">{selected.size}</span> selected ·{" "}
              <button type="button" className="text-brand-text hover:underline" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </>
          ) : (
            <>
              <span className="font-semibold text-fg">{kept.length}</span> of {pages.length} pages ·{" "}
              <button type="button" className="text-brand-text hover:underline" onClick={() => setSelected(new Set(pages.map((p) => p.id)))}>
                Select all
              </button>
            </>
          )}
        </p>
        <ToolbarButton label="Rotate left" icon={RotateCcw} disabled={!targets} onClick={() => targets && rotate(targets, -90)} />
        <ToolbarButton label="Rotate right" icon={RotateCw} disabled={!targets} onClick={() => targets && rotate(targets, 90)} />
        <ToolbarButton label="Delete" icon={Trash2} disabled={!targets} onClick={() => targets && setDeleted(targets, true)} />
        <ToolbarButton label="Restore" icon={Undo} disabled={!targets} onClick={() => targets && setDeleted(targets, false)} />
        <span className="mx-1 hidden h-6 w-px bg-line sm:block" />
        <ToolbarButton label="Undo (Ctrl+Z)" icon={Undo2} disabled={!canUndo} onClick={undo} />
        <ToolbarButton label="Redo (Ctrl+Y)" icon={Redo2} disabled={!canRedo} onClick={redo} />
        <button type="button" onClick={reset} disabled={!changed} className="rounded-lg px-2.5 py-1.5 text-sm text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40">
          Reset
        </button>

        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => apply("download")} disabled={!changed || busy !== null || kept.length === 0} className={SECONDARY}>
            {busy === "download" ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
            Download edited PDF
          </button>
          <button type="button" onClick={() => apply("tab")} disabled={!changed || busy !== null || kept.length === 0} className={PRIMARY}>
            {busy === "tab" ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
            Apply changes
          </button>
        </div>
      </div>

      {kept.length === 0 && (
        <p className="border-b border-line bg-warning-soft px-4 py-2 text-sm text-warning-text">Every page is marked for deletion — keep at least one.</p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
          <ol className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 p-4">
            {pages.map((page, position) => (
              <PageTile
                key={page.id}
                doc={doc}
                page={page}
                position={position + 1}
                selected={selected.has(page.id)}
                onSelect={(e) => select(page.id, e)}
                onRotate={(by) => rotate(new Set([page.id]), by)}
                onToggleDelete={() => setDeleted(new Set([page.id]), !page.deleted)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <p className="border-t border-line px-4 py-2.5 text-xs text-fg-subtle">
        Drag pages to reorder (long-press on touch screens, or focus a page and use Space + arrow keys). Ctrl/Shift-click to select several.
      </p>
    </section>
  );
}

function ToolbarButton({ label, icon: Icon, disabled, onClick }: { label: string; icon: typeof RotateCw; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded-lg p-2 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <Icon className="size-4" />
    </button>
  );
}

function PageTile({
  doc,
  page,
  position,
  selected,
  onSelect,
  onRotate,
  onToggleDelete,
}: {
  doc: PDFDocumentProxy;
  page: PageItem;
  position: number;
  selected: boolean;
  onSelect: (e: MouseEvent) => void;
  onRotate: (by: number) => void;
  onToggleDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: page.id });
  const moved = page.index + 1 !== position;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx("group relative", isDragging && "z-10")}
    >
      <div
        className={clsx(
          "rounded-xl border-2 p-2 transition-colors",
          selected ? "border-brand-text bg-brand-soft" : "border-transparent hover:bg-surface-muted",
          isDragging && "bg-surface shadow-elev-2",
        )}
      >
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          onClick={onSelect}
          aria-pressed={selected}
          aria-label={`Page ${page.index + 1}${page.deleted ? " (deleted)" : ""}, position ${position}`}
          className="relative mx-auto block cursor-grab rounded-md active:cursor-grabbing"
        >
          <PageThumbnail
            doc={doc}
            pageNumber={page.index + 1}
            rotation={page.rotate}
            width={TILE_W}
            height={TILE_H}
            className={clsx(page.deleted && "opacity-25 grayscale")}
          />
          {page.deleted && (
            <span className="absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 rounded bg-danger px-2 py-0.5 text-xs font-semibold text-white">
              Deleted
            </span>
          )}
        </button>
        <p className="mt-1.5 text-center text-xs text-fg-muted tabular-nums">
          <span className="font-semibold text-fg">{position}</span>
          {moved && <span className="text-fg-subtle"> · was {page.index + 1}</span>}
        </p>
      </div>

      <div className="absolute top-3 right-3 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
        <TileAction label={`Rotate page ${page.index + 1} left`} icon={RotateCcw} onClick={() => onRotate(-90)} />
        <TileAction label={`Rotate page ${page.index + 1} right`} icon={RotateCw} onClick={() => onRotate(90)} />
        <TileAction
          label={page.deleted ? `Restore page ${page.index + 1}` : `Delete page ${page.index + 1}`}
          icon={page.deleted ? Undo : Trash2}
          onClick={onToggleDelete}
          danger={!page.deleted}
        />
      </div>
    </li>
  );
}

function TileAction({ label, icon: Icon, onClick, danger }: { label: string; icon: typeof RotateCw; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={clsx(
        "rounded-md border border-line bg-surface p-1.5 shadow-elev-1 transition-colors",
        danger ? "text-fg-muted hover:border-danger/50 hover:text-danger" : "text-fg-muted hover:text-fg",
      )}
    >
      <Icon className="size-3.5" />
    </button>
  );
}
