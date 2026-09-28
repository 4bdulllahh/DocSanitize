"use client";

import { useState, type ChangeEvent, type ReactNode } from "react";
import clsx from "clsx";
import { Bold, Copy, ImagePlus, Italic, Plus, Signature, Trash2 } from "lucide-react";
import { acceptFor } from "@/lib/files";
import type { EditObject, FontFamily, TextStyle } from "@/lib/pdf/edit/types";
import { ColorField, Segmented, Slider } from "../shared/controls";
import { PRIMARY, SECONDARY } from "../shared/OutputCard";
import { SignatureCreator, useSignatures, type SignatureAsset } from "../sign/SignatureCreator";
import { COLORS, MARKER_COLORS, TOOLS_BY_ID, type Defaults, type Tool } from "./model";
import { useT } from "@/store/locale";
import { msg } from "@/i18n/msg";

const FONTS: { id: FontFamily; label: string }[] = [
  { id: "sans", label: msg("Sans") },
  { id: "serif", label: msg("Serif") },
  { id: "mono", label: msg("Mono") },
];

export const KIND_NAMES: Record<EditObject["kind"], string> = {
  text: msg("Text"),
  replace: msg("Edited text"),
  whiteout: msg("White-out"),
  rect: msg("Rectangle"),
  ellipse: msg("Ellipse"),
  line: msg("Line"),
  arrow: msg("Arrow"),
  ink: msg("Drawing"),
  highlight: msg("Highlight"),
  underline: msg("Underline"),
  strikeout: msg("Strikethrough"),
  check: msg("Check mark"),
  cross: msg("Cross"),
  dot: msg("Dot"),
  image: msg("Image"),
  note: msg("Note"),
};

const NONE = "none";
const percent = (v: number) => `${Math.round(v)}%`;
const points = (v: number) => `${v} pt`;

interface Props {
  tool: Tool;
  defaults: Defaults;
  onDefaults: (fn: (d: Defaults) => Defaults) => void;
  selected: EditObject | null;
  /** Change the selected object; changes to the same property in a row merge into one undo step. */
  onPatch: (patch: Partial<EditObject>, key: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onImage: (file: File) => void;
  onSignature: (asset: SignatureAsset) => void;
  /** A note just placed: focus its text. */
  focusNote: boolean;
}

export function Inspector({ tool, defaults, onDefaults, selected, onPatch, onDelete, onDuplicate, onImage, onSignature, focusNote }: Props) {
  const t = useT();
  const target = tool === "select" ? selected : null;
  // The panel shows the tool in hand, or for a selected object the tool that makes it.
  const info = TOOLS_BY_ID[target ? (target.kind === "replace" ? "edit-text" : target.kind === "ink" ? (target.highlighter ? "highlighter" : "pen") : target.kind) : tool];

  return (
    <section className="rounded-xl border border-line bg-surface p-5" aria-label={t("Tool settings")}>
      <h2 className="flex items-center gap-2 font-semibold text-fg">
        <info.icon className="size-4 text-brand-text" aria-hidden="true" />
        {t(target ? KIND_NAMES[target.kind] : info.label)}
      </h2>
      <p className="mt-1 text-sm text-fg-muted">{target ? t("Change how it looks below, drag it on the page, or press Delete.") : t(info.hint)}</p>

      {target ? <ObjectControls object={target} onPatch={onPatch} focusNote={focusNote} /> : <ToolControls tool={tool} defaults={defaults} onDefaults={onDefaults} onImage={onImage} onSignature={onSignature} />}

      {target && (
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onDuplicate} className={SECONDARY} disabled={target.kind === "replace"}>
            <Copy className="size-4" aria-hidden="true" />
            {t("Duplicate")}
          </button>
          <button type="button" onClick={onDelete} className={clsx(SECONDARY, "hover:border-danger/50 hover:text-danger-text")}>
            <Trash2 className="size-4" aria-hidden="true" />
            {target.kind === "replace" ? t("Undo edit") : t("Delete")}
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------- Shared controls

function TextControls({ style, onChange }: { style: TextStyle; onChange: (patch: Partial<TextStyle>) => void }) {
  const t = useT();
  return (
    <>
      <Segmented label={t("Font")} value={style.font} onChange={(font) => onChange({ font })} options={FONTS.map((f) => ({ ...f, label: t(f.label) }))} />
      <Slider label={t("Size")} value={style.size} min={6} max={72} step={0.5} format={points} onChange={(size) => onChange({ size })} />
      <div className="mt-3 flex gap-2" role="group" aria-label={t("Style")}>
        <Toggle pressed={style.bold} onClick={() => onChange({ bold: !style.bold })} label={t("Bold")}>
          <Bold className="size-4" />
        </Toggle>
        <Toggle pressed={style.italic} onClick={() => onChange({ italic: !style.italic })} label={t("Italic")}>
          <Italic className="size-4" />
        </Toggle>
      </div>
      <ColorField label={t("Colour")} value={style.color} onChange={(color) => onChange({ color })} presets={COLORS} />
    </>
  );
}

function Toggle({ pressed, onClick, label, children }: { pressed: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      className={clsx("flex size-9 items-center justify-center rounded-md border", pressed ? "border-brand bg-brand-soft text-brand-text" : "border-line text-fg-muted hover:border-line-strong hover:text-fg")}
    >
      {children}
    </button>
  );
}

/** A colour that can be switched off (shape outline or fill). */
function OptionalColor({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) {
  const t = useT();
  return (
    <div>
      <Segmented
        label={label}
        value={value === null ? NONE : "on"}
        onChange={(v) => onChange(v === NONE ? null : (value ?? COLORS[0].value))}
        options={[
          { id: "on", label: t("Colour") },
          { id: NONE, label: t("None") },
        ]}
      />
      {value !== null && <ColorField label={t("{label} colour", { label })} value={value} onChange={onChange} presets={COLORS} />}
    </div>
  );
}

// ---------------------------------------------------------------------------- Selected object

function ObjectControls({ object, onPatch, focusNote }: { object: EditObject; onPatch: Props["onPatch"]; focusNote: boolean }) {
  const t = useT();
  const patch = (p: Partial<EditObject>) => onPatch(p, `style:${object.id}:${Object.keys(p).join()}`);
  switch (object.kind) {
    case "text":
    case "replace":
      return (
        <>
          {object.kind === "replace" && (
            <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-xs text-fg-muted">
              {t("Was:")} <span className="text-fg">{object.sources.map((s) => s.str).join(" ")}</span>
            </p>
          )}
          <TextControls style={object} onChange={patch} />
        </>
      );
    case "rect":
    case "ellipse":
      return (
        <>
          <OptionalColor label={t("Outline")} value={object.stroke} onChange={(stroke) => patch({ stroke, ...(stroke === null && object.fill === null ? { fill: COLORS[0].value } : {}) })} />
          <OptionalColor label={t("Fill")} value={object.fill} onChange={(fill) => patch({ fill, ...(fill === null && object.stroke === null ? { stroke: COLORS[0].value } : {}) })} />
          {object.stroke && <Slider label={t("Line width")} value={object.strokeWidth} min={0.5} max={12} step={0.5} format={points} onChange={(strokeWidth) => patch({ strokeWidth })} />}
          <Slider label={t("Opacity")} value={object.opacity * 100} min={10} max={100} step={5} format={percent} onChange={(v) => patch({ opacity: v / 100 })} />
        </>
      );
    case "line":
    case "arrow":
      return (
        <>
          <ColorField label={t("Colour")} value={object.color} onChange={(color) => patch({ color })} presets={COLORS} />
          <Slider label={t("Line width")} value={object.strokeWidth} min={0.5} max={12} step={0.5} format={points} onChange={(strokeWidth) => patch({ strokeWidth })} />
          <Slider label={t("Opacity")} value={object.opacity * 100} min={10} max={100} step={5} format={percent} onChange={(v) => patch({ opacity: v / 100 })} />
        </>
      );
    case "ink":
      return (
        <>
          <ColorField label={t("Colour")} value={object.color} onChange={(color) => patch({ color })} presets={object.highlighter ? MARKER_COLORS : COLORS} />
          <Slider label={t("Width")} value={object.strokeWidth} min={0.5} max={object.highlighter ? 30 : 12} step={0.5} format={points} onChange={(strokeWidth) => patch({ strokeWidth })} />
        </>
      );
    case "highlight":
    case "underline":
    case "strikeout":
      return <ColorField label={t("Colour")} value={object.color} onChange={(color) => patch({ color })} presets={object.kind === "highlight" ? MARKER_COLORS : COLORS} />;
    case "check":
    case "cross":
    case "dot":
      return (
        <>
          <ColorField label={t("Colour")} value={object.color} onChange={(color) => patch({ color })} presets={COLORS} />
          <Slider label={t("Size")} value={object.size} min={6} max={60} step={1} format={points} onChange={(size) => patch({ size })} />
        </>
      );
    case "whiteout":
      return <ColorField label={t("Colour")} value={object.color} onChange={(color) => patch({ color })} presets={[{ value: "#ffffff", name: t("White") }, ...COLORS.filter((c) => c.value !== "#ffffff")]} />;
    case "image":
      return <Slider label={t("Opacity")} value={object.opacity * 100} min={10} max={100} step={5} format={percent} onChange={(v) => patch({ opacity: v / 100 })} />;
    case "note":
      return (
        <>
          <label className="mt-4 block text-sm">
            <span className="font-medium text-fg">{t("Note")}</span>
            <textarea
              autoFocus={focusNote}
              value={object.text}
              onChange={(e) => onPatch({ text: e.target.value }, `note:${object.id}`)}
              rows={4}
              placeholder={t("Write a comment…")}
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-fg outline-none focus:border-brand-border"
            />
          </label>
          <ColorField label={t("Colour")} value={object.color} onChange={(color) => patch({ color })} presets={MARKER_COLORS} />
        </>
      );
  }
}

// ---------------------------------------------------------------------------- Tool defaults

function ToolControls({ tool, defaults, onDefaults, onImage, onSignature }: Pick<Props, "tool" | "defaults" | "onDefaults" | "onImage" | "onSignature">) {
  const t = useT();
  const set = (fn: (d: Defaults) => Partial<Defaults>) => onDefaults((d) => ({ ...d, ...fn(d) }));
  switch (tool) {
    case "text":
      return <TextControls style={defaults.text} onChange={(p) => set((d) => ({ text: { ...d.text, ...p } }))} />;
    case "edit-text":
      return <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-xs text-fg-muted">{t("The new text uses a standard font close to the original. Its size, colour and style can be changed after you click a line.")}</p>;
    case "whiteout":
      return <ColorField label={t("Colour")} value={defaults.whiteout} onChange={(whiteout) => set(() => ({ whiteout }))} presets={[{ value: "#ffffff", name: t("White") }, ...COLORS.filter((c) => c.value !== "#ffffff")]} />;
    case "rect":
    case "ellipse":
      return (
        <>
          <OptionalColor label={t("Outline")} value={defaults.stroke} onChange={(stroke) => set((d) => ({ stroke, ...(stroke === null && d.fill === null ? { fill: COLORS[0].value } : {}) }))} />
          <OptionalColor label={t("Fill")} value={defaults.fill} onChange={(fill) => set((d) => ({ fill, ...(fill === null && d.stroke === null ? { stroke: COLORS[0].value } : {}) }))} />
          <Slider label={t("Line width")} value={defaults.strokeWidth} min={0.5} max={12} step={0.5} format={points} onChange={(strokeWidth) => set(() => ({ strokeWidth }))} />
          <Slider label={t("Opacity")} value={defaults.opacity * 100} min={10} max={100} step={5} format={percent} onChange={(v) => set(() => ({ opacity: v / 100 }))} />
        </>
      );
    case "line":
    case "arrow":
      return (
        <>
          <ColorField label={t("Colour")} value={defaults.stroke ?? COLORS[0].value} onChange={(stroke) => set(() => ({ stroke }))} presets={COLORS} />
          <Slider label={t("Line width")} value={defaults.strokeWidth} min={0.5} max={12} step={0.5} format={points} onChange={(strokeWidth) => set(() => ({ strokeWidth }))} />
          <Slider label={t("Opacity")} value={defaults.opacity * 100} min={10} max={100} step={5} format={percent} onChange={(v) => set(() => ({ opacity: v / 100 }))} />
        </>
      );
    case "pen":
    case "highlighter": {
      const key = tool === "pen" ? "pen" : "marker";
      const style = defaults[key];
      return (
        <>
          <ColorField label={t("Colour")} value={style.color} onChange={(color) => set((d) => ({ [key]: { ...d[key], color } }))} presets={tool === "pen" ? COLORS : MARKER_COLORS} />
          <Slider label={t("Width")} value={style.width} min={0.5} max={tool === "pen" ? 12 : 30} step={0.5} format={points} onChange={(width) => set((d) => ({ [key]: { ...d[key], width } }))} />
        </>
      );
    }
    case "highlight":
    case "underline":
    case "strikeout":
      return <ColorField label={t("Colour")} value={defaults.markup[tool]} onChange={(color) => set((d) => ({ markup: { ...d.markup, [tool]: color } }))} presets={tool === "highlight" ? MARKER_COLORS : COLORS} />;
    case "check":
    case "cross":
    case "dot":
      return (
        <>
          <ColorField label={t("Colour")} value={defaults.mark.color} onChange={(color) => set((d) => ({ mark: { ...d.mark, color } }))} presets={COLORS} />
          <Slider label={t("Size")} value={defaults.mark.size} min={6} max={60} step={1} format={points} onChange={(size) => set((d) => ({ mark: { ...d.mark, size } }))} />
        </>
      );
    case "note":
      return <ColorField label={t("Colour")} value={defaults.note} onChange={(note) => set(() => ({ note }))} presets={MARKER_COLORS} />;
    case "image":
      return <ImagePicker onImage={onImage} />;
    case "sign":
      return <Signatures onPlace={onSignature} />;
    default:
      return null;
  }
}

function ImagePicker({ onImage }: { onImage: (file: File) => void }) {
  const t = useT();
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onImage(file);
  };
  return (
    <label className={clsx(PRIMARY, "mt-4 w-full cursor-pointer")}>
      <ImagePlus className="size-4" aria-hidden="true" />
      {t("Choose an image")}
      <input type="file" accept={acceptFor(["image"])} onChange={choose} className="sr-only" />
    </label>
  );
}

function Signatures({ onPlace }: { onPlace: (asset: SignatureAsset) => void }) {
  const t = useT();
  const { assets, add, remove } = useSignatures();
  const [creating, setCreating] = useState(assets.length === 0);
  return (
    <div>
      {assets.length > 0 && (
        <ul className="mt-4 space-y-2" aria-label={t("Your signatures")}>
          {assets.map((asset, i) => (
            <li key={asset.id} className="flex items-center gap-2 rounded-lg border border-line p-2">
              <span className="flex h-12 flex-1 items-center justify-center rounded bg-white px-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                <img src={asset.url} alt={t("Signature {n}", { n: i + 1 })} className="max-h-10 max-w-full object-contain" />
              </span>
              <button type="button" onClick={() => onPlace(asset)} className={clsx(PRIMARY, "px-3 py-2")} aria-label={t("Place signature {n}", { n: i + 1 })}>
                <Plus className="size-4" aria-hidden="true" />
                {t("Place")}
              </button>
              <button type="button" onClick={() => remove(asset.id)} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg" aria-label={t("Delete signature {n}", { n: i + 1 })}>
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
              onPlace(asset);
            }
          }}
        />
      ) : (
        <button type="button" onClick={() => setCreating(true)} className={clsx(SECONDARY, "mt-3 w-full")}>
          <Signature className="size-4" aria-hidden="true" />
          {assets.length ? t("Create another signature") : t("Create a signature")}
        </button>
      )}
    </div>
  );
}
