import { ProcessingError } from "../errors";
import { defaultStep, STEP_INFO, type BatchStep, type StepType } from "./steps";

/*
 * A list of steps saved as a small JSON file, so the same batch can be run again later or shared.
 * Nothing is stored in the browser: the person downloads the file and opens it again. Passwords
 * are never written into it.
 */

const FORMAT = "docsanitize-batch";
const VERSION = 1;

const ANCHORS = ["top-left", "top-center", "top-right", "middle-left", "center", "middle-right", "bottom-left", "bottom-center", "bottom-right"];

/** Allowed values for the settings that are a choice. */
const CHOICES: Record<string, readonly unknown[]> = {
  "to-pdf.pageSize": ["a4", "letter"],
  "to-pdf.photoPages": ["fit", "page"],
  "rotate.angle": [90, 180, 270],
  "resize.size": ["a4", "letter", "legal", "a3", "a5"],
  "watermark.position": ["center", "tile"],
  "page-numbers.position": ANCHORS,
  "header-footer.align": ["left", "center", "right"],
  "bates.position": ANCHORS,
  "compress.preset": ["light", "balanced", "strong"],
  "sign.anchor": ANCHORS,
  "sign.certify": [0, 1, 2, 3],
  "convert-image.format": ["jpeg", "png", "webp"],
  "convert-audio.target": ["mp3", "m4a", "wav", "flac", "ogg", "opus"],
};

/** The steps as a file's text. */
export function recipeToJson(steps: BatchStep[]): string {
  const saved = steps.map((step) => (step.type === "protect" ? { ...step, password: "" } : step));
  return `${JSON.stringify({ format: FORMAT, version: VERSION, steps: saved }, null, 2)}\n`;
}

/** Read a saved list. Unknown settings are dropped and missing ones take their defaults. */
export function parseRecipe(text: string): BatchStep[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProcessingError("This isn't a saved list of steps.", "invalid");
  }
  const record = data as { format?: unknown; version?: unknown; steps?: unknown };
  if (!record || record.format !== FORMAT || !Array.isArray(record.steps)) throw new ProcessingError("This isn't a saved list of steps.", "invalid");
  if (typeof record.version !== "number" || record.version > VERSION) throw new ProcessingError("This list was saved by a newer version of DocSanitize.", "unsupported");
  const steps = record.steps.map(readStep);
  if (!steps.length) throw new ProcessingError("The saved list has no steps.", "invalid");
  return steps;
}

function readStep(raw: unknown): BatchStep {
  const input = raw as Record<string, unknown> | null;
  const type = input?.type;
  if (typeof type !== "string" || !(type in STEP_INFO)) throw new ProcessingError(`The saved list has a step this version doesn't know (${String(type)}).`, "unsupported");
  const step = defaultStep(type as StepType) as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(step)) {
    if (key === "type" || !(key in input!)) continue;
    const value = input![key];
    const choices = CHOICES[`${type}.${key}`];
    if (choices) {
      if (choices.includes(value)) step[key] = value;
    } else if (Array.isArray(fallback)) {
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) step[key] = value;
    } else if (fallback === null || typeof fallback === "number") {
      // Numbers that may be left empty (null), such as an image's longest side.
      if ((typeof value === "number" && Number.isFinite(value)) || (fallback === null && value === null)) step[key] = value;
    } else if (typeof value === typeof fallback) {
      step[key] = value;
    }
  }
  return step as BatchStep;
}
