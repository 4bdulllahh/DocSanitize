"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Hash, LoaderCircle, PanelTop } from "lucide-react";
import { batesFiles, headerFooterFile } from "@/lib/pdf/client";
import { batesLabel, SLOTS, type BatesOptions, type HeaderFooterOptions, type Slot } from "@/lib/pdf/markup";
import { openPdfForRendering } from "@/lib/pdf/render";
import { withSuffix } from "@/lib/zip";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import { errorMessage } from "@/lib/errors";
import { toast } from "@/store/toast";
import type { ToolPanelProps } from "../registry";
import { AnchorPicker, ColorField, Field, INPUT, Segmented, Slider, type AnchorId } from "../shared/controls";
import { OutputCard, PRIMARY, type OutputFile } from "../shared/OutputCard";
import { StampPreview, useStampPreview } from "../shared/StampPreview";
import { DocGate, Layout, ToolCard, useApply, usePageField } from "../shared/toolkit";

const COLORS = [
  { value: "#374151", name: "Grey" },
  { value: "#111111", name: "Black" },
  { value: "#263a81", name: "Navy" },
  { value: "#b91c1c", name: "Red" },
];
const MARGINS = { small: 18, medium: 30, large: 48 } as const;
type Margin = keyof typeof MARGINS;
const MARGIN_OPTIONS: { id: Margin; label: string }[] = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
];
const EDGE_ANCHORS: AnchorId[] = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"];

// ---------------------------------------------------------------------------- Header & footer

export function HeaderFooterPanel({ file }: ToolPanelProps) {
  return <DocGate file={file}>{(doc) => <HeaderFooter file={file} doc={doc} />}</DocGate>;
}

const SLOT_LABELS: Record<Slot, string> = {
  "top-left": "Header, left",
  "top-center": "Header, centre",
  "top-right": "Header, right",
  "bottom-left": "Footer, left",
  "bottom-center": "Footer, centre",
  "bottom-right": "Footer, right",
};
const TOKENS = [
  { token: "{page}", label: "Page number" },
  { token: "{pages}", label: "Page count" },
  { token: "{date}", label: "Today's date" },
  { token: "{file}", label: "File name" },
];

function HeaderFooter({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const { busy, output, setOutput, apply } = useApply(file, "header-footer");
  const [slots, setSlots] = useState<Partial<Record<Slot, string>>>({ "top-right": "{file}", "bottom-center": "Page {page} of {pages}" });
  const [focused, setFocused] = useState<Slot>("bottom-center");
  const [size, setSize] = useState(9);
  const [color, setColor] = useState(COLORS[0].value);
  const [margin, setMargin] = useState<Margin>("medium");
  const [start, setStart] = useState(1);
  const range = usePageField(doc.numPages);
  const inputs = useRef<Partial<Record<Slot, HTMLInputElement | null>>>({});
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  const options: HeaderFooterOptions = { slots, size, color, margin: MARGINS[margin], start: Number.isFinite(start) ? start : 1, pages: range.pages, date, file: file.name, total: doc.numPages };
  const previewPages = Math.min(2, doc.numPages);
  const preview = useStampPreview(file.file, previewPages, JSON.stringify(options), (firstPages) =>
    SLOTS.some((s) => slots[s]?.trim()) ? headerFooterFile(firstPages, { ...options, pages: range.pages?.filter((p) => p < previewPages) ?? undefined }) : Promise.resolve(firstPages),
  );
  const set = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setOutput(null);
  };
  const insert = (token: string) => {
    const el = inputs.current[focused];
    const text = slots[focused] ?? "";
    const at = el?.selectionStart ?? text.length;
    set(setSlots)({ ...slots, [focused]: text.slice(0, at) + token + text.slice(el?.selectionEnd ?? at) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };
  const empty = !SLOTS.some((s) => slots[s]?.trim());

  return (
    <Layout
      main={<StampPreview {...preview} />}
      actions={
        <>
          <ToolCard icon={PanelTop} title="Header & footer">
            <div className="mt-3 grid grid-cols-1 gap-x-3 sm:grid-cols-2 lg:grid-cols-1">
              {SLOTS.map((slot) => (
                <Field key={slot} label={SLOT_LABELS[slot]}>
                  <input
                    ref={(el) => {
                      inputs.current[slot] = el;
                    }}
                    value={slots[slot] ?? ""}
                    onFocus={() => setFocused(slot)}
                    onChange={(e) => set(setSlots)({ ...slots, [slot]: e.target.value })}
                    placeholder="Empty"
                    maxLength={120}
                    className={INPUT}
                  />
                </Field>
              ))}
            </div>
            <p className="mt-3 text-xs text-fg-subtle">Insert into “{SLOT_LABELS[focused]}”:</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {TOKENS.map((t) => (
                <button key={t.token} type="button" onClick={() => insert(t.token)} className="rounded-md border border-line px-2 py-1 text-xs text-fg-muted hover:border-brand-border hover:text-brand-text" title={t.label}>
                  {t.token}
                </button>
              ))}
            </div>
            <Slider label="Size" value={size} min={6} max={20} format={(v) => `${v} pt`} onChange={set(setSize)} />
            <ColorField label="Colour" value={color} onChange={set(setColor)} presets={COLORS} />
            <Segmented label="Distance from the edge" value={margin} onChange={set(setMargin)} options={MARGIN_OPTIONS} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="First page number">
                <input type="number" min={0} value={Number.isFinite(start) ? start : ""} onChange={(e) => set(setStart)(e.target.valueAsNumber)} className={INPUT} />
              </Field>
              <Field label="Pages" error={range.error}>
                <input value={range.text} onChange={(e) => set(range.setText)(e.target.value)} placeholder="All" className={INPUT} />
              </Field>
            </div>
            <button type="button" onClick={() => apply(() => headerFooterFile(file.file, { ...options, total: undefined }))} disabled={busy || empty || Boolean(range.error)} className={clsx(PRIMARY, "mt-5 w-full")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <PanelTop className="size-4" aria-hidden="true" />}
              {busy ? "Adding…" : "Add header & footer"}
            </button>
          </ToolCard>
          {output && <OutputCard title="Header & footer added" outputs={[output]} replaceFileId={file.id} />}
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------- Bates numbering

/** Page counts of several PDFs (null while unknown or unreadable). */
function usePageCounts(files: WorkspaceFile[]) {
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const key = files.map((f) => `${f.id}:${f.revision}`).join();
  useEffect(() => {
    let active = true;
    (async () => {
      for (const f of files) {
        try {
          const opened = await openPdfForRendering(f.file);
          const n = opened.doc.numPages;
          opened.destroy();
          if (active) setCounts((c) => ({ ...c, [`${f.id}:${f.revision}`]: n }));
        } catch {
          if (active) setCounts((c) => ({ ...c, [`${f.id}:${f.revision}`]: null }));
        }
      }
    })();
    return () => {
      active = false;
    };
    // `key` captures the files that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (f: WorkspaceFile) => counts[`${f.id}:${f.revision}`];
}

export function BatesPanel({ files }: ToolPanelProps) {
  const [prefix, setPrefix] = useState("DOC-");
  const [suffix, setSuffix] = useState("");
  const [start, setStart] = useState(1);
  const [digits, setDigits] = useState(6);
  const [position, setPosition] = useState<AnchorId>("bottom-right");
  const [margin, setMargin] = useState<Margin>("small");
  const [size, setSize] = useState(9);
  const [color, setColor] = useState(COLORS[1].value);
  const [busy, setBusy] = useState(false);
  const [outputs, setOutputs] = useState<OutputFile[] | null>(null);
  const countOf = usePageCounts(files);
  const set = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setOutputs(null);
  };

  const options: BatesOptions = { prefix, suffix, start: Number.isFinite(start) ? start : 1, digits: Number.isFinite(digits) ? digits : 6, position, margin: MARGINS[margin], size, color };
  const valid = options.start >= 0 && Number.isInteger(options.start) && options.digits >= 1 && options.digits <= 12;
  const first = files[0];
  const preview = useStampPreview(first.file, 1, JSON.stringify(options), async (firstPage) => (valid ? (await batesFiles([firstPage], options))[0].blob : firstPage));

  // Each file's first number is the start plus the pages of the files before it.
  const counts = files.map((f) => countOf(f));
  const ranges = counts.map((n, i) => {
    if (n == null || counts.slice(0, i).some((c) => c == null)) return null;
    const first = options.start + counts.slice(0, i).reduce<number>((sum, c) => sum + (c ?? 0), 0);
    return [batesLabel(options, first), batesLabel(options, first + n - 1)] as const;
  });

  const run = async () => {
    const { updateFile } = useWorkspaceStore.getState();
    setBusy(true);
    setOutputs(null);
    try {
      const results = await batesFiles(
        files.map((f) => f.file),
        options,
      );
      setOutputs(results.map((r, i) => ({ name: withSuffix(files[i].name, "bates"), blob: r.blob, detail: `${r.first} – ${r.last}` })));
      files.forEach((f) => updateFile(f.id, { status: "idle", error: undefined }));
    } catch (error) {
      toast({ tone: "error", title: "Couldn't number the files", description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout
      main={
        <div className="space-y-4">
          <section className="rounded-xl border border-line bg-surface" aria-label="Files in numbering order">
            <header className="border-b border-line px-4 py-3 text-sm text-fg-muted">Numbered in tab order; drag the tabs above to reorder.</header>
            <ol className="divide-y divide-line">
              {files.map((f, i) => (
                <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 truncate font-medium text-fg">{f.name}</span>
                  <span className="shrink-0 font-mono text-xs text-fg-muted">{ranges[i] ? `${ranges[i][0]} – ${ranges[i][1]}` : "…"}</span>
                </li>
              ))}
            </ol>
          </section>
          <StampPreview {...preview} />
        </div>
      }
      actions={
        <>
          <ToolCard icon={Hash} title="Bates numbering">
            <p className="mt-1 text-sm text-fg-muted">Gives every page of every open PDF a unique number, continuing from one file to the next.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prefix">
                <input value={prefix} onChange={(e) => set(setPrefix)(e.target.value)} maxLength={30} className={INPUT} />
              </Field>
              <Field label="Suffix">
                <input value={suffix} onChange={(e) => set(setSuffix)(e.target.value)} maxLength={30} className={INPUT} />
              </Field>
              <Field label="First number" error={options.start >= 0 && Number.isInteger(options.start) ? undefined : "0 or more"}>
                <input type="number" min={0} value={Number.isFinite(start) ? start : ""} onChange={(e) => set(setStart)(e.target.valueAsNumber)} className={INPUT} />
              </Field>
              <Field label="Digits" error={options.digits >= 1 && options.digits <= 12 ? undefined : "1 to 12"}>
                <input type="number" min={1} max={12} value={Number.isFinite(digits) ? digits : ""} onChange={(e) => set(setDigits)(e.target.valueAsNumber)} className={INPUT} />
              </Field>
            </div>
            <p className="mt-2 font-mono text-xs text-fg-subtle">e.g. {batesLabel(options, options.start)}</p>
            <AnchorPicker label="Position" value={position} onChange={set(setPosition)} allowed={EDGE_ANCHORS} />
            <Segmented label="Distance from the edge" value={margin} onChange={set(setMargin)} options={MARGIN_OPTIONS} />
            <Slider label="Size" value={size} min={6} max={16} format={(v) => `${v} pt`} onChange={set(setSize)} />
            <ColorField label="Colour" value={color} onChange={set(setColor)} presets={COLORS} />
            <button type="button" onClick={run} disabled={busy || !valid} className={clsx(PRIMARY, "mt-5 w-full")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Hash className="size-4" aria-hidden="true" />}
              {busy ? "Numbering…" : `Number ${files.length === 1 ? "the PDF" : `${files.length} PDFs`}`}
            </button>
          </ToolCard>
          {outputs && <OutputCard title="Bates numbers added" outputs={outputs} zipName="bates-numbered.zip" replaceFileId={outputs.length === 1 ? files[0].id : undefined} />}
        </>
      }
    />
  );
}
