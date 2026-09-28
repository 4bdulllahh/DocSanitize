import { errorMessage } from "../errors";
import type { FileKind } from "../files";
import { STEP_INFO, type BatchStep } from "./steps";
import { msg } from "@/i18n/msg";

/*
 * Runs the steps one at a time over all the files (step by step, not file by file), so steps that
 * work on the files together (Bates numbers, Combine) see every file at that point. A file that
 * fails drops out with its reason; the others carry on.
 */

export interface BatchItem {
  name: string;
  blob: Blob;
  kind: FileKind;
}

export interface StepContext {
  signal: AbortSignal;
  /** Progress within this file, 0–1. */
  report: (fraction: number) => void;
}

export interface Operations {
  /** Apply a step to one file. */
  one: (step: BatchStep, item: BatchItem, context: StepContext) => Promise<BatchItem>;
  /** Apply a step that works on all the files at once (`STEP_INFO[type].together`). */
  all: (step: BatchStep, items: BatchItem[], context: StepContext) => Promise<BatchItem[]>;
}

export interface BatchProgress {
  step: number;
  /** File being worked on, within this step. */
  done: number;
  total: number;
  name: string;
  /** The whole run, 0–1. */
  fraction: number;
}

export interface BatchFailure {
  name: string;
  step: string;
  message: string;
}

export interface BatchResult {
  outputs: BatchItem[];
  failures: BatchFailure[];
  /** Files no step applies to (left out of the results). */
  untouched: string[];
}

const aborted = () => new DOMException(msg("The batch was cancelled."), "AbortError");

export async function runBatch(files: BatchItem[], steps: BatchStep[], ops: Operations, options: { signal: AbortSignal; onProgress?: (p: BatchProgress) => void }): Promise<BatchResult> {
  const { signal, onProgress } = options;
  const failures: BatchFailure[] = [];
  // Each entry remembers whether any step changed it.
  let items = files.map((item) => ({ item, touched: false }));

  for (const [s, step] of steps.entries()) {
    const info = STEP_INFO[step.type];
    const targets = items.filter((e) => info.accepts.includes(e.item.kind));
    if (!targets.length) continue;
    const progress = (done: number, name: string, fraction = 0) =>
      onProgress?.({ step: s, done, total: targets.length, name, fraction: (s + (info.together ? fraction : (done + fraction) / targets.length)) / steps.length });

    if (signal.aborted) throw aborted();
    if (info.together) {
      progress(0, targets.length === 1 ? targets[0].item.name : `${targets.length} files`);
      try {
        const results = await ops.all(
          step,
          targets.map((e) => e.item),
          { signal, report: (f) => progress(0, `${targets.length} files`, f) },
        );
        const first = items.indexOf(targets[0]);
        const rest = items.filter((e) => !targets.includes(e));
        // Results take the place of the first file they came from (Combine turns several into one).
        rest.splice(Math.min(first, rest.length), 0, ...results.map((item) => ({ item, touched: true })));
        items = rest;
      } catch (error) {
        if (signal.aborted) throw aborted();
        for (const e of targets) failures.push({ name: e.item.name, step: info.name, message: errorMessage(error) });
        items = items.filter((e) => !targets.includes(e));
      }
      continue;
    }

    for (const [done, entry] of targets.entries()) {
      if (signal.aborted) throw aborted();
      progress(done, entry.item.name);
      try {
        entry.item = await ops.one(step, entry.item, { signal, report: (f) => progress(done, entry.item.name, Math.min(1, Math.max(0, f))) });
        entry.touched = true;
      } catch (error) {
        if (signal.aborted) throw aborted();
        failures.push({ name: entry.item.name, step: info.name, message: errorMessage(error) });
        items = items.filter((e) => e !== entry);
      }
    }
  }

  onProgress?.({ step: steps.length - 1, done: 0, total: 0, name: "", fraction: 1 });
  const outputs = uniqueNames(items.filter((e) => e.touched).map((e) => e.item));
  const untouched = items.filter((e) => !e.touched).map((e) => e.item.name);
  return { outputs, failures, untouched };
}

/** "a.pdf", "a.pdf" -> "a.pdf", "a (2).pdf" (files can share a name, or end up with one after converting). */
export function uniqueNames<T extends { name: string }>(items: T[]): T[] {
  const used = new Set<string>();
  return items.map((item) => {
    let name = item.name;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = item.name.replace(/(\.[^.]*)?$/, ` (${n})$1`);
    used.add(name.toLowerCase());
    return name === item.name ? item : { ...item, name };
  });
}
