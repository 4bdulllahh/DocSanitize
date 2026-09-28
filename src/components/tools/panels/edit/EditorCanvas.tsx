"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { X } from "lucide-react";
import { useElementWidth } from "@/components/pdf/PageStage";
import { PageThumbnail } from "@/components/pdf/PageThumbnail";
import { createId } from "@/lib/files";
import { bounds, moveObject } from "@/lib/pdf/edit/geometry";
import { selectText } from "@/lib/pdf/edit/text-select";
import { baselineOffset, LINE_HEIGHT, type Box, type EditObject, type MarkupObject, type ReplaceObject } from "@/lib/pdf/edit/types";
import { CSS_FONTS, measureText, STAYS_ACTIVE, type Defaults, type TextLike, type Tool } from "./model";
import { KIND_NAMES } from "./Inspector";
import type { Translator } from "@/i18n/translate";
import { HitArea, ObjectShape } from "./ObjectLayer";
import type { EditorState } from "./useEditorState";
import { sampleColors, usePageText, type PagePhrase } from "./usePageText";
import { useT } from "@/store/locale";

type Point = { x: number; y: number };

type Gesture =
  | { kind: "move"; id: string; start: Point; original: EditObject; key: string }
  | { kind: "resize"; id: string; start: Point; original: EditObject; key: string }
  | { kind: "endpoint"; id: string; end: "p1" | "p2"; key: string }
  | { kind: "rect"; start: Point }
  | { kind: "line"; start: Point }
  | { kind: "ink"; points: number[] }
  | { kind: "markup"; start: Point };

type Draft =
  | { kind: "rect"; box: Box }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "ink"; points: number[] }
  | { kind: "markup"; rects: Box[] };

interface Props {
  doc: PDFDocumentProxy;
  index: number;
  page: { width: number; height: number };
  zoom: number;
  tool: Tool;
  defaults: Defaults;
  state: EditorState;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  editingId: string | null;
  onEdit: (id: string | null) => void;
  /** Called after a tool made something, with its id (the editor may switch back to Select). */
  onCreated: (id: string, tool: Tool) => void;
}

const MAX_FIT = 1000;
const round = (n: number) => Math.round(n * 100) / 100;

/** Constrain a point to 45° steps from `from` (Shift while drawing lines). */
function snap45(from: Point, to: Point): Point {
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / (Math.PI / 4)) * (Math.PI / 4);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

function rectFrom(a: Point, b: Point, square: boolean): Box {
  let w = b.x - a.x;
  let h = b.y - a.y;
  if (square) {
    const side = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * side;
    h = Math.sign(h || 1) * side;
  }
  return { x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + h), width: Math.abs(w), height: Math.abs(h) };
}

const inside = (p: Point, b: Box, pad = 0) => p.x >= b.x - pad && p.x <= b.x + b.width + pad && p.y >= b.y - pad && p.y <= b.y + b.height + pad;

export function EditorCanvas({ doc, index, page, zoom, tool, defaults, state, selectedId, onSelect, editingId, onEdit, onCreated }: Props) {
  const t = useT();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const available = useElementWidth(scrollerRef);
  const gesture = useRef<Gesture | null>(null);
  const gestureCount = useRef(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const fit = Math.max(200, Math.min(available - 32, MAX_FIT));
  const width = Math.round(fit * zoom);
  const height = Math.round((width * page.height) / page.width);
  const scale = width / page.width;

  const needsText = tool === "edit-text" || tool === "highlight" || tool === "underline" || tool === "strikeout";
  const phrases = usePageText(doc, index, needsText);
  const objects = state.objects.filter((o) => o.page === index);
  const selected = objects.find((o) => o.id === selectedId) ?? null;
  const editing = objects.find((o) => o.id === editingId && (o.kind === "text" || o.kind === "replace")) as TextLike | undefined;

  const toPoint = (event: { clientX: number; clientY: number }): Point => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: round((event.clientX - r.left) / scale), y: round((event.clientY - r.top) / scale) };
  };
  const update = (id: string, fn: (o: EditObject) => EditObject, key?: string) => state.change((all) => all.map((o) => (o.id === id ? fn(o) : o)), key);
  const add = (object: EditObject) => {
    state.change((all) => [...all, object]);
    onCreated(object.id, tool);
  };
  const phraseAt = (p: Point) => phrases?.findIndex((ph) => inside(p, ph, 1)) ?? -1;

  /** Edit a line of the page's own text: reuse its replacement if it has one. */
  const editPhrase = (phrase: PagePhrase) => {
    const existing = state.objects.find((o): o is ReplaceObject => o.kind === "replace" && o.page === index && o.sources[0].transform.join() === phrase.sources[0].transform.join());
    if (existing) {
      onSelect(existing.id);
      onEdit(existing.id);
      return;
    }
    const cover = { x: phrase.x - 1, y: phrase.y - 1, width: phrase.width + 2, height: phrase.height + 2 };
    const colors = sampleColors(stageRef.current?.querySelector("canvas") ?? null, page.width, cover);
    const object: ReplaceObject = {
      id: createId(),
      kind: "replace",
      page: index,
      x: phrase.x,
      y: phrase.baseline - baselineOffset(phrase.font, phrase.size),
      text: phrase.str,
      font: phrase.font,
      size: round(phrase.size),
      bold: phrase.bold,
      italic: phrase.italic,
      color: colors.text,
      cover,
      background: colors.background,
      sources: phrase.sources,
    };
    state.change((all) => [...all, object]);
    onSelect(object.id);
    onEdit(object.id);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("textarea,button")) return;
    // Stop the browser's own mousedown handling, which would move focus away from a text box
    // this click opens (closing it at once) and start selecting page text.
    event.preventDefault();
    if (document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
    const p = toPoint(event);
    const target = event.target as Element;
    const key = `gesture:${++gestureCount.current}`;
    event.currentTarget.setPointerCapture(event.pointerId);

    switch (tool) {
      case "select": {
        const handle = target.closest("[data-handle]")?.getAttribute("data-handle");
        const id = target.closest("[data-id]")?.getAttribute("data-id") ?? (handle ? selectedId : null);
        const object = objects.find((o) => o.id === id);
        if (!object) {
          onSelect(null);
          return;
        }
        onSelect(object.id);
        if (handle === "p1" || handle === "p2") gesture.current = { kind: "endpoint", id: object.id, end: handle, key };
        else if (handle === "se") gesture.current = { kind: "resize", id: object.id, start: p, original: object, key };
        else gesture.current = { kind: "move", id: object.id, start: p, original: object, key };
        return;
      }
      case "text": {
        const object = { id: createId(), kind: "text" as const, page: index, x: p.x, y: round(p.y - defaults.text.size * 0.6), text: "", ...defaults.text };
        state.change((all) => [...all, object]);
        onSelect(object.id);
        onEdit(object.id);
        return;
      }
      case "edit-text": {
        const i = phraseAt(p);
        if (phrases && i !== -1) editPhrase(phrases[i]);
        return;
      }
      case "whiteout":
      case "rect":
      case "ellipse":
        gesture.current = { kind: "rect", start: p };
        setDraft({ kind: "rect", box: { ...p, width: 0, height: 0 } });
        return;
      case "line":
      case "arrow":
        gesture.current = { kind: "line", start: p };
        setDraft({ kind: "line", x1: p.x, y1: p.y, x2: p.x, y2: p.y });
        return;
      case "pen":
      case "highlighter":
        gesture.current = { kind: "ink", points: [p.x, p.y] };
        setDraft({ kind: "ink", points: [p.x, p.y] });
        return;
      case "highlight":
      case "underline":
      case "strikeout":
        gesture.current = { kind: "markup", start: p };
        setDraft({ kind: "markup", rects: [] });
        return;
      case "check":
      case "cross":
      case "dot": {
        const size = defaults.mark.size;
        add({ id: createId(), kind: tool, page: index, x: round(p.x - size / 2), y: round(p.y - size / 2), size, color: defaults.mark.color });
        return;
      }
      case "note":
        add({ id: createId(), kind: "note", page: index, x: round(p.x - 3), y: round(p.y - 3), text: "", color: defaults.note });
        return;
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const p = toPoint(event);
    if (!g) {
      if (tool === "edit-text" && phrases) {
        const i = phraseAt(p);
        if (i !== hover) setHover(i === -1 ? null : i);
      }
      return;
    }
    switch (g.kind) {
      case "move":
        update(g.id, () => moveObject(g.original, round(p.x - g.start.x), round(p.y - g.start.y)), g.key);
        break;
      case "resize": {
        const o = g.original;
        const dx = p.x - g.start.x;
        const dy = p.y - g.start.y;
        update(
          g.id,
          () => {
            switch (o.kind) {
              case "image": {
                const w = Math.max(8, o.width + dx);
                return { ...o, width: round(w), height: round((w * o.height) / o.width) };
              }
              case "rect":
              case "ellipse":
              case "whiteout": {
                const w = Math.max(3, o.width + dx);
                const h = Math.max(3, o.height + dy);
                const side = Math.max(w, h);
                return { ...o, width: round(event.shiftKey ? side : w), height: round(event.shiftKey ? side : h) };
              }
              case "check":
              case "cross":
              case "dot":
                return { ...o, size: round(Math.max(6, o.size + Math.max(dx, dy))) };
              case "text":
              case "replace": {
                const lines = o.text.split("\n").length;
                const box = lines * LINE_HEIGHT * o.size;
                return { ...o, size: round(Math.min(200, Math.max(4, (o.size * (box + dy)) / box))) };
              }
              default:
                return o;
            }
          },
          g.key,
        );
        break;
      }
      case "endpoint":
        update(
          g.id,
          (o) => {
            if (o.kind !== "line" && o.kind !== "arrow") return o;
            const other = g.end === "p1" ? { x: o.x2, y: o.y2 } : { x: o.x1, y: o.y1 };
            const q = event.shiftKey ? snap45(other, p) : p;
            return g.end === "p1" ? { ...o, x1: round(q.x), y1: round(q.y) } : { ...o, x2: round(q.x), y2: round(q.y) };
          },
          g.key,
        );
        break;
      case "rect":
        setDraft({ kind: "rect", box: rectFrom(g.start, p, event.shiftKey && tool !== "whiteout") });
        break;
      case "line": {
        const q = event.shiftKey ? snap45(g.start, p) : p;
        setDraft({ kind: "line", x1: g.start.x, y1: g.start.y, x2: round(q.x), y2: round(q.y) });
        break;
      }
      case "ink": {
        const [lx, ly] = g.points.slice(-2);
        if (Math.hypot(p.x - lx, p.y - ly) * scale >= 1.5) {
          g.points.push(p.x, p.y);
          setDraft({ kind: "ink", points: [...g.points] });
        }
        break;
      }
      case "markup":
        setDraft({ kind: "markup", rects: phrases?.length ? selectText(phrases, g.start, p) : [rectFrom(g.start, p, false)] });
        break;
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    const d = draft;
    gesture.current = null;
    setDraft(null);
    if (!g || !d) return;
    const id = createId();
    if (g.kind === "rect" && d.kind === "rect") {
      const box = d.box.width >= 3 && d.box.height >= 3 ? d.box : tool === "whiteout" ? null : { x: d.box.x, y: d.box.y, width: 120, height: 80 };
      if (!box) return;
      if (tool === "whiteout") add({ id, kind: "whiteout", page: index, ...box, color: defaults.whiteout });
      else if (tool === "rect" || tool === "ellipse") add({ id, kind: tool, page: index, ...box, stroke: defaults.stroke, fill: defaults.fill, strokeWidth: defaults.strokeWidth, opacity: defaults.opacity });
    } else if (g.kind === "line" && d.kind === "line") {
      if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 3) return;
      const { x1, y1, x2, y2 } = d;
      if (tool === "line" || tool === "arrow") add({ id, kind: tool, page: index, x1, y1, x2, y2, color: defaults.stroke ?? "#111827", strokeWidth: defaults.strokeWidth, opacity: defaults.opacity });
    } else if (g.kind === "ink" && d.kind === "ink") {
      const marker = tool === "highlighter";
      const style = marker ? defaults.marker : defaults.pen;
      add({ id, kind: "ink", page: index, strokes: [d.points], color: style.color, strokeWidth: style.width, opacity: marker ? 0.6 : 1, highlighter: marker });
    } else if (g.kind === "markup" && d.kind === "markup") {
      const rects = d.rects.filter((r) => r.width >= 2 && r.height >= 2);
      if (!rects.length || (tool !== "highlight" && tool !== "underline" && tool !== "strikeout")) return;
      add({ id, kind: tool, page: index, rects, color: defaults.markup[tool], opacity: 1 } satisfies MarkupObject);
    }
  };

  const cursor = tool === "select" ? "default" : tool === "text" || tool === "edit-text" ? "text" : "crosshair";
  const selectedBox = selected ? bounds(selected, measureText) : null;

  return (
    <div ref={scrollerRef} className="overflow-x-auto rounded-b-xl bg-surface-muted p-4">
      <div ref={stageRef} className="relative mx-auto bg-white shadow-elev-1" style={{ width, height }} dir="ltr">
        <PageThumbnail key={index} doc={doc} pageNumber={index + 1} width={width} height={height} />
        <div
          className={clsx("absolute inset-0 select-none", (tool !== "select" || selected) && "touch-none")}
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => hover !== null && setHover(null)}
          onDoubleClick={(event) => {
            const id = (event.target as Element).closest("[data-id]")?.getAttribute("data-id");
            const object = objects.find((o) => o.id === id);
            if (tool === "select" && object && (object.kind === "text" || object.kind === "replace" || object.kind === "note")) onEdit(object.id);
          }}
          role="application"
          aria-label={t("Page {page} of the document being edited", { page: index + 1 })}
        >
          <svg className="absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${page.width} ${page.height}`} preserveAspectRatio="none">
            {objects.map((o) => (
              <g key={o.id} data-id={o.id} className={tool === "select" ? "cursor-move" : "pointer-events-none"} role="img" aria-label={describe(o, t)}>
                <ObjectShape object={o} images={state.images} hideText={o.id === editing?.id} />
                {tool === "select" && <HitArea object={o} scale={scale} />}
                {tool === "select" && o.kind !== "line" && o.kind !== "arrow" && o.kind !== "ink" && <BoundsHit object={o} />}
              </g>
            ))}
            {tool === "edit-text" &&
              phrases?.map((ph, i) => (
                <rect key={i} x={ph.x - 1} y={ph.y - 1} width={ph.width + 2} height={ph.height + 2} fill={i === hover ? "rgb(38 58 129 / 0.12)" : "none"} stroke="rgb(38 58 129 / 0.55)" strokeWidth={1 / scale} strokeDasharray={`${3 / scale} ${2 / scale}`} className="pointer-events-none" />
              ))}
            {draft && <DraftShape draft={draft} tool={tool} defaults={defaults} scale={scale} />}
          </svg>

          {selected && selectedBox && tool === "select" && !editing && (
            <SelectionFrame
              object={selected}
              box={selectedBox}
              scale={scale}
              onDelete={() => {
                state.change((all) => all.filter((o) => o.id !== selected.id));
                onSelect(null);
              }}
            />
          )}
          {editing && (
            <TextEditor
              key={editing.id}
              object={editing}
              scale={scale}
              onChange={(text) => update(editing.id, (o) => ({ ...o, text }) as EditObject, `text:${editing.id}`)}
              onDone={() => {
                if (editing.kind === "text" && !editing.text.trim()) {
                  state.change((all) => all.filter((o) => o.id !== editing.id));
                  onSelect(null);
                }
                onEdit(null);
                if (!STAYS_ACTIVE.has(tool)) onCreated(editing.id, tool);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function describe(o: EditObject, t: Translator): string {
  switch (o.kind) {
    case "text":
    case "replace":
    case "note":
      return t("{kind}: {text}", { kind: t(KIND_NAMES[o.kind]), text: o.text || t("empty") });
    default:
      return t(KIND_NAMES[o.kind]);
  }
}

/** A transparent box over an object's bounds, so clicking anywhere on it selects it. */
function BoundsHit({ object }: { object: EditObject }) {
  const b = bounds(object, measureText);
  return <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="transparent" />;
}

function DraftShape({ draft, tool, defaults, scale }: { draft: Draft; tool: Tool; defaults: Defaults; scale: number }) {
  const outline = { fill: "none", stroke: "#263a81", strokeWidth: 1 / scale, strokeDasharray: `${4 / scale} ${3 / scale}` };
  switch (draft.kind) {
    case "rect": {
      const { x, y, width, height } = draft.box;
      if (tool === "whiteout") return <rect x={x} y={y} width={width} height={height} {...outline} fill={defaults.whiteout} />;
      const paint = { fill: defaults.fill ?? "none", stroke: defaults.stroke ?? "none", strokeWidth: defaults.strokeWidth, opacity: defaults.opacity };
      return tool === "ellipse" ? <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} {...paint} /> : <rect x={x} y={y} width={width} height={height} {...paint} />;
    }
    case "line":
      return <line x1={draft.x1} y1={draft.y1} x2={draft.x2} y2={draft.y2} stroke={defaults.stroke ?? "#111827"} strokeWidth={defaults.strokeWidth} strokeLinecap="round" opacity={defaults.opacity} />;
    case "ink": {
      const marker = tool === "highlighter";
      const style = marker ? defaults.marker : defaults.pen;
      return <polyline points={draft.points.join(" ")} fill="none" stroke={style.color} strokeWidth={style.width} strokeLinecap={marker ? "square" : "round"} strokeLinejoin="round" opacity={marker ? 0.6 : 1} style={marker ? { mixBlendMode: "multiply" } : undefined} />;
    }
    case "markup":
      return (
        <g fill={tool === "highlight" ? defaults.markup.highlight : "rgb(38 58 129 / 0.2)"} style={{ mixBlendMode: "multiply" }}>
          {draft.rects.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} />
          ))}
        </g>
      );
  }
}

function SelectionFrame({ object, box, scale, onDelete }: { object: EditObject; box: Box; scale: number; onDelete: () => void }) {
  const t = useT();
  const px = (b: Box) => ({ left: b.x * scale - 3, top: b.y * scale - 3, width: b.width * scale + 6, height: b.height * scale + 6 });
  const handle = "absolute size-3.5 rounded-sm border-2 border-surface bg-brand";
  const isLine = object.kind === "line" || object.kind === "arrow";
  const resizable = !isLine && object.kind !== "ink" && object.kind !== "note" && object.kind !== "highlight" && object.kind !== "underline" && object.kind !== "strikeout";
  return (
    <>
      <div className="pointer-events-none absolute rounded-sm border border-dashed border-brand" style={px(box)} aria-hidden="true" />
      {isLine ? (
        (["p1", "p2"] as const).map((end) => (
          <span
            key={end}
            data-handle={end}
            className={clsx(handle, "-translate-1/2 cursor-crosshair rounded-full")}
            style={{ left: (end === "p1" ? object.x1 : object.x2) * scale, top: (end === "p1" ? object.y1 : object.y2) * scale }}
            aria-hidden="true"
          />
        ))
      ) : resizable ? (
        <span data-handle="se" className={clsx(handle, "cursor-nwse-resize")} style={{ left: (box.x + box.width) * scale - 4, top: (box.y + box.height) * scale - 4 }} aria-hidden="true" />
      ) : null}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onDelete}
        aria-label={t("Delete the selected item")}
        className="absolute flex size-6 items-center justify-center rounded-full bg-danger text-white shadow-elev-2"
        style={{ left: (box.x + box.width) * scale - 6, top: box.y * scale - 18 }}
      >
        <X className="size-3.5" />
      </button>
    </>
  );
}

function TextEditor({ object, scale, onChange, onDone }: { object: TextLike; scale: number; onChange: (text: string) => void; onDone: () => void }) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  // Focus without scrolling the page; select an existing line's text so typing replaces it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (object.kind === "replace") el.select();
    // Only when the editor opens (it's keyed by the object's id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lines = object.text.split("\n");
  const width = Math.max(measureText(object), object.size * 4) + object.size;
  return (
    <textarea
      ref={ref}
      value={object.text}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") e.currentTarget.blur();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={object.kind === "replace" ? t("Edit this line of text") : t("Text")}
      spellCheck
      wrap="off"
      className="absolute resize-none overflow-hidden border-0 bg-transparent p-0 outline-1 outline-offset-2 outline-brand outline-dashed"
      style={{
        left: object.x * scale,
        top: object.y * scale,
        width: width * scale,
        height: lines.length * LINE_HEIGHT * object.size * scale + 2,
        fontFamily: CSS_FONTS[object.font],
        fontSize: object.size * scale,
        fontWeight: object.bold ? 700 : 400,
        fontStyle: object.italic ? "italic" : "normal",
        lineHeight: LINE_HEIGHT,
        color: object.color,
        caretColor: object.color,
      }}
    />
  );
}
