"use client";

import { useState } from "react";
import clsx from "clsx";
import { ArrowRight, Download, Eraser, Layers, LoaderCircle, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { FilePreview } from "@/components/workspace/FilePreview";
import { downloadBlob } from "@/lib/download";
import { formatBytes } from "@/lib/files";
import { stripFile } from "@/lib/metadata/client";
import { DEFAULT_STRIP_OPTIONS, type StripOptions } from "@/lib/metadata/types";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
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
    updateFile(target.id, { status: "done", output: { blob, name: cleanName(target.name) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't sanitize this file.";
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
      toast({ tone: "error", title: "Sanitizing failed", description: error instanceof Error ? error.message : undefined });
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
  const busy = file.status === "processing";
  const report = audit.status === "ready" ? audit.report : null;
  const alreadyClean = report !== null && report.entries.length === 0;
  const set = (key: keyof StripOptions) => (checked: boolean) => onOptionsChange({ ...options, [key]: checked });

  return (
    <section className="rounded-xl border border-line bg-surface p-5" aria-labelledby="strip-heading">
      <h2 id="strip-heading" className="flex items-center gap-2 font-semibold text-fg">
        <Eraser className="size-4 text-brand-text" aria-hidden="true" />
        Strip metadata
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        {file.kind === "pdf"
          ? "Rewrites the PDF from scratch without its hidden data. Pages and text are untouched."
          : "Removes metadata without re-encoding, so image quality is unchanged."}
      </p>

      <fieldset className="mt-4 space-y-2.5" disabled={busy}>
        <legend className="sr-only">Options</legend>
        {file.kind === "pdf" ? (
          <>
            <Option checked={options.removeAttachments} onChange={set("removeAttachments")} label="Remove attached files" />
            <Option checked={options.removeJavaScript} onChange={set("removeJavaScript")} label="Remove JavaScript" />
            <Option checked={options.anonymizeAnnotations} onChange={set("anonymizeAnnotations")} label="Remove comment authors & timestamps" />
          </>
        ) : (
          <Option
            checked={options.keepColorProfile}
            onChange={set("keepColorProfile")}
            label="Keep color profile"
            hint="Preserves exact colors on wide-gamut photos"
          />
        )}
      </fieldset>

      <button
        type="button"
        onClick={onStrip}
        disabled={busy || audit.status !== "ready" || alreadyClean}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : file.output ? <RefreshCw className="size-4" aria-hidden="true" /> : <Eraser className="size-4" aria-hidden="true" />}
        {busy ? "Stripping…" : alreadyClean ? "Nothing to strip" : file.output ? "Strip again" : "Strip all metadata"}
      </button>
      {file.status === "error" && file.error && <p className="mt-2 text-sm text-danger-text">{file.error}</p>}
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
  const output = file.output!;
  const report = verification?.status === "ready" ? verification.report : null;
  const clean = report !== null && report.entries.length === 0;

  return (
    <section
      className={clsx(
        "rounded-xl border bg-surface p-5",
        clean ? "border-success/50" : report ? "border-warning/50" : "border-line",
      )}
      aria-live="polite"
    >
      {!report ? (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Verifying the cleaned file…
        </p>
      ) : clean ? (
        <div className="flex items-start gap-3">
          <ShieldCheck className="size-6 shrink-0 text-success" aria-hidden="true" />
          <div>
            <p className="font-semibold text-success-text">0 metadata tags found</p>
            <p className="mt-0.5 text-sm text-fg-muted">Verified by re-reading the cleaned file from scratch.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <TriangleAlert className="size-6 shrink-0 text-warning" aria-hidden="true" />
          <div>
            <p className="font-semibold text-warning-text">
              {report.entries.length} tag{report.entries.length === 1 ? "" : "s"} still present
            </p>
            <p className="mt-0.5 text-sm text-fg-muted">{report.entries.map((e) => e.label).join(", ")}</p>
          </div>
        </div>
      )}

      <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-subtle">
        {formatBytes(file.size)} <ArrowRight className="size-3" aria-hidden="true" /> {formatBytes(output.blob.size)}
      </p>

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => downloadBlob(output.blob, output.name)}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-brand-fg hover:bg-brand-hover"
        >
          <Download className="size-4" aria-hidden="true" />
          Download clean file
        </button>
        <button
          type="button"
          onClick={() => replaceFileContent(file.id, output.blob, file.name)}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-fg-muted hover:border-line-strong hover:text-fg"
          title="Replace this tab's file with the cleaned version, e.g. before merging or converting it"
        >
          Use cleaned version in workspace
        </button>
      </div>
    </section>
  );
}

function BatchCard({ files, options }: { files: WorkspaceFile[]; options: StripOptions }) {
  const [running, setRunning] = useState(false);
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
      title: `${succeeded} file${succeeded === 1 ? "" : "s"} sanitized`,
      description: failed ? `${failed} couldn't be processed — open their tabs for details.` : undefined,
    });
  };

  const downloadAll = () => {
    // Staggered so browsers don't drop rapid consecutive downloads.
    done.forEach((f, i) => setTimeout(() => downloadBlob(f.output!.blob, f.output!.name), i * 250));
  };

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-semibold text-fg">
        <Layers className="size-4 text-brand-text" aria-hidden="true" />
        All open files
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        {done.length} of {files.length} sanitized.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        {pending.length > 0 && (
          <button
            type="button"
            onClick={sanitizeAll}
            disabled={running}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-brand-border px-4 py-2 text-sm font-medium text-brand-text hover:bg-brand-soft disabled:opacity-50"
          >
            {running && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            Sanitize {pending.length === files.length ? "all" : "remaining"} {pending.length} file{pending.length === 1 ? "" : "s"}
          </button>
        )}
        {done.length > 1 && (
          <button
            type="button"
            onClick={downloadAll}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-fg-muted hover:border-line-strong hover:text-fg"
          >
            <Download className="size-4" aria-hidden="true" />
            Download {done.length} clean files
          </button>
        )}
      </div>
    </section>
  );
}
