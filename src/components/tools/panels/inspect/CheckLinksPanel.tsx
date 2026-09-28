"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { CircleAlert, Info, Link2, QrCode, TriangleAlert, Type } from "lucide-react";
import { Rich } from "@/i18n/Rich";
import type { Translator } from "@/i18n/translate";
import { errorMessage } from "@/lib/errors";
import { decodeImage } from "@/lib/image/canvas";
import type { Severity } from "@/lib/scan/findings";
import { analyzeUrl, describeQr, worst, type Flag } from "@/lib/scan/links";
import { findLinksInPdf, qrCodesInBitmap, type FoundLink } from "@/lib/scan/links-browser";
import { useT } from "@/store/locale";
import type { WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { FidelityNote, ProgressBar } from "../shared/ConversionParts";
import { DocGate, Layout, ToolCard } from "../shared/toolkit";
import { EmptyFindings } from "./parts";

interface Checked {
  found: FoundLink;
  /** What it is: "Web link", "Wi-Fi network", … */
  label: string;
  details: string[];
  flags: Flag[];
  severity: Severity;
}

function judge(found: FoundLink, t: Translator): Checked {
  if (found.kind === "qr") {
    const qr = describeQr(found.value);
    return { found, label: t("QR code: {kind}", { kind: t.dynamic(qr.label) }), details: qr.details, flags: qr.flags, severity: worst(qr.flags) };
  }
  const verdict = analyzeUrl(found.value, found.shown);
  return { found, label: found.kind === "link" ? t("Link") : t("Address in the text"), details: [found.value], flags: verdict.flags, severity: verdict.severity };
}

const ICONS = { link: Link2, text: Type, qr: QrCode };
const TONE: Record<Severity, { icon: typeof Info; className: string }> = {
  high: { icon: CircleAlert, className: "text-danger" },
  medium: { icon: TriangleAlert, className: "text-warning" },
  info: { icon: Info, className: "text-fg-subtle" },
};
const RANK: Record<Severity, number> = { high: 0, medium: 1, info: 2 };

export default function CheckLinksPanel({ file }: ToolPanelProps) {
  if (file.kind === "image") return <FromImage file={file} />;
  return <DocGate file={file}>{(doc) => <FromPdf doc={doc} />}</DocGate>;
}

function FromPdf({ doc }: { doc: PDFDocumentProxy }) {
  const [state, setState] = useState<{ doc: PDFDocumentProxy; done: number; found?: FoundLink[]; error?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    findLinksInPdf(doc, (done) => setState({ doc, done }), controller.signal)
      .then((found) => !controller.signal.aborted && setState({ doc, done: doc.numPages, found }))
      .catch((error) => !controller.signal.aborted && setState({ doc, done: 0, error: errorMessage(error) }));
    return () => controller.abort();
  }, [doc]);
  const current = state?.doc === doc ? state : null;
  return <Results found={current?.found} error={current?.error} progress={current?.found ? null : { done: current?.done ?? 0, total: doc.numPages }} />;
}

function FromImage({ file }: { file: WorkspaceFile }) {
  const [state, setState] = useState<{ blob: Blob; found?: FoundLink[]; error?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bitmap = await decodeImage(new Uint8Array(await file.file.arrayBuffer()), file.file.type);
      const codes = qrCodesInBitmap(bitmap);
      bitmap.close();
      if (!cancelled) setState({ blob: file.file, found: codes.map((value) => ({ kind: "qr", value })) });
    })().catch((error) => !cancelled && setState({ blob: file.file, error: errorMessage(error) }));
    return () => {
      cancelled = true;
    };
  }, [file.file]);
  const current = state?.blob === file.file ? state : null;
  return <Results found={current?.found} error={current?.error} progress={current?.found ? null : { done: 0, total: 1 }} image />;
}

function Results({ found, error, progress, image = false }: { found?: FoundLink[]; error?: string; progress: { done: number; total: number } | null; image?: boolean }) {
  const t = useT();
  const checked = (found ?? []).map((f) => judge(f, t)).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const counts = { high: checked.filter((c) => c.severity === "high").length, medium: checked.filter((c) => c.severity === "medium").length };

  return (
    <Layout
      main={
        !found ? (
          <div className="h-72 rounded-xl border border-line bg-surface" aria-busy="true" />
        ) : checked.length === 0 ? (
          <EmptyFindings
            title={image ? t("No QR code found") : t("No links or QR codes found")}
            detail={image ? t("No QR code could be read in this picture. Very small, blurred or partly covered codes can be missed.") : t("There are no clickable links, web addresses in the text, or QR codes on the pages.")}
          />
        ) : (
          <section className="rounded-xl border border-line bg-surface" aria-label={t("Links found")}>
            <div className="border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">
              {image ? t.plural(checked.length, "{n} code found", "{n} codes found") : t.plural(checked.length, "{n} link found", "{n} links found")}
            </div>
            <ul className="divide-y divide-line">
              {checked.map((c, i) => {
                const Kind = ICONS[c.found.kind];
                const { icon: Tone, className } = TONE[c.severity];
                return (
                  <li key={i} className="flex gap-3 px-4 py-3.5">
                    <Tone className={clsx("mt-0.5 size-5 shrink-0", className)} aria-label={c.severity === "high" ? t("Warning") : c.severity === "medium" ? t("Caution") : t("No warning signs")} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-subtle">
                        <Kind className="size-3.5" aria-hidden="true" />
                        {c.label}
                        {c.found.page !== undefined && ` · ${t("page {page}", { page: c.found.page + 1 })}`}
                      </p>
                      {c.details.map((d, k) => (
                        <p key={k} className={clsx("mt-1 text-sm break-all", k === 0 ? "font-mono text-fg" : "text-fg-muted")} dir="auto">
                          {k === 0 ? d : t.dynamic(d)}
                        </p>
                      ))}
                      {c.found.shown && c.found.shown !== c.found.value && <p className="mt-1 text-xs text-fg-muted">{t("Shown as: “{text}”", { text: c.found.shown })}</p>}
                      {c.flags.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {c.flags.map((f, k) => (
                            <li key={k} className={clsx("text-sm", f.severity === "high" ? "text-danger-text" : f.severity === "medium" ? "text-fg" : "text-fg-muted")}>
                              {t.dynamic(f.text)}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs text-fg-subtle">{t("No warning signs.")}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )
      }
      actions={
        <ToolCard icon={QrCode} title={image ? t("Check QR codes") : t("Check links & QR codes")}>
          <FidelityNote>
            {t(
              "Looks for tricks in web addresses: look-alike names, hidden destinations, brand names on other sites, and link text that doesn't match where it goes. Nothing is looked up online, so no warning doesn't mean a site is safe.",
            )}
          </FidelityNote>
          {error ? (
            <p className="mt-4 text-sm text-danger-text">{t.dynamic(error)}</p>
          ) : progress ? (
            <ProgressBar
              label={image ? t("Reading the picture…") : t("Checking page {page} of {count}…", { page: Math.min(progress.done + 1, progress.total), count: progress.total })}
              fraction={image ? null : progress.done / progress.total}
            />
          ) : (
            <p className="mt-4 rounded-lg bg-surface-muted px-3 py-2 text-sm text-fg">
              {counts.high ? (
                <Rich
                  text={counts.medium ? t("{warnings}, {count} to be careful with.", { count: counts.medium }) : t("{warnings}.")}
                  values={{ warnings: <span className="font-semibold">{t.plural(counts.high, "{n} warning", "{n} warnings")}</span> }}
                />
              ) : counts.medium ? (
                t.plural(counts.medium, "{n} thing to be careful with.", "{n} things to be careful with.")
              ) : (
                t("No warning signs.")
              )}
            </p>
          )}
        </ToolCard>
      }
    />
  );
}
