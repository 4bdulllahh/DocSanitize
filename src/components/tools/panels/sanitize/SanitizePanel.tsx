"use client";

import { useState } from "react";
import clsx from "clsx";
import { ArrowRight, Download, Eraser, Layers, LoaderCircle, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { FilePreview } from "@/components/workspace/FilePreview";
import { msg } from "@/i18n/msg";
import { downloadBlob } from "@/lib/download";
import { formatBytes } from "@/lib/files";
import { stripFile } from "@/lib/metadata/client";
import { DEFAULT_STRIP_OPTIONS, type StripOptions } from "@/lib/metadata/types";
import { zipFiles } from "@/lib/zip";
import { useT } from "@/store/locale";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { Segmented } from "../shared/controls";
import { AuditCard } from "./AuditCard";
import { useAudit, type AuditState } from "./useAudit";

/** "photo.jpg" -> "photo-clean.jpg" */
function cleanName(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}-clean${name.slice(dot)}` : `${name}-clean`;
}

async function sanitize(target: WorkspaceFile, options: StripOptions) {
  const { updateFile } = useWorkspaceStore.getState();
  updateFile(target.id, { status: "processing", error: undefined });
  try {
    const { bytes } = await stripFile(target.file, options);
    const blob = new Blob([bytes as BlobPart], { type: target.mimeType });
    // Technical data is only ever kept in images; PDFs are always stripped completely.
    const keptTechnical = options.keepTechnical && target.kind === "image";
    updateFile(target.id, { status: "done", output: { blob, name: cleanName(target.name), keptTechnical } });
  } catch (error) {
    const message = error instanceof Error ? error.message : msg("Couldn't sanitize this file.");
    updateFile(target.id, { status: "error", error: message });
    throw error;
  }
}

export default function SanitizePanel({ file, files }: ToolPanelProps) {
  const [options, setOptions] = useState<StripOptions>(DEFAULT_STRIP_OPTIONS);
  const audit = useAudit(file.file)!;
  const verification = useAudit(file.output?.blob);

  const run = async () => {
    try {
      await sanitize(file, options);
    } catch (error) {
      toast({ tone: "error", title: msg("Sanitizing failed"), description: error instanceof Error ? error.message : undefined });
    }
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <AuditCard audit={audit} />
      {/* On small screens the actions come first so the Strip button isn't below a long table. */}
      <div className="order-first space-y-4 lg:sticky lg:top-20 lg:order-0">
        <StripCard file={file} audit={audit} options={options} onOptionsChange={setOptions} onStrip={run} />
        {file.output && <ResultCard file={file} verification={verification} />}
        {files.length > 1 && <BatchCard files={files} options={options} />}
        <FilePreview file={file} />
      </div>
    </div>
  );
}

function StripCard({
  file,
  audit,
  options,
  onOptionsChange,
  onStrip,
}: {
  file: WorkspaceFile;
  audit: AuditState;
  options: StripOptions;
  onOptionsChange: (options: StripOptions) => void;
  onStrip: () => void;
}) {
  const t = useT();
  const busy = file.status === "processing";
  const report = audit.status === "ready" ? audit.report : null;
  const technical = options.keepTechnical && file.kind === "image";
  const alreadyClean = report !== null && report.entries.every((e) => technical && e.sensitivity === "low");
  const set = (key: keyof StripOptions) => (checked: boolean) => onOptionsChange({ ...options, [key]: checked });

  return (
    <section className="rounded-xl border border-line bg-surface p-5" aria-labelledby="strip-heading">
      <h2 id="strip-heading" className="flex items-center gap-2 font-semibold text-fg">
        <Eraser className="size-4 text-brand-text" aria-hidden="true" />
        {t("Strip metadata")}
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        {file.kind === "pdf" ? t("Rewrites the PDF from scratch without its hidden data. Pages and text are untouched.") : t("Removes metadata without re-encoding, so image quality is unchanged.")}
      </p>

      <fieldset className="mt-4 space-y-2.5" disabled={busy}>
        <legend className="sr-only">{t("Options")}</legend>
        {file.kind === "pdf" ? (
          <>
            <Option checked={options.removeAttachments} onChange={set("removeAttachments")} label={t("Remove attached files")} />
            <Option checked={options.removeJavaScript} onChange={set("removeJavaScript")} label={t("Remove JavaScript")} />
            <Option checked={options.anonymizeAnnotations} onChange={set("anonymizeAnnotations")} label={t("Remove comment authors & timestamps")} />
          </>
        ) : (
          <>
            <Segmented
              label={t("What to remove")}
              value={options.keepTechnical ? "revealing" : "all"}
              onChange={(v) => onOptionsChange({ ...options, keepTechnical: v === "revealing" })}
              options={[
                { id: "all", label: t("Everything") },
                { id: "revealing", label: t("Keep technical") },
              ]}
            />
            <p className="text-xs text-fg-subtle">
              {options.keepTechnical
                ? t("Removes everything sensitive or revealing. Keeps camera settings (exposure, aperture, ISO, focal length), resolution and the colour profile.")
                : t("Removes every tag, including camera settings.")}
            </p>
            {!options.keepTechnical && <Option checked={options.keepColorProfile} onChange={set("keepColorProfile")} label={t("Keep color profile")} hint={t("Preserves exact colors on wide-gamut photos")} />}
          </>
        )}
      </fieldset>

      <button
        type="button"
        onClick={onStrip}
        disabled={busy || audit.status !== "ready" || alreadyClean}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : file.output ? <RefreshCw className="size-4" aria-hidden="true" /> : <Eraser className="size-4" aria-hidden="true" />}
        {busy ? t("Stripping…") : alreadyClean ? t("Nothing to strip") : file.output ? t("Strip again") : technical ? t("Strip revealing metadata") : t("Strip all metadata")}
      </button>
      {file.status === "error" && file.error && <p className="mt-2 text-sm text-danger-text">{t.dynamic(file.error)}</p>}
    </section>
  );
}

function Option({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-brand" />
      <span>
        <span className="text-fg">{label}</span>
        {hint && <span className="block text-xs text-fg-subtle">{hint}</span>}
      </span>
    </label>
  );
}

function ResultCard({ file, verification }: { file: WorkspaceFile; verification: AuditState | null }) {
  const replaceFileContent = useWorkspaceStore((s) => s.replaceFileContent);
  const t = useT();
  const output = file.output!;
  const report = verification?.status === "ready" ? verification.report : null;
  const kept = report && output.keptTechnical ? report.entries.filter((e) => e.sensitivity === "low") : [];
  const leftover = report ? report.entries.filter((e) => !kept.includes(e)) : [];
  const clean = report !== null && leftover.length === 0;

  return (
    <section className={clsx("rounded-xl border bg-surface p-5", clean ? "border-success/50" : report ? "border-warning/50" : "border-line")} aria-live="polite">
      {!report ? (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          {t("Verifying the cleaned file…")}
        </p>
      ) : clean ? (
        <div className="flex items-start gap-3">
          <ShieldCheck className="size-6 shrink-0 text-success" aria-hidden="true" />
          <div>
            <p className="font-semibold text-success-text">{kept.length ? t("No sensitive or revealing metadata") : t("0 metadata tags found")}</p>
            <p className="mt-0.5 text-sm text-fg-muted">
              {kept.length > 0 && `${t.plural(kept.length, "{n} technical tag kept on purpose.", "{n} technical tags kept on purpose.")} `}
              {t("Verified by re-reading the cleaned file from scratch.")}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <TriangleAlert className="size-6 shrink-0 text-warning" aria-hidden="true" />
          <div>
            <p className="font-semibold text-warning-text">{t.plural(leftover.length, "{n} tag still present", "{n} tags still present")}</p>
            <p className="mt-0.5 text-sm text-fg-muted">{t.list(leftover.map((e) => t.dynamic(e.label)))}</p>
          </div>
        </div>
      )}

      <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-subtle">
        {formatBytes(file.size)} <ArrowRight className="size-3 rtl:-scale-x-100" aria-hidden="true" /> {formatBytes(output.blob.size)}
      </p>

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => downloadBlob(output.blob, output.name)}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-brand-fg hover:bg-brand-hover"
        >
          <Download className="size-4" aria-hidden="true" />
          {t("Download clean file")}
        </button>
        <button
          type="button"
          onClick={() => replaceFileContent(file.id, output.blob, file.name)}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-fg-muted hover:border-line-strong hover:text-fg"
          title={t("Replace this tab's file with the cleaned version, e.g. before merging or converting it")}
        >
          {t("Use cleaned version in workspace")}
        </button>
      </div>
    </section>
  );
}

function BatchCard({ files, options }: { files: WorkspaceFile[]; options: StripOptions }) {
  const [running, setRunning] = useState(false);
  const t = useT();
  const pending = files.filter((f) => !f.output);
  const done = files.filter((f) => f.output);

  const sanitizeAll = async () => {
    setRunning(true);
    let failed = 0;
    for (const f of pending) {
      try {
        await sanitize(f, options);
      } catch {
        failed++;
      }
    }
    setRunning(false);
    const succeeded = pending.length - failed;
    toast({
      tone: failed ? "warning" : "success",
      title: t.plural(succeeded, "{n} file sanitized", "{n} files sanitized"),
      description: failed ? t("{count} couldn't be processed — open their tabs for details.", { count: failed }) : undefined,
    });
  };

  const downloadAll = async () => {
    downloadBlob(await zipFiles(done.map((f) => f.output!)), "sanitized-files.zip");
  };

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-semibold text-fg">
        <Layers className="size-4 text-brand-text" aria-hidden="true" />
        {t("All open files")}
      </h2>
      <p className="mt-1 text-sm text-fg-muted">{t("{done} of {total} sanitized.", { done: done.length, total: files.length })}</p>
      <div className="mt-4 flex flex-col gap-2">
        {pending.length > 0 && (
          <button
            type="button"
            onClick={sanitizeAll}
            disabled={running}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-brand-border px-4 py-2 text-sm font-medium text-brand-text hover:bg-brand-soft disabled:opacity-50"
          >
            {running && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            {pending.length === files.length
              ? t.plural(pending.length, "Sanitize all {n} file", "Sanitize all {n} files")
              : t.plural(pending.length, "Sanitize remaining {n} file", "Sanitize remaining {n} files")}
          </button>
        )}
        {done.length > 1 && (
          <button
            type="button"
            onClick={downloadAll}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-fg-muted hover:border-line-strong hover:text-fg"
          >
            <Download className="size-4" aria-hidden="true" />
            {t("Download {count} clean files (ZIP)", { count: done.length })}
          </button>
        )}
      </div>
    </section>
  );
}
