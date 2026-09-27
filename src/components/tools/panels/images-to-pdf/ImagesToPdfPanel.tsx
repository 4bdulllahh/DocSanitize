"use client";

import { useRef, useState } from "react";
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
import { FileImage, GripVertical, ImageOff, LoaderCircle, RotateCw } from "lucide-react";
import { useImageSource } from "@/hooks/useImageSource";
import { errorMessage } from "@/lib/errors";
import { formatBytes } from "@/lib/files";
import { imagesToPdfFile } from "@/lib/pdf/client";
import { layoutPage, type ImageFit, type ImagesToPdfOptions, type PageOrientation, type PageSizeOption } from "@/lib/pdf/images";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { Field, INPUT, Segmented } from "../shared/controls";
import { OutputCard, PRIMARY, type OutputFile } from "../shared/OutputCard";

// Margins in points: none, ¼ inch, ½ inch.
const MARGINS = { none: 0, small: 18, large: 36 } as const;
type Margin = keyof typeof MARGINS;

interface Options {
  pageSize: PageSizeOption;
  orientation: PageOrientation;
  margin: Margin;
  fit: ImageFit;
}

const toPdfOptions = (o: Options): ImagesToPdfOptions => ({ ...o, margin: MARGINS[o.margin] });

export default function ImagesToPdfPanel({ files }: ToolPanelProps) {
  const moveFile = useWorkspaceStore((s) => s.moveFile);
  const [options, setOptions] = useState<Options>({ pageSize: "a4", orientation: "auto", margin: "none", fit: "contain" });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [unreadable, setUnreadable] = useState<Set<string>>(new Set());
  const [rotations, setRotations] = useState<Record<string, number>>({});
  const [outputName, setOutputName] = useState("images.pdf");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<OutputFile | null>(null);

  const isIncluded = (id: string) => !excluded.has(id) && !unreadable.has(id);
  const included = files.filter((f) => isIncluded(f.id));
  const fitted = options.pageSize === "fit";

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

  const setOption = <K extends keyof Options>(key: K, value: Options[K]) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
    setOutput(null);
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

  const rotate = (id: string) => {
    setRotations((prev) => ({ ...prev, [id]: ((prev[id] ?? 0) + 90) % 360 }));
    setOutput(null);
  };

  const create = async () => {
    setBusy(true);
    setOutput(null);
    try {
      const name = /\.pdf$/i.test(outputName.trim()) ? outputName.trim() : `${outputName.trim() || "images"}.pdf`;
      const blob = await imagesToPdfFile(
        included.map((f) => ({ name: f.name, file: f.file, rotate: rotations[f.id] ?? 0 })),
        toPdfOptions(options),
      );
      setOutput({ name, blob, detail: `${included.length} page${included.length === 1 ? "" : "s"}` });
    } catch (error) {
      toast({ tone: "error", title: "Couldn't create the PDF", description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="rounded-xl border border-line bg-surface" aria-labelledby="images-heading">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
          <div>
            <h2 id="images-heading" className="font-semibold text-fg">
              Page order
            </h2>
            <p className="mt-0.5 text-sm text-fg-muted">Drag to reorder. Each image becomes one page.</p>
          </div>
          <p className="text-sm text-fg-subtle">
            {included.length} of {files.length} images
          </p>
        </header>
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
          <SortableContext items={files.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <ol className="divide-y divide-line">
              {files.map((f, i) => (
                <ImageRow
                  key={f.id}
                  file={f}
                  position={i + 1}
                  included={isIncluded(f.id)}
                  unreadable={unreadable.has(f.id)}
                  rotation={rotations[f.id] ?? 0}
                  options={toPdfOptions(options)}
                  onToggle={() => toggle(f.id)}
                  onRotate={() => rotate(f.id)}
                  onUnreadable={() => setUnreadable((prev) => (prev.has(f.id) ? prev : new Set(prev).add(f.id)))}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      </section>

      <div className="order-first space-y-4 lg:sticky lg:top-20 lg:order-0">
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-semibold text-fg">
            <FileImage className="size-4 text-brand-text" aria-hidden="true" />
            Images to PDF
          </h2>
          <p className="mt-1 text-sm text-fg-muted">JPEGs go in as-is, with no quality loss. Camera data such as GPS location is removed.</p>

          <Segmented
            label="Page size"
            value={options.pageSize}
            onChange={(v) => setOption("pageSize", v)}
            options={[
              { id: "fit", label: "Fit image" },
              { id: "a4", label: "A4" },
              { id: "letter", label: "Letter" },
            ]}
          />
          <Segmented
            label="Orientation"
            value={options.orientation}
            onChange={(v) => setOption("orientation", v)}
            disabled={fitted}
            options={[
              { id: "auto", label: "Auto" },
              { id: "portrait", label: "Portrait" },
              { id: "landscape", label: "Landscape" },
            ]}
          />
          <Segmented
            label="Image placement"
            value={options.fit}
            onChange={(v) => setOption("fit", v)}
            disabled={fitted}
            options={[
              { id: "contain", label: "Whole image" },
              { id: "cover", label: "Fill page" },
            ]}
          />
          <Segmented
            label="Margin"
            value={options.margin}
            onChange={(v) => setOption("margin", v)}
            options={[
              { id: "none", label: "None" },
              { id: "small", label: "Small" },
              { id: "large", label: "Large" },
            ]}
          />
          <Field label="File name">
            <input
              value={outputName}
              onChange={(e) => {
                setOutputName(e.target.value);
                setOutput(null);
              }}
              className={INPUT}
            />
          </Field>
          <button type="button" onClick={create} disabled={busy || included.length === 0} className={clsx(PRIMARY, "mt-5 w-full")}>
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <FileImage className="size-4" aria-hidden="true" />}
            {busy ? "Creating PDF…" : `Create PDF from ${included.length} image${included.length === 1 ? "" : "s"}`}
          </button>
          {included.length === 0 && <p className="mt-2 text-xs text-fg-subtle">Select at least one image.</p>}
        </section>
        {output && <OutputCard title="PDF created" outputs={[output]} />}
      </div>
    </div>
  );
}

function ImageRow({
  file,
  position,
  included,
  unreadable,
  rotation,
  options,
  onToggle,
  onRotate,
  onUnreadable,
}: {
  file: WorkspaceFile;
  position: number;
  included: boolean;
  unreadable: boolean;
  rotation: number;
  options: ImagesToPdfOptions;
  onToggle: () => void;
  onRotate: () => void;
  onUnreadable: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: file.id });
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

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
        aria-label={`Reorder ${file.name}, position ${position}`}
        className="cursor-grab touch-none rounded p-1 text-fg-subtle hover:bg-surface-muted hover:text-fg active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <span className="w-5 text-right text-sm font-medium text-fg-subtle tabular-nums">{position}</span>
      <PagePreview file={file.file} rotation={rotation} options={options} onSize={setSize} onError={onUnreadable} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{file.name}</p>
        <p className={clsx("text-xs", unreadable ? "text-danger-text" : "text-fg-subtle")}>
          {unreadable
            ? "This image can't be read."
            : `${size ? `${size.w} × ${size.h} px · ` : ""}${formatBytes(file.size)}${rotation ? ` · rotated ${rotation}°` : ""}`}
        </p>
      </div>
      <button
        type="button"
        onClick={onRotate}
        disabled={unreadable}
        aria-label={`Rotate ${file.name} clockwise`}
        title="Rotate 90° clockwise"
        className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40"
      >
        <RotateCw className="size-4" />
      </button>
      <input
        type="checkbox"
        checked={included}
        disabled={unreadable}
        onChange={onToggle}
        aria-label={`Include ${file.name}`}
        className="size-4 accent-brand"
      />
    </li>
  );
}

const FRAME = 64;

/** A miniature of the page the image will produce, drawn with the same layout maths as the PDF. */
function PagePreview({
  file,
  rotation,
  options,
  onSize,
  onError,
}: {
  file: File;
  rotation: number;
  options: ImagesToPdfOptions;
  onSize: (size: { w: number; h: number }) => void;
  onError: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  useImageSource(imgRef, file, () => {
    setFailed(true);
    onError();
  });

  let frame = { w: FRAME, h: FRAME };
  let clipBox = { left: 0, top: 0, w: FRAME, h: FRAME };
  let image = { cx: FRAME / 2, cy: FRAME / 2, w: 0, h: 0 };
  const odd = rotation % 180 !== 0;
  if (natural) {
    const [w, h] = odd ? [natural.h, natural.w] : [natural.w, natural.h];
    const layout = layoutPage(w, h, options);
    const k = FRAME / Math.max(layout.width, layout.height);
    const clip = layout.clip ?? { x: 0, y: 0, width: layout.width, height: layout.height };
    const rect = layout.image;
    frame = { w: layout.width * k, h: layout.height * k };
    // PDF coordinates start bottom-left; CSS starts top-left.
    clipBox = { left: clip.x * k, top: (layout.height - clip.y - clip.height) * k, w: clip.width * k, h: clip.height * k };
    image = {
      cx: (rect.x - clip.x + rect.width / 2) * k,
      cy: (clip.y + clip.height - rect.y - rect.height / 2) * k,
      // The <img> is laid out unrotated, then turned with CSS.
      w: (odd ? rect.height : rect.width) * k,
      h: (odd ? rect.width : rect.height) * k,
    };
  }

  return (
    <div className="flex size-18 shrink-0 items-center justify-center rounded bg-surface-muted" aria-hidden="true">
      {failed ? (
        <ImageOff className="size-4 text-fg-subtle" />
      ) : (
        <div className={clsx("relative bg-white shadow-elev-1", !natural && "invisible")} style={{ width: frame.w, height: frame.h }}>
          <div className="absolute overflow-hidden" style={{ left: clipBox.left, top: clipBox.top, width: clipBox.w, height: clipBox.h }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL, nothing to optimize */}
            <img
              ref={imgRef}
              alt=""
              onLoad={(e) => {
                const size = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
                setNatural(size);
                onSize(size);
              }}
              onError={() => {
                setFailed(true);
                onError();
              }}
              className="absolute max-w-none"
              style={{
                left: image.cx,
                top: image.cy,
                width: image.w,
                height: image.h,
                transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
