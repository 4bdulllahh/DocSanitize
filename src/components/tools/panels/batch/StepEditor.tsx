"use client";

import type { ReactNode } from "react";
import { AUDIO_TARGETS, type AudioTarget } from "@/lib/media/jobs";
import { OCR_LANGUAGES } from "@/lib/ocr/languages";
import type { Anchor } from "@/lib/pdf/anchor";
import { PAGE_SIZES, type PageSizeName } from "@/lib/pdf/pages";
import type { BatchStep, StepOf } from "@/lib/batch/steps";
import { useCertificateStore } from "@/store/certificate";
import { AnchorPicker, ColorField, Field, INPUT, Segmented, Slider } from "../shared/controls";

const COLORS = [
  { value: "#6b7280", name: "Grey" },
  { value: "#b91c1c", name: "Red" },
  { value: "#263a81", name: "Navy" },
  { value: "#111111", name: "Black" },
];
const EDGES: Anchor[] = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"];
const CORNERS: Anchor[] = ["top-left", "top-right", "bottom-left", "bottom-center", "bottom-right"];
const MAX_OCR_LANGUAGES = 3;

function Check({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="mt-4 flex cursor-pointer items-start gap-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-brand" />
      <span>
        <span className="block text-sm font-medium text-fg">{label}</span>
        {hint && <span className="block text-xs text-fg-muted">{hint}</span>}
      </span>
    </label>
  );
}

function NumberField({ label, value, min, max, onChange, hint }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" inputMode="numeric" min={min} max={max} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(e.target.valueAsNumber)} className={INPUT} />
    </Field>
  );
}

const Two = ({ children }: { children: ReactNode }) => <div className="grid gap-x-3 sm:grid-cols-2">{children}</div>;

/** The settings of one step. */
export function StepEditor({ step, onChange }: { step: BatchStep; onChange: (step: BatchStep) => void }) {
  // Each editor gets a setter typed for its own step.
  const set = <T extends BatchStep>(s: T) => (patch: Partial<T>) => onChange({ ...s, ...patch });
  switch (step.type) {
    case "sanitize":
      return <Check label="Keep technical photo data" hint="Exposure, lens and colour profile stay; location, device, names and dates go. PDFs are always cleaned completely." checked={step.keepTechnical} onChange={(keepTechnical) => set(step)({ keepTechnical })} />;
    case "to-pdf":
      return <ToPdf step={step} set={set(step)} />;
    case "rotate":
      return <Segmented label="Turn every page" value={String(step.angle) as "90" | "180" | "270"} options={[{ id: "90", label: "90° right" }, { id: "180", label: "180°" }, { id: "270", label: "90° left" }]} onChange={(v) => set(step)({ angle: Number(v) as 90 | 180 | 270 })} />;
    case "delete-pages":
      return (
        <Field label="Pages to delete" hint="Such as 1 (the first page), 1-2, or -1 (the last page). Pages a file doesn't have are ignored.">
          <input value={step.pages} onChange={(e) => set(step)({ pages: e.target.value })} className={INPUT} />
        </Field>
      );
    case "resize":
      return (
        <Field label="Page size" hint="Each page keeps its orientation; its content is scaled to fit.">
          <select value={step.size} onChange={(e) => set(step)({ size: e.target.value as PageSizeName })} className={INPUT}>
            {(Object.keys(PAGE_SIZES) as PageSizeName[]).map((s) => (
              <option key={s} value={s}>
                {PAGE_SIZES[s].label}
              </option>
            ))}
          </select>
        </Field>
      );
    case "watermark":
      return <Watermark step={step} set={set(step)} />;
    case "page-numbers":
      return (
        <>
          <Two>
            <Field label="Format" hint="{n} is the number, {total} the last one.">
              <input value={step.format} onChange={(e) => set(step)({ format: e.target.value })} className={INPUT} />
            </Field>
            <NumberField label="First number" min={0} max={99999} value={step.start} onChange={(start) => set(step)({ start })} />
          </Two>
          <AnchorPicker label="Position" value={step.position} allowed={EDGES} onChange={(position) => set(step)({ position })} />
        </>
      );
    case "header-footer":
      return (
        <>
          <Two>
            <Field label="Header">
              <input value={step.header} onChange={(e) => set(step)({ header: e.target.value })} className={INPUT} />
            </Field>
            <Field label="Footer">
              <input value={step.footer} onChange={(e) => set(step)({ footer: e.target.value })} className={INPUT} />
            </Field>
          </Two>
          <p className="mt-1 text-xs text-fg-subtle">Use {"{file}"} for the file name, {"{date}"} for today, {"{page}"} and {"{pages}"} for page numbers.</p>
          <Segmented label="Alignment" value={step.align} options={[{ id: "left", label: "Left" }, { id: "center", label: "Centre" }, { id: "right", label: "Right" }]} onChange={(align) => set(step)({ align })} />
        </>
      );
    case "bates":
      return (
        <>
          <Two>
            <Field label="Prefix" hint="Such as a case or client code.">
              <input value={step.prefix} onChange={(e) => set(step)({ prefix: e.target.value })} className={INPUT} />
            </Field>
            <NumberField label="First number" min={0} max={999999999} value={step.start} onChange={(start) => set(step)({ start })} />
          </Two>
          <NumberField label="Digits" min={1} max={12} value={step.digits} onChange={(digits) => set(step)({ digits })} hint="Numbers are padded with zeros, such as 000001." />
          <AnchorPicker label="Position" value={step.position} allowed={EDGES} onChange={(position) => set(step)({ position })} />
          <p className="mt-2 text-xs text-fg-subtle">Numbering runs on from one file to the next, in tab order.</p>
        </>
      );
    case "grayscale":
      return <p className="mt-3 text-sm text-fg-muted">Colours in text, drawings and pictures become shades of grey.</p>;
    case "flatten":
      return (
        <>
          <Check label="Form fields" hint="Their current values become part of the page." checked={step.forms} onChange={(forms) => set(step)({ forms })} />
          <Check label="Comments and markup" hint="Highlights, notes and stamps. Links keep working." checked={step.annotations} onChange={(annotations) => set(step)({ annotations })} />
        </>
      );
    case "compress":
      return (
        <Segmented
          label="How much"
          hint={{ light: "Pictures at 200 dpi, barely visible changes.", balanced: "Pictures at 150 dpi: good for screens and printing.", strong: "Pictures at 100 dpi: smallest, for screens." }[step.preset]}
          value={step.preset}
          options={[
            { id: "light", label: "Light" },
            { id: "balanced", label: "Balanced" },
            { id: "strong", label: "Strong" },
          ]}
          onChange={(preset) => set(step)({ preset })}
        />
      );
    case "ocr":
      return <Ocr step={step} set={set(step)} />;
    case "merge":
      return (
        <Field label="Name of the combined PDF" hint="PDFs are joined in the order of their tabs; drag the tabs to change it.">
          <input value={step.name} onChange={(e) => set(step)({ name: e.target.value })} className={INPUT} />
        </Field>
      );
    case "protect":
      return (
        <>
          <Field label="Password to open" hint="The same password for every file. It isn't saved with the list of steps.">
            <input type="password" autoComplete="new-password" value={step.password} onChange={(e) => set(step)({ password: e.target.value })} className={INPUT} />
          </Field>
          <Check label="Allow printing" checked={step.allowPrinting} onChange={(allowPrinting) => set(step)({ allowPrinting })} />
          <Check label="Allow copying text" checked={step.allowCopying} onChange={(allowCopying) => set(step)({ allowCopying })} />
          <Check label="Allow changes" checked={step.allowModifying} onChange={(allowModifying) => set(step)({ allowModifying })} />
        </>
      );
    case "sign":
      return <Sign step={step} set={set(step)} />;
    case "convert-image":
      return (
        <>
          <Segmented label="Format" value={step.format} options={[{ id: "jpeg", label: "JPG" }, { id: "png", label: "PNG" }, { id: "webp", label: "WebP" }]} onChange={(format) => set(step)({ format })} />
          {step.format !== "png" && <Slider label="Quality" value={Math.round(step.quality * 100)} min={40} max={100} format={(v) => `${v}%`} onChange={(v) => set(step)({ quality: v / 100 })} />}
          <Field label="Longest side, in pixels (optional)" hint="Larger pictures are made smaller; smaller ones stay as they are.">
            <input type="number" inputMode="numeric" min={16} max={16384} value={step.maxSide ?? ""} placeholder="Keep the size" onChange={(e) => set(step)({ maxSide: Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : null })} className={INPUT} />
          </Field>
        </>
      );
    case "clean-media":
      return <Check label="Keep cover art" hint="Album art or a cover picture inside the file." checked={step.keepCover} onChange={(keepCover) => set(step)({ keepCover })} />;
    case "convert-audio":
      return <Audio step={step} set={set(step)} />;
  }
}

type Setter<T extends BatchStep> = (patch: Partial<T>) => void;

function ToPdf({ step, set }: { step: StepOf<"to-pdf">; set: Setter<StepOf<"to-pdf">> }) {
  return (
    <>
      <Segmented label="Page size" value={step.pageSize} options={[{ id: "a4", label: "A4" }, { id: "letter", label: "Letter" }]} onChange={(pageSize) => set({ pageSize })} />
      <Segmented
        label="Photos"
        value={step.photoPages}
        options={[
          { id: "fit", label: "Page the size of the photo" },
          { id: "page", label: "On the page size" },
        ]}
        onChange={(photoPages) => set({ photoPages })}
      />
      <p className="mt-2 text-xs text-fg-subtle">Word, Excel, PowerPoint, text, Markdown and HTML files are laid out as their own tools do (every visible sheet, every shown slide).</p>
    </>
  );
}

function Watermark({ step, set }: { step: StepOf<"watermark">; set: Setter<StepOf<"watermark">> }) {
  return (
    <>
      <Field label="Text">
        <input value={step.text} onChange={(e) => set({ text: e.target.value })} className={INPUT} />
      </Field>
      <ColorField label="Colour" value={step.color} presets={COLORS} onChange={(color) => set({ color })} />
      <Slider label="Size" value={step.size} min={12} max={144} format={(v) => `${v} pt`} onChange={(size) => set({ size })} />
      <Slider label="Opacity" value={Math.round(step.opacity * 100)} min={5} max={100} format={(v) => `${v}%`} onChange={(v) => set({ opacity: v / 100 })} />
      <Segmented label="Angle" value={String(step.angle) as "0" | "45" | "90"} options={[{ id: "0", label: "0°" }, { id: "45", label: "45°" }, { id: "90", label: "90°" }]} onChange={(v) => set({ angle: Number(v) })} />
      <Segmented label="Placement" value={step.position} options={[{ id: "center", label: "Once, centred" }, { id: "tile", label: "Tiled" }]} onChange={(position) => set({ position })} />
      <Check label="Behind the page content" hint="Text and pictures stay on top; hidden by pages with a solid background." checked={step.behind} onChange={(behind) => set({ behind })} />
    </>
  );
}

function Ocr({ step, set }: { step: StepOf<"ocr">; set: Setter<StepOf<"ocr">> }) {
  const toggle = (code: string) => set({ languages: step.languages.includes(code) ? step.languages.filter((c) => c !== code) : [...step.languages, code] });
  return (
    <>
      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-fg">Languages in the documents (up to {MAX_OCR_LANGUAGES})</legend>
        <div className="mt-1.5 grid max-h-44 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-3">
          {OCR_LANGUAGES.map((l) => (
            <label key={l.code} className="flex items-center gap-2 text-sm text-fg">
              <input type="checkbox" checked={step.languages.includes(l.code)} disabled={!step.languages.includes(l.code) && step.languages.length >= MAX_OCR_LANGUAGES} onChange={() => toggle(l.code)} className="size-3.5 accent-brand" />
              {l.name}
            </label>
          ))}
        </div>
      </fieldset>
      <Check label="Skip pages that already have text" checked={step.skipText} onChange={(skipText) => set({ skipText })} />
      <p className="mt-2 text-xs text-fg-subtle">The OCR engine and each language are downloaded from this site the first time (a few MB), then work offline.</p>
    </>
  );
}

function Sign({ step, set }: { step: StepOf<"sign">; set: Setter<StepOf<"sign">> }) {
  const certificate = useCertificateStore((s) => s.current);
  return (
    <>
      <p className="mt-3 text-sm text-fg-muted">{certificate ? `Signing as ${certificate.identity.name}.` : "Open or create a certificate in the “Your certificate” card."}</p>
      <Two>
        <Field label="Reason (optional)">
          <input value={step.reason} onChange={(e) => set({ reason: e.target.value })} className={INPUT} />
        </Field>
        <Field label="Location (optional)">
          <input value={step.location} onChange={(e) => set({ location: e.target.value })} className={INPUT} />
        </Field>
      </Two>
      <Segmented label="Signature" value={step.visible ? "box" : "invisible"} options={[{ id: "invisible", label: "Invisible" }, { id: "box", label: "Box on the last page" }]} onChange={(v) => set({ visible: v === "box" })} />
      {step.visible && <AnchorPicker label="Corner" value={step.anchor} allowed={CORNERS} onChange={(anchor) => set({ anchor })} />}
      <Segmented
        label="Type"
        columns={2}
        value={String(step.certify) as "0" | "1" | "2" | "3"}
        options={[
          { id: "0", label: "Sign" },
          { id: "1", label: "Certify: no changes" },
          { id: "2", label: "Certify: forms, signing" },
          { id: "3", label: "Certify: also comments" },
        ]}
        onChange={(v) => set({ certify: Number(v) as 0 | 1 | 2 | 3 })}
      />
      <p className="mt-2 text-xs text-fg-subtle">Must be the last step for PDFs: any later change would break the signature.</p>
    </>
  );
}

function Audio({ step, set }: { step: StepOf<"convert-audio">; set: Setter<StepOf<"convert-audio">> }) {
  const target = AUDIO_TARGETS[step.target];
  return (
    <>
      <Segmented
        label="Format"
        columns={3}
        value={step.target}
        options={(Object.keys(AUDIO_TARGETS) as AudioTarget[]).map((t) => ({ id: t, label: t.toUpperCase() }))}
        onChange={(t) => set({ target: t, bitrate: AUDIO_TARGETS[t].bitrate })}
      />
      {!target.lossless && (
        <Field label="Quality">
          <select value={step.bitrate} onChange={(e) => set({ bitrate: Number(e.target.value) })} className={INPUT}>
            {target.bitrates.map((b) => (
              <option key={b} value={b}>
                {b} kbps
              </option>
            ))}
          </select>
        </Field>
      )}
      <Check label="Even out the loudness" hint="Brings quiet and loud recordings to the same level." checked={step.normalize} onChange={(normalize) => set({ normalize })} />
      <p className="mt-2 text-xs text-fg-subtle">Videos keep only their sound. The audio engine is downloaded from this site the first time (31 MB), then works offline.</p>
    </>
  );
}
