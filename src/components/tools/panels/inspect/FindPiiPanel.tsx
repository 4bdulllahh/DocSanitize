"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Copy, EyeOff, UserSearch } from "lucide-react";
import { Rich } from "@/i18n/Rich";
import { errorMessage } from "@/lib/errors";
import { extractText } from "@/lib/office/extract";
import { annotationTexts } from "@/lib/pdf/annotations";
import { PII_LABELS, type PiiKind } from "@/lib/scan/pii";
import { findPiiInPages, type PiiFinding } from "@/lib/scan/pii-pdf";
import { handOffToRedact } from "@/store/handoff";
import { useT } from "@/store/locale";
import type { WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { FidelityNote, ProgressBar } from "../shared/ConversionParts";
import { PRIMARY, SECONDARY } from "../shared/OutputCard";
import { DocGate, Layout, ToolCard } from "../shared/toolkit";
import { copyText } from "./CheckFilePanel";
import { EmptyFindings } from "./parts";

export default function FindPiiPanel({ file }: ToolPanelProps) {
  return <DocGate file={file}>{(doc) => <FindPii file={file} doc={doc} />}</DocGate>;
}

interface Scan {
  findings: PiiFinding[];
  /** Pages (0-based) with no selectable text: scans, or pictures of text. */
  textless: number[];
}

function useScan(doc: PDFDocumentProxy) {
  const [state, setState] = useState<{ doc: PDFDocumentProxy; done: number; scan?: Scan; error?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const pages = Array.from({ length: doc.numPages }, (_, i) => i + 1);
    (async () => {
      const text = await extractText(doc, pages, (done) => !cancelled && setState({ doc, done }), false);
      const annotations = await annotationTexts(doc, pages);
      const textless = text.flatMap((page, i) => (page.items.some((item) => item.text.trim()) ? [] : [i]));
      if (!cancelled) setState({ doc, done: pages.length, scan: { findings: findPiiInPages(text, annotations), textless } });
    })().catch((error) => !cancelled && setState({ doc, done: 0, error: errorMessage(error) }));
    return () => {
      cancelled = true;
    };
  }, [doc]);
  return state?.doc === doc ? state : null;
}

function FindPii({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const router = useRouter();
  const t = useT();
  const state = useScan(doc);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<PiiKind>>(new Set());

  if (!state?.scan) {
    return (
      <Layout
        main={<div className="h-72 rounded-xl border border-line bg-surface" />}
        actions={
          <ToolCard icon={UserSearch} title={t("Find personal data")}>
            {state?.error ? (
              <p className="mt-3 text-sm text-danger-text">{t.dynamic(state.error)}</p>
            ) : (
              <ProgressBar label={t("Reading page {page} of {count}…", { page: Math.min((state?.done ?? 0) + 1, doc.numPages), count: doc.numPages })} fraction={(state?.done ?? 0) / doc.numPages} />
            )}
          </ToolCard>
        }
      />
    );
  }

  const { findings, textless } = state.scan;
  const kinds = (Object.keys(PII_LABELS) as PiiKind[]).filter((k) => findings.some((f) => f.kind === k));
  const visible = findings.filter((f) => !hidden.has(f.kind));
  const chosen = visible.filter((f) => !unticked.has(f.id));
  const toggle = (id: string) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const redact = () => {
    const boxes: Record<number, PiiFinding["boxes"]> = {};
    for (const f of chosen) (boxes[f.page] ??= []).push(...f.boxes);
    handOffToRedact({ fileId: file.id, revision: file.revision, boxes, note: t.plural(chosen.length, "Marked {n} item from Find Personal Data. Check it, then apply.", "Marked {n} items from Find Personal Data. Check them, then apply.") });
    router.push("/tools/redact/");
  };
  const copy = () =>
    copyText(chosen.map((f) => `${t.dynamic(PII_LABELS[f.kind].name)}\t${f.value}\t${t("page {page}", { page: f.page + 1 })}`).join("\n"), t("List copied"));

  return (
    <Layout
      main={
        findings.length === 0 ? (
          <EmptyFindings title={t("No personal data found")} detail={t("No email addresses, phone numbers, card or bank account numbers, national ID numbers, IP addresses or labelled dates of birth were found in the text.")} />
        ) : (
          <section className="rounded-xl border border-line bg-surface" aria-label={t("Personal data found")}>
            <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-3" role="group" aria-label={t("Show")}>
              {kinds.map((kind) => {
                const count = findings.filter((f) => f.kind === kind).length;
                const on = !hidden.has(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setHidden((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(kind);
                        else next.delete(kind);
                        return next;
                      })
                    }
                    className={clsx("rounded-full border px-3 py-1 text-xs font-medium", on ? "border-brand-border bg-brand-soft text-fg" : "border-line text-fg-subtle")}
                  >
                    {t.dynamic(PII_LABELS[kind].plural)} · {count}
                  </button>
                );
              })}
            </div>
            <ul className="max-h-160 divide-y divide-line overflow-y-auto">
              {visible.map((f) => (
                <li key={f.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-surface-muted">
                    <input type="checkbox" checked={!unticked.has(f.id)} onChange={() => toggle(f.id)} className="mt-1 size-4 shrink-0 accent-brand" aria-label={`${t.dynamic(PII_LABELS[f.kind].name)} ${f.value}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-mono text-sm font-medium break-all text-fg" dir="ltr">{f.value}</span>
                        <span className="text-xs text-fg-subtle">
                          {t.dynamic(PII_LABELS[f.kind].name)} · {t("page {page}", { page: f.page + 1 })}
                          {f.inAnnotation && ` · ${t("in a form field or comment")}`}
                        </span>
                      </span>
                      <Context text={f.context} />
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )
      }
      actions={
        <>
          <ToolCard icon={UserSearch} title={t("Find personal data")}>
            <FidelityNote>
              {t(
                "Looks for email addresses, phone numbers, payment card and bank account numbers, US Social Security and UK National Insurance numbers, IP addresses and labelled dates of birth. Names and postal addresses can't be found reliably, so read the document too.",
              )}
            </FidelityNote>
            <p className="mt-4 text-sm text-fg-muted">
              <Rich
                text={doc.numPages === 1 ? t("{items} found on the page.") : t("{items} found on {count} pages.", { count: doc.numPages })}
                values={{ items: <span className="font-semibold text-fg">{t.plural(findings.length, "{n} item", "{n} items")}</span> }}
              />
            </p>
            {textless.length > 0 && (
              <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-fg-muted">
                {textless.length === doc.numPages
                  ? t("No page has selectable text (a scan?), so nothing was checked. Run OCR PDF first.")
                  : t.plural(textless.length, "{n} page has no selectable text (a scan?), so it wasn't checked. Run OCR PDF first.", "{n} pages have no selectable text (a scan?), so they weren't checked. Run OCR PDF first.")}
              </p>
            )}
            <button type="button" onClick={redact} disabled={chosen.length === 0} className={`${PRIMARY} mt-5 w-full`}>
              <EyeOff className="size-4" aria-hidden="true" />
              {t.plural(chosen.length, "Redact {n} item", "Redact {n} items")}
            </button>
            <button type="button" onClick={copy} disabled={chosen.length === 0} className={`${SECONDARY} mt-2 w-full`}>
              <Copy className="size-4" aria-hidden="true" />
              {t("Copy the list")}
            </button>
          </ToolCard>
        </>
      }
    />
  );
}

/** "…text before [[value]] text after…" with the value highlighted. */
function Context({ text }: { text: string }) {
  const [before, rest = ""] = text.split("[[");
  const [value, after = ""] = rest.split("]]");
  return (
    <span className="mt-0.5 block text-xs text-fg-muted" dir="auto">
      {before}
      <mark className="rounded bg-warning-soft px-0.5 text-fg">{value}</mark>
      {after}
    </span>
  );
}
