"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ArrowDownToLine, Contrast, FilePlus2, Layers2, LoaderCircle, RotateCw, Scaling, Trash2 } from "lucide-react";
import { usePageSelection } from "@/components/pdf/usePageSelection";
import { deletePagesOfFile, flattenFile, grayscaleFile, insertIntoFile, resizeFile, rotateFile } from "@/lib/pdf/client";
import { PAGE_SIZES, type PageSizeName } from "@/lib/pdf/pages";
import type { WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { FidelityNote, PdfResultPreview } from "../shared/ConversionParts";
import { Field, INPUT, Segmented } from "../shared/controls";
import { OutputCard, PRIMARY } from "../shared/OutputCard";
import { DocGate, Layout, PageGrid, SelectionSummary, ToolCard, useApply, usePageField } from "../shared/toolkit";

const all = (n: number) => Array.from({ length: n }, (_, i) => i);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function RunButton({ busy, disabled, onClick, icon: Icon, children, busyText = "Working…" }: { busy: boolean; disabled?: boolean; onClick: () => void; icon: typeof RotateCw; children: string; busyText?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={busy || disabled} className={clsx(PRIMARY, "mt-5 w-full")}>
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Icon className="size-4" aria-hidden="true" />}
      {busy ? busyText : children}
    </button>
  );
}

function PagesField({ selection }: { selection: ReturnType<typeof usePageSelection> }) {
  return (
    <Field label="Pages" hint="Click pages, or type ranges such as 1-3, 5, 8-" error={selection.error}>
      <input value={selection.text} onChange={(e) => selection.type(e.target.value)} placeholder="Click pages or type ranges" className={INPUT} />
    </Field>
  );
}

// ---------------------------------------------------------------------------- Rotate

export function RotatePanel({ file }: ToolPanelProps) {
  return <DocGate file={file}>{(doc) => <Rotator file={file} doc={doc} />}</DocGate>;
}

function Rotator({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const { busy, output, setOutput, apply } = useApply(file, "rotated");
  const selection = usePageSelection(doc.numPages, all(doc.numPages), () => setOutput(null));
  const [angle, setAngle] = useState<"90" | "180" | "270">("90");
  const chosen = new Set(selection.selected);
  return (
    <Layout
      main={
        <PageGrid
          doc={doc}
          header={<SelectionSummary count={chosen.size} total={doc.numPages} onAll={selection.selectAll} onClear={selection.clear} />}
          tile={(i) => ({ selected: chosen.has(i), rotation: chosen.has(i) ? Number(angle) : 0, label: `Page ${i + 1}${chosen.has(i) ? ", will be rotated" : ""}` })}
          onTileClick={(i, e) => selection.click(i, e)}
        />
      }
      actions={
        <>
          <ToolCard icon={RotateCw} title="Rotate pages">
            <Segmented
              label="Turn"
              value={angle}
              onChange={(v) => {
                setAngle(v);
                setOutput(null);
              }}
              options={[
                { id: "90", label: "Right 90°" },
                { id: "180", label: "180°" },
                { id: "270", label: "Left 90°" },
              ]}
            />
            <PagesField selection={selection} />
            <RunButton busy={busy} disabled={!chosen.size || Boolean(selection.error)} onClick={() => apply(() => rotateFile(file.file, selection.selected, Number(angle)))} icon={RotateCw}>
              {`Rotate ${plural(chosen.size, "page")}`}
            </RunButton>
          </ToolCard>
          {output && <OutputCard title="Pages rotated" outputs={[output]} replaceFileId={file.id} />}
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------- Delete

export function DeletePagesPanel({ file }: ToolPanelProps) {
  return <DocGate file={file}>{(doc) => <Deleter file={file} doc={doc} />}</DocGate>;
}

function Deleter({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const { busy, output, setOutput, apply } = useApply(file, "pages-removed");
  const selection = usePageSelection(doc.numPages, [], () => setOutput(null));
  const chosen = new Set(selection.selected);
  const everything = chosen.size === doc.numPages;
  return (
    <Layout
      main={
        <PageGrid
          doc={doc}
          header={<SelectionSummary count={chosen.size} total={doc.numPages} noun="to delete" onAll={selection.selectAll} onClear={selection.clear} />}
          tile={(i) => ({
            selected: chosen.has(i),
            dimmed: chosen.has(i),
            label: `Page ${i + 1}${chosen.has(i) ? ", will be deleted" : ""}`,
            badge: chosen.has(i) && <span className="absolute top-3 left-3 rounded bg-danger px-1.5 py-0.5 text-[10px] font-semibold text-white">Delete</span>,
          })}
          onTileClick={(i, e) => selection.click(i, e)}
        />
      }
      actions={
        <>
          <ToolCard icon={Trash2} title="Delete pages">
            <p className="mt-1 text-sm text-fg-muted">Deleted pages are removed from the file completely, not just hidden.</p>
            <PagesField selection={selection} />
            {everything && <p className="mt-2 text-xs text-danger-text">Keep at least one page.</p>}
            <RunButton busy={busy} disabled={!chosen.size || everything || Boolean(selection.error)} onClick={() => apply(() => deletePagesOfFile(file.file, selection.selected))} icon={Trash2}>
              {chosen.size ? `Delete ${plural(chosen.size, "page")}` : "Select pages to delete"}
            </RunButton>
          </ToolCard>
          {output && <OutputCard title="Pages deleted" outputs={[output]} replaceFileId={file.id} />}
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------- Insert

export function InsertPagesPanel({ file, files }: ToolPanelProps) {
  return <DocGate file={file}>{(doc) => <Inserter file={file} files={files} doc={doc} />}</DocGate>;
}

type Size = PageSizeName | "match";
const SIZE_OPTIONS: { id: Size; label: string }[] = [
  { id: "match", label: "Same as page" },
  { id: "a4", label: "A4" },
  { id: "letter", label: "Letter" },
];

function Inserter({ file, files, doc }: { file: WorkspaceFile; files: WorkspaceFile[]; doc: PDFDocumentProxy }) {
  const { busy, output, setOutput, apply } = useApply(file, "inserted");
  const others = files.filter((f) => f.id !== file.id);
  const [what, setWhat] = useState<"blank" | "pdf">("blank");
  const [at, setAt] = useState(doc.numPages);
  const [count, setCount] = useState(1);
  const [size, setSize] = useState<Size>("match");
  const [sourceId, setSourceId] = useState(others[0]?.id ?? "");
  const source = others.find((f) => f.id === sourceId) ?? others[0];
  const [sourcePages, setSourcePages] = useState("");
  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setOutput(null);
  };
  const where = at === 0 ? "at the start" : at >= doc.numPages ? "at the end" : `between pages ${at} and ${at + 1}`;
  const countOk = Number.isInteger(count) && count >= 1 && count <= 500;
  const range = sourcePages.trim() ? sourcePages.split(",").map((s) => s.trim()) : null;

  const run = () =>
    apply(async () => {
      if (what === "blank") return insertIntoFile(file.file, { at, blank: { count, size } });
      let pages: number[] | undefined;
      if (range) {
        pages = [];
        for (const part of range) {
          const [a, b] = part.split("-").map((n) => parseInt(n, 10));
          if (!Number.isFinite(a)) throw new Error(`“${part}” isn't a page range.`);
          const end = part.includes("-") ? (Number.isFinite(b) ? b : 100000) : a;
          for (let p = a; p <= end && p <= 100000; p++) pages.push(p - 1);
        }
      }
      return insertIntoFile(file.file, { at, source: { file: source!.file, name: source!.name, pages } });
    });

  return (
    <Layout
      main={
        <PageGrid
          doc={doc}
          header={<p className="text-sm text-fg-muted">Click a page to insert before it. New pages go {where}.</p>}
          tile={(i) => ({
            selected: false,
            label: `Insert before page ${i + 1}`,
            badge: (i === at || (at >= doc.numPages && i === doc.numPages - 1)) && (
              <span className={clsx("absolute inset-y-3 w-1.5 rounded-full bg-brand", i === at ? "-left-1.5" : "-right-1.5")} aria-hidden="true" />
            ),
          })}
          onTileClick={(i) => change(setAt)(i)}
        />
      }
      actions={
        <>
          <ToolCard icon={FilePlus2} title="Insert pages">
            <Segmented
              label="Insert"
              value={what}
              onChange={change(setWhat)}
              options={[
                { id: "blank", label: "Blank pages" },
                { id: "pdf", label: "Another PDF", disabled: others.length === 0 },
              ]}
            />
            {others.length === 0 && <p className="mt-2 text-xs text-fg-subtle">To insert pages from another PDF, open it in a tab too (drop it here).</p>}
            <Field label="Position" hint={`New pages go ${where}.`}>
              <select value={at} onChange={(e) => change(setAt)(Number(e.target.value))} className={INPUT}>
                <option value={0}>At the start</option>
                {Array.from({ length: doc.numPages - 1 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    After page {i + 1}
                  </option>
                ))}
                <option value={doc.numPages}>At the end</option>
              </select>
            </Field>
            {what === "blank" ? (
              <>
                <Field label="How many" error={countOk ? undefined : "Between 1 and 500."}>
                  <input type="number" min={1} max={500} value={Number.isFinite(count) ? count : ""} onChange={(e) => change(setCount)(e.target.valueAsNumber)} className={INPUT} />
                </Field>
                <Segmented label="Size" value={size} onChange={change(setSize)} options={SIZE_OPTIONS} />
              </>
            ) : (
              source && (
                <>
                  <Field label="From">
                    <select value={source.id} onChange={(e) => change(setSourceId)(e.target.value)} className={INPUT}>
                      {others.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Its pages" hint="Empty for all, or ranges such as 1-3, 5">
                    <input value={sourcePages} onChange={(e) => change(setSourcePages)(e.target.value)} placeholder="All pages" className={INPUT} />
                  </Field>
                </>
              )
            )}
            <RunButton busy={busy} disabled={what === "blank" ? !countOk : !source} onClick={run} icon={FilePlus2}>
              {what === "blank" ? `Insert ${plural(countOk ? count : 0, "blank page")}` : "Insert pages"}
            </RunButton>
          </ToolCard>
          {output && <OutputCard title="Pages inserted" outputs={[output]} replaceFileId={file.id} />}
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------- Resize

export function ResizePanel({ file }: ToolPanelProps) {
  return <DocGate file={file}>{(doc) => <Resizer file={file} doc={doc} />}</DocGate>;
}

/** Displayed page sizes, in points. */
export function usePageSizes(doc: PDFDocumentProxy) {
  const [sizes, setSizes] = useState<{ doc: PDFDocumentProxy; sizes: { width: number; height: number }[] } | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all(all(doc.numPages).map(async (i) => (await doc.getPage(i + 1)).getViewport({ scale: 1 }))).then((viewports) => {
      if (active) setSizes({ doc, sizes: viewports.map((v) => ({ width: v.width, height: v.height })) });
    });
    return () => {
      active = false;
    };
  }, [doc]);
  return sizes?.doc === doc ? sizes.sizes : null;
}

/** "Letter" / "A4 landscape" / "210 × 99 mm". */
export function sizeName(size: { width: number; height: number }): string {
  const [short, long] = [Math.min(size.width, size.height), Math.max(size.width, size.height)];
  const named = Object.values(PAGE_SIZES).find((s) => Math.abs(s.width - short) < 2 && Math.abs(s.height - long) < 2);
  const mm = (pt: number) => Math.round((pt / 72) * 25.4);
  const orientation = size.width > size.height ? " landscape" : "";
  return named ? `${named.label}${orientation}` : `${mm(size.width)} × ${mm(size.height)} mm`;
}

function Resizer({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const { busy, output, setOutput, apply } = useApply(file, "resized");
  const sizes = usePageSizes(doc);
  const [size, setSize] = useState<PageSizeName | "custom">("a4");
  const [custom, setCustom] = useState({ width: 210, height: 297 });
  const [orientation, setOrientation] = useState<"auto" | "portrait" | "landscape">("auto");
  const range = usePageField(doc.numPages);
  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setOutput(null);
  };
  const mmToPt = (mm: number) => (mm / 25.4) * 72;
  const customOk = custom.width >= 25 && custom.height >= 25 && custom.width <= 5000 && custom.height <= 5000;
  const counts = new Map<string, number>();
  for (const s of sizes ?? []) counts.set(sizeName(s), (counts.get(sizeName(s)) ?? 0) + 1);

  return (
    <Layout
      main={<PageGrid doc={doc} header={<p className="text-sm text-fg-muted">Now: {sizes ? [...counts].map(([name, n]) => `${name}${n > 1 || counts.size > 1 ? ` × ${n}` : ""}`).join(", ") : "…"}</p>} tile={() => ({ selected: false })} />}
      actions={
        <>
          <ToolCard icon={Scaling} title="Change page size">
            <Segmented
              label="New size"
              value={size}
              onChange={change(setSize)}
              options={[...(Object.keys(PAGE_SIZES) as PageSizeName[]).map((id) => ({ id, label: PAGE_SIZES[id].label })), { id: "custom" as const, label: "Custom" }]}
              columns={3}
            />
            {size === "custom" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Width (mm)">
                  <input type="number" min={25} value={custom.width} onChange={(e) => change(setCustom)({ ...custom, width: e.target.valueAsNumber })} className={INPUT} />
                </Field>
                <Field label="Height (mm)">
                  <input type="number" min={25} value={custom.height} onChange={(e) => change(setCustom)({ ...custom, height: e.target.valueAsNumber })} className={INPUT} />
                </Field>
              </div>
            )}
            <Segmented
              label="Orientation"
              value={orientation}
              onChange={change(setOrientation)}
              options={[
                { id: "auto", label: "Keep each page's" },
                { id: "portrait", label: "Portrait" },
                { id: "landscape", label: "Landscape" },
              ]}
            />
            <Field label="Pages" error={range.error}>
              <input value={range.text} onChange={(e) => change(range.setText)(e.target.value)} placeholder="All" className={INPUT} />
            </Field>
            <FidelityNote>Content is scaled to fit the new size and centred; nothing is cut off. Links and comments move with it.</FidelityNote>
            <RunButton
              busy={busy}
              disabled={Boolean(range.error) || (size === "custom" && !customOk)}
              onClick={() => apply(() => resizeFile(file.file, { size: size === "custom" ? { width: mmToPt(custom.width), height: mmToPt(custom.height) } : size, orientation, pages: range.pages }))}
              icon={Scaling}
            >
              Resize pages
            </RunButton>
          </ToolCard>
          {output && <OutputCard title="Pages resized" outputs={[output]} replaceFileId={file.id} />}
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------- Grayscale

export function GrayscalePanel({ file }: ToolPanelProps) {
  return <DocGate file={file}>{(doc) => <Grayer file={file} doc={doc} />}</DocGate>;
}

function Grayer({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const { busy, output, apply } = useApply(file, "grayscale");
  const [stats, setStats] = useState<{ images: number; overlaid: number } | null>(null);
  return (
    <Layout
      main={output ? <PdfResultPreview blob={output.blob} /> : <PageGrid doc={doc} tile={() => ({ selected: false })} />}
      actions={
        <>
          <ToolCard icon={Contrast} title="Convert to grayscale">
            <p className="mt-1 text-sm text-fg-muted">Turns text, drawings and photos gray, for printing without colour ink. Images are converted too, which usually makes the file smaller.</p>
            <RunButton
              busy={busy}
              busyText="Converting…"
              onClick={() =>
                apply(async () => {
                  const { blob, images, overlaid } = await grayscaleFile(file.file);
                  setStats({ images, overlaid });
                  return blob;
                })
              }
              icon={Contrast}
            >
              Convert to grayscale
            </RunButton>
          </ToolCard>
          {output && stats && (
            <>
              <OutputCard title="Grayscale PDF ready" outputs={[{ ...output, detail: `${plural(stats.images, "image")} converted` }]} replaceFileId={file.id} />
              {stats.overlaid > 0 && (
                <FidelityNote>
                  {plural(stats.overlaid, "page")} had colours that can&apos;t be rewritten one by one (such as gradients or spot colours). They&apos;re shown in gray
                  with a blend layer instead, which current PDF readers and printers support.
                </FidelityNote>
              )}
            </>
          )}
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------- Flatten

export function FlattenPanel({ file }: ToolPanelProps) {
  return <DocGate file={file}>{(doc) => <Flattener file={file} doc={doc} />}</DocGate>;
}

/** How many form fields and (non-link) annotations the document has. */
function useAnnotationCounts(doc: PDFDocumentProxy) {
  const [counts, setCounts] = useState<{ doc: PDFDocumentProxy; fields: number; annotations: number } | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      // Fields by name (a radio group is one field with a widget per option).
      const names = new Set<string>();
      let annotations = 0;
      for (let i = 1; i <= doc.numPages; i++) {
        for (const a of await (await doc.getPage(i)).getAnnotations()) {
          if (a.subtype === "Widget") names.add(a.fieldName ?? `#${names.size}`);
          else if (a.subtype !== "Link" && a.subtype !== "Popup") annotations++;
        }
      }
      const fields = names.size;
      if (active) setCounts({ doc, fields, annotations });
    })().catch(() => {});
    return () => {
      active = false;
    };
  }, [doc]);
  return counts?.doc === doc ? counts : null;
}

function Flattener({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const { busy, output, setOutput, apply } = useApply(file, "flattened");
  const counts = useAnnotationCounts(doc);
  const [forms, setForms] = useState(true);
  const [annotations, setAnnotations] = useState(true);
  const [result, setResult] = useState<{ fields: number; annotations: number; kept: number } | null>(null);
  const nothing = counts !== null && counts.fields === 0 && counts.annotations === 0;
  const toggle = (set: (v: boolean) => void) => (e: { target: { checked: boolean } }) => {
    set(e.target.checked);
    setOutput(null);
  };
  return (
    <Layout
      main={output ? <PdfResultPreview blob={output.blob} /> : <PageGrid doc={doc} tile={() => ({ selected: false })} />}
      actions={
        <>
          <ToolCard icon={Layers2} title="Flatten PDF">
            <p className="mt-1 text-sm text-fg-muted">
              Makes filled-in forms, comments, highlights and stamps part of the page, so they look the same everywhere and can&apos;t be changed.
            </p>
            <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-sm text-fg-muted">
              {counts ? (nothing ? "This PDF has no form fields or comments to flatten." : `${plural(counts.fields, "form field")} and ${plural(counts.annotations, "comment")} (highlights and stamps included)`) : "Counting…"}
            </p>
            <label className="mt-4 flex cursor-pointer items-center gap-3 text-sm text-fg">
              <input type="checkbox" checked={forms} onChange={toggle(setForms)} className="size-4 accent-brand" />
              Form fields
            </label>
            <label className="mt-2 flex cursor-pointer items-center gap-3 text-sm text-fg">
              <input type="checkbox" checked={annotations} onChange={toggle(setAnnotations)} className="size-4 accent-brand" />
              Comments, highlights and stamps
            </label>
            <RunButton
              busy={busy}
              disabled={nothing || (!forms && !annotations)}
              onClick={() =>
                apply(async () => {
                  const { blob, ...r } = await flattenFile(file.file, { forms, annotations });
                  setResult(r);
                  return blob;
                })
              }
              icon={ArrowDownToLine}
            >
              Flatten
            </RunButton>
          </ToolCard>
          {output && result && (
            <>
              <OutputCard title="Flattened" outputs={[{ ...output, detail: `${plural(result.fields, "field")}, ${plural(result.annotations, "annotation")}` }]} replaceFileId={file.id} />
              {result.kept > 0 && <FidelityNote>{plural(result.kept, "comment")} had no appearance to draw (some readers draw note icons themselves) and were kept as comments.</FidelityNote>}
            </>
          )}
        </>
      }
    />
  );
}

