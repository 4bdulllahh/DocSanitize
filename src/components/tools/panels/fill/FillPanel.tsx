"use client";

import { useState, type CSSProperties } from "react";
import clsx from "clsx";
import Link from "next/link";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Check, ChevronLeft, ChevronRight, ClipboardPen, LoaderCircle, Save, Signature } from "lucide-react";
import { PageStage } from "@/components/pdf/PageStage";
import { PageStrip } from "@/components/pdf/PageStrip";
import { fillFileForm, readFileForm } from "@/lib/pdf/client";
import type { FieldValues, FormField, FormInfo } from "@/lib/pdf/forms";
import type { WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { FidelityNote } from "../shared/ConversionParts";
import { OutputCard, PRIMARY } from "../shared/OutputCard";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import { DocGate, Layout, ToolCard, useApply, useLoaded } from "../shared/toolkit";

export default function FillPanel({ file }: ToolPanelProps) {
  const loaded = useLoaded(file, readFileForm);
  return (
    <DocGate file={file}>
      {(doc) =>
        !loaded ? (
          <PdfLoading />
        ) : !loaded.value ? (
          <PdfLoadError message={loaded.error ?? "This PDF couldn't be read."} code={loaded.code} />
        ) : loaded.value.fields.length === 0 ? (
          <NoFields />
        ) : (
          <Filler key={`${file.id}:${file.revision}`} file={file} doc={doc} form={loaded.value} />
        )
      }
    </DocGate>
  );
}

function NoFields() {
  return (
    <section className="mx-auto max-w-lg rounded-xl border border-line bg-surface p-8 text-center">
      <ClipboardPen className="mx-auto size-10 text-fg-subtle" strokeWidth={1.5} aria-hidden="true" />
      <h2 className="mt-3 font-semibold text-fg">This PDF has no fillable fields</h2>
      <p className="mt-1 text-sm text-fg-muted">You can still fill it in: type on it, tick boxes and sign with Edit PDF.</p>
      <Link href="/tools/edit-pdf" className={clsx(PRIMARY, "mt-5")}>
        Open Edit PDF
      </Link>
    </section>
  );
}

/** "topmostSubform[0].Page1[0].FirstName[0]" -> "First Name". */
export function fieldLabel(name: string): string {
  const last = name.split(".").pop()!.replace(/\[\d+\]$/, "");
  return last.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim() || name;
}

const FIELD_STYLE = "border border-brand-border/60 bg-brand-soft/70 text-[#111] outline-none focus:border-brand focus:bg-white";

function Filler({ file, doc, form }: { file: WorkspaceFile; doc: PDFDocumentProxy; form: FormInfo }) {
  const { busy, output, setOutput, apply } = useApply(file, "filled");
  const [values, setValues] = useState<FieldValues>(() => Object.fromEntries(form.fields.map((f) => [f.name, f.value])));
  const [current, setCurrent] = useState(() => form.fields.flatMap((f) => f.widgets.map((w) => w.page)).sort((a, b) => a - b)[0] ?? 0);
  const [flatten, setFlatten] = useState(false);
  const set = (name: string, value: FieldValues[string]) => {
    setValues((v) => ({ ...v, [name]: value }));
    setOutput(null);
  };
  const fillable = form.fields.filter((f) => f.kind !== "button");
  const missing = fillable.filter((f) => f.required && (values[f.name] === "" || values[f.name] === false || (Array.isArray(values[f.name]) && !(values[f.name] as string[]).length)));
  const counts: Record<number, number> = {};
  for (const f of fillable) for (const w of f.widgets) counts[w.page] = (counts[w.page] ?? 0) + 1;

  return (
    <Layout
      main={
        <section className="min-w-0 rounded-xl border border-line bg-surface" aria-label="Form">
          {doc.numPages > 1 && <PageStrip doc={doc} current={current} onSelect={setCurrent} counts={counts} noun="field" />}
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
            <button type="button" className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40" disabled={current === 0} onClick={() => setCurrent(current - 1)} aria-label="Previous page">
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-fg-muted tabular-nums">
              Page {current + 1} of {doc.numPages}
            </span>
            <button type="button" className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40" disabled={current === doc.numPages - 1} onClick={() => setCurrent(current + 1)} aria-label="Next page">
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="bg-surface-muted p-3 sm:p-5">
            <PageStage doc={doc} index={current}>
              {(stage) => (
                <div className="absolute inset-0" role="group" aria-label={`Fields on page ${current + 1}`}>
                  {fillable.flatMap((field) =>
                    field.widgets
                      .filter((w) => w.page === current)
                      .map((w, k) => {
                        const k2 = stage.width / stage.pageWidth;
                        const style: CSSProperties = { position: "absolute", left: w.box.x * k2, top: w.box.y * k2, width: w.box.width * k2, height: w.box.height * k2 };
                        return <WidgetControl key={`${field.name}:${k}`} field={field} option={w.option} value={values[field.name]} onChange={(v) => set(field.name, v)} style={style} scale={k2} boxHeight={w.box.height} />;
                      }),
                  )}
                </div>
              )}
            </PageStage>
          </div>
        </section>
      }
      actions={
        <>
          <ToolCard icon={ClipboardPen} title="Fill in the form">
            <p className="mt-1 text-sm text-fg-muted">
              {fillable.length} field{fillable.length === 1 ? "" : "s"}. Fill them on the page or in the list.
              {missing.length > 0 && <span className="text-warning-text"> {missing.length} required still empty.</span>}
            </p>
            {form.xfa && <FidelityNote>This is an XFA form. Its standard fields are filled, and the XFA part (which some readers show instead) is removed so everyone sees the same values.</FidelityNote>}
            <ol className="mt-4 max-h-[22rem] space-y-3 overflow-y-auto pr-1" aria-label="All fields">
              {fillable.map((field) => (
                <li key={field.name} onFocus={() => field.widgets[0] && setCurrent(field.widgets[0].page)}>
                  <ListControl field={field} value={values[field.name]} onChange={(v) => set(field.name, v)} />
                </li>
              ))}
            </ol>
            <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-fg">
              <input type="checkbox" checked={flatten} onChange={(e) => (setFlatten(e.target.checked), setOutput(null))} className="mt-0.5 size-4 accent-brand" />
              <span>
                Flatten the form
                <span className="block text-xs text-fg-subtle">Makes the answers part of the page so they can&apos;t be changed.</span>
              </span>
            </label>
            <button type="button" onClick={() => apply(() => fillFileForm(file.file, values, { flatten }))} disabled={busy} className={clsx(PRIMARY, "mt-5 w-full")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
              {busy ? "Saving…" : "Save filled PDF"}
            </button>
          </ToolCard>
          {output && <OutputCard title="Form filled" outputs={[output]} replaceFileId={file.id} />}
        </>
      }
    />
  );
}

/** A field's control drawn over its spot on the page. */
function WidgetControl({ field, option, value, onChange, style, scale, boxHeight }: { field: FormField; option?: string; value: FieldValues[string]; onChange: (v: FieldValues[string]) => void; style: CSSProperties; scale: number; boxHeight: number }) {
  const label = fieldLabel(field.name);
  const fontSize = Math.max(7, Math.min(boxHeight * 0.62, 13)) * scale;
  const disabled = field.readOnly;
  switch (field.kind) {
    case "text":
      return field.multiline ? (
        <textarea aria-label={label} value={value as string} maxLength={field.maxLength} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={clsx(FIELD_STYLE, "resize-none px-0.5 leading-tight")} style={{ ...style, fontSize }} />
      ) : (
        <input aria-label={label} value={value as string} maxLength={field.maxLength} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={clsx(FIELD_STYLE, "px-0.5")} style={{ ...style, fontSize }} />
      );
    case "checkbox":
      return (
        <button type="button" role="checkbox" aria-checked={value as boolean} aria-label={label} disabled={disabled} onClick={() => onChange(!value)} className={clsx(FIELD_STYLE, "flex items-center justify-center")} style={style}>
          {value && <Check className="size-[80%]" strokeWidth={3} aria-hidden="true" />}
        </button>
      );
    case "radio":
      return (
        <button type="button" role="radio" aria-checked={value === option} aria-label={`${label}: ${option}`} disabled={disabled} onClick={() => onChange(option ?? "")} className={clsx(FIELD_STYLE, "flex items-center justify-center rounded-full")} style={style}>
          {value === option && <span className="size-[55%] rounded-full bg-[#111]" aria-hidden="true" />}
        </button>
      );
    case "dropdown":
      return (
        <select aria-label={label} value={value as string} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={clsx(FIELD_STYLE, "px-0.5")} style={{ ...style, fontSize }}>
          <option value="">—</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "list":
      return (
        <select
          aria-label={label}
          multiple={field.multiple}
          value={field.multiple ? (value as string[]) : ((value as string[])[0] ?? "")}
          disabled={disabled}
          onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => o.value))}
          className={clsx(FIELD_STYLE)}
          style={{ ...style, fontSize }}
        >
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "signature":
      return (
        <Link href="/tools/edit-pdf" title="Sign with Edit PDF or E-Sign" className="flex items-center justify-center gap-1 border border-dashed border-brand-border bg-brand-soft/50 text-brand-text" style={{ ...style, fontSize: Math.min(fontSize, 12 * scale) }}>
          <Signature className="size-3.5" aria-hidden="true" />
          Sign
        </Link>
      );
    default:
      return null;
  }
}

/** The same field as a labelled control in the side list. */
function ListControl({ field, value, onChange }: { field: FormField; value: FieldValues[string]; onChange: (v: FieldValues[string]) => void }) {
  const label = `${fieldLabel(field.name)}${field.required ? " *" : ""}`;
  const input = "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm text-fg outline-none focus:border-brand-border disabled:opacity-60";
  switch (field.kind) {
    case "text":
      return (
        <label className="block text-sm">
          <span className="font-medium text-fg">{label}</span>
          {field.multiline ? (
            <textarea value={value as string} maxLength={field.maxLength} disabled={field.readOnly} onChange={(e) => onChange(e.target.value)} rows={3} className={input} />
          ) : (
            <input value={value as string} maxLength={field.maxLength} disabled={field.readOnly} onChange={(e) => onChange(e.target.value)} className={input} />
          )}
        </label>
      );
    case "checkbox":
      return (
        <label className="flex cursor-pointer items-center gap-3 text-sm text-fg">
          <input type="checkbox" checked={value as boolean} disabled={field.readOnly} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-brand" />
          {label}
        </label>
      );
    case "radio":
      return (
        <fieldset className="text-sm">
          <legend className="font-medium text-fg">{label}</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {field.options?.map((o) => (
              <label key={o} className="flex cursor-pointer items-center gap-2 text-fg">
                <input type="radio" name={`list-${field.name}`} checked={value === o} disabled={field.readOnly} onChange={() => onChange(o)} className="size-4 accent-brand" />
                {o}
              </label>
            ))}
          </div>
        </fieldset>
      );
    case "dropdown":
    case "list":
      return (
        <label className="block text-sm">
          <span className="font-medium text-fg">{label}</span>
          <select
            multiple={field.kind === "list" && field.multiple}
            value={field.kind === "list" ? (field.multiple ? (value as string[]) : ((value as string[])[0] ?? "")) : (value as string)}
            disabled={field.readOnly}
            onChange={(e) => onChange(field.kind === "list" ? Array.from(e.target.selectedOptions, (o) => o.value) : e.target.value)}
            className={input}
          >
            {field.kind === "dropdown" && <option value="">—</option>}
            {field.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      );
    case "signature":
      return <p className="text-sm text-fg-muted">{label}: a signature field. Sign with Edit PDF or E-Sign.</p>;
    default:
      return null;
  }
}
