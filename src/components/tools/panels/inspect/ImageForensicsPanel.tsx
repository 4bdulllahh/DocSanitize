"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { ImageUp, ScanEye } from "lucide-react";
import { errorMessage } from "@/lib/errors";
import { decodeImage } from "@/lib/image/canvas";
import { inspectImageFile } from "@/lib/scan/client";
import { compareThumbnail, errorLevelAnalysis } from "@/lib/scan/ela";
import type { Finding } from "@/lib/scan/findings";
import type { WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { FidelityNote } from "../shared/ConversionParts";
import { Segmented } from "../shared/controls";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import { Layout, ToolCard, useLoaded } from "../shared/toolkit";
import { FindingList } from "./parts";

interface Visual {
  blob: Blob;
  picture: string;
  ela: string | null;
  thumbnail: string | null;
  thumbnailFinding: Finding | null;
  error?: string;
}

/** The picture, its error-level view and the thumbnail comparison, as object URLs. */
function useVisual(file: WorkspaceFile, thumbnail: Uint8Array | null | undefined) {
  const [visual, setVisual] = useState<Visual | null>(null);
  useEffect(() => {
    if (thumbnail === undefined) return;
    let cancelled = false;
    const urls: string[] = [];
    const url = (blob: Blob) => {
      const u = URL.createObjectURL(blob);
      urls.push(u);
      return u;
    };
    (async () => {
      const bytes = new Uint8Array(await file.file.arrayBuffer());
      const bitmap = await decodeImage(bytes, file.file.type);
      const pictureBlob = await (async () => {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
        return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
      })();
      const ela = await errorLevelAnalysis(bitmap);
      bitmap.close();
      let thumbnailFinding: Finding | null = null;
      if (thumbnail) {
        try {
          // The EXIF thumbnail isn't rotated, so compare it with the picture as stored.
          const stored = await createImageBitmap(file.file, { imageOrientation: "none" });
          const { difference, thumbnailAspect, imageAspect } = await compareThumbnail(stored, thumbnail);
          stored.close();
          const cropped = Math.abs(thumbnailAspect - imageAspect) / imageAspect > 0.08;
          thumbnailFinding =
            difference > 35 || cropped
              ? { id: "thumbnail", severity: "high", title: cropped ? "The thumbnail has a different shape" : "The thumbnail shows a different picture", detail: "The small preview saved inside the file doesn't match the picture, so the picture was cropped or changed after the preview was made. The preview may show what was removed." }
              : difference > 18
                ? { id: "thumbnail", severity: "medium", title: "The thumbnail differs a little", detail: "Colours or details changed after the preview inside the file was made (an edit or a filter)." }
                : { id: "thumbnail", severity: "info", title: "The thumbnail matches the picture" };
        } catch {
          thumbnailFinding = null;
        }
      }
      if (!cancelled) setVisual({ blob: file.file, picture: url(pictureBlob), ela: url(ela), thumbnail: thumbnail ? url(new Blob([thumbnail as BlobPart], { type: "image/jpeg" })) : null, thumbnailFinding });
    })().catch((error) => !cancelled && setVisual({ blob: file.file, picture: "", ela: null, thumbnail: null, thumbnailFinding: null, error: errorMessage(error) }));
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [file.file, file.file.type, thumbnail]);
  return visual?.blob === file.file ? visual : null;
}

export default function ImageForensicsPanel({ file }: ToolPanelProps) {
  const report = useLoaded(file, inspectImageFile);
  const visual = useVisual(file, report?.value?.thumbnail);
  const [view, setView] = useState<"picture" | "ela" | "thumbnail">("ela");

  if (!report) return <PdfLoading label="Reading the image" />;
  if (report.error || !report.value) return <PdfLoadError title="Couldn't read this image" message={report.error ?? ""} code={report.code} />;
  const findings = [...(visual?.thumbnailFinding ? [visual.thumbnailFinding] : []), ...report.value.findings];
  const shown = view === "thumbnail" ? visual?.thumbnail : view === "ela" ? visual?.ela : visual?.picture;

  return (
    <Layout
      main={
        <div className="space-y-4">
          <FindingList title="What the file says about itself" findings={findings} />
          <section className="rounded-xl border border-line bg-surface" aria-label="Picture">
            <div className="border-b border-line px-4 py-2.5">
              <Segmented
                label="Show"
                value={view}
                onChange={setView}
                options={[
                  { id: "picture", label: "Picture" },
                  { id: "ela", label: "Error levels" },
                  { id: "thumbnail", label: "Thumbnail", disabled: !visual?.thumbnail },
                ]}
              />
            </div>
            <div className="flex min-h-72 items-center justify-center bg-surface-muted p-4">
              {visual?.error ? (
                <p className="text-sm text-fg-muted">{visual.error}</p>
              ) : shown ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shown} alt={view === "ela" ? "Error level analysis" : view === "thumbnail" ? "Thumbnail stored in the file" : "The picture"} className={clsx("max-h-[36rem] max-w-full rounded", view === "thumbnail" && "min-w-40")} />
              ) : (
                <div className="h-64 w-full animate-pulse rounded bg-surface" aria-busy="true" />
              )}
            </div>
            {view === "ela" && (
              <p className="border-t border-line px-4 py-3 text-xs text-fg-muted">
                Error level analysis saves the picture again and shows how much each part changed, brighter meaning more. Similar areas (sky, skin, text)
                should look alike; a patch that&apos;s much brighter or darker than its surroundings may have been pasted in or retouched after the last
                save. Edges and fine detail are always brighter, and pictures saved many times look dark all over. It&apos;s a hint, not proof.
              </p>
            )}
          </section>
        </div>
      }
      actions={
        <ToolCard icon={ScanEye} title="Image forensics">
          <FidelityNote>
            Reads what the file records about how it was made and changed, compares its stored thumbnail, and runs an error level analysis. Metadata can be
            removed or faked, so a clean result doesn&apos;t prove a picture is genuine.
          </FidelityNote>
          <p className="mt-4 flex items-center gap-2 text-xs text-fg-subtle">
            <ImageUp className="size-4" aria-hidden="true" />
            Everything is analysed on this device.
          </p>
        </ToolCard>
      }
    />
  );
}
