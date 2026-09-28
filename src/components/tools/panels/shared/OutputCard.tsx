"use client";

import { useState } from "react";
import { CircleCheck, Download, FileArchive, FilePlus2, LoaderCircle, Replace } from "lucide-react";
import { downloadBlob } from "@/lib/download";
import { formatBytes } from "@/lib/files";
import { zipFiles } from "@/lib/zip";
import { useT } from "@/store/locale";
import { useWorkspaceStore } from "@/store/workspace";

export interface OutputFile {
  name: string;
  blob: Blob;
  /** Optional detail line, e.g. "Pages 1–3". */
  detail?: string;
}

interface Props {
  title: string;
  outputs: OutputFile[];
  /** Name for the ZIP when there are several outputs. */
  zipName?: string;
  /** Offer to replace this tab's file with the (single) output. */
  replaceFileId?: string;
}

/** Download / open-in-workspace actions for whatever a tool produced. */
export function OutputCard({ title, outputs, zipName = "files.zip", replaceFileId }: Props) {
  const [zipping, setZipping] = useState(false);
  const t = useT();
  const { addFiles, replaceFileContent } = useWorkspaceStore.getState();
  const single = outputs.length === 1 ? outputs[0] : null;

  const openInTabs = () => addFiles(outputs.map((o) => new File([o.blob], o.name, { type: o.blob.type })));
  const downloadZip = async () => {
    setZipping(true);
    try {
      downloadBlob(await zipFiles(outputs), zipName);
    } finally {
      setZipping(false);
    }
  };

  return (
    <section className="rounded-xl border border-success/50 bg-surface p-5" aria-live="polite">
      <div className="flex items-start gap-3">
        <CircleCheck className="size-6 shrink-0 text-success" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold text-fg">{title}</p>
          {single && (
            <p className="mt-0.5 text-sm wrap-anywhere text-fg-muted">
              {single.name} · {formatBytes(single.blob.size)}
              {single.detail && ` · ${single.detail}`}
            </p>
          )}
        </div>
      </div>

      {!single && (
        <ul className="mt-4 max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {outputs.map((o, i) => (
            <li key={`${o.name}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-fg">{o.name}</p>
                <p className="text-xs text-fg-subtle">
                  {o.detail && `${o.detail} · `}
                  {formatBytes(o.blob.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => downloadBlob(o.blob, o.name)}
                className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg"
                aria-label={t("Download {name}", { name: o.name })}
              >
                <Download className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {single ? (
          <button type="button" onClick={() => downloadBlob(single.blob, single.name)} className={PRIMARY}>
            <Download className="size-4" aria-hidden="true" />
            {t("Download result")}
          </button>
        ) : (
          <button type="button" onClick={downloadZip} disabled={zipping} className={PRIMARY}>
            {zipping ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <FileArchive className="size-4" aria-hidden="true" />}
            {t("Download all as ZIP")}
          </button>
        )}
        {single && replaceFileId && (
          <button type="button" onClick={() => replaceFileContent(replaceFileId, single.blob)} className={SECONDARY}>
            <Replace className="size-4" aria-hidden="true" />
            {t("Replace the file in this tab")}
          </button>
        )}
        <button type="button" onClick={openInTabs} className={SECONDARY}>
          <FilePlus2 className="size-4" aria-hidden="true" />
          {single ? t("Open in a new tab") : t("Open all {count} in new tabs", { count: outputs.length })}
        </button>
      </div>
    </section>
  );
}

export const PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50";
export const SECONDARY =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-50";
