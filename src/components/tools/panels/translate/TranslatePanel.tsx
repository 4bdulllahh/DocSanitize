"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ArrowRight, Copy, Download, Languages, TriangleAlert, X } from "lucide-react";
import { PageThumbnail } from "@/components/pdf/PageThumbnail";
import { usePdfDocument } from "@/components/pdf/usePdfDocument";
import { downloadBlob } from "@/lib/download";
import { errorMessage, ProcessingError } from "@/lib/errors";
import { joinPageTexts } from "@/lib/ocr/result";
import { translateFile } from "@/lib/pdf/client";
import { readPhrases, sampleColors } from "@/lib/pdf/edit/page-text";
import { withRenderSlot } from "@/lib/pdf/render";
import type { TranslatedBlock } from "@/lib/pdf/translate";
import { groupLines, hasWords } from "@/lib/translate/blocks";
import { createTranslator, detectLanguage, pairAvailability, translatorSupported, type Availability } from "@/lib/translate/browser";
import { translateLanguage, TRANSLATE_LANGUAGES } from "@/lib/translate/languages";
import { replaceExtension, withSuffix } from "@/lib/zip";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { FidelityNote, ProgressBar, WarningList } from "../shared/ConversionParts";
import { Field, INPUT } from "../shared/controls";
import { OutputCard, PRIMARY, SECONDARY, type OutputFile } from "../shared/OutputCard";
import { DocGate, Layout, PageGrid, ToolCard, usePageField } from "../shared/toolkit";
import { useT } from "@/store/locale";
import { msg } from "@/i18n/msg";
import type { Translator } from "@/i18n/translate";
import { Rich } from "@/i18n/Rich";

const nameOf = (code: string, t: Translator) => t.language(code, TRANSLATE_LANGUAGES.find((l) => l.code === code)?.name ?? code);
/** Pages are rendered at this scale to sample text and background colours. */
const COLOR_SCALE = 1.5;

export default function TranslatePanel({ file }: ToolPanelProps) {
  return <DocGate file={file}>{(doc) => <Translate file={file} doc={doc} />}</DocGate>;
}

/** The document's language, detected from the text of its first pages (null: unknown). */
function useDetectedLanguage(doc: PDFDocumentProxy) {
  const [state, setState] = useState<{ doc: PDFDocumentProxy; code: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let sample = "";
      for (let i = 1; i <= Math.min(doc.numPages, 3) && sample.length < 3000; i++) {
        const content = await (await doc.getPage(i)).getTextContent();
        sample += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + " ";
      }
      const detected = translateLanguage((await detectLanguage(sample)) ?? undefined);
      if (!cancelled) setState({ doc, code: detected?.code ?? null });
    })().catch(() => !cancelled && setState({ doc, code: null }));
    return () => {
      cancelled = true;
    };
  }, [doc]);
  return state?.doc === doc ? state : null;
}

function usePairAvailability(source: string, target: string) {
  const [state, setState] = useState<{ key: string; value: Availability } | null>(null);
  const key = `${source}>${target}`;
  useEffect(() => {
    if (!source || !target || source === target) return;
    let cancelled = false;
    pairAvailability(source, target).then((value) => !cancelled && setState({ key, value }));
    return () => {
      cancelled = true;
    };
  }, [key, source, target]);
  return state?.key === key ? state.value : null;
}

type Progress = { label: string; fraction: number | null };

interface Result {
  pdf: OutputFile | null;
  warnings: string[];
  text: string;
  pairs: { original: string; translation: string }[];
  blocks: number;
}

async function renderForColors(doc: PDFDocumentProxy, index: number) {
  return withRenderSlot(async () => {
    const page = await doc.getPage(index + 1);
    const viewport = page.getViewport({ scale: COLOR_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport, background: "#ffffff" }).promise;
    return { page, canvas, width: viewport.width / COLOR_SCALE };
  });
}

function Translate({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const t = useT();
  const [supported] = useState(translatorSupported);
  const detected = useDetectedLanguage(doc);
  const [sourceChoice, setSource] = useState<string | null>(null);
  const source = sourceChoice ?? detected?.code ?? "";
  const [target, setTarget] = useState(() => {
    const browser = translateLanguage(typeof navigator === "undefined" ? undefined : navigator.language);
    return browser?.code ?? "en";
  });
  const range = usePageField(doc.numPages);
  const availability = usePairAvailability(source, target);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const abort = useRef<AbortController | null>(null);
  const pdfTarget = TRANSLATE_LANGUAGES.find((l) => l.code === target)?.pdf ?? false;
  const pages = range.pages ?? Array.from({ length: doc.numPages }, (_, i) => i);
  const busy = progress !== null;

  const run = async () => {
    const { updateFile } = useWorkspaceStore.getState();
    const controller = new AbortController();
    abort.current = controller;
    setResult(null);
    setProgress({ label: msg("Preparing the translator…"), fraction: null });
    updateFile(file.id, { status: "processing", error: undefined });
    try {
      // First, while the click still counts: the browser may need to download a language pack.
      const translator = await createTranslator(source, target, (loaded) => setProgress({ label: t("Downloading the language pack (once)…"), fraction: loaded }), controller.signal);
      const blocks: TranslatedBlock[] = [];
      const pageTexts: { page: number; text: string }[] = [];
      const pairs: Result["pairs"] = [];
      let found = 0;
      try {
        for (const [n, index] of pages.entries()) {
          setProgress({ label: t("Translating page {page} of {count}…", { page: n + 1, count: pages.length }), fraction: n / pages.length });
          const { page, canvas, width } = await renderForColors(doc, index);
          try {
            const groups = groupLines(await readPhrases(page));
            const texts: string[] = [];
            for (const [k, block] of groups.entries()) {
              if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
              found++;
              if (!hasWords(block.text)) {
                texts.push(block.text);
                continue;
              }
              const translation = await translator.translate(block.text);
              texts.push(translation);
              if (pairs.length < 40) pairs.push({ original: block.text, translation });
              if (translation.trim() && translation.trim() !== block.text.trim()) {
                const { box, baseline, size, font, bold, italic, lines } = block;
                const colors = sampleColors(canvas, width, box);
                blocks.push({ box, baseline, size, font, bold, italic, page: index, translation, color: colors.text, background: colors.background, sources: lines.flatMap((l) => l.sources) });
              }
              setProgress({ label: t("Translating page {page} of {count}…", { page: n + 1, count: pages.length }), fraction: (n + (k + 1) / groups.length) / pages.length });
            }
            pageTexts.push({ page: index, text: texts.join("\n\n") });
          } finally {
            canvas.width = canvas.height = 0;
            page.cleanup();
          }
        }
      } finally {
        translator.destroy();
      }
      if (found === 0) {
        throw new ProcessingError("There's no text to translate: this looks like a scan. Run OCR PDF on it first, then translate the result.", "invalid");
      }
      let pdf: OutputFile | null = null;
      let warnings: string[] = [];
      if (pdfTarget) {
        setProgress({ label: t("Writing the translated PDF…"), fraction: null });
        const written = await translateFile(file.file, blocks);
        pdf = { name: withSuffix(file.name, target), blob: written.blob, detail: t.plural(blocks.length, "{n} passage translated", "{n} passages translated") };
        warnings = written.warnings;
      }
      setResult({ pdf, warnings, text: joinPageTexts(pageTexts), pairs, blocks: blocks.length });
      updateFile(file.id, { status: "idle" });
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      updateFile(file.id, { status: cancelled ? "idle" : "error", error: cancelled ? undefined : errorMessage(error) });
      if (!cancelled) toast({ tone: "error", title: msg("Translation failed"), description: errorMessage(error) });
    } finally {
      abort.current = null;
      setProgress(null);
    }
  };

  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setResult(null);
  };

  const sameLanguage = !!source && source === target;
  const main = result ? (
    <div className="space-y-4">
      {result.pdf && <TranslatedPages blob={result.pdf.blob} />}
      <TranslationPreview pairs={result.pairs} />
    </div>
  ) : (
    <PageGrid doc={doc} label={t("Pages")} tile={(i) => ({ selected: false, dimmed: !pages.includes(i) })} />
  );

  if (!supported) {
    return (
      <Layout
        main={main}
        actions={
          <ToolCard icon={Languages} title={t("Translate")}>
            <div className="mt-4 flex gap-2.5 rounded-lg bg-warning-soft p-3 text-sm text-fg-muted">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <div>
                <p className="font-medium text-fg">{t("This browser has no built-in translator")}</p>
                <p className="mt-1">
                  {t("Translate PDF uses the translator built into Chrome and Edge on computers, which works on your device. Open DocSanitize in one of them to translate this file. DocSanitize never sends your document to an online translation service.")}
                </p>
              </div>
            </div>
          </ToolCard>
        }
      />
    );
  }

  return (
    <Layout
      main={main}
      actions={
        <>
          <ToolCard icon={Languages} title={t("Translate")}>
            <FidelityNote>
              {t("Your browser translates on your device; the text never leaves it. Each paragraph is replaced in place, in the same spot and colour, set smaller where the translation is longer. Images and scanned text aren't translated.")}
            </FidelityNote>
            <Field label={t("From")} hint={detected === null ? t("Detecting the language…") : detected.code && !sourceChoice ? t("Detected from the text.") : undefined}>
              <select value={source} disabled={busy} onChange={(e) => change(setSource)(e.target.value)} className={INPUT}>
                {!source && <option value="">{t("Choose the document's language…")}</option>}
                {TRANSLATE_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {t.language(l.code, l.name)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="To">
              <select value={target} disabled={busy} onChange={(e) => change(setTarget)(e.target.value)} className={INPUT}>
                {TRANSLATE_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {t.language(l.code, l.name)}
                  </option>
                ))}
              </select>
            </Field>
            {sameLanguage && <p className="mt-2 text-xs text-danger-text">{t("The document is already in {language}. Pick another language.", { language: nameOf(target, t) })}</p>}
            {!sameLanguage && source && availability === "unavailable" && (
              <p className="mt-2 text-xs text-danger-text">
                {t("Your browser can't translate {from} to {to}.", { from: nameOf(source, t), to: nameOf(target, t) })}
              </p>
            )}
            {!sameLanguage && source && (availability === "downloadable" || availability === "downloading") && (
              <p className="mt-2 text-xs text-fg-subtle">{t("Your browser will download this language pack once, then translate offline.")}</p>
            )}
            {!pdfTarget && (
              <p className="mt-2 text-xs text-fg-muted">
                {t("{language} needs fonts DocSanitize doesn't include yet, so you'll get the translated text as a .txt file instead of a PDF.", { language: nameOf(target, t) })}
              </p>
            )}
            {doc.numPages > 1 && (
              <Field label={t("Pages")} hint={t("Leave empty for all {count} pages, or type ranges such as 1-3, 5.", { count: doc.numPages })} error={range.error}>
                <input value={range.text} disabled={busy} onChange={(e) => change(range.setText)(e.target.value)} placeholder={t("All pages")} className={INPUT} />
              </Field>
            )}
            {busy ? (
              <>
                <ProgressBar label={progress.label} fraction={progress.fraction} />
                <button type="button" onClick={() => abort.current?.abort()} className={`${SECONDARY} mt-4 w-full`}>
                  <X className="size-4" aria-hidden="true" />
                  {t("Cancel")}
                </button>
              </>
            ) : (
              <button type="button" onClick={run} disabled={!source || sameLanguage || availability === "unavailable" || !!range.error} className={`${PRIMARY} mt-5 w-full`}>
                <Languages className="size-4" aria-hidden="true" />
                {t("Translate to {language}", { language: nameOf(target, t) })}
              </button>
            )}
          </ToolCard>
          {result && (
            <>
              {result.pdf && <OutputCard title={t("Translated PDF ready")} outputs={[result.pdf]} />}
              {result.pdf && result.warnings.length > 0 && <WarningList warnings={result.warnings} />}
              <ToolCard icon={Download} title={result.pdf ? t("Text only") : t("Translation ready")}>
                <p className="mt-2 text-sm text-fg-muted">{t("The translated text as a plain .txt file, or copied to paste anywhere.")}</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" className={result.pdf ? SECONDARY : PRIMARY} onClick={() => downloadBlob(new Blob([result.text], { type: "text/plain;charset=utf-8" }), replaceExtension(withSuffix(file.name, target), ".txt"))}>
                    <Download className="size-4" aria-hidden="true" />
                    {t(".txt")}
                  </button>
                  <button
                    type="button"
                    className={SECONDARY}
                    onClick={() =>
                      navigator.clipboard.writeText(result.text).then(
                        () => toast({ tone: "success", title: msg("Translation copied") }),
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
          {!result && (
            <p className="px-1 text-xs text-fg-subtle">
              <Rich
                text={t("Scanned document? Make its text readable with {link} first.")}
                values={{
                  link: (
                    <Link href="/tools/ocr" className="font-medium text-brand-text underline underline-offset-2">
                      {t("OCR PDF")}
                    </Link>
                  ),
                }}
              />
            </p>
          )}
        </>
      }
    />
  );
}

const PREVIEW_PAGES = 4;

/** The translated pages, large enough to read. */
function TranslatedPages({ blob }: { blob: Blob }) {
  const t = useT();
  const pdf = usePdfDocument(blob);
  const pages = pdf.status === "ready" ? pdf.doc.numPages : 0;
  return (
    <section className="rounded-xl border border-line bg-surface" aria-label={t("Result preview")}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">
        <span>{t("Translated PDF")}</span>
        <span className="normal-case tracking-normal">{pages > PREVIEW_PAGES ? t("First {shown} of {count} pages", { shown: PREVIEW_PAGES, count: pages }) : t.plural(pages, "{n} page", "{n} pages")}</span>
      </div>
      <ol className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4 bg-surface-muted p-4">
        {pdf.status === "ready" &&
          Array.from({ length: Math.min(pages, PREVIEW_PAGES) }, (_, i) => (
            <li key={i} className="flex flex-col items-center gap-1.5">
              <PageThumbnail doc={pdf.doc} pageNumber={i + 1} width={300} height={390} />
              <span className="text-xs text-fg-subtle tabular-nums">{i + 1}</span>
            </li>
          ))}
      </ol>
    </section>
  );
}

function TranslationPreview({ pairs }: { pairs: Result["pairs"] }) {
  const t = useT();
  return (
    <section className="rounded-xl border border-line bg-surface" aria-label={t("Translation preview")}>
      <div className="border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">{t("Translation · first passages")}</div>
      <ol className="max-h-[36rem] divide-y divide-line overflow-y-auto">
        {pairs.map((p, i) => (
          <li key={i} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_auto_1fr]">
            <p className="text-fg-muted" dir="auto">
              {p.original}
            </p>
            <ArrowRight className="hidden size-4 self-center text-fg-subtle sm:block" aria-hidden="true" />
            <p className="text-fg" dir="auto">
              {p.translation}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
