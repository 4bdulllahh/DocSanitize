"use client";

import { useState } from "react";
import { FileSearch, LoaderCircle, Sparkles } from "lucide-react";
import { msg } from "@/i18n/msg";
import { Rich } from "@/i18n/Rich";
import { errorMessage } from "@/lib/errors";
import { cleanOfficeFile, inspectOfficeFile } from "@/lib/scan/client";
import type { OfficeCleanOptions } from "@/lib/scan/office-inspect";
import { withSuffix } from "@/lib/zip";
import { useT } from "@/store/locale";
import { toast } from "@/store/toast";
import { useWorkspaceStore } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { OutputCard, PRIMARY, type OutputFile } from "../shared/OutputCard";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import { Layout, ToolCard, useLoaded } from "../shared/toolkit";
import { EmptyFindings, FindingList } from "./parts";

const LABELS: Record<keyof OfficeCleanOptions, { label: string; hint?: string }> = {
  properties: { label: msg("Document properties"), hint: msg("Author, company, dates, editing time and custom properties") },
  comments: { label: msg("Comments") },
  trackedChanges: { label: msg("Accept all tracked changes"), hint: msg("Deleted text is removed for good; insertions become normal text") },
  hiddenText: { label: msg("Delete hidden text") },
  notes: { label: msg("Delete speaker notes") },
  extras: { label: msg("Other traces"), hint: msg("Preview picture, printer settings, template path, document variables and editing-session IDs") },
};

const TEXTS = {
  word: {
    title: msg("What's in this Word document"),
    intro: msg("Looks for what a Word document carries besides what's on screen: names, comments, tracked changes, hidden content, notes and paths."),
  },
  excel: {
    title: msg("What's in this Excel workbook"),
    intro: msg("Looks for what an Excel workbook carries besides what's on screen: names, comments, hidden sheets, rows and columns, cached data and paths."),
  },
  powerpoint: {
    title: msg("What's in this PowerPoint presentation"),
    intro: msg("Looks for what a PowerPoint presentation carries besides what's on screen: names, comments, speaker notes, hidden slides and paths."),
  },
};

export default function InspectOfficePanel({ file }: ToolPanelProps) {
  const t = useT();
  const inspection = useLoaded(file, inspectOfficeFile);
  const [unticked, setUnticked] = useState<Set<keyof OfficeCleanOptions>>(new Set());
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<OutputFile | null>(null);

  if (!inspection) return <PdfLoading label={t("Reading the file")} />;
  if (inspection.error || !inspection.value) return <PdfLoadError title={t("Couldn't read this file")} message={inspection.error ?? ""} code={inspection.code} />;
  const { kind, findings, removable } = inspection.value;
  const options = Object.fromEntries((Object.keys(LABELS) as (keyof OfficeCleanOptions)[]).map((k) => [k, removable[k] && !unticked.has(k)])) as unknown as OfficeCleanOptions;
  const serious = findings.filter((f) => f.severity === "high").length;

  const clean = async () => {
    const { updateFile } = useWorkspaceStore.getState();
    setBusy(true);
    setOutput(null);
    updateFile(file.id, { status: "processing", error: undefined });
    try {
      setOutput({ name: withSuffix(file.name, "cleaned"), blob: await cleanOfficeFile(file.file, kind, options) });
      updateFile(file.id, { status: "idle" });
    } catch (error) {
      updateFile(file.id, { status: "error", error: errorMessage(error) });
      toast({ tone: "error", title: msg("Couldn't clean the file"), description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout
      main={findings.length ? <FindingList title={t(TEXTS[kind].title)} findings={findings} /> : <EmptyFindings title={t("Nothing hidden found")} detail={t("No names, comments, tracked changes, hidden content or links to other files.")} />}
      actions={
        <>
          <ToolCard icon={FileSearch} title={t("Inspect Office file")}>
            <p className="mt-2 text-sm text-fg-muted">{t(TEXTS[kind].intro)}</p>
            <p className="mt-4 rounded-lg bg-surface-muted px-3 py-2 text-sm text-fg">
              {serious ? (
                <Rich text={t("{things} to check before sharing.")} values={{ things: <span className="font-semibold">{t.plural(serious, "{n} thing", "{n} things")}</span> }} />
              ) : (
                t("Nothing hidden that needs attention.")
              )}
            </p>
          </ToolCard>
          {Object.values(removable).some(Boolean) && (
            <ToolCard icon={Sparkles} title={t("Clean the file")}>
              <p className="mt-2 text-sm text-fg-muted">{t("Removes what you tick from the file itself. Everything else, including formatting, stays as it is.")}</p>
              <div className="mt-3 space-y-2.5">
                {(Object.keys(LABELS) as (keyof OfficeCleanOptions)[])
                  .filter((k) => removable[k])
                  .map((k) => (
                    <label key={k} className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={!unticked.has(k)}
                        disabled={busy}
                        onChange={() => {
                          setOutput(null);
                          setUnticked((prev) => {
                            const next = new Set(prev);
                            if (next.has(k)) next.delete(k);
                            else next.add(k);
                            return next;
                          });
                        }}
                        className="mt-0.5 size-4 shrink-0 accent-brand"
                      />
                      <span>
                        <span className="block text-sm text-fg">{t(LABELS[k].label)}</span>
                        {LABELS[k].hint && <span className="block text-xs text-fg-muted">{t(LABELS[k].hint)}</span>}
                      </span>
                    </label>
                  ))}
              </div>
              <button type="button" onClick={clean} disabled={busy || !Object.values(options).some(Boolean)} className={`${PRIMARY} mt-5 w-full`}>
                {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
                {t("Clean file")}
              </button>
            </ToolCard>
          )}
          {output && <OutputCard title={t("Cleaned file ready")} outputs={[output]} replaceFileId={file.id} />}
        </>
      }
    />
  );
}
