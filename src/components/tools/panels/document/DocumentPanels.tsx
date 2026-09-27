"use client";

import { useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ArrowDown, ArrowUp, Bookmark as BookmarkIcon, ChevronLeft, ChevronRight, Eraser, FileText, IndentDecrease, IndentIncrease, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { PageStage } from "@/components/pdf/PageStage";
import { PageStrip } from "@/components/pdf/PageStrip";
import { createId } from "@/lib/files";
import { readFileBookmarks, readFileInfo, writeFileBookmarks, writeFileInfo } from "@/lib/pdf/client";
import { INFO_FIELDS, type Bookmark, type DocumentInfo, type InfoField } from "@/lib/pdf/info";
import type { WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { FidelityNote } from "../shared/ConversionParts";
import { Field, INPUT } from "../shared/controls";
import { OutputCard, PRIMARY, SECONDARY } from "../shared/OutputCard";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import { DocGate, Layout, ToolCard, useApply, useLoaded } from "../shared/toolkit";

// ---------------------------------------------------------------------------- Properties

export function PropertiesPanel({ file }: ToolPanelProps) {
  const loaded = useLoaded(file, readFileInfo);
  if (!loaded) return <PdfLoading />;
  if (!loaded.value) return <PdfLoadError message={loaded.error ?? "This PDF couldn't be read."} code={loaded.code} />;
  return <PropertiesForm key={`${file.id}:${file.revision}`} file={file} initial={loaded.value} />;
}

const HINTS: Partial<Record<InfoField, string>> = {
  Keywords: "Separate with commas",
  Creator: "The app the document was made in",
  Producer: "The app that made the PDF",
};

/** ISO -> the value of a datetime-local input (local time). */
const toLocal = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (value: string) => (value ? new Date(value).toISOString() : "");

function PropertiesForm({ file, initial }: { file: WorkspaceFile; initial: DocumentInfo }) {
  const { busy, output, setOutput, apply } = useApply(file, "properties");
  const [fields, setFields] = useState(initial.fields);
  const [created, setCreated] = useState(toLocal(initial.created));
  const [modified, setModified] = useState(toLocal(initial.modified));
  const changed = () => setOutput(null);

  return (
    <Layout
      main={
        <section className="rounded-xl border border-line bg-surface p-5" aria-label="Document properties">
          <div className="grid gap-x-4 sm:grid-cols-2">
            {INFO_FIELDS.map((key) => (
              <Field key={key} label={key} hint={HINTS[key]}>
                <input
                  value={fields[key]}
                  onChange={(e) => {
                    setFields({ ...fields, [key]: e.target.value });
                    changed();
                  }}
                  placeholder="Not set"
                  maxLength={500}
                  className={INPUT}
                />
              </Field>
            ))}
            <Field label="Created">
              <input type="datetime-local" value={created} onChange={(e) => (setCreated(e.target.value), changed())} className={INPUT} />
            </Field>
            <Field label="Modified">
              <input type="datetime-local" value={modified} onChange={(e) => (setModified(e.target.value), changed())} className={INPUT} />
            </Field>
          </div>
        </section>
      }
      actions={
        <>
          <ToolCard icon={FileText} title="Edit properties">
            <p className="mt-1 text-sm text-fg-muted">
              Set exactly what the file says about itself. Empty fields are removed. To see and remove everything hidden in a file, use{" "}
              <Link href="/tools/sanitize" className="font-medium text-brand-text underline underline-offset-4">
                Sanitize Metadata
              </Link>
              .
            </p>
            {initial.hasXmp && <FidelityNote>This file also keeps a second copy of these details (XMP). It&apos;s removed, so every reader shows what you set here.</FidelityNote>}
            <button
              type="button"
              onClick={() => {
                setFields(Object.fromEntries(INFO_FIELDS.map((k) => [k, ""])) as Record<InfoField, string>);
                setCreated("");
                setModified("");
                changed();
              }}
              className={clsx(SECONDARY, "mt-4 w-full")}
            >
              <Eraser className="size-4" aria-hidden="true" />
              Clear everything
            </button>
            <button type="button" onClick={() => apply(() => writeFileInfo(file.file, { fields, created: fromLocal(created), modified: fromLocal(modified) }))} disabled={busy} className={clsx(PRIMARY, "mt-2 w-full")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
              {busy ? "Saving…" : "Save properties"}
            </button>
          </ToolCard>
          {output && <OutputCard title="Properties saved" outputs={[output]} replaceFileId={file.id} />}
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------- Bookmarks

export function BookmarksPanel({ file }: ToolPanelProps) {
  const loaded = useLoaded(file, readFileBookmarks);
  return (
    <DocGate file={file}>
      {(doc) =>
        !loaded ? <PdfLoading /> : loaded.value ? <BookmarkEditor key={`${file.id}:${file.revision}`} file={file} doc={doc} initial={loaded.value} /> : <PdfLoadError message={loaded.error ?? "This PDF couldn't be read."} code={loaded.code} />
      }
    </DocGate>
  );
}

type Item = Bookmark & { id: string };

/** Keep levels valid: the first is 0 and each is at most one deeper than the one before. */
function normalise(items: Item[]): Item[] {
  return items.map((item, i) => ({ ...item, level: i === 0 ? 0 : Math.max(0, Math.min(item.level, items[i - 1].level + 1)) }));
}

/** An item and everything nested under it. */
function blockEnd(items: Item[], i: number): number {
  let end = i + 1;
  while (end < items.length && items[end].level > items[i].level) end++;
  return end;
}

const ICON_BUTTON = "rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent";

function BookmarkEditor({ file, doc, initial }: { file: WorkspaceFile; doc: PDFDocumentProxy; initial: Bookmark[] }) {
  const { busy, output, setOutput, apply } = useApply(file, "bookmarks");
  const [items, setItems] = useState<Item[]>(() => initial.map((b) => ({ ...b, id: createId() })));
  const [current, setCurrent] = useState(0);
  const [focusId, setFocusId] = useState<string | null>(null);
  const update = (next: Item[]) => {
    setItems(normalise(next));
    setOutput(null);
  };
  const patch = (id: string, p: Partial<Item>) => update(items.map((it) => (it.id === id ? { ...it, ...p } : it)));

  const move = (i: number, direction: -1 | 1) => {
    const end = blockEnd(items, i);
    const block = items.slice(i, end);
    if (direction === -1) {
      // Swap with the previous sibling block (or the item before, at the same level).
      let j = i - 1;
      while (j > 0 && items[j].level > items[i].level) j--;
      if (j < 0 || items[j].level < items[i].level) return;
      update([...items.slice(0, j), ...block, ...items.slice(j, i), ...items.slice(end)]);
    } else {
      if (end >= items.length || items[end].level < items[i].level) return;
      const nextEnd = blockEnd(items, end);
      update([...items.slice(0, i), ...items.slice(end, nextEnd), ...block, ...items.slice(nextEnd)]);
    }
  };
  const shift = (i: number, delta: -1 | 1) => {
    const end = blockEnd(items, i);
    update(items.map((it, k) => (k >= i && k < end ? { ...it, level: it.level + delta } : it)));
  };
  const add = () => {
    const id = createId();
    const selected = items.findIndex((it) => it.page === current);
    const at = selected === -1 ? items.length : blockEnd(items, selected);
    const level = selected === -1 ? 0 : items[selected].level;
    update([...items.slice(0, at), { id, title: `Page ${current + 1}`, page: current, level }, ...items.slice(at)]);
    setFocusId(id);
  };

  return (
    <Layout
      main={
        <section className="min-w-0 rounded-xl border border-line bg-surface" aria-label="Page">
          {doc.numPages > 1 && <PageStrip doc={doc} current={current} onSelect={setCurrent} counts={Object.fromEntries(items.flatMap((b) => (b.page === null ? [] : [[b.page, 1]])))} noun="bookmark" />}
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
            <button type="button" className={ICON_BUTTON} disabled={current === 0} onClick={() => setCurrent(current - 1)} aria-label="Previous page">
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-fg-muted tabular-nums">
              Page {current + 1} of {doc.numPages}
            </span>
            <button type="button" className={ICON_BUTTON} disabled={current === doc.numPages - 1} onClick={() => setCurrent(current + 1)} aria-label="Next page">
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="bg-surface-muted p-3 sm:p-5">
            <PageStage doc={doc} index={current} maxWidth={620} />
          </div>
        </section>
      }
      actions={
        <>
          <ToolCard icon={BookmarkIcon} title="Bookmarks">
            <p className="mt-1 text-sm text-fg-muted">The outline readers show beside the document. Click one to see its page.</p>
            {items.length === 0 ? (
              <p className="mt-4 rounded-lg bg-surface-muted px-3 py-3 text-center text-sm text-fg-muted">No bookmarks yet.</p>
            ) : (
              <ol className="mt-4 max-h-[26rem] space-y-1 overflow-y-auto" aria-label="Bookmark list">
                {items.map((item, i) => (
                  <li key={item.id} className={clsx("rounded-lg border p-2", item.page === current ? "border-brand-border bg-brand-soft/60" : "border-line")} style={{ marginLeft: item.level * 14 }}>
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus={item.id === focusId}
                        onFocus={(e) => {
                          if (item.page !== null) setCurrent(item.page);
                          if (item.id === focusId) e.currentTarget.select();
                        }}
                        value={item.title}
                        onChange={(e) => patch(item.id, { title: e.target.value })}
                        aria-label={`Bookmark ${i + 1} title`}
                        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-fg outline-none hover:border-line focus:border-brand-border focus:bg-canvas"
                      />
                      <label className="flex shrink-0 items-center gap-1 text-xs text-fg-subtle">
                        p.
                        <input
                          type="number"
                          min={1}
                          max={doc.numPages}
                          value={item.page === null ? "" : item.page + 1}
                          onChange={(e) => {
                            const n = e.target.valueAsNumber;
                            patch(item.id, { page: Number.isFinite(n) ? Math.max(0, Math.min(doc.numPages - 1, n - 1)) : null });
                            if (Number.isFinite(n)) setCurrent(Math.max(0, Math.min(doc.numPages - 1, n - 1)));
                          }}
                          aria-label={`Bookmark ${i + 1} page`}
                          className="w-12 rounded-md border border-line bg-canvas px-1 py-0.5 text-right text-xs text-fg tabular-nums"
                        />
                      </label>
                    </div>
                    <div className="mt-1 flex justify-end gap-0.5">
                      <button type="button" className={ICON_BUTTON} onClick={() => shift(i, -1)} disabled={item.level === 0} aria-label={`Move “${item.title}” out a level`}>
                        <IndentDecrease className="size-3.5" />
                      </button>
                      <button type="button" className={ICON_BUTTON} onClick={() => shift(i, 1)} disabled={i === 0 || item.level > items[i - 1].level} aria-label={`Move “${item.title}” in a level`}>
                        <IndentIncrease className="size-3.5" />
                      </button>
                      <button type="button" className={ICON_BUTTON} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move “${item.title}” up`}>
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button type="button" className={ICON_BUTTON} onClick={() => move(i, 1)} disabled={blockEnd(items, i) >= items.length} aria-label={`Move “${item.title}” down`}>
                        <ArrowDown className="size-3.5" />
                      </button>
                      <button type="button" className={ICON_BUTTON} onClick={() => update([...items.slice(0, i), ...items.slice(blockEnd(items, i))])} aria-label={`Delete “${item.title}” and what's under it`}>
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <button type="button" onClick={add} className={clsx(SECONDARY, "mt-3 w-full")}>
              <Plus className="size-4" aria-hidden="true" />
              Add a bookmark for page {current + 1}
            </button>
            <button type="button" onClick={() => apply(() => writeFileBookmarks(file.file, items.map(({ title, page, level }) => ({ title, page, level }))))} disabled={busy || items.some((it) => !it.title.trim())} className={clsx(PRIMARY, "mt-2 w-full")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
              {busy ? "Saving…" : "Save bookmarks"}
            </button>
            {items.some((it) => !it.title.trim()) && <p className="mt-2 text-xs text-danger-text">Every bookmark needs a title.</p>}
          </ToolCard>
          {output && <OutputCard title="Bookmarks saved" outputs={[output]} replaceFileId={file.id} />}
        </>
      }
    />
  );
}
