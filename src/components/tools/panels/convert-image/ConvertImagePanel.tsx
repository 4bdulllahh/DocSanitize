"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import { CircleAlert, ImageDown, ImageOff, LoaderCircle } from "lucide-react";
import { useImageSource } from "@/hooks/useImageSource";
import { errorMessage } from "@/lib/errors";
import { formatBytes } from "@/lib/files";
import { convertImage, type ImageFormat } from "@/lib/image/convert";
import { replaceExtension } from "@/lib/zip";
import { toast } from "@/store/toast";
import type { WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { FidelityNote } from "../shared/ConversionParts";
import { Segmented, Slider } from "../shared/controls";
import { OutputCard, PRIMARY, type OutputFile } from "../shared/OutputCard";
import { useT } from "@/store/locale";

const FORMATS: { id: ImageFormat; label: string }[] = [
  { id: "jpeg", label: "JPG" },
  { id: "png", label: "PNG" },
];

/** Converts every open image (HEIC, AVIF, WebP, PNG, JPG) to JPG or PNG. */
export default function ConvertImagePanel({ files }: ToolPanelProps) {
  const t = useT();
  const [format, setFormat] = useState<ImageFormat>("jpeg");
  const [quality, setQuality] = useState(90);
  const [progress, setProgress] = useState<number | null>(null);
  const [outputs, setOutputs] = useState<OutputFile[] | null>(null);
  const [failures, setFailures] = useState<Record<string, string>>({});

  const change =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setOutputs(null);
    };

  const convert = async () => {
    setOutputs(null);
    setFailures({});
    const done: OutputFile[] = [];
    const failed: Record<string, string> = {};
    for (const [i, f] of files.entries()) {
      setProgress(i);
      try {
        const { bytes, width, height } = await convertImage(new Uint8Array(await f.file.arrayBuffer()), f.mimeType, format, quality / 100);
        done.push({
          name: replaceExtension(f.name, format === "jpeg" ? ".jpg" : ".png"),
          blob: new Blob([bytes as BlobPart], { type: `image/${format}` }),
          detail: `${width} × ${height}`,
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
      toast({
        tone: done.length ? "warning" : "error",
        title: t.plural(failedCount, "{n} image couldn't be converted", "{n} images couldn't be converted"),
        description: Object.values(failed)[0],
      });
    }
  };

  const busy = progress !== null;
  const label = format === "jpeg" ? "JPG" : "PNG";

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
            <ImageDown className="size-4 text-brand-text" aria-hidden="true" />
            {t("Convert")}
          </h2>
          <Segmented label={t("Format")} value={format} onChange={change(setFormat)} options={FORMATS} />
          {format === "jpeg" ? (
            <Slider label={t("Quality")} value={quality} min={50} max={100} step={5} format={(v) => `${v}%`} onChange={change(setQuality)} />
          ) : (
            <p className="mt-3 text-xs text-fg-subtle">{t("PNG is lossless and keeps transparency, but files are much larger.")}</p>
          )}
          <FidelityNote>
            {t("Photos are turned the right way up. Location, camera and date details aren't copied to the new files; only the colour profile is kept, so colours look the same.")}
          </FidelityNote>
          <button type="button" onClick={convert} disabled={busy || files.length === 0} className={clsx(PRIMARY, "mt-4 w-full")}>
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ImageDown className="size-4" aria-hidden="true" />}
            {busy ? t("Converting {done} of {count}…", { done: progress + 1, count: files.length }) : files.length === 1 ? t("Convert to {format}", { format: label }) : t("Convert {count} images to {format}", { count: files.length, format: label })}
          </button>
        </section>
        {outputs && (
          <OutputCard
            title={t.plural(outputs.length, "{n} image converted to {format}", "{n} images converted to {format}", { format: label })}
            outputs={outputs}
            zipName={`images-${label.toLowerCase()}.zip`}
            replaceFileId={outputs.length === 1 && files.length === 1 ? files[0].id : undefined}
          />
        )}
      </div>
    </div>
  );
}

export function ImageRow({ file, working, error }: { file: WorkspaceFile; working: boolean; error?: string }) {
  const t = useT();
  const imgRef = useRef<HTMLImageElement>(null);
  const [unreadable, setUnreadable] = useState(false);
  useImageSource(imgRef, file.file, () => setUnreadable(true));
  const extension = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1).toUpperCase() : "Image";

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-muted" aria-hidden="true">
        {unreadable ? (
          <ImageOff className="size-4 text-fg-subtle" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- local blob URL, nothing to optimize
          <img ref={imgRef} alt="" className="max-h-full max-w-full object-contain" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{file.name}</p>
        {error ? (
          <p className="inline-flex items-center gap-1 text-xs text-danger-text">
            <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : (
          <p className="text-xs text-fg-subtle">
            {extension} · {formatBytes(file.size)}
          </p>
        )}
      </div>
      {working && <LoaderCircle className="size-4 animate-spin text-fg-subtle" aria-label={t("Converting")} />}
    </li>
  );
}
