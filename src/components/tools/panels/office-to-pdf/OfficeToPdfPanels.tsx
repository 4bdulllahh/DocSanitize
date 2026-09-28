"use client";

import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { FileCode, FileType, LoaderCircle, Projector, Sheet } from "lucide-react";
import { powerPointToPdf, textFileToPdf } from "@/lib/convert/client";
import { textFormatOf } from "@/lib/convert/text-document";
import { errorMessage, ProcessingError, type ProcessingErrorCode } from "@/lib/errors";
import { inspectSpreadsheet, spreadsheetToPdf, wordToPdf } from "@/lib/office/client";
import type { SheetSummary, SheetToPdfOptions } from "@/lib/office/sheet";
import { replaceExtension } from "@/lib/zip";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { FidelityNote, PdfResultPreview, WarningList } from "../shared/ConversionParts";
import { Segmented } from "../shared/controls";
import { OutputCard, PRIMARY } from "../shared/OutputCard";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import { useT } from "@/store/locale";
import { msg } from "@/i18n/msg";

type PageSize = "a4" | "letter";

interface Result {
  blob: Blob;
  pages: number;
  warnings: string[];
}

/** Runs a conversion for a file, tracking busy state and the tab's status icon. */
function useConvert(file: WorkspaceFile) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const run = async (convert: () => Promise<Result>) => {
    const { updateFile } = useWorkspaceStore.getState();
    setBusy(true);
    setResult(null);
    updateFile(file.id, { status: "processing", error: undefined });
    try {
      setResult(await convert());
      updateFile(file.id, { status: "idle" });
    } catch (error) {
      updateFile(file.id, { status: "error", error: errorMessage(error) });
      toast({ tone: "error", title: msg("Conversion failed"), description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };
  return { busy, result, setResult, run };
}

function Layout({ file, result, placeholder, actions }: { file: WorkspaceFile; result: Result | null; placeholder: ReactNode; actions: ReactNode }) {
  const t = useT();
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-4">
        {result ? (
          <>
            <WarningList warnings={result.warnings} />
            <PdfResultPreview blob={result.blob} pages={result.pages} />
          </>
        ) : (
          placeholder
        )}
      </div>
      <div className="order-first space-y-4 lg:sticky lg:top-20 lg:order-0">
        {actions}
        {result && <OutputCard title={t("PDF ready")} outputs={[{ name: replaceExtension(file.name, ".pdf"), blob: result.blob, detail: t.plural(result.pages, "{n} page", "{n} pages") }]} />}
      </div>
    </div>
  );
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center text-sm text-fg-muted">
      {children}
    </div>
  );
}

const PAGE_SIZES = [
  { id: "a4" as const, label: "A4" },
  { id: "letter" as const, label: msg("Letter") },
];

function ConvertButton({ busy, disabled, icon, onClick }: { busy: boolean; disabled?: boolean; icon: ReactNode; onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} disabled={busy || disabled} className={clsx(PRIMARY, "mt-5 w-full")}>
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : icon}
      {busy ? t("Converting…") : t("Convert to PDF")}
    </button>
  );
}

// ---------------------------------------------------------------------------- Word to PDF

export function WordToPdfPanel({ file }: ToolPanelProps) {
  const t = useT();
  const [pageSize, setPageSize] = useState<PageSize>("a4");
  const { busy, result, setResult, run } = useConvert(file);

  return (
    <Layout
      file={file}
      result={result}
      placeholder={
        <Placeholder>
          <FileType className="size-8 text-fg-subtle" aria-hidden="true" />
          <p className="font-medium text-fg">{t("Your PDF preview appears here")}</p>
          <p className="max-w-sm">{t("The document is converted in your browser; nothing is uploaded.")}</p>
        </Placeholder>
      }
      actions={
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-semibold text-fg">
            <FileType className="size-4 text-brand-text" aria-hidden="true" />
            {t("Word to PDF")}
          </h2>
          <FidelityNote>
            {t("Keeps headings, paragraphs, bold/italic/underline, lists, tables, links, JPEG/PNG images and footnotes, typeset in a standard font. Headers, footers, comments, text boxes and exact page layout aren't reproduced.")}
          </FidelityNote>
          <Segmented
            label={t("Page size")}
            value={pageSize}
            onChange={(v) => {
              setPageSize(v);
              setResult(null);
            }}
            options={PAGE_SIZES}
          />
          <ConvertButton busy={busy} icon={<FileType className="size-4" aria-hidden="true" />} onClick={() => run(() => wordToPdf(file.file, file.name, { pageSize }))} />
        </section>
      }
    />
  );
}

// ---------------------------------------------------------------------------- Excel to PDF

type Inspection = { status: "loading" } | { status: "ready"; sheets: SheetSummary[] } | { status: "error"; message: string; code?: ProcessingErrorCode };

function useSheets(file: WorkspaceFile): Inspection {
  const [result, setResult] = useState<{ file: File; state: Inspection } | null>(null);
  useEffect(() => {
    let active = true;
    inspectSpreadsheet(file.file, file.name)
      .then((sheets) => active && setResult({ file: file.file, state: { status: "ready", sheets } }))
      .catch((error: unknown) => {
        if (active) {
          setResult({
            file: file.file,
            state: { status: "error", message: errorMessage(error), code: error instanceof ProcessingError ? error.code : undefined },
          });
        }
      });
    return () => {
      active = false;
    };
  }, [file.file, file.name]);
  return result?.file === file.file ? result.state : { status: "loading" };
}

export function ExcelToPdfPanel({ file }: ToolPanelProps) {
  const t = useT();
  const inspection = useSheets(file);
  if (inspection.status === "loading") return <PdfLoading label={t("Reading sheets")} />;
  // Spreadsheet errors are never about PDF passwords, so no "Unlock PDF" link.
  if (inspection.status === "error") {
    return <PdfLoadError title={t("Couldn't open this spreadsheet")} message={inspection.message} code={inspection.code === "encrypted" ? undefined : inspection.code} />;
  }
  return <SheetConverter file={file} sheets={inspection.sheets} />;
}

function SheetConverter({ file, sheets }: { file: WorkspaceFile; sheets: SheetSummary[] }) {
  const t = useT();
  const [chosen, setChosen] = useState(() => new Set(sheets.filter((s) => !s.hidden && s.rows > 0).map((s) => s.name)));
  const [pageSize, setPageSize] = useState<PageSize>("a4");
  const [orientation, setOrientation] = useState<SheetToPdfOptions["orientation"]>("auto");
  const [headerRow, setHeaderRow] = useState(true);
  const { busy, result, setResult, run } = useConvert(file);

  const toggle = (name: string) => {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setResult(null);
  };
  const options: SheetToPdfOptions = { sheets: sheets.filter((s) => chosen.has(s.name)).map((s) => s.name), pageSize, orientation, headerRow };

  return (
    <Layout
      file={file}
      result={result}
      placeholder={
        <Placeholder>
          <Sheet className="size-8 text-fg-subtle" aria-hidden="true" />
          <p className="font-medium text-fg">{t("Your PDF preview appears here")}</p>
          <p className="max-w-sm">{t("Each sheet becomes a table. Wide sheets switch to landscape, and very wide ones are split into column groups.")}</p>
        </Placeholder>
      }
      actions={
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-semibold text-fg">
            <Sheet className="size-4 text-brand-text" aria-hidden="true" />
            {t("Spreadsheet to PDF")}
          </h2>
          <FidelityNote>{t("Values appear as formatted in the workbook (dates, currency, percentages). Charts, colours, fonts and formulas' source aren't included.")}</FidelityNote>

          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-fg">{t("Sheets")}</legend>
            <ul className="mt-1.5 max-h-48 divide-y divide-line overflow-y-auto rounded-lg border border-line">
              {sheets.map((s) => (
                <li key={s.name}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                    <input type="checkbox" checked={chosen.has(s.name)} onChange={() => toggle(s.name)} className="size-4 shrink-0 accent-brand" />
                    <span className="min-w-0 flex-1 truncate font-medium text-fg">{s.name}</span>
                    <span className="shrink-0 text-xs text-fg-subtle tabular-nums">
                      {s.rows === 0 ? t("empty") : `${s.rows.toLocaleString()} × ${s.columns}`}
                      {s.hidden && t(" · hidden")}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <Segmented
            label={t("Page size")}
            value={pageSize}
            onChange={(v) => {
              setPageSize(v);
              setResult(null);
            }}
            options={PAGE_SIZES}
          />
          <Segmented
            label={t("Orientation")}
            value={orientation}
            onChange={(v) => {
              setOrientation(v);
              setResult(null);
            }}
            options={[
              { id: "auto", label: t("Auto") },
              { id: "portrait", label: t("Portrait") },
              { id: "landscape", label: t("Landscape") },
            ]}
          />
          <label className="mt-4 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={headerRow}
              onChange={(e) => {
                setHeaderRow(e.target.checked);
                setResult(null);
              }}
              className="mt-0.5 size-4 shrink-0 accent-brand"
            />
            <span>
              <span className="block text-sm font-medium text-fg">{t("First row is a header")}</span>
              <span className="block text-xs text-fg-muted">{t("Shaded, bold and repeated at the top of every page.")}</span>
            </span>
          </label>
          <ConvertButton
            busy={busy}
            disabled={options.sheets.length === 0}
            icon={<Sheet className="size-4" aria-hidden="true" />}
            onClick={() => run(() => spreadsheetToPdf(file.file, file.name, options))}
          />
          {options.sheets.length === 0 && <p className="mt-2 text-xs text-fg-subtle">{t("Choose at least one sheet.")}</p>}
        </section>
      }
    />
  );
}

// ---------------------------------------------------------------------------- PowerPoint to PDF

export function PowerPointToPdfPanel({ file }: ToolPanelProps) {
  const t = useT();
  const [hiddenSlides, setHiddenSlides] = useState(false);
  const { busy, result, setResult, run } = useConvert(file);

  return (
    <Layout
      file={file}
      result={result}
      placeholder={
        <Placeholder>
          <Projector className="size-8 text-fg-subtle" aria-hidden="true" />
          <p className="font-medium text-fg">{t("Your PDF preview appears here")}</p>
          <p className="max-w-sm">{t("Each slide becomes one page, the slide's size. The presentation is converted in your browser; nothing is uploaded.")}</p>
        </Placeholder>
      }
      actions={
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-semibold text-fg">
            <Projector className="size-4 text-brand-text" aria-hidden="true" />
            {t("PowerPoint to PDF")}
          </h2>
          <FidelityNote>
            {t("Keeps slide backgrounds, the master's design, text with its colours, bullets and alignment, pictures, common shapes and tables, in a standard font. Charts, SmartArt, animations, videos and complex shapes aren't reproduced exactly.")}
          </FidelityNote>
          <label className="mt-4 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={hiddenSlides}
              onChange={(e) => {
                setHiddenSlides(e.target.checked);
                setResult(null);
              }}
              className="mt-0.5 size-4 shrink-0 accent-brand"
            />
            <span>
              <span className="block text-sm font-medium text-fg">{t("Include hidden slides")}</span>
              <span className="block text-xs text-fg-muted">{t("Slides hidden in the slide show are left out unless this is on.")}</span>
            </span>
          </label>
          <ConvertButton busy={busy} icon={<Projector className="size-4" aria-hidden="true" />} onClick={() => run(() => powerPointToPdf(file.file, file.name, { hiddenSlides }))} />
        </section>
      }
    />
  );
}

// ---------------------------------------------------------------------------- Markdown, HTML & text to PDF

const FORMAT_NAMES = { markdown: "Markdown", html: "HTML", text: msg("Plain text") };

export function TextToPdfPanel({ file }: ToolPanelProps) {
  const t = useT();
  const [pageSize, setPageSize] = useState<PageSize>("a4");
  const [margins, setMargins] = useState<"normal" | "narrow">("normal");
  const [mono, setMono] = useState(false);
  const { busy, result, setResult, run } = useConvert(file);
  const format = textFormatOf(file.name);
  const reset =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setResult(null);
    };

  return (
    <Layout
      file={file}
      result={result}
      placeholder={
        <Placeholder>
          <FileCode className="size-8 text-fg-subtle" aria-hidden="true" />
          <p className="font-medium text-fg">{t("Your PDF preview appears here")}</p>
          <p className="max-w-sm">{t("The file is read as {format} and typeset in your browser. Nothing is uploaded, and nothing it links to is downloaded.", { format: t(FORMAT_NAMES[format]) })}</p>
        </Placeholder>
      }
      actions={
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-semibold text-fg">
            <FileCode className="size-4 text-brand-text" aria-hidden="true" />
            {t("{format} to PDF", { format: t(FORMAT_NAMES[format]) })}
          </h2>
          <FidelityNote>
            {format === "text"
              ? t("Every line is kept as it is; long lines wrap.")
              : t("Keeps headings, paragraphs, bold/italic, links, lists, quotes, code blocks, tables and pictures stored in the file. Web styles (CSS), scripts and pictures from the web aren't used.")}
          </FidelityNote>
          <Segmented label={t("Page size")} value={pageSize} onChange={reset(setPageSize)} options={PAGE_SIZES} />
          <Segmented
            label={t("Margins")}
            value={margins}
            onChange={reset(setMargins)}
            options={[
              { id: "normal", label: t("Normal") },
              { id: "narrow", label: t("Narrow") },
            ]}
          />
          {format === "text" && (
            <label className="mt-4 flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={mono} onChange={(e) => reset(setMono)(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-brand" />
              <span>
                <span className="block text-sm font-medium text-fg">{t("Fixed-width font")}</span>
                <span className="block text-xs text-fg-muted">{t("Keeps columns and ASCII art lined up (for logs, code and tables made with spaces).")}</span>
              </span>
            </label>
          )}
          <ConvertButton busy={busy} icon={<FileCode className="size-4" aria-hidden="true" />} onClick={() => run(() => textFileToPdf(file.file, file.name, { pageSize, margins, mono }))} />
        </section>
      }
    />
  );
}
