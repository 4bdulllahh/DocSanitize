"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { EyeOff, FileSearch, LoaderCircle, Sparkles } from "lucide-react";
import { errorMessage } from "@/lib/errors";
import { cleanPdfFile, inspectPdfFile } from "@/lib/scan/client";
import { plural, type Finding } from "@/lib/scan/findings";
import type { CleanOptions } from "@/lib/scan/pdf-inspect";
import { findHiddenText, type HiddenKind, type HiddenText } from "@/lib/scan/pdf-visibility";
import { withSuffix } from "@/lib/zip";
import { handOffToRedact } from "@/store/handoff";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { ProgressBar } from "../shared/ConversionParts";
import { OutputCard, PRIMARY, SECONDARY, type OutputFile } from "../shared/OutputCard";
import { PdfLoadError } from "../shared/PdfStates";
import { DocGate, Layout, ToolCard, useLoaded } from "../shared/toolkit";
import { FindingList } from "./parts";

export default function InspectPdfPanel({ file }: ToolPanelProps) {
  return <DocGate file={file}>{(doc) => <Inspect file={file} doc={doc} />}</DocGate>;
}

const HIDDEN: Record<HiddenKind, Omit<Finding, "id" | "items">> = {
  covered: {
    severity: "high",
    title: "Text hidden under black boxes",
    detail: "A fake redaction: the boxes hide the text on screen, but it's still in the file, where anyone can copy, search or extract it.",
  },
  invisible: {
    severity: "medium",
    title: "Invisible text",
    detail: "Text in the file that doesn't show: white on white, behind a shape, or set to invisible. Search, copy and AI tools still read it. (A scanned page made searchable by OCR is fine.)",
  },
  tiny: { severity: "medium", title: "Text too small to read", detail: "Text under 1.5 points: invisible to the eye but read by search, copy and AI tools." },
};

function useHiddenText(doc: PDFDocumentProxy) {
  const [state, setState] = useState<{ doc: PDFDocumentProxy; done: number; found?: HiddenText[] } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    findHiddenText(doc, (done) => setState({ doc, done }), controller.signal)
      .then((found) => !controller.signal.aborted && setState({ doc, done: doc.numPages, found }))
      .catch(() => !controller.signal.aborted && setState({ doc, done: doc.numPages, found: [] }));
    return () => controller.abort();
  }, [doc]);
  return state?.doc === doc ? state : null;
}

const LABELS: Record<keyof CleanOptions, string> = {
  javascript: "JavaScript and actions that open programs, files or websites",
  attachments: "Attached files",
  comments: "Comments and markup",
  metadata: "Metadata and document properties",
  thumbnails: "Stored page thumbnails",
};

function Inspect({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const router = useRouter();
  const structure = useLoaded(file, inspectPdfFile);
  const hidden = useHiddenText(doc);
  const [unticked, setUnticked] = useState<Set<keyof CleanOptions>>(new Set());
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<OutputFile | null>(null);

  if (structure?.error) return <PdfLoadError message={structure.error} code={structure.code} />;

  const hiddenFindings: Finding[] = (Object.keys(HIDDEN) as HiddenKind[]).flatMap((kind) => {
    const found = hidden?.found?.filter((h) => h.kind === kind) ?? [];
    if (!found.length) return [];
    const pages = new Set(found.map((h) => h.page)).size;
    return [{ id: kind, ...HIDDEN[kind], title: `${HIDDEN[kind].title} on ${plural(pages, "page")}`, items: found.slice(0, 60).map((h) => `Page ${h.page + 1}: “${h.text.length > 120 ? `${h.text.slice(0, 120)}…` : h.text}”`) }];
  });
  const findings = [...hiddenFindings, ...(structure?.value?.findings ?? [])];
  const removable = structure?.value?.removable;
  const options = removable && (Object.fromEntries((Object.keys(LABELS) as (keyof CleanOptions)[]).map((k) => [k, removable[k] && !unticked.has(k)])) as unknown as CleanOptions);

  const redact = (kind: HiddenKind) => {
    const boxes: Record<number, HiddenText["box"][]> = {};
    for (const h of hidden?.found ?? []) if (h.kind === kind) (boxes[h.page] ??= []).push(h.box);
    handOffToRedact({ fileId: file.id, revision: file.revision, boxes, note: `Marked the ${kind === "covered" ? "text under black boxes" : kind === "tiny" ? "tiny text" : "invisible text"} found by Inspect PDF. Check it, then apply.` });
    router.push("/tools/redact/");
  };

  const clean = async () => {
    if (!options) return;
    const { updateFile } = useWorkspaceStore.getState();
    setBusy(true);
    setOutput(null);
    updateFile(file.id, { status: "processing", error: undefined });
    try {
      setOutput({ name: withSuffix(file.name, "cleaned"), blob: await cleanPdfFile(file.file, options) });
      updateFile(file.id, { status: "idle" });
    } catch (error) {
      updateFile(file.id, { status: "error", error: errorMessage(error) });
      toast({ tone: "error", title: "Couldn't clean the PDF", description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const checking = !structure || !hidden?.found;
  const serious = findings.filter((f) => f.severity === "high").length;
  const redactButton = (kind: HiddenKind) => (
    <button type="button" onClick={() => redact(kind)} className={SECONDARY}>
      <EyeOff className="size-4" aria-hidden="true" />
      Redact it properly
    </button>
  );

  return (
    <Layout
      main={findings.length ? <FindingList title="What's in this PDF" findings={findings} actions={{ covered: redactButton("covered"), invisible: redactButton("invisible"), tiny: redactButton("tiny") }} /> : <div className="h-72 rounded-xl border border-line bg-surface" aria-busy="true" />}
      actions={
        <>
          <ToolCard icon={FileSearch} title="Inspect PDF">
            <p className="mt-2 text-sm text-fg-muted">Looks for what the pages don&apos;t show: earlier versions, hidden and covered text, scripts, attachments, comments, hidden layers and leftovers.</p>
            {checking ? (
              <ProgressBar label={hidden && !hidden.found ? `Checking page ${Math.min(hidden.done + 1, doc.numPages)} of ${doc.numPages} for hidden text…` : "Reading the file…"} fraction={hidden ? hidden.done / doc.numPages : null} />
            ) : (
              <p className="mt-4 rounded-lg bg-surface-muted px-3 py-2 text-sm text-fg">
                {serious ? (
                  <>
                    <span className="font-semibold">{plural(serious, "thing")}</span> to check before sharing.
                  </>
                ) : (
                  "Nothing hidden that needs attention."
                )}
              </p>
            )}
          </ToolCard>
          {removable && Object.values(removable).some(Boolean) && (
            <ToolCard icon={Sparkles} title="Clean the PDF">
              <p className="mt-2 text-sm text-fg-muted">Removes what you tick and rewrites the file, which also drops earlier versions and leftovers. Pages, links and form fields stay.</p>
              <div className="mt-3 space-y-2">
                {(Object.keys(LABELS) as (keyof CleanOptions)[])
                  .filter((k) => removable[k])
                  .map((k) => (
                    <label key={k} className="flex cursor-pointer items-start gap-3 text-sm text-fg">
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
                      {LABELS[k]}
                    </label>
                  ))}
              </div>
              <button type="button" onClick={clean} disabled={busy} className={`${PRIMARY} mt-5 w-full`}>
                {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
                Clean PDF
              </button>
            </ToolCard>
          )}
          {output && <OutputCard title="Cleaned PDF ready" outputs={[output]} replaceFileId={file.id} />}
        </>
      }
    />
  );
}
