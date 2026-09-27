"use client";

import { useState, type ReactNode } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { FileSpreadsheet, FileText, LoaderCircle } from "lucide-react";
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
      toast({ tone: "error", title: "Conversion failed", description: errorMessage(error) });
    } finally {
      setProgress(null);
    }
  };

  const rangeField = (
    <Field label="Pages" hint={`Leave empty for all ${doc.numPages} pages, or type ranges such as 1-3, 5.`} error={parsed && !parsed.ok ? parsed.error : undefined}>
      <input
        value={rangeText}
        disabled={progress !== null}
        onChange={(e) => {
          setRangeText(e.target.value);
          setResult(null);
        }}
        placeholder="All pages"
        className={INPUT}
      />
    </Field>
  );
  return { pages, valid: !parsed || parsed.ok, progress, result, setResult, run, rangeField };
}

function ConvertButton({ label, icon, progress, disabled, onClick }: { label: string; icon: ReactNode; progress: { done: number; total: number } | null; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || progress !== null} className={clsx(PRIMARY, "mt-5 w-full")}>
      {progress ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : icon}
      {progress ? (progress.done < progress.total ? `Reading page ${progress.done + 1} of ${progress.total}…` : "Building the file…") : label}
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
  return (
    <section className="rounded-xl border border-line bg-surface" aria-label="Preview">
      <div className="border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">Preview · page 1 of {doc.numPages}</div>
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
              Convert to Word
            </h2>
            <FidelityNote>
              Text, headings, lists and bold/italic come across as editable paragraphs. Images, exact positions and original fonts don&apos;t. Scanned
              PDFs have no text to extract.
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
                <span className="block text-sm font-medium text-fg">Keep page breaks</span>
                <span className="block text-xs text-fg-muted">Start each PDF page on a new page. Off: text flows, and paragraphs split by a page are rejoined.</span>
              </span>
            </label>
            <ConvertButton
              label="Convert to .docx"
              icon={<FileText className="size-4" aria-hidden="true" />}
              progress={conversion.progress}
              disabled={!conversion.valid}
              onClick={() => conversion.run((pages, onPage) => pdfToWord(doc, pages, { pageBreaks }, onPage))}
            />
          </section>
          {result && (
            <OutputCard
              title="Word document ready"
              outputs={[
                {
                  name: replaceExtension(file.name, ".docx"),
                  blob: result.blob,
                  detail: `${result.paragraphs} paragraphs, ${result.headings} headings`,
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
  return (
    <section className="rounded-xl border border-line bg-surface" aria-label="Document preview">
      <div className="border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">Extracted text · first paragraphs</div>
      <div className="max-h-[36rem] space-y-2.5 overflow-y-auto px-6 py-5 text-sm text-fg">
        {blocks.map((b, i) => {
          if (b.kind === "h1") return <h3 key={i} className="pt-2 text-xl font-semibold">{b.text}</h3>;
          if (b.kind === "h2") return <h4 key={i} className="pt-1.5 text-lg font-semibold">{b.text}</h4>;
          if (b.kind === "h3") return <h5 key={i} className="pt-1 font-semibold">{b.text}</h5>;
          return (
            <p key={i} className={clsx("leading-relaxed text-fg-muted", b.kind === "li" && "pl-4")}>
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
              Convert to Excel
            </h2>
            <FidelityNote>
              Text is arranged into rows and columns by its position on the page, and numbers become real numbers. Works best on clearly laid-out
              tables; merged cells and colours aren&apos;t kept.
            </FidelityNote>
            {conversion.rangeField}
            <Segmented
              label="Sheets"
              value={layout}
              onChange={(v) => {
                setLayout(v);
                conversion.setResult(null);
              }}
              options={[
                { id: "sheet-per-page", label: "One per page" },
                { id: "single-sheet", label: "All on one" },
              ]}
            />
            <ConvertButton
              label="Convert to .xlsx"
              icon={<FileSpreadsheet className="size-4" aria-hidden="true" />}
              progress={conversion.progress}
              disabled={!conversion.valid}
              onClick={() => conversion.run((pages, onPage) => pdfToExcel(doc, pages, { layout }, onPage))}
            />
          </section>
          {result && (
            <OutputCard
              title="Spreadsheet ready"
              outputs={[
                {
                  name: replaceExtension(file.name, ".xlsx"),
                  blob: result.blob,
                  detail: `${result.sheets} sheet${result.sheets === 1 ? "" : "s"}, ${result.rows} rows`,
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
  const columns = Math.max(1, ...rows.map((r) => r.length));
  return (
    <section className="rounded-xl border border-line bg-surface" aria-label="Spreadsheet preview">
      <div className="border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">First sheet · first rows</div>
      <div className="max-h-[36rem] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-line">
                <th className="w-10 bg-surface-muted px-2 py-1.5 text-right text-xs font-medium text-fg-subtle tabular-nums">{r + 1}</th>
                {Array.from({ length: columns }, (_, c) => {
                  const value = row[c];
                  return (
                    <td key={c} className={clsx("border-l border-line px-2.5 py-1.5 whitespace-nowrap text-fg", typeof value === "number" && "text-right tabular-nums")}>
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
