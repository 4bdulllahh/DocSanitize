"use client";

import Link from "next/link";
import { Download, Hourglass, TriangleAlert, X } from "lucide-react";
import { KindIcon } from "@/components/files/KindIcon";
import { TOOL_PANELS } from "@/components/tools/panels/registry";
import { downloadBlob } from "@/lib/download";
import { formatBytes, KIND_LABELS } from "@/lib/files";
import { toolsAccepting, type Tool } from "@/lib/tools";
import { useT } from "@/store/locale";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import { FilePreview } from "./FilePreview";
import { PANEL_ID, tabId } from "./FileTabs";

export function FilePanel({ tool, file }: { tool: Tool; file: WorkspaceFile }) {
  const files = useWorkspaceStore((s) => s.files);
  const compatible = tool.accepts.includes(file.kind);
  const Panel = TOOL_PANELS[tool.id];

  return (
    <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(file.id)} className="flex-1 p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        {!(tool.multiFile && Panel && compatible) && <FileSummary file={file} />}
        {!compatible ? (
          <IncompatibleNotice tool={tool} file={file} />
        ) : Panel ? (
          <Panel tool={tool} file={file} files={files.filter((f) => tool.accepts.includes(f.kind))} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <FilePreview file={file} />
            <ComingSoonCard tool={tool} />
          </div>
        )}
      </div>
    </div>
  );
}

function FileSummary({ file }: { file: WorkspaceFile }) {
  const removeFile = useWorkspaceStore((s) => s.removeFile);
  const t = useT();

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface p-4">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-text">
        <KindIcon kind={file.kind} className="size-5" />
      </span>
      <div className="min-w-48 flex-1">
        <h2 className="font-semibold wrap-anywhere text-fg">{file.name}</h2>
        <p className="mt-0.5 text-sm text-fg-muted">
          {t("{kind} · {size} · Modified {date}", {
            kind: t(KIND_LABELS[file.kind]),
            size: formatBytes(file.size),
            date: t.date(file.file.lastModified, { dateStyle: "medium", timeStyle: "short" }),
          })}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => downloadBlob(file.file, file.name)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-muted hover:border-line-strong hover:text-fg"
        >
          <Download className="size-4" aria-hidden="true" />
          {t("Download")}
        </button>
        <button
          type="button"
          onClick={() => removeFile(file.id)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-muted hover:border-line-strong hover:text-fg"
        >
          <X className="size-4" aria-hidden="true" />
          {t("Close")}
        </button>
      </div>
    </div>
  );
}

function ComingSoonCard({ tool }: { tool: Tool }) {
  const Icon = tool.icon;
  const t = useT();
  return (
    <div className="flex flex-col rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-fg">
        <Icon className="size-4 text-brand-text" aria-hidden="true" />
        {t(tool.name)}
      </div>
      <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg bg-surface-muted p-6 text-center">
        <Hourglass className="size-6 text-fg-subtle" aria-hidden="true" />
        <p className="text-sm font-medium text-fg">{t("Coming soon")}</p>
        <p className="text-sm text-fg-muted">{t("Your file is open and ready. This tool's controls will appear here.")}</p>
      </div>
    </div>
  );
}

function IncompatibleNotice({ tool, file }: { tool: Tool; file: WorkspaceFile }) {
  const alternatives = toolsAccepting(file.kind);
  const t = useT();
  return (
    <div className="rounded-xl border border-warning/40 bg-warning-soft p-5">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <p className="font-medium text-fg">{t("{tool} can't open {kind} files.", { tool: t(tool.name), kind: t(KIND_LABELS[file.kind]) })}</p>
          <p className="mt-1 text-sm text-fg-muted">{t("This file is still open in your workspace. Switch to another tab, or open it with a tool that supports it.")}</p>
          {alternatives.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {alternatives.map((alt) => (
                <Link
                  key={alt.id}
                  href={`/tools/${alt.id}`}
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-brand-text hover:border-brand-border"
                >
                  {t(alt.name)}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
