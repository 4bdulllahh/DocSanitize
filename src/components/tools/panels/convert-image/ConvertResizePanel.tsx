"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { ImageUpscale, LoaderCircle } from "lucide-react";
import { errorMessage } from "@/lib/errors";
import { canEncode, convertImageTo, ICON_SIZES, OPAQUE_FORMATS, TARGET_TYPES, type TargetFormat } from "@/lib/image/convert";
import type { ResizeMode } from "@/lib/image/formats";
import { replaceExtension } from "@/lib/zip";
import { toast } from "@/store/toast";
import type { ToolPanelProps } from "../registry";
import { FidelityNote } from "../shared/ConversionParts";
import { ColorField, Field, INPUT, Segmented, Slider } from "../shared/controls";
import { OutputCard, PRIMARY, type OutputFile } from "../shared/OutputCard";
import { ImageRow } from "./ConvertImagePanel";
import { useT } from "@/store/locale";

const FORMATS: TargetFormat[] = ["jpeg", "png", "webp", "avif", "bmp", "tiff", "ico"];
const LOSSY = new Set<TargetFormat>(["jpeg", "webp", "avif"]);

type ResizeKind = ResizeMode["mode"];

/** Converts every open image to another format, optionally resized. */
export default function ConvertResizePanel({ files }: ToolPanelProps) {
  const t = useT();
  const [format, setFormat] = useState<TargetFormat>("webp");
  const [supported, setSupported] = useState<Record<string, boolean>>({});
  const [quality, setQuality] = useState(85);
  const [resize, setResize] = useState<ResizeKind>("none");
  const [percent, setPercent] = useState(50);
  const [width, setWidth] = useState("1920");
  const [height, setHeight] = useState("1080");
  const [keepTransparency, setKeepTransparency] = useState(true);
  const [background, setBackground] = useState("#ffffff");
  const [iconSizes, setIconSizes] = useState<number[]>([16, 32, 48, 256]);
  const [progress, setProgress] = useState<number | null>(null);
  const [outputs, setOutputs] = useState<OutputFile[] | null>(null);
  const [failures, setFailures] = useState<Record<string, string>>({});

  // WebP and AVIF writing depends on the browser.
  useEffect(() => {
    let active = true;
    Promise.all(["webp", "avif"].map(async (f) => [f, await canEncode(TARGET_TYPES[f as TargetFormat].mime)] as const)).then((entries) => {
      if (active) setSupported(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, []);
  const available = FORMATS.filter((f) => supported[f] !== false);
  const chosen = available.includes(format) ? format : "png";

  const change =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setOutputs(null);
    };

  const resizeMode = (): ResizeMode => {
    const [w, h] = [Number(width) || 0, Number(height) || 0];
    if (resize === "percent") return { mode: "percent", percent };
    if (resize === "fit") return { mode: "fit", width: w, height: h };
    if (resize === "exact") return { mode: "exact", width: w, height: h };
    return { mode: "none" };
  };
  const sizeInvalid = (resize === "fit" && !Number(width) && !Number(height)) || (resize === "exact" && (!Number(width) || !Number(height)));
  const opaque = OPAQUE_FORMATS.has(chosen);
  const label = TARGET_TYPES[chosen].label;

  const convert = async () => {
    setOutputs(null);
    setFailures({});
    const done: OutputFile[] = [];
    const failed: Record<string, string> = {};
    for (const [i, f] of files.entries()) {
      setProgress(i);
      try {
        const result = await convertImageTo(new Uint8Array(await f.file.arrayBuffer()), f.mimeType, {
          format: chosen,
          quality: quality / 100,
          resize: resizeMode(),
          background: opaque || !keepTransparency ? background : null,
          iconSizes,
        });
        done.push({
          name: replaceExtension(f.name, TARGET_TYPES[chosen].extension),
          blob: new Blob([result.bytes as BlobPart], { type: TARGET_TYPES[chosen].mime }),
          detail: chosen === "ico" ? t.plural(iconSizes.length, "{n} size, up to {width} px", "{n} sizes, up to {width} px", { width: result.width }) : `${result.width} × ${result.height}`,
        });
      } catch (error) {
        failed[f.id] = errorMessage(error);
      }
    }
    setProgress(null);
    setFailures(failed);
    if (done.length) setOutputs(done);
    const failedCount = Object.keys(failed).length;
    if (failedCount) {
      toast({ tone: done.length ? "warning" : "error", title: t.plural(failedCount, "{n} image couldn't be converted", "{n} images couldn't be converted"), description: Object.values(failed)[0] });
    }
  };

  const busy = progress !== null;
  const toggleIcon = (size: number) => change(setIconSizes)(iconSizes.includes(size) ? iconSizes.filter((s) => s !== size) : [...iconSizes, size].sort((a, b) => a - b));

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="min-w-0 rounded-xl border border-line bg-surface" aria-label={t("Images to convert")}>
        <header className="border-b border-line px-5 py-4">
          <h2 className="font-semibold text-fg">
            {t.plural(files.length, "{n} image", "{n} images")}
          </h2>
          <p className="mt-0.5 text-sm text-fg-muted">{t("Every open image is converted. Add more by dropping them anywhere.")}</p>
        </header>
        <ul className="divide-y divide-line">
          {files.map((f, i) => (
            <ImageRow key={`${f.id}:${f.revision}`} file={f} working={progress === i} error={failures[f.id]} />
          ))}
        </ul>
      </section>

      <div className="order-first space-y-4 lg:sticky lg:top-20 lg:order-0">
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-semibold text-fg">
            <ImageUpscale className="size-4 text-brand-text" aria-hidden="true" />
            {t("Convert & resize")}
          </h2>
          <Field label={t("Format")}>
            <select value={chosen} onChange={(e) => change(setFormat)(e.target.value as TargetFormat)} className={INPUT}>
              {available.map((f) => (
                <option key={f} value={f}>
                  {TARGET_TYPES[f].label}
                  {f === "png" ? t(" (lossless)") : f === "ico" ? t(" (icon)") : ""}
                </option>
              ))}
            </select>
          </Field>
          {LOSSY.has(chosen) && <Slider label={t("Quality")} value={quality} min={40} max={100} step={5} format={(v) => `${v}%`} onChange={change(setQuality)} />}

          {chosen === "ico" ? (
            <fieldset className="mt-4">
              <legend className="text-sm font-medium text-fg">{t("Icon sizes")}</legend>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {ICON_SIZES.map((size) => (
                  <label key={size} className={clsx("flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs tabular-nums", iconSizes.includes(size) ? "border-brand-border bg-brand-soft text-fg" : "border-line text-fg-muted")}>
                    <input type="checkbox" checked={iconSizes.includes(size)} onChange={() => toggleIcon(size)} className="size-3.5 accent-brand" />
                    {size}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-fg-subtle">{t("Non-square pictures are centred on a transparent square.")}</p>
            </fieldset>
          ) : (
            <>
              <Segmented
                label={t("Size")}
                value={resize}
                onChange={change(setResize)}
                options={[
                  { id: "none", label: t("Keep") },
                  { id: "percent", label: t("Scale") },
                  { id: "fit", label: t("Fit") },
                  { id: "exact", label: t("Exact") },
                ]}
              />
              {resize === "percent" && <Slider label={t("Scale")} value={percent} min={5} max={200} step={5} format={(v) => `${v}%`} onChange={change(setPercent)} />}
              {(resize === "fit" || resize === "exact") && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("Width (px)")}>
                    <input inputMode="numeric" value={width} onChange={(e) => change(setWidth)(e.target.value.replace(/\D/g, ""))} className={INPUT} />
                  </Field>
                  <Field label={t("Height (px)")}>
                    <input inputMode="numeric" value={height} onChange={(e) => change(setHeight)(e.target.value.replace(/\D/g, ""))} className={INPUT} />
                  </Field>
                </div>
              )}
              {resize === "fit" && <p className="mt-1.5 text-xs text-fg-subtle">{t("Shrinks to fit inside the box, keeping proportions; smaller images stay as they are. Leave one side empty to fit the other.")}</p>}
              {resize === "exact" && <p className="mt-1.5 text-xs text-fg-subtle">{t("Stretches to exactly this size.")}</p>}
            </>
          )}

          {!opaque && (
            <label className="mt-4 flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={keepTransparency} onChange={(e) => change(setKeepTransparency)(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-brand" />
              <span>
                <span className="block text-sm font-medium text-fg">{t("Keep transparency")}</span>
                <span className="block text-xs text-fg-muted">{t("Off: transparent areas are filled with the background colour.")}</span>
              </span>
            </label>
          )}
          {(opaque || !keepTransparency) && (
            <ColorField
              label={t("Background")}
              value={background}
              onChange={change(setBackground)}
              presets={[
                { value: "#ffffff", name: t("White") },
                { value: "#000000", name: t("Black") },
              ]}
            />
          )}
          <FidelityNote>{t("Photos are turned the right way up. Location, camera and date details aren't copied to the new files.")}</FidelityNote>
          <button type="button" onClick={convert} disabled={busy || files.length === 0 || (chosen === "ico" ? iconSizes.length === 0 : sizeInvalid)} className={clsx(PRIMARY, "mt-4 w-full")}>
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ImageUpscale className="size-4" aria-hidden="true" />}
            {busy ? t("Converting {done} of {count}…", { done: progress + 1, count: files.length }) : files.length === 1 ? t("Convert to {format}", { format: label }) : t("Convert {count} images to {format}", { count: files.length, format: label })}
          </button>
        </section>
        {outputs && (
          <OutputCard
            title={t.plural(outputs.length, "{n} image converted to {format}", "{n} images converted to {format}", { format: label })}
            outputs={outputs}
            zipName={`images-${label.toLowerCase()}.zip`}
            replaceFileId={outputs.length === 1 && files.length === 1 && chosen !== "tiff" && chosen !== "bmp" && chosen !== "ico" ? files[0].id : undefined}
          />
        )}
      </div>
    </div>
  );
}
