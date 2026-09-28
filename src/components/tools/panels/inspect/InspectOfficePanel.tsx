"use client";

import { useState } from "react";
import { FileSearch, LoaderCircle, Sparkles } from "lucide-react";
import { errorMessage } from "@/lib/errors";
import { cleanOfficeFile, inspectOfficeFile } from "@/lib/scan/client";
import { plural } from "@/lib/scan/findings";
import type { OfficeCleanOptions } from "@/lib/scan/office-inspect";
import { withSuffix } from "@/lib/zip";
import { toast } from "@/store/toast";
import { useWorkspaceStore } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { OutputCard, PRIMARY, type OutputFile } from "../shared/OutputCard";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import { Layout, ToolCard, useLoaded } from "../shared/toolkit";
import { EmptyFindings, FindingList } from "./parts";

const LABELS: Record<keyof OfficeCleanOptions, { label: string; hint?: string }> = {
  properties: { label: "Document properties", hint: "Author, company, dates, editing time and custom properties" },
  comments: { label: "Comments" },
  trackedChanges: { label: "Accept all tracked changes", hint: "Deleted text is removed for good; insertions become normal text" },
  hiddenText: { label: "Delete hidden text" },
  notes: { label: "Delete speaker notes" },
  extras: { label: "Other traces", hint: "Preview picture, printer settings, template path, document variables and editing-session IDs" },
};

const KIND_NAMES = { word: "Word document", excel: "Excel workbook", powerpoint: "PowerPoint presentation" };

export default function InspectOfficePanel({ file }: ToolPanelProps) {
  const inspection = useLoaded(file, inspectOfficeFile);
  const [unticked, setUnticked] = useState<Set<keyof OfficeCleanOptions>>(new Set());
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<OutputFile | null>(null);

  if (!inspection) return <PdfLoading label="Reading the file" />;
  if (inspection.error || !inspection.value) return <PdfLoadError title="Couldn't read this file" message={inspection.error ?? ""} code={inspection.code} />;
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
      toast({ tone: "error", title: "Couldn't clean the file", description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout
      main={findings.length ? <FindingList title={`What's in this ${KIND_NAMES[kind].toLowerCase()}`} findings={findings} /> : <EmptyFindings title="Nothing hidden found" detail="No names, comments, tracked changes, hidden content or links to other files." />}
      actions={
        <>
          <ToolCard icon={FileSearch} title="Inspect Office file">
            <p className="mt-2 text-sm text-fg-muted">Looks for what a {KIND_NAMES[kind].toLowerCase()} carries besides what&apos;s on screen: names, comments, tracked changes, hidden content, notes and paths.</p>
            <p className="mt-4 rounded-lg bg-surface-muted px-3 py-2 text-sm text-fg">
              {serious ? (
                <>
                  <span className="font-semibold">{plural(serious, "thing")}</span> to check before sharing.
                </>
              ) : (
                "Nothing hidden that needs attention."
              )}
            </p>
          </ToolCard>
          {Object.values(removable).some(Boolean) && (
            <ToolCard icon={Sparkles} title="Clean the file">
              <p className="mt-2 text-sm text-fg-muted">Removes what you tick from the file itself. Everything else, including formatting, stays as it is.</p>
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
                        <span className="block text-sm text-fg">{LABELS[k].label}</span>
                        {LABELS[k].hint && <span className="block text-xs text-fg-muted">{LABELS[k].hint}</span>}
                      </span>
                    </label>
                  ))}
              </div>
              <button type="button" onClick={clean} disabled={busy || !Object.values(options).some(Boolean)} className={`${PRIMARY} mt-5 w-full`}>
                {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
                Clean file
              </button>
            </ToolCard>
          )}
          {output && <OutputCard title="Cleaned file ready" outputs={[output]} replaceFileId={file.id} />}
        </>
      }
    />
  );
}
