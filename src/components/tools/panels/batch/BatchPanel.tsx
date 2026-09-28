"use client";

import { createElement, useId, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowDown, ArrowUp, ChevronDown, FileDown, FileUp, ListChecks, Play, Plus, Trash2, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { KindIcon } from "@/components/files/KindIcon";
import { createOperations } from "@/lib/batch/operations";
import { BATCH_PRESETS } from "@/lib/batch/presets";
import { parseRecipe, recipeToJson } from "@/lib/batch/recipe";
import { runBatch, type BatchProgress, type BatchResult } from "@/lib/batch/run";
import { checkSteps, defaultStep, describeStep, planFiles, STEP_GROUPS, STEP_INFO, type FilePlan, type StepType } from "@/lib/batch/steps";
import { downloadBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { formatBytes, KIND_LABELS } from "@/lib/files";
import { defaultOcrLanguage } from "@/lib/ocr/languages";
import { getTool } from "@/lib/tools";
import { useBatchStore, type BatchEntry } from "@/store/batch";
import { useCertificateStore } from "@/store/certificate";
import { toast } from "@/store/toast";
import type { WorkspaceFile } from "@/store/workspace";
import { CertificateCard } from "../certsign/CertificateCard";
import type { ToolPanelProps } from "../registry";
import { ProgressBar } from "../shared/ConversionParts";
import { OutputCard, PRIMARY, SECONDARY } from "../shared/OutputCard";
import { ToolCard } from "../shared/toolkit";
import { StepEditor } from "./StepEditor";
import { useT } from "@/store/locale";
import { msg } from "@/i18n/msg";
import type { Translator } from "@/i18n/translate";

/** The tool whose icon each step shows. */
const STEP_TOOL: Record<StepType, string> = {
  sanitize: "sanitize",
  flatten: "flatten",
  grayscale: "grayscale",
  compress: "compress",
  rotate: "rotate",
  "delete-pages": "delete-pages",
  resize: "resize-pages",
  watermark: "watermark",
  "page-numbers": "page-numbers",
  "header-footer": "header-footer",
  bates: "bates",
  "to-pdf": "word-to-pdf",
  ocr: "ocr",
  merge: "merge",
  "convert-image": "convert-image",
  protect: "protect",
  sign: "digital-signature",
  "clean-media": "clean-media",
  "convert-audio": "convert-audio",
};
const STEP_ICONS = Object.fromEntries(Object.entries(STEP_TOOL).map(([type, tool]) => [type, getTool(tool)!.icon])) as Record<StepType, LucideIcon>;
const StepIcon = ({ type, className }: { type: StepType; className: string }) => createElement(STEP_ICONS[type], { className, "aria-hidden": true });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });

export default function BatchPanel({ files }: ToolPanelProps) {
  const t = useT();
  const entries = useBatchStore((s) => s.entries);
  const certificate = useCertificateStore((s) => s.current);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [result, setResult] = useState<{ entries: BatchEntry[]; value: BatchResult } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const steps = entries.map((e) => e.step);
  const problems = checkSteps(steps, { hasCertificate: !!certificate });
  const included = files.filter((f) => !excluded.has(f.id));
  const planned = planFiles(
    included.map((f) => f.kind),
    steps,
  );
  const plans = new Map(included.map((f, i) => [f.id, planned[i]]));
  const workable = included.filter((f) => plans.get(f.id)!.steps.length > 0);
  const busy = progress !== null;

  const run = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setResult(null);
    setProgress({ step: 0, done: 0, total: workable.length, name: workable[0]?.name ?? "", fraction: 0 });
    const ops = createOperations({ certificate: certificate && { file: certificate.file, password: certificate.password }, date: dateFormat.format(new Date()) });
    try {
      const value = await runBatch(
        workable.map((f) => ({ name: f.name, blob: f.file, kind: f.kind })),
        steps,
        ops,
        { signal: controller.signal, onProgress: setProgress },
      );
      setResult({ entries, value });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) toast({ tone: "error", title: msg("The batch stopped"), description: errorMessage(error) });
    } finally {
      abort.current = null;
      setProgress(null);
    }
  };

  const shownResult = result?.entries === entries ? result.value : null;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <StepList entries={entries} problems={problems} files={included} busy={busy} />
      <div className="space-y-4 lg:sticky lg:top-20">
        <ToolCard icon={Play} title={t("Run")}>
          <ul className="mt-3 max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line" aria-label={t("Open files")}>
            {files.map((f) => (
              <FileRow
                key={f.id}
                file={f}
                plan={excluded.has(f.id) ? null : plans.get(f.id)!}
                steps={entries}
                disabled={busy}
                onToggle={(on) =>
                  setExcluded((prev) => {
                    const next = new Set(prev);
                    if (on) next.delete(f.id);
                    else next.add(f.id);
                    return next;
                  })
                }
              />
            ))}
          </ul>
          {busy ? (
            <>
              <ProgressBar label={progressLabel(progress, entries, t)} fraction={progress.fraction} />
              <button type="button" onClick={() => abort.current?.abort()} className={clsx(SECONDARY, "mt-3 w-full")}>
                <X className="size-4" aria-hidden="true" />
                {t("Cancel")}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={run} disabled={!!problems.length || !workable.length || !steps.length} className={clsx(PRIMARY, "mt-4 w-full")}>
                <Play className="size-4" aria-hidden="true" />
                {steps.length && workable.length ? t.plural(workable.length, "Run on {n} file", "Run on {n} files") : t("Run")}
              </button>
              <p className="mt-2 text-xs text-fg-subtle">
                {!steps.length
                  ? t("Add a step, or start from a ready-made list.")
                  : problems.length
                    ? t("Fix the steps marked in red first.")
                    : !workable.length
                      ? t("None of the chosen files can go through these steps.")
                      : t("One file at a time, on this device: nothing is uploaded.")}
              </p>
            </>
          )}
        </ToolCard>
        {steps.some((s) => s.type === "sign") && <CertificateCard />}
        {shownResult && <Results result={shownResult} />}
      </div>
    </div>
  );
}

function progressLabel(progress: BatchProgress, entries: BatchEntry[], t: Translator): string {
  const step = entries[progress.step]?.step;
  if (!step || !progress.total) return t("Finishing…");
  const info = STEP_INFO[step.type];
  const which = info.together ? progress.name : t("{name} ({done} of {count})", { name: progress.name, done: progress.done + 1, count: progress.total });
  return t("Step {step} of {steps}, {tool}: {which}", { step: progress.step + 1, steps: entries.length, tool: t(info.name), which });
}

function FileRow({ file, plan, steps, disabled, onToggle }: { file: WorkspaceFile; plan: FilePlan | null; steps: BatchEntry[]; disabled: boolean; onToggle: (on: boolean) => void }) {
  const t = useT();
  let detail: string;
  if (!plan) detail = t("Left out");
  else if (!steps.length) detail = t(KIND_LABELS[file.kind]);
  else if (!plan.steps.length) detail = t("Nothing to do");
  else {
    const merge = plan.mergedAt === null ? null : steps[plan.mergedAt].step;
    if (merge?.type === "merge") detail = t.plural(plan.steps.length, "{n} step, combined into {name}", "{n} steps, combined into {name}", { name: merge.name });
    else if (plan.kind !== file.kind) detail = t.plural(plan.steps.length, "{n} step, becomes {kind}", "{n} steps, becomes {kind}", { kind: t(KIND_LABELS[plan.kind]) });
    else detail = t.plural(plan.steps.length, "{n} step", "{n} steps");
  }
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
        <input type="checkbox" checked={!!plan} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} className="size-4 shrink-0 accent-brand" aria-label={t("Include {name}", { name: file.name })} />
        <KindIcon kind={file.kind} className="size-4 shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{file.name}</span>
          <span className={clsx("block text-xs", plan && plan.steps.length ? "text-fg-muted" : "text-fg-subtle")}>{detail}</span>
        </span>
      </label>
    </li>
  );
}

// ---------------------------------------------------------------- Steps

function StepList({ entries, problems, files, busy }: { entries: BatchEntry[]; problems: { index: number; message: string }[]; files: WorkspaceFile[]; busy: boolean }) {
  const t = useT();
  const { replaceAll } = useBatchStore.getState();
  const openInput = useId();
  const [adding, setAdding] = useState(false);
  const plans = planFiles(
    files.map((f) => f.kind),
    entries.map((e) => e.step),
  );

  const openList = async (file: File) => {
    try {
      replaceAll(parseRecipe(await file.text()));
      toast({ tone: "success", title: msg("Steps opened"), description: file.name });
    } catch (error) {
      toast({ tone: "error", title: msg("Couldn't open the steps"), description: errorMessage(error) });
    }
  };

  return (
    <section className="rounded-xl border border-line bg-surface" aria-labelledby="steps-heading">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
        <div>
          <h2 id="steps-heading" className="flex items-center gap-2 font-semibold text-fg">
            <ListChecks className="size-4 text-brand-text" aria-hidden="true" />
            {t("Steps")}
          </h2>
          <p className="mt-0.5 text-sm text-fg-muted">{t("Done in this order, to every file they can open.")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label htmlFor={openInput} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-muted hover:border-line-strong hover:text-fg">
            <FileUp className="size-4" aria-hidden="true" />
            {t("Open steps")}
          </label>
          <input
            id={openInput}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label={t("Saved steps file")}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void openList(f);
            }}
          />
          <button
            type="button"
            disabled={!entries.length}
            onClick={() => downloadBlob(new Blob([recipeToJson(entries.map((e) => e.step))], { type: "application/json" }), "batch-steps.json")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-muted hover:border-line-strong hover:text-fg disabled:opacity-40"
          >
            <FileDown className="size-4" aria-hidden="true" />
            {t("Save steps")}
          </button>
          {entries.length > 0 && (
            <button type="button" disabled={busy} onClick={() => replaceAll([])} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-muted hover:border-line-strong hover:text-fg disabled:opacity-40">
              <Trash2 className="size-4" aria-hidden="true" />
              {t("Clear")}
            </button>
          )}
        </div>
      </header>

      <div className="p-5">
        {entries.length === 0 && <Presets />}
        {entries.length > 0 && (
          <ol className="space-y-3">
            {entries.map((entry, index) => (
              <StepCard
                key={entry.id}
                entry={entry}
                index={index}
                count={entries.length}
                problems={problems.filter((p) => p.index === index).map((p) => t.dynamic(p.message))}
                reach={plans.filter((p) => p.steps.includes(index)).length}
                disabled={busy}
              />
            ))}
          </ol>
        )}
        <AddStep open={adding} onOpen={setAdding} entries={entries} disabled={busy} />
      </div>
    </section>
  );
}

function Presets() {
  const t = useT();
  const { replaceAll } = useBatchStore.getState();
  return (
    <div className="mb-4">
      <p className="text-sm font-medium text-fg">{t("Start from a ready-made list")}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {BATCH_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => replaceAll(preset.steps({ ocrLanguage: defaultOcrLanguage(typeof navigator === "undefined" ? undefined : navigator.language) }))}
            className="rounded-lg border border-line p-3 text-start hover:border-brand-border hover:bg-brand-soft/40"
          >
            <span className="block text-sm font-semibold text-fg">{t(preset.name)}</span>
            <span className="mt-0.5 block text-xs text-fg-muted">{t(preset.description)}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm text-fg-muted">{t("Or build your own:")}</p>
    </div>
  );
}

function StepCard({ entry, index, count, problems, reach, disabled }: { entry: BatchEntry; index: number; count: number; problems: string[]; reach: number; disabled: boolean }) {
  const t = useT();
  const { update, remove, move, setOpen } = useBatchStore.getState();
  const open = useBatchStore((s) => s.openId === entry.id);
  const bodyId = useId();
  const { step } = entry;
  const info = STEP_INFO[step.type];
  const iconButton = "rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-30";
  return (
    <li className={clsx("rounded-lg border", problems.length ? "border-danger/60" : "border-line")} aria-label={t("Step {n}: {name}", { n: index + 1, name: t(info.name) })}>
      <div className="flex items-center gap-2 p-2 ps-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-fg-muted tabular-nums">{index + 1}</span>
        <button type="button" onClick={() => setOpen(open ? null : entry.id)} aria-expanded={open} aria-controls={bodyId} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-start">
          <StepIcon type={step.type} className="size-4 shrink-0 text-brand-text" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-fg">{t(info.name)}</span>
            <span className="block truncate text-xs text-fg-muted">
              {describeStep(step, t)} · {reach ? t.plural(reach, "{n} file", "{n} files") : t("no open file")}
            </span>
          </span>
          <ChevronDown className={clsx("size-4 shrink-0 text-fg-subtle transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
        <button type="button" className={iconButton} disabled={disabled || index === 0} onClick={() => move(entry.id, -1)} aria-label={t("Move {name} up", { name: t(info.name) })}>
          <ArrowUp className="size-4" />
        </button>
        <button type="button" className={iconButton} disabled={disabled || index === count - 1} onClick={() => move(entry.id, 1)} aria-label={t("Move {name} down", { name: t(info.name) })}>
          <ArrowDown className="size-4" />
        </button>
        <button type="button" className={iconButton} disabled={disabled} onClick={() => remove(entry.id)} aria-label={t("Remove {name}", { name: t(info.name) })}>
          <X className="size-4" />
        </button>
      </div>
      {problems.map((p) => (
        <p key={p} className="mx-3 mb-2 flex gap-2 text-xs text-danger-text">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          {p}
        </p>
      ))}
      {open && (
        <div id={bodyId} className="border-t border-line px-4 pb-4">
          <fieldset disabled={disabled}>
            <legend className="sr-only">{t("{name} settings", { name: t(info.name) })}</legend>
            <StepEditor step={step} onChange={(s) => update(entry.id, s)} />
          </fieldset>
        </div>
      )}
    </li>
  );
}

function AddStep({ open, onOpen, entries, disabled }: { open: boolean; onOpen: (open: boolean) => void; entries: BatchEntry[]; disabled: boolean }) {
  const t = useT();
  const { add } = useBatchStore.getState();
  const menuId = useId();
  const used = new Set(entries.map((e) => e.step.type));
  return (
    <div className="mt-3">
      <button type="button" disabled={disabled} onClick={() => onOpen(!open)} aria-expanded={open} aria-controls={menuId} className={clsx(SECONDARY, "w-full border-dashed")}>
        <Plus className="size-4" aria-hidden="true" />
        {t("Add a step")}
      </button>
      {open && (
        <div id={menuId} className="mt-3 space-y-4 rounded-lg border border-line p-4">
          {STEP_GROUPS.map((group) => (
            <div key={group.id}>
              <p className="text-xs font-medium tracking-wider text-fg-subtle uppercase">{t(group.name)}</p>
              <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                {(Object.keys(STEP_INFO) as StepType[])
                  .filter((type) => STEP_INFO[type].group === group.id)
                  .map((type) => {
                    const info = STEP_INFO[type];
                    const taken = info.once && used.has(type);
                    return (
                      <button
                        key={type}
                        type="button"
                        disabled={taken}
                        onClick={() => {
                          add(defaultStep(type));
                          onOpen(false);
                        }}
                        className="flex items-start gap-2.5 rounded-lg p-2 text-start hover:bg-surface-muted disabled:opacity-40"
                      >
                        <StepIcon type={type} className="mt-0.5 size-4 shrink-0 text-brand-text" />
                        <span>
                          <span className="block text-sm font-medium text-fg">{t(info.name)}</span>
                          <span className="block text-xs text-fg-muted">{taken ? t("Already in the list") : t(info.description)}</span>
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Results

function Results({ result }: { result: BatchResult }) {
  const t = useT();
  const { outputs, failures, untouched } = result;
  return (
    <>
      {outputs.length > 0 && (
        <OutputCard
          title={t.plural(outputs.length, "{n} file ready", "{n} files ready")}
          outputs={outputs.map((o) => ({ name: o.name, blob: o.blob, detail: t(KIND_LABELS[o.kind]) }))}
          zipName="batch.zip"
        />
      )}
      {failures.length > 0 && (
        <section className="rounded-xl border border-danger/50 bg-danger-soft p-5" role="alert">
          <h2 className="flex items-center gap-2 font-semibold text-fg">
            <TriangleAlert className="size-5 text-danger" aria-hidden="true" />
            {t.plural(failures.length, "{n} file couldn't be finished", "{n} files couldn't be finished")}
          </h2>
          <ul className="mt-2 space-y-2 text-sm">
            {failures.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span className="font-medium wrap-anywhere text-fg">{f.name}</span>
                <span className="text-fg-muted">
                  {" "}
                  {t("at {step}: {message}", { step: t(f.step), message: t.dynamic(f.message) })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {untouched.length > 0 && (
        <p className="text-xs text-fg-subtle">
          {t.plural(untouched.length, "Nothing to do for {names}: no step works on it, so it's not in the results.", "Nothing to do for {names}: no step works on them, so they're not in the results.", { names: untouched.join(", ") })}
        </p>
      )}
      {!outputs.length && !failures.length && <p className="text-sm text-fg-muted">{t("No file went through any step.")}</p>}
      {outputs.length > 0 && <p className="text-xs text-fg-subtle">{t("Total {size}.", { size: formatBytes(outputs.reduce((n, o) => n + o.blob.size, 0)) })}</p>}
    </>
  );
}
