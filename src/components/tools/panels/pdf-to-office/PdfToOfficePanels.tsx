"use client";

import { useState, type ReactNode } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Copy, FileSpreadsheet, FileText, LetterText, LoaderCircle, Presentation } from "lucide-react";
import { pdfToPowerPoint, pdfToText, type SlideMode } from "@/lib/convert/client";
import type { PdfToTextOptions } from "@/lib/convert/pdf-to-text";
import { PageThumbnail } from "@/components/pdf/PageThumbnail";
import { usePdfDocument } from "@/components/pdf/usePdfDocument";
import { errorMessage } from "@/lib/errors";
import { pdfToExcel, pdfToWord } from "@/lib/office/client";
import type { PreviewBlock } from "@/lib/office/pdf-to-office";
import type { CellValue } from "@/lib/office/xlsx";
import { parsePageRanges } from "@/lib/pdf/ranges";
import { replaceExtension } from "@/lib/zip";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { FidelityNote } from "../shared/ConversionParts";
import { Field, INPUT, Segmented } from "../shared/controls";
import { OutputCard, PRIMARY, type OutputFile } from "../shared/OutputCard";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import { useT } from "@/store/locale";
import { msg } from "@/i18n/msg";

export function PdfToWordPanel({ file }: ToolPanelProps) {
  const pdf = usePdfDocument(file.file);
  if (pdf.status === "loading") return <PdfLoading />;
  if (pdf.status === "error") return <PdfLoadError message={pdf.message} code={pdf.code} />;
  return <ToWord file={file} doc={pdf.doc} />;
}

export function PdfToExcelPanel({ file }: ToolPanelProps) {
  const pdf = usePdfDocument(file.file);
  if (pdf.status === "loading") return <PdfLoading />;
  if (pdf.status === "error") return <PdfLoadError message={pdf.message} code={pdf.code} />;
  return <ToExcel file={file} doc={pdf.doc} />;
}

/** Page-range field state plus a conversion run with per-page progress. */
function useConversion<T>(file: WorkspaceFile, doc: PDFDocumentProxy) {
  const t = useT();
  const [rangeText, setRangeText] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<T | null>(null);
  const parsed = rangeText.trim() ? parsePageRanges(rangeText, doc.numPages) : null;
  const pages = parsed?.ok ? [...new Set(parsed.groups.flat())].sort((a, b) => a - b).map((i) => i + 1) : Array.from({ length: doc.numPages }, (_, i) => i + 1);

  const run = async (convert: (pages: number[], onPage: (done: number) => void) => Promise<T>) => {
    const { updateFile } = useWorkspaceStore.getState();
    setResult(null);
    setProgress({ done: 0, total: pages.length });
    updateFile(file.id, { status: "processing", error: undefined });
    try {
      setResult(await convert(pages, (done) => setProgress({ done, total: pages.length })));
      updateFile(file.id, { status: "idle" });
    } catch (error) {
      updateFile(file.id, { status: "error", error: errorMessage(error) });
      toast({ tone: "error", title: msg("Conversion failed"), description: errorMessage(error) });
    } finally {
      setProgress(null);
    }
  };

  const rangeField = (
    <Field label={t("Pages")} hint={t("Leave empty for all {count} pages, or type ranges such as 1-3, 5.", { count: doc.numPages })} error={parsed && !parsed.ok ? parsed.error : undefined}>
      <input
        value={rangeText}
        disabled={progress !== null}
        onChange={(e) => {
          setRangeText(e.target.value);
          setResult(null);
        }}
        placeholder={t("All pages")}
        className={INPUT}
      />
    </Field>
  );
  return { pages, valid: !parsed || parsed.ok, progress, result, setResult, run, rangeField };
}

function ConvertButton({ label, icon, progress, disabled, onClick }: { label: string; icon: ReactNode; progress: { done: number; total: number } | null; disabled: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} disabled={disabled || progress !== null} className={clsx(PRIMARY, "mt-5 w-full")}>
      {progress ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : icon}
      {progress ? (progress.done < progress.total ? t("Reading page {page} of {count}…", { page: progress.done + 1, count: progress.total }) : t("Building the file…")) : label}
    </button>
  );
}

function Layout({ preview, actions }: { preview: ReactNode; actions: ReactNode }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {preview}
      <div className="order-first space-y-4 lg:sticky lg:top-20 lg:order-0">{actions}</div>
    </div>
  );
}

function SourcePreview({ doc }: { doc: PDFDocumentProxy }) {
  const t = useT();
  return (
    <section className="rounded-xl border border-line bg-surface" aria-label={t("Preview")}>
      <div className="border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">{t("Preview · page 1 of {count}", { count: doc.numPages })}</div>
      <div className="flex justify-center bg-surface-muted p-4">
        <PageThumbnail doc={doc} pageNumber={1} width={300} height={380} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------- PDF to Word

interface WordResult {
  blob: Blob;
  paragraphs: number;
  headings: number;
  preview: PreviewBlock[];
}

function ToWord({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const t = useT();
  const [pageBreaks, setPageBreaks] = useState(true);
  const conversion = useConversion<WordResult>(file, doc);
  const { result } = conversion;

  return (
    <Layout
      preview={result ? <DocumentPreview blocks={result.preview} /> : <SourcePreview doc={doc} />}
      actions={
        <>
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="flex items-center gap-2 font-semibold text-fg">
              <FileText className="size-4 text-brand-text" aria-hidden="true" />
              {t("Convert to Word")}
            </h2>
            <FidelityNote>
              {t("Text, headings, lists and bold/italic come across as editable paragraphs. Images, exact positions and original fonts don't. Scanned PDFs have no text to extract.")}
            </FidelityNote>
            {conversion.rangeField}
            <label className="mt-4 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={pageBreaks}
                onChange={(e) => {
                  setPageBreaks(e.target.checked);
                  conversion.setResult(null);
                }}
                className="mt-0.5 size-4 shrink-0 accent-brand"
              />
              <span>
                <span className="block text-sm font-medium text-fg">{t("Keep page breaks")}</span>
                <span className="block text-xs text-fg-muted">{t("Start each PDF page on a new page. Off: text flows, and paragraphs split by a page are rejoined.")}</span>
              </span>
            </label>
            <ConvertButton
              label={t("Convert to .docx")}
              icon={<FileText className="size-4" aria-hidden="true" />}
              progress={conversion.progress}
              disabled={!conversion.valid}
              onClick={() => conversion.run((pages, onPage) => pdfToWord(doc, pages, { pageBreaks }, onPage))}
            />
          </section>
          {result && (
            <OutputCard
              title={t("Word document ready")}
              outputs={[
                {
                  name: replaceExtension(file.name, ".docx"),
                  blob: result.blob,
                  detail: t("{paragraphs} paragraphs, {headings} headings", { paragraphs: result.paragraphs, headings: result.headings }),
                } satisfies OutputFile,
              ]}
            />
          )}
        </>
      }
    />
  );
}

function DocumentPreview({ blocks }: { blocks: PreviewBlock[] }) {
  const t = useT();
  return (
    <section className="rounded-xl border border-line bg-surface" aria-label={t("Document preview")}>
      <div className="border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">{t("Extracted text · first paragraphs")}</div>
      <div className="max-h-[36rem] space-y-2.5 overflow-y-auto px-6 py-5 text-sm text-fg">
        {blocks.map((b, i) => {
          if (b.kind === "h1") return <h3 key={i} className="pt-2 text-xl font-semibold">{b.text}</h3>;
          if (b.kind === "h2") return <h4 key={i} className="pt-1.5 text-lg font-semibold">{b.text}</h4>;
          if (b.kind === "h3") return <h5 key={i} className="pt-1 font-semibold">{b.text}</h5>;
          return (
            <p key={i} className={clsx("leading-relaxed text-fg-muted", b.kind === "li" && "ps-4")}>
              {b.text}
            </p>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------- PDF to Excel

interface ExcelResult {
  blob: Blob;
  sheets: number;
  rows: number;
  preview: CellValue[][];
}

function ToExcel({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const t = useT();
  const [layout, setLayout] = useState<"sheet-per-page" | "single-sheet">("sheet-per-page");
  const conversion = useConversion<ExcelResult>(file, doc);
  const { result } = conversion;

  return (
    <Layout
      preview={result ? <SheetPreview rows={result.preview} /> : <SourcePreview doc={doc} />}
      actions={
        <>
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="flex items-center gap-2 font-semibold text-fg">
              <FileSpreadsheet className="size-4 text-brand-text" aria-hidden="true" />
              {t("Convert to Excel")}
            </h2>
            <FidelityNote>
              {t("Text is arranged into rows and columns by its position on the page, and numbers become real numbers. Works best on clearly laid-out tables; merged cells and colours aren't kept.")}
            </FidelityNote>
            {conversion.rangeField}
            <Segmented
              label={t("Sheets")}
              value={layout}
              onChange={(v) => {
                setLayout(v);
                conversion.setResult(null);
              }}
              options={[
                { id: "sheet-per-page", label: t("One per page") },
                { id: "single-sheet", label: t("All on one") },
              ]}
            />
            <ConvertButton
              label={t("Convert to .xlsx")}
              icon={<FileSpreadsheet className="size-4" aria-hidden="true" />}
              progress={conversion.progress}
              disabled={!conversion.valid}
              onClick={() => conversion.run((pages, onPage) => pdfToExcel(doc, pages, { layout }, onPage))}
            />
          </section>
          {result && (
            <OutputCard
              title={t("Spreadsheet ready")}
              outputs={[
                {
                  name: replaceExtension(file.name, ".xlsx"),
                  blob: result.blob,
                  detail: `${t.plural(result.sheets, "{n} sheet", "{n} sheets")}, ${t.plural(result.rows, "{n} row", "{n} rows")}`,
                },
              ]}
            />
          )}
        </>
      }
    />
  );
}

function SheetPreview({ rows }: { rows: CellValue[][] }) {
  const t = useT();
  const columns = Math.max(1, ...rows.map((r) => r.length));
  return (
    <section className="rounded-xl border border-line bg-surface" aria-label={t("Spreadsheet preview")}>
      <div className="border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">{t("First sheet · first rows")}</div>
      <div className="max-h-[36rem] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-line">
                <th className="w-10 bg-surface-muted px-2 py-1.5 text-end text-xs font-medium text-fg-subtle tabular-nums">{r + 1}</th>
                {Array.from({ length: columns }, (_, c) => {
                  const value = row[c];
                  return (
                    <td key={c} className={clsx("border-s border-line px-2.5 py-1.5 whitespace-nowrap text-fg", typeof value === "number" && "text-end tabular-nums")}>
                      {value ?? ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------- PDF to PowerPoint

export function PdfToPowerPointPanel({ file }: ToolPanelProps) {
  const pdf = usePdfDocument(file.file);
  if (pdf.status === "loading") return <PdfLoading />;
  if (pdf.status === "error") return <PdfLoadError message={pdf.message} code={pdf.code} />;
  return <ToPowerPoint file={file} doc={pdf.doc} />;
}

interface SlidesResult {
  blob: Blob;
  slides: number;
  textBoxes: number;
}

function ToPowerPoint({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const t = useT();
  const [mode, setMode] = useState<SlideMode>("editable");
  const conversion = useConversion<SlidesResult>(file, doc);
  const { result } = conversion;
  const progress = conversion.progress && { ...conversion.progress, done: Math.floor(conversion.progress.done) };

  return (
    <Layout
      preview={<SourcePreview doc={doc} />}
      actions={
        <>
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="flex items-center gap-2 font-semibold text-fg">
              <Presentation className="size-4 text-brand-text" aria-hidden="true" />
              {t("Convert to PowerPoint")}
            </h2>
            <Segmented
              label={t("Slides")}
              value={mode}
              onChange={(v) => {
                setMode(v);
                conversion.setResult(null);
              }}
              options={[
                { id: "editable", label: t("Editable text") },
                { id: "pictures", label: t("Pictures of pages") },
              ]}
            />
            <FidelityNote>
              {mode === "editable"
                ? t("Each page's text becomes text boxes in the same place, over a picture of the rest of the page (drawings, photos, backgrounds). Fonts are replaced by standard ones, so line lengths can differ a little.")
                : t("Each slide is an exact picture of the page. Nothing on it can be edited, but it looks just like the PDF.")}
            </FidelityNote>
            {conversion.rangeField}
            <ConvertButton
              label={t("Convert to .pptx")}
              icon={<Presentation className="size-4" aria-hidden="true" />}
              progress={progress}
              disabled={!conversion.valid}
              onClick={() => conversion.run((pages, onPage) => pdfToPowerPoint(file.file, doc, pages, mode, onPage))}
            />
          </section>
          {result && (
            <OutputCard
              title={t("Presentation ready")}
              outputs={[
                {
                  name: replaceExtension(file.name, ".pptx"),
                  blob: result.blob,
                  detail: mode === "editable" ? `${t.plural(result.slides, "{n} slide", "{n} slides")}, ${t.plural(result.textBoxes, "{n} text box", "{n} text boxes")}` : t.plural(result.slides, "{n} slide", "{n} slides"),
                },
              ]}
            />
          )}
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------- PDF to Text & Markdown

export function PdfToTextPanel({ file }: ToolPanelProps) {
  const pdf = usePdfDocument(file.file);
  if (pdf.status === "loading") return <PdfLoading />;
  if (pdf.status === "error") return <PdfLoadError message={pdf.message} code={pdf.code} />;
  return <ToText file={file} doc={pdf.doc} />;
}

interface TextResult {
  text: string;
  format: PdfToTextOptions["format"];
  paragraphs: number;
  headings: number;
  words: number;
}

function ToText({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const t = useT();
  const [format, setFormat] = useState<PdfToTextOptions["format"]>("markdown");
  const [pageMarkers, setPageMarkers] = useState(false);
  const conversion = useConversion<TextResult>(file, doc);
  const { result } = conversion;
  const extension = result?.format === "markdown" ? ".md" : ".txt";

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      toast({ tone: "success", title: msg("Text copied") });
    } catch {
      toast({ tone: "error", title: msg("Couldn't copy"), description: msg("Your browser blocked the clipboard. Download the file instead.") });
    }
  };

  return (
    <Layout
      preview={
        result ? (
          <section className="min-w-0 rounded-xl border border-line bg-surface" aria-label={t("Extracted text")}>
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <span className="text-xs font-medium tracking-wider text-fg-subtle uppercase">{result.format === "markdown" ? t("Markdown") : t("Text")}</span>
              <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-muted hover:text-fg">
                <Copy className="size-3.5" aria-hidden="true" />
                {t("Copy")}
              </button>
            </div>
            <pre className="max-h-[36rem] overflow-auto px-5 py-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg">{result.text}</pre>
          </section>
        ) : (
          <SourcePreview doc={doc} />
        )
      }
      actions={
        <>
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="flex items-center gap-2 font-semibold text-fg">
              <LetterText className="size-4 text-brand-text" aria-hidden="true" />
              {t("Extract text")}
            </h2>
            <Segmented
              label={t("Format")}
              value={format}
              onChange={(v) => {
                setFormat(v);
                conversion.setResult(null);
              }}
              options={[
                { id: "markdown", label: t("Markdown") },
                { id: "text", label: t("Plain text") },
              ]}
            />
            <FidelityNote>
              {format === "markdown"
                ? t("Headings, bold and italic, lists and simple tables become Markdown.")
                : t("Paragraphs are rejoined and separated by blank lines.")}{" "}
              {t("Columns are read one after the other and running headers and footers are left out. Scanned pages need OCR PDF first.")}
            </FidelityNote>
            {conversion.rangeField}
            <label className="mt-4 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={pageMarkers}
                onChange={(e) => {
                  setPageMarkers(e.target.checked);
                  conversion.setResult(null);
                }}
                className="mt-0.5 size-4 shrink-0 accent-brand"
              />
              <span>
                <span className="block text-sm font-medium text-fg">{t("Mark where pages start")}</span>
                <span className="block text-xs text-fg-muted">{t("Off: paragraphs split by a page break are rejoined.")}</span>
              </span>
            </label>
            <ConvertButton
              label={format === "markdown" ? t("Extract as .md") : t("Extract as .txt")}
              icon={<LetterText className="size-4" aria-hidden="true" />}
              progress={conversion.progress}
              disabled={!conversion.valid}
              onClick={() => conversion.run(async (pages, onPage) => ({ ...(await pdfToText(doc, pages, { format, pageMarkers }, onPage)), format }))}
            />
          </section>
          {result && (
            <OutputCard
              title={t("Text ready")}
              outputs={[
                {
                  name: replaceExtension(file.name, extension),
                  blob: new Blob([result.text], { type: result.format === "markdown" ? "text/markdown" : "text/plain" }),
                  detail: t("{words} words, {paragraphs} paragraphs", { words: result.words, paragraphs: result.paragraphs }),
                },
              ]}
            />
          )}
        </>
      }
    />
  );
}
