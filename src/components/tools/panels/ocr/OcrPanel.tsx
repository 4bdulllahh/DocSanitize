"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Copy, Download, LoaderCircle, ScanText, X } from "lucide-react";
import { usePdfDocument } from "@/components/pdf/usePdfDocument";
import { downloadBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { pagesWithText, recognizePages, type OcrProgress } from "@/lib/ocr/engine";
import { defaultOcrLanguage, OCR_ENGINE_MB, OCR_LANGUAGES } from "@/lib/ocr/languages";
import { joinPageTexts, type OcrPageResult } from "@/lib/ocr/result";
import { addOcrTextToFile, imagesToPdfFile } from "@/lib/pdf/client";
import { DEFAULT_IMAGES_TO_PDF } from "@/lib/pdf/images";
import { replaceExtension, withSuffix } from "@/lib/zip";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { FidelityNote, ProgressBar } from "../shared/ConversionParts";
import { Field, INPUT } from "../shared/controls";
import { OutputCard, PRIMARY, SECONDARY, type OutputFile } from "../shared/OutputCard";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import { DocGate, Layout, PageGrid, ToolCard, useLoaded, usePageField } from "../shared/toolkit";
import { useT } from "@/store/locale";
import { msg } from "@/i18n/msg";

const MAX_LANGUAGES = 3;

export default function OcrPanel({ file }: ToolPanelProps) {
  if (file.kind === "image") return <FromImage file={file} />;
  return <DocGate file={file}>{(doc) => <Ocr file={file} source={file.file} doc={doc} fromImage={false} />}</DocGate>;
}

/** A photo or screenshot becomes a one-page PDF first (the page is the image, at its own size). */
function FromImage({ file }: { file: WorkspaceFile }) {
  const t = useT();
  const converted = useLoaded(file, (blob) => imagesToPdfFile([{ name: file.name, file: blob, rotate: 0 }], { ...DEFAULT_IMAGES_TO_PDF, pageSize: "fit" }));
  if (!converted) return <PdfLoading label={t("Preparing the image")} />;
  if (converted.error || !converted.value) return <PdfLoadError title={t("Couldn't open this image")} message={converted.error ?? ""} code={converted.code} />;
  return <ImageDoc file={file} pdf={converted.value} />;
}

function ImageDoc({ file, pdf }: { file: WorkspaceFile; pdf: Blob }) {
  const t = useT();
  const opened = usePdfDocument(pdf);
  if (opened.status === "loading") return <PdfLoading label={t("Preparing the image")} />;
  if (opened.status === "error") return <PdfLoadError message={opened.message} code={opened.code} />;
  return <Ocr file={file} source={pdf} doc={opened.doc} fromImage />;
}

/** Pages (0-based) that already have text, so they needn't be read again. */
function usePagesWithText(doc: PDFDocumentProxy) {
  const [state, setState] = useState<{ doc: PDFDocumentProxy; pages: Set<number> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pages = await pagesWithText(doc, () => cancelled);
      if (!cancelled) setState({ doc, pages });
    })().catch(() => !cancelled && setState({ doc, pages: new Set() }));
    return () => {
      cancelled = true;
    };
  }, [doc]);
  return state?.doc === doc ? state.pages : null;
}

interface Result {
  pdf: OutputFile;
  text: string;
  pages: OcrPageResult[];
  skipped: number;
}

function Ocr({ file, source, doc, fromImage }: { file: WorkspaceFile; source: Blob; doc: PDFDocumentProxy; fromImage: boolean }) {
  const t = useT();
  const [languages, setLanguages] = useState(() => [defaultOcrLanguage(typeof navigator === "undefined" ? undefined : navigator.language)]);
  const range = usePageField(doc.numPages);
  const withText = usePagesWithText(doc);
  const [skipText, setSkipText] = useState(true);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const abort = useRef<AbortController | null>(null);

  const chosen = range.pages ?? Array.from({ length: doc.numPages }, (_, i) => i);
  const toRead = skipText && withText ? chosen.filter((i) => !withText.has(i)) : chosen;
  const skipped = chosen.length - toRead.length;
  const busy = progress !== null;
  const reset = () => setResult(null);

  const run = async () => {
    const { updateFile } = useWorkspaceStore.getState();
    const controller = new AbortController();
    abort.current = controller;
    setResult(null);
    setProgress({ stage: "loading", label: msg("Loading the OCR engine…") });
    updateFile(file.id, { status: "processing", error: undefined });
    // Progress reported after the run has ended (e.g. by a failed engine) is ignored.
    let running = true;
    try {
      const pages = await recognizePages(doc, toRead, { languages, fromImage, onProgress: (p) => running && setProgress(p), signal: controller.signal });
      setProgress({ stage: "loading", label: t("Adding the text to the PDF…") });
      const pdf = await addOcrTextToFile(source, pages);
      const name = fromImage ? withSuffix(file.name, "ocr", ".pdf") : withSuffix(file.name, "ocr");
      const words = pages.reduce((n, p) => n + p.words, 0);
      setResult({ pdf: { name, blob: pdf, detail: t.plural(words, "{n} word added", "{n} words added") }, text: joinPageTexts(pages), pages, skipped });
      updateFile(file.id, { status: "idle" });
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      updateFile(file.id, { status: cancelled ? "idle" : "error", error: cancelled ? undefined : errorMessage(error) });
      if (!cancelled) toast({ tone: "error", title: msg("OCR failed"), description: errorMessage(error) });
    } finally {
      running = false;
      abort.current = null;
      setProgress(null);
    }
  };

  const downloadMb = OCR_ENGINE_MB + languages.reduce((n, code) => n + (OCR_LANGUAGES.find((l) => l.code === code)?.mb ?? 0), 0);

  return (
    <Layout
      main={
        result ? (
          <TextPreview result={result} />
        ) : (
          <PageGrid
            doc={doc}
            label={t("Pages")}
            tile={(i) => ({
              selected: false,
              dimmed: !toRead.includes(i),
              badge: withText?.has(i) && <span className="absolute top-3 start-3 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">{t("Has text")}</span>,
            })}
          />
        )
      }
      actions={
        <>
          <ToolCard icon={ScanText} title={t("Recognise text (OCR)")}>
            <FidelityNote>
              {t(
                "Reads the text in scans and photos and adds it invisibly over the page, so you can search, select and copy it; the page looks the same. The OCR engine and languages (about {size} MB) download from this site the first time, then work offline.",
                { size: downloadMb.toFixed(1) },
              )}
            </FidelityNote>
            <LanguagePicker
              value={languages}
              disabled={busy}
              onChange={(v) => {
                setLanguages(v);
                reset();
              }}
            />
            {doc.numPages > 1 && (
              <Field label={t("Pages")} hint={t("Leave empty for all {count} pages, or type ranges such as 1-3, 5.", { count: doc.numPages })} error={range.error}>
                <input
                  value={range.text}
                  disabled={busy}
                  onChange={(e) => {
                    range.setText(e.target.value);
                    reset();
                  }}
                  placeholder={t("All pages")}
                  className={INPUT}
                />
              </Field>
            )}
            {!fromImage && (
              <label className="mt-4 flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={skipText}
                  disabled={busy}
                  onChange={(e) => {
                    setSkipText(e.target.checked);
                    reset();
                  }}
                  className="mt-0.5 size-4 shrink-0 accent-brand"
                />
                <span>
                  <span className="block text-sm font-medium text-fg">{t("Skip pages that already have text")}</span>
                  <span className="block text-xs text-fg-muted">
                    {withText === null ? t("Checking the pages…") : withText.size === 0 ? t("No page has text yet.") : t.plural(withText.size, "{n} page already has text.", "{n} pages already have text.")}
                  </span>
                </span>
              </label>
            )}
            {busy ? (
              <>
                <ProgressBar
                  label={progress.stage === "loading" ? t.dynamic(progress.label) : t("Reading page {page} of {count}…", { page: progress.done + 1, count: progress.total })}
                  fraction={progress.stage === "loading" ? null : (progress.done + progress.fraction) / progress.total}
                />
                <button type="button" onClick={() => abort.current?.abort()} className={`${SECONDARY} mt-4 w-full`}>
                  <X className="size-4" aria-hidden="true" />
                  {t("Cancel")}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={run} disabled={toRead.length === 0 || !!range.error || languages.length === 0 || withText === null} className={`${PRIMARY} mt-5 w-full`}>
                  {withText === null ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ScanText className="size-4" aria-hidden="true" />}
                  {toRead.length === 0 && withText !== null ? t("Nothing to read") : t.plural(toRead.length, "Recognise text on {n} page", "Recognise text on {n} pages")}
                </button>
                {toRead.length === 0 && withText !== null && <p className="mt-2 text-xs text-fg-muted">{t("Every chosen page already has text. Untick “Skip pages that already have text” to read them again.")}</p>}
              </>
            )}
          </ToolCard>
          {result && (
            <>
              <OutputCard title={t("Searchable PDF ready")} outputs={[result.pdf]} replaceFileId={fromImage ? undefined : file.id} />
              <ToolCard icon={Download} title={t("Text only")}>
                <p className="mt-2 text-sm text-fg-muted">{t("The recognised text as a plain .txt file, or copied to paste anywhere.")}</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" className={SECONDARY} onClick={() => downloadBlob(new Blob([result.text], { type: "text/plain;charset=utf-8" }), replaceExtension(file.name, ".txt"))}>
                    <Download className="size-4" aria-hidden="true" />
                    {t(".txt")}
                  </button>
                  <button
                    type="button"
                    className={SECONDARY}
                    onClick={() =>
                      navigator.clipboard.writeText(result.text).then(
                        () => toast({ tone: "success", title: msg("Text copied") }),
                        () => toast({ tone: "error", title: msg("Couldn't copy"), description: msg("Your browser didn't allow it. Download the .txt instead.") }),
                      )
                    }
                  >
                    <Copy className="size-4" aria-hidden="true" />
                    {t("Copy")}
                  </button>
                </div>
              </ToolCard>
            </>
          )}
        </>
      }
    />
  );
}

function LanguagePicker({ value, onChange, disabled }: { value: string[]; onChange: (codes: string[]) => void; disabled: boolean }) {
  const t = useT();
  const language = (l: (typeof OCR_LANGUAGES)[number]) => t.language(l.bcp47, l.name);
  const name = (code: string) => {
    const l = OCR_LANGUAGES.find((x) => x.code === code);
    return l ? language(l) : code;
  };
  return (
    <div className="mt-4">
      <p className="text-sm font-medium text-fg">{t("Languages in the document")}</p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={t("Chosen languages")}>
        {value.map((code) => (
          <li key={code} className="flex items-center gap-1 rounded-full bg-brand-soft py-1 ps-3 pe-1 text-sm text-fg">
            {name(code)}
            <button
              type="button"
              disabled={disabled || value.length === 1}
              onClick={() => onChange(value.filter((c) => c !== code))}
              className="rounded-full p-0.5 text-fg-muted hover:bg-surface hover:text-fg disabled:opacity-30"
              aria-label={t("Remove {language}", { language: name(code) })}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {value.length < MAX_LANGUAGES && (
        <select
          aria-label={t("Add a language")}
          value=""
          disabled={disabled}
          onChange={(e) => e.target.value && onChange([...value, e.target.value])}
          className={INPUT}
        >
          <option value="">{t("Add a language…")}</option>
          {OCR_LANGUAGES.filter((l) => !value.includes(l.code)).map((l) => (
            <option key={l.code} value={l.code}>
              {language(l)} ({l.mb} MB)
            </option>
          ))}
        </select>
      )}
      <p className="mt-1 text-xs text-fg-subtle">{t("Up to {count}. Each one makes reading a little slower.", { count: MAX_LANGUAGES })}</p>
    </div>
  );
}

function TextPreview({ result }: { result: Result }) {
  const t = useT();
  const words = result.pages.reduce((n, p) => n + p.words, 0);
  const confidence = words ? Math.round(result.pages.reduce((n, p) => n + p.confidence * p.words, 0) / words) : 0;
  return (
    <section className="rounded-xl border border-line bg-surface" aria-label={t("Recognised text")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">
        <span>{t("Recognised text")}</span>
        <span className="normal-case tracking-normal">
          {result.skipped > 0 ? t.plural(result.pages.length, "{n} page read, {skipped} skipped", "{n} pages read, {skipped} skipped", { skipped: result.skipped }) : t.plural(result.pages.length, "{n} page read", "{n} pages read")} ·{" "}
          {t.plural(words, "{n} word", "{n} words")}
          {words > 0 && ` · ${t("{percent}% confidence", { percent: confidence })}`}
        </span>
      </div>
      {words > 0 && confidence < 60 && (
        <p className="border-b border-line bg-warning-soft px-4 py-2 text-sm text-fg-muted">
          {t("Some text was hard to read, so check the result. Straight, sharp, well-lit scans work best, and so does choosing every language the document uses.")}
        </p>
      )}
      <div className="max-h-[36rem] space-y-5 overflow-y-auto px-6 py-5">
        {result.pages.map((page) => (
          <div key={page.page}>
            {result.pages.length > 1 && <h3 className="text-xs font-semibold tracking-wider text-fg-subtle uppercase">{t("Page {page}", { page: page.page + 1 })}</h3>}
            <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-fg" dir="auto">
              {page.text || <span className="text-fg-subtle italic">{t("No text found on this page.")}</span>}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
