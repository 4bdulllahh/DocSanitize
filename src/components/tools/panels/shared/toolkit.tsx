"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { LucideIcon } from "lucide-react";
import { PageTile } from "@/components/pdf/PageTile";
import { usePdfDocument } from "@/components/pdf/usePdfDocument";
import { msg } from "@/i18n/msg";
import { Rich } from "@/i18n/Rich";
import { errorMessage } from "@/lib/errors";
import { parsePageRanges } from "@/lib/pdf/ranges";
import { withSuffix } from "@/lib/zip";
import { useT } from "@/store/locale";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { OutputFile } from "./OutputCard";
import { PdfLoadError, PdfLoading } from "./PdfStates";

/* Building blocks shared by the single-PDF tools (page tools, stamps, document properties). */

/** Opens the PDF, showing loading and error states, then renders the tool with it. */
export function DocGate({ file, children }: { file: WorkspaceFile; children: (doc: PDFDocumentProxy) => ReactNode }) {
  const pdf = usePdfDocument(file.file);
  if (pdf.status === "loading") return <PdfLoading />;
  if (pdf.status === "error") return <PdfLoadError message={pdf.message} code={pdf.code} />;
  return children(pdf.doc);
}

/** Main area on the left, sticky actions on the right (actions first on small screens). */
export function Layout({ main, actions }: { main: ReactNode; actions: ReactNode }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0">{main}</div>
      <div className="order-first space-y-4 lg:sticky lg:top-20 lg:order-0">{actions}</div>
    </div>
  );
}

export function ToolCard({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-semibold text-fg">
        <Icon className="size-4 text-brand-text" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Runs the tool on the whole file: tab status, errors as toasts, and the output. */
export function useApply(file: WorkspaceFile, suffix: string) {
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<OutputFile | null>(null);
  const apply = async (make: () => Promise<Blob>): Promise<boolean> => {
    const { updateFile } = useWorkspaceStore.getState();
    setBusy(true);
    setOutput(null);
    updateFile(file.id, { status: "processing", error: undefined });
    try {
      setOutput({ name: withSuffix(file.name, suffix), blob: await make() });
      updateFile(file.id, { status: "idle" });
      return true;
    } catch (error) {
      updateFile(file.id, { status: "error", error: errorMessage(error) });
      toast({ tone: "error", title: msg("Couldn't update the PDF"), description: errorMessage(error) });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, output, setOutput, apply };
}

/** An optional page-range field; empty means every page. */
export function usePageField(pageCount: number) {
  const [text, setText] = useState("");
  const parsed = text.trim() ? parsePageRanges(text, pageCount) : null;
  const pages = parsed?.ok ? [...new Set(parsed.groups.flat())].sort((a, b) => a - b) : undefined;
  return { text, setText, pages, error: parsed && !parsed.ok ? parsed.error : undefined };
}

/** A grid of page thumbnails; each tile's look comes from `tile`. */
export function PageGrid({
  doc,
  header,
  tile,
  onTileClick,
  label,
}: {
  doc: PDFDocumentProxy;
  header?: ReactNode;
  tile: (index: number) => { selected: boolean; dimmed?: boolean; rotation?: number; badge?: ReactNode; label?: string };
  onTileClick?: (index: number, event: MouseEvent) => void;
  label?: string;
}) {
  const t = useT();
  return (
    <section className="rounded-xl border border-line bg-surface" aria-label={label ?? t("Pages")}>
      {header && <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">{header}</header>}
      <ol className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3 p-4">
        {Array.from({ length: doc.numPages }, (_, i) => {
          const look = tile(i);
          return (
            <li key={i}>
              <PageTile
                doc={doc}
                index={i}
                selected={look.selected}
                dimmed={look.dimmed}
                rotation={look.rotation}
                pressed={onTileClick ? look.selected : undefined}
                label={look.label ?? t("Page {page}", { page: i + 1 })}
                badge={look.badge}
                onClick={(e) => onTileClick?.(i, e)}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** "3 of 12 pages selected · Select all · Clear" for a grid header. */
export function SelectionSummary({ count, total, action = "select", onAll, onClear }: { count: number; total: number; action?: "select" | "delete" | "remove"; onAll: () => void; onClear: () => void }) {
  const t = useT();
  const text = {
    select: t.plural(total, "{count} of {n} page selected", "{count} of {n} pages selected"),
    delete: t.plural(total, "{count} of {n} page to delete", "{count} of {n} pages to delete"),
    remove: t.plural(total, "{count} of {n} page to remove", "{count} of {n} pages to remove"),
  }[action];
  return (
    <>
      <p className="text-sm text-fg-muted">
        <Rich text={text} values={{ count: <span className="font-semibold text-fg">{t.number(count)}</span> }} />
      </p>
      <div className="flex gap-3 text-sm">
        <button type="button" className="text-brand-text hover:underline disabled:opacity-40" disabled={count === total} onClick={onAll}>
          {t("Select all")}
        </button>
        <button type="button" className={clsx("text-brand-text hover:underline disabled:opacity-40")} disabled={count === 0} onClick={onClear}>
          {t("Clear")}
        </button>
      </div>
    </>
  );
}

/** Load something from the file once per version of it. */
export function useLoaded<T>(file: WorkspaceFile, load: (blob: Blob) => Promise<T>) {
  const [state, setState] = useState<{ blob: Blob; value?: T; error?: string; code?: string } | null>(null);
  useEffect(() => {
    let active = true;
    load(file.file)
      .then((value) => active && setState({ blob: file.file, value }))
      .catch((error) => active && setState({ blob: file.file, error: errorMessage(error), code: (error as { code?: string }).code }));
    return () => {
      active = false;
    };
    // `load` is a module-level function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.file]);
  return state?.blob === file.file ? state : null;
}

