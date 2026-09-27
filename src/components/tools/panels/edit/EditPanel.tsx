"use client";

import { useEffect, useEffectEvent, useState } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, LoaderCircle, Save, TriangleAlert } from "lucide-react";
import { PageStrip } from "@/components/pdf/PageStrip";
import { usePdfDocument } from "@/components/pdf/usePdfDocument";
import { errorMessage } from "@/lib/errors";
import { createId } from "@/lib/files";
import { asPngOrJpeg } from "@/lib/image/convert";
import { editFile } from "@/lib/pdf/client";
import { moveObject } from "@/lib/pdf/edit/geometry";
import type { EditObject, EditRequest } from "@/lib/pdf/edit/types";
import { formatPageRanges } from "@/lib/pdf/ranges";
import { withSuffix } from "@/lib/zip";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { Segmented } from "../shared/controls";
import { OutputCard, PRIMARY, type OutputFile } from "../shared/OutputCard";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import type { SignatureAsset } from "../sign/SignatureCreator";
import { EditorCanvas } from "./EditorCanvas";
import { Inspector } from "./Inspector";
import { DEFAULTS, STAYS_ACTIVE, TOOL_GROUPS, type Defaults, type Tool } from "./model";
import { Toolbar, ZOOMS } from "./Toolbar";
import { useEditorState } from "./useEditorState";

export default function EditPanel({ file }: ToolPanelProps) {
  const pdf = usePdfDocument(file.file);
  if (pdf.status === "loading") return <PdfLoading />;
  if (pdf.status === "error") return <PdfLoadError message={pdf.message} code={pdf.code} />;
  return <Editor file={file} doc={pdf.doc} />;
}

const SHORTCUTS = Object.fromEntries(TOOL_GROUPS.flat().flatMap((t) => (t.key ? [[t.key, t.id]] : []))) as Record<string, Tool>;
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

function Editor({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const state = useEditorState(`${file.id}:${file.revision}`);
  const [tool, setTool] = useState<Tool>("select");
  const [defaults, setDefaults] = useState<Defaults>(DEFAULTS);
  const [current, setCurrent] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [flatten, setFlatten] = useState(true);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<{ file: OutputFile; warnings: string[] } | null>(null);
  const [page, setPage] = useState<{ index: number; width: number; height: number } | null>(null);

  // The displayed size of the current page, in points.
  useEffect(() => {
    let active = true;
    doc
      .getPage(current + 1)
      .then((p) => {
        const { width, height } = p.getViewport({ scale: 1 });
        if (active) setPage({ index: current, width, height });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [doc, current]);
  const pageSize = page?.index === current ? page : null;

  const { objects } = state;
  const selected = objects.find((o) => o.id === selectedId) ?? null;
  const change: typeof state.change = (fn, key) => {
    state.change(fn, key);
    setOutput(null);
  };
  const editorState = { ...state, change };

  const chooseTool = (next: Tool) => {
    setTool(next);
    setEditingId(null);
    if (next !== "select") setSelectedId(null);
  };
  const goTo = (index: number) => {
    setCurrent(Math.max(0, Math.min(doc.numPages - 1, index)));
    setSelectedId(null);
    setEditingId(null);
  };
  const remove = (id: string) => {
    change((all) => all.filter((o) => o.id !== id));
    setSelectedId(null);
  };

  /** Put a picture on the current page: centred, at most 40% of the page wide. */
  const placeImage = (key: string, image: { width: number; height: number }) => {
    if (!pageSize) return;
    const width = Math.min(pageSize.width * 0.4, image.width);
    const height = (width * image.height) / image.width;
    const object: EditObject = { id: createId(), kind: "image", page: current, x: (pageSize.width - width) / 2, y: (pageSize.height - height) / 2, width, height, image: key, opacity: 1 };
    change((all) => [...all, object]);
    setTool("select");
    setSelectedId(object.id);
  };
  const addImageFile = async (chosen: File) => {
    try {
      const { bytes, format } = await asPngOrJpeg(new Uint8Array(await chosen.arrayBuffer()), chosen.type);
      const blob = new Blob([bytes as BlobPart], { type: `image/${format}` });
      const bitmap = await createImageBitmap(blob);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      const key = createId();
      state.addImage(key, { bytes, format, url: URL.createObjectURL(blob), ...size });
      placeImage(key, size);
    } catch (error) {
      toast({ tone: "error", title: "Couldn't use that image", description: errorMessage(error) });
    }
  };
  const addSignature = (asset: SignatureAsset) => {
    if (!state.images[asset.id]) state.addImage(asset.id, { bytes: asset.png, format: "png", url: asset.url, width: asset.width, height: asset.height });
    if (!pageSize) return;
    // Signature size: 160 pt wide, in the lower right where signatures usually go.
    const width = Math.min(160, pageSize.width * 0.4);
    const height = (width * asset.height) / asset.width;
    const object: EditObject = { id: createId(), kind: "image", page: current, x: pageSize.width * 0.62, y: Math.min(pageSize.height * 0.8, pageSize.height - height - 20), width, height, image: asset.id, opacity: 1 };
    change((all) => [...all, object]);
    setTool("select");
    setSelectedId(object.id);
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (isTyping(event.target)) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === "z") {
      event.preventDefault();
      if (event.shiftKey) state.redo();
      else state.undo();
      setOutput(null);
    } else if (mod && key === "y") {
      event.preventDefault();
      state.redo();
      setOutput(null);
    } else if ((event.key === "Delete" || event.key === "Backspace") && selected) {
      event.preventDefault();
      remove(selected.id);
    } else if (event.key === "Escape") {
      setSelectedId(null);
      chooseTool("select");
    } else if (selected && event.key.startsWith("Arrow")) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key] ?? [0, 0];
      change((all) => all.map((o) => (o.id === selected.id ? moveObject(o, dx, dy) : o)), `nudge:${selected.id}`);
    } else if (!mod && !event.altKey && SHORTCUTS[key]) {
      chooseTool(SHORTCUTS[key]);
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const save = async () => {
    const { updateFile } = useWorkspaceStore.getState();
    setBusy(true);
    setOutput(null);
    setEditingId(null);
    updateFile(file.id, { status: "processing", error: undefined });
    try {
      const used = new Set(objects.flatMap((o) => (o.kind === "image" ? [o.image] : [])));
      const images: EditRequest["images"] = Object.fromEntries(Object.entries(state.images).flatMap(([key, image]) => (used.has(key) ? [[key, { bytes: image.bytes, format: image.format }]] : [])));
      // Empty new text boxes would only add nothing; leave them out.
      const request = { objects: objects.filter((o) => !(o.kind === "text" && !o.text.trim()) && !(o.kind === "note" && !o.text.trim())), images, flatten };
      const { blob, warnings } = await editFile(file.file, request);
      setOutput({ file: { name: withSuffix(file.name, "edited"), blob }, warnings });
      updateFile(file.id, { status: "idle" });
    } catch (error) {
      updateFile(file.id, { status: "error", error: errorMessage(error) });
      toast({ tone: "error", title: "Saving failed", description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const counts: Record<number, number> = {};
  for (const o of objects) counts[o.page] = (counts[o.page] ?? 0) + 1;
  const pages = Object.keys(counts).map(Number).sort((a, b) => a - b);
  const emptyNotes = objects.filter((o) => o.kind === "note" && !o.text.trim()).length;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <section className="min-w-0 rounded-xl border border-line bg-surface" aria-label="Document">
        <Toolbar
          tool={tool}
          onTool={chooseTool}
          canUndo={state.canUndo}
          canRedo={state.canRedo}
          onUndo={() => {
            state.undo();
            setOutput(null);
          }}
          onRedo={() => {
            state.redo();
            setOutput(null);
          }}
          zoom={zoom}
          onZoom={(z) => ZOOMS.includes(z) && setZoom(z)}
        />
        {doc.numPages > 1 && <PageStrip doc={doc} current={current} onSelect={goTo} counts={counts} noun="change" />}
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
          <button type="button" className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40" disabled={current === 0} onClick={() => goTo(current - 1)} aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-fg-muted tabular-nums">
            Page {current + 1} of {doc.numPages}
          </span>
          <button type="button" className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40" disabled={current === doc.numPages - 1} onClick={() => goTo(current + 1)} aria-label="Next page">
            <ChevronRight className="size-4" />
          </button>
        </div>
        {pageSize ? (
          <EditorCanvas
            doc={doc}
            index={current}
            page={pageSize}
            zoom={zoom}
            tool={tool}
            defaults={defaults}
            state={editorState}
            selectedId={selectedId}
            onSelect={setSelectedId}
            editingId={editingId}
            onEdit={setEditingId}
            onCreated={(id, used) => {
              if (STAYS_ACTIVE.has(used)) return;
              setTool("select");
              setSelectedId(id);
            }}
          />
        ) : (
          <div className="h-[60vh] animate-pulse bg-surface-muted" aria-busy="true" />
        )}
      </section>

      <div className="space-y-4 lg:sticky lg:top-20">
        <Inspector
          tool={tool}
          defaults={defaults}
          onDefaults={setDefaults}
          selected={selected}
          onPatch={(patch, key) => change((all) => all.map((o) => (o.id === selected?.id ? ({ ...o, ...patch } as EditObject) : o)), key)}
          onDelete={() => selected && remove(selected.id)}
          onDuplicate={() => {
            if (!selected) return;
            const copy = { ...moveObject(selected, 12, 12), id: createId() };
            change((all) => [...all, copy]);
            setSelectedId(copy.id);
          }}
          onImage={addImageFile}
          onSignature={addSignature}
          focusNote={selected?.kind === "note" && !selected.text}
        />

        <section className="rounded-xl border border-line bg-surface p-5" aria-label="Save">
          <Segmented
            label="Save as"
            value={flatten ? "flatten" : "editable"}
            onChange={(v) => {
              setFlatten(v === "flatten");
              setOutput(null);
            }}
            options={[
              { id: "flatten", label: "Flattened" },
              { id: "editable", label: "Editable" },
            ]}
          />
          <p className="mt-2 text-xs text-fg-subtle">
            {flatten
              ? "Everything becomes part of the page, and looks the same in every PDF reader."
              : "Added items stay separate annotations that other PDF apps can move, change or delete."}{" "}
            Edited text and white-out are always part of the page; notes always stay comments.
          </p>
          <p className="mt-4 rounded-lg bg-surface-muted px-3 py-2 text-sm text-fg-muted">
            {objects.length === 0 ? (
              "No changes yet"
            ) : (
              <>
                <span className="font-semibold text-fg">{objects.length}</span> change{objects.length === 1 ? "" : "s"} on {pages.length === 1 ? "page" : "pages"} {formatPageRanges(pages)}
              </>
            )}
          </p>
          {emptyNotes > 0 && <p className="mt-2 text-xs text-fg-subtle">Notes without text are left out.</p>}
          <button type="button" onClick={save} disabled={busy || objects.length === 0} className={clsx(PRIMARY, "mt-4 w-full")}>
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
            {busy ? "Saving…" : "Save PDF"}
          </button>
        </section>

        {output && output.warnings.length > 0 && (
          <section className="rounded-xl border border-warning/40 bg-warning-soft p-4 text-sm" aria-live="polite">
            <p className="flex items-center gap-2 font-medium text-fg">
              <TriangleAlert className="size-4 text-warning" aria-hidden="true" />
              Please check
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-9 text-fg-muted">
              {output.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </section>
        )}
        {output && <OutputCard title="Edited PDF ready" outputs={[output.file]} replaceFileId={file.id} />}
      </div>
    </div>
  );
}
