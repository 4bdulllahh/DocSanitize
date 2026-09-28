"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Copy, Download, LoaderCircle, ScanText, X } from "lucide-react";
import { usePdfDocument } from "@/components/pdf/usePdfDocument";
import { downloadBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { recognizePages, type OcrProgress } from "@/lib/ocr/engine";
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

const MAX_LANGUAGES = 3;
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

export default function OcrPanel({ file }: ToolPanelProps) {
  if (file.kind === "image") return <FromImage file={file} />;
  return <DocGate file={file}>{(doc) => <Ocr file={file} source={file.file} doc={doc} fromImage={false} />}</DocGate>;
}

/** A photo or screenshot becomes a one-page PDF first (the page is the image, at its own size). */
function FromImage({ file }: { file: WorkspaceFile }) {
  const converted = useLoaded(file, (blob) => imagesToPdfFile([{ name: file.name, file: blob, rotate: 0 }], { ...DEFAULT_IMAGES_TO_PDF, pageSize: "fit" }));
  if (!converted) return <PdfLoading label="Preparing the image" />;
  if (converted.error || !converted.value) return <PdfLoadError title="Couldn't open this image" message={converted.error ?? ""} code={converted.code} />;
  return <ImageDoc file={file} pdf={converted.value} />;
}

function ImageDoc({ file, pdf }: { file: WorkspaceFile; pdf: Blob }) {
  const opened = usePdfDocument(pdf);
  if (opened.status === "loading") return <PdfLoading label="Preparing the image" />;
  if (opened.status === "error") return <PdfLoadError message={opened.message} code={opened.code} />;
  return <Ocr file={file} source={pdf} doc={opened.doc} fromImage />;
}

/** Pages (0-based) that already have text, so they needn't be read again. */
function usePagesWithText(doc: PDFDocumentProxy) {
  const [state, setState] = useState<{ doc: PDFDocumentProxy; pages: Set<number> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pages = new Set<number>();
      for (let i = 0; i < doc.numPages && !cancelled; i++) {
        const content = await (await doc.getPage(i + 1)).getTextContent();
        if (content.items.some((item) => "str" in item && item.str.trim())) pages.add(i);
      }
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
    setProgress({ stage: "loading", label: "Loading the OCR engine…" });
    updateFile(file.id, { status: "processing", error: undefined });
    // Progress reported after the run has ended (e.g. by a failed engine) is ignored.
    let running = true;
    try {
      const pages = await recognizePages(doc, toRead, { languages, fromImage, onProgress: (p) => running && setProgress(p), signal: controller.signal });
      setProgress({ stage: "loading", label: "Adding the text to the PDF…" });
      const pdf = await addOcrTextToFile(source, pages);
      const name = fromImage ? withSuffix(file.name, "ocr", ".pdf") : withSuffix(file.name, "ocr");
      const words = pages.reduce((n, p) => n + p.words, 0);
      setResult({ pdf: { name, blob: pdf, detail: `${plural(words, "word")} added` }, text: joinPageTexts(pages), pages, skipped });
      updateFile(file.id, { status: "idle" });
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      updateFile(file.id, { status: cancelled ? "idle" : "error", error: cancelled ? undefined : errorMessage(error) });
      if (!cancelled) toast({ tone: "error", title: "OCR failed", description: errorMessage(error) });
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
            label="Pages"
            tile={(i) => ({
              selected: false,
              dimmed: !toRead.includes(i),
              badge: withText?.has(i) && <span className="absolute top-3 left-3 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">Has text</span>,
            })}
          />
        )
      }
      actions={
        <>
          <ToolCard icon={ScanText} title="Recognise text (OCR)">
            <FidelityNote>
              Reads the text in scans and photos and adds it invisibly over the page, so you can search, select and copy it; the page looks the same.
              The OCR engine and languages (about {downloadMb.toFixed(1)} MB) download from this site the first time, then work offline.
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
              <Field label="Pages" hint={`Leave empty for all ${doc.numPages} pages, or type ranges such as 1-3, 5.`} error={range.error}>
                <input
                  value={range.text}
                  disabled={busy}
                  onChange={(e) => {
                    range.setText(e.target.value);
                    reset();
                  }}
                  placeholder="All pages"
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
                  <span className="block text-sm font-medium text-fg">Skip pages that already have text</span>
                  <span className="block text-xs text-fg-muted">
                    {withText === null ? "Checking the pages…" : withText.size === 0 ? "No page has text yet." : `${plural(withText.size, "page")} already ${withText.size === 1 ? "has" : "have"} text.`}
                  </span>
                </span>
              </label>
            )}
            {busy ? (
              <>
                <ProgressBar
                  label={progress.stage === "loading" ? progress.label : `Reading page ${progress.done + 1} of ${progress.total}…`}
                  fraction={progress.stage === "loading" ? null : (progress.done + progress.fraction) / progress.total}
                />
                <button type="button" onClick={() => abort.current?.abort()} className={`${SECONDARY} mt-4 w-full`}>
                  <X className="size-4" aria-hidden="true" />
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={run} disabled={toRead.length === 0 || !!range.error || languages.length === 0 || withText === null} className={`${PRIMARY} mt-5 w-full`}>
                  {withText === null ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ScanText className="size-4" aria-hidden="true" />}
                  {toRead.length === 0 && withText !== null ? "Nothing to read" : `Recognise text on ${plural(toRead.length, "page")}`}
                </button>
                {toRead.length === 0 && withText !== null && <p className="mt-2 text-xs text-fg-muted">Every chosen page already has text. Untick “Skip pages that already have text” to read them again.</p>}
              </>
            )}
          </ToolCard>
          {result && (
            <>
              <OutputCard title="Searchable PDF ready" outputs={[result.pdf]} replaceFileId={fromImage ? undefined : file.id} />
              <ToolCard icon={Download} title="Text only">
                <p className="mt-2 text-sm text-fg-muted">The recognised text as a plain .txt file, or copied to paste anywhere.</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" className={SECONDARY} onClick={() => downloadBlob(new Blob([result.text], { type: "text/plain;charset=utf-8" }), replaceExtension(file.name, ".txt"))}>
                    <Download className="size-4" aria-hidden="true" />
                    .txt
                  </button>
                  <button
                    type="button"
                    className={SECONDARY}
                    onClick={() =>
                      navigator.clipboard.writeText(result.text).then(
                        () => toast({ tone: "success", title: "Text copied" }),
                        () => toast({ tone: "error", title: "Couldn't copy", description: "Your browser didn't allow it. Download the .txt instead." }),
                      )
                    }
                  >
                    <Copy className="size-4" aria-hidden="true" />
                    Copy
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
  const name = (code: string) => OCR_LANGUAGES.find((l) => l.code === code)?.name ?? code;
  return (
    <div className="mt-4">
      <p className="text-sm font-medium text-fg">Languages in the document</p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Chosen languages">
        {value.map((code) => (
          <li key={code} className="flex items-center gap-1 rounded-full bg-brand-soft py-1 pr-1 pl-3 text-sm text-fg">
            {name(code)}
            <button
              type="button"
              disabled={disabled || value.length === 1}
              onClick={() => onChange(value.filter((c) => c !== code))}
              className="rounded-full p-0.5 text-fg-muted hover:bg-surface hover:text-fg disabled:opacity-30"
              aria-label={`Remove ${name(code)}`}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {value.length < MAX_LANGUAGES && (
        <select
          aria-label="Add a language"
          value=""
          disabled={disabled}
          onChange={(e) => e.target.value && onChange([...value, e.target.value])}
          className={INPUT}
        >
          <option value="">Add a language…</option>
          {OCR_LANGUAGES.filter((l) => !value.includes(l.code)).map((l) => (
            <option key={l.code} value={l.code}>
              {l.name} ({l.mb} MB)
            </option>
          ))}
        </select>
      )}
      <p className="mt-1 text-xs text-fg-subtle">Up to {MAX_LANGUAGES}. Each one makes reading a little slower.</p>
    </div>
  );
}

function TextPreview({ result }: { result: Result }) {
  const words = result.pages.reduce((n, p) => n + p.words, 0);
  const confidence = words ? Math.round(result.pages.reduce((n, p) => n + p.confidence * p.words, 0) / words) : 0;
  return (
    <section className="rounded-xl border border-line bg-surface" aria-label="Recognised text">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">
        <span>Recognised text</span>
        <span className="normal-case tracking-normal">
          {plural(result.pages.length, "page")} read{result.skipped > 0 && `, ${result.skipped} skipped`} · {plural(words, "word")}
          {words > 0 && ` · ${confidence}% confidence`}
        </span>
      </div>
      {words > 0 && confidence < 60 && (
        <p className="border-b border-line bg-warning-soft px-4 py-2 text-sm text-fg-muted">
          Some text was hard to read, so check the result. Straight, sharp, well-lit scans work best, and so does choosing every language the document uses.
        </p>
      )}
      <div className="max-h-[36rem] space-y-5 overflow-y-auto px-6 py-5">
        {result.pages.map((page) => (
          <div key={page.page}>
            {result.pages.length > 1 && <h3 className="text-xs font-semibold tracking-wider text-fg-subtle uppercase">Page {page.page + 1}</h3>}
            <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-fg" dir="auto">
              {page.text || <span className="text-fg-subtle italic">No text found on this page.</span>}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
