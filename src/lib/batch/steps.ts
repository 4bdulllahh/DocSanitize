import { ProcessingError } from "../errors";
import type { FileKind } from "../files";
import type { Anchor } from "../pdf/anchor";
import type { CompressPreset } from "../pdf/compress";
import type { PageSizeName } from "../pdf/pages";
import type { AudioTarget } from "../media/jobs";

/*
 * Batch Process: a list of steps run over every open file. Each step is one of the existing tools
 * with its settings; a step only touches the files it can open (a watermark skips photos), and a
 * step that converts (Convert to PDF) hands its result to the steps after it.
 */

export type BatchStep =
  | { type: "sanitize"; keepTechnical: boolean }
  | { type: "to-pdf"; pageSize: "a4" | "letter"; photoPages: "fit" | "page" }
  | { type: "rotate"; angle: 90 | 180 | 270 }
  | { type: "delete-pages"; pages: string }
  | { type: "resize"; size: PageSizeName }
  | { type: "watermark"; text: string; size: number; color: string; opacity: number; angle: number; position: "center" | "tile"; behind: boolean }
  | { type: "page-numbers"; format: string; position: Anchor; start: number; size: number }
  | { type: "header-footer"; header: string; footer: string; align: "left" | "center" | "right"; size: number }
  | { type: "bates"; prefix: string; start: number; digits: number; position: Anchor }
  | { type: "grayscale" }
  | { type: "flatten"; forms: boolean; annotations: boolean }
  | { type: "compress"; preset: CompressPreset }
  | { type: "ocr"; languages: string[]; skipText: boolean }
  | { type: "merge"; name: string }
  | { type: "protect"; password: string; allowPrinting: boolean; allowCopying: boolean; allowModifying: boolean }
  | { type: "sign"; reason: string; location: string; visible: boolean; anchor: Anchor; certify: 0 | 1 | 2 | 3 }
  | { type: "convert-image"; format: "jpeg" | "png" | "webp"; quality: number; maxSide: number | null }
  | { type: "clean-media"; keepCover: boolean }
  | { type: "convert-audio"; target: AudioTarget; bitrate: number; normalize: boolean };

export type StepType = BatchStep["type"];
export type StepOf<T extends StepType> = Extract<BatchStep, { type: T }>;

export type StepGroup = "clean" | "pages" | "stamp" | "convert" | "secure" | "media";

export const STEP_GROUPS: { id: StepGroup; name: string }[] = [
  { id: "clean", name: "Clean up and shrink" },
  { id: "pages", name: "Pages" },
  { id: "stamp", name: "Stamps and numbers" },
  { id: "convert", name: "Convert and combine" },
  { id: "secure", name: "Protect and sign" },
  { id: "media", name: "Audio and video" },
];

export interface StepInfo {
  name: string;
  /** One line for the "Add a step" menu. */
  description: string;
  group: StepGroup;
  /** The file kinds the step works on; other files pass through untouched. */
  accepts: FileKind[];
  /** What the files become (default: the same kind). */
  produces?: FileKind;
  /** Runs once over all the files together (numbering across files, or combining them). */
  together?: boolean;
  /** Only once per list (it needs all the files at that point). */
  once?: boolean;
}

const OFFICE: FileKind[] = ["image", "word", "excel", "powerpoint", "text"];

export const STEP_INFO: Record<StepType, StepInfo> = {
  sanitize: { name: "Remove metadata", description: "Author, GPS location, camera, dates, hidden history.", group: "clean", accepts: ["pdf", "image"] },
  flatten: { name: "Flatten", description: "Draw form fields and comments into the pages.", group: "clean", accepts: ["pdf"] },
  grayscale: { name: "Grayscale", description: "Turn the pages black and white.", group: "clean", accepts: ["pdf"] },
  compress: { name: "Compress", description: "Make PDFs smaller by shrinking their pictures.", group: "clean", accepts: ["pdf"] },
  rotate: { name: "Rotate pages", description: "Turn every page.", group: "pages", accepts: ["pdf"] },
  "delete-pages": { name: "Delete pages", description: "Remove the same pages from each PDF, such as a cover.", group: "pages", accepts: ["pdf"] },
  resize: { name: "Resize pages", description: "Fit every page to A4, Letter or another size.", group: "pages", accepts: ["pdf"] },
  watermark: { name: "Watermark", description: "Text such as CONFIDENTIAL across the pages.", group: "stamp", accepts: ["pdf"] },
  "page-numbers": { name: "Page numbers", description: "Number the pages of each PDF.", group: "stamp", accepts: ["pdf"] },
  "header-footer": { name: "Header and footer", description: "Text at the top or bottom, with the file name or date.", group: "stamp", accepts: ["pdf"] },
  bates: { name: "Bates numbers", description: "Numbers that run on from one file to the next.", group: "stamp", accepts: ["pdf"], together: true, once: true },
  "to-pdf": { name: "Convert to PDF", description: "Photos, Word, Excel, PowerPoint and text files.", group: "convert", accepts: OFFICE, produces: "pdf" },
  ocr: { name: "Make searchable (OCR)", description: "Add selectable text to scanned pages.", group: "convert", accepts: ["pdf"] },
  merge: { name: "Combine into one PDF", description: "Join all the PDFs, in tab order.", group: "convert", accepts: ["pdf"], together: true, once: true },
  "convert-image": { name: "Convert images", description: "Change the format or size of photos and pictures.", group: "convert", accepts: ["image"] },
  protect: { name: "Password-protect", description: "Lock each PDF with a password.", group: "secure", accepts: ["pdf"] },
  sign: { name: "Digital signature", description: "Sign each PDF with your certificate.", group: "secure", accepts: ["pdf"] },
  "clean-media": { name: "Remove video and audio metadata", description: "Location, device and dates, without re-encoding.", group: "media", accepts: ["video", "audio"] },
  "convert-audio": { name: "Convert to audio", description: "MP3, M4A, WAV and more, from sound or video files.", group: "media", accepts: ["audio", "video"], produces: "audio" },
};

export function defaultStep<T extends StepType>(type: T): StepOf<T> {
  const defaults: { [K in StepType]: StepOf<K> } = {
    sanitize: { type: "sanitize", keepTechnical: false },
    "to-pdf": { type: "to-pdf", pageSize: "a4", photoPages: "fit" },
    rotate: { type: "rotate", angle: 90 },
    "delete-pages": { type: "delete-pages", pages: "1" },
    resize: { type: "resize", size: "a4" },
    watermark: { type: "watermark", text: "CONFIDENTIAL", size: 64, color: "#b91c1c", opacity: 0.25, angle: 45, position: "center", behind: false },
    "page-numbers": { type: "page-numbers", format: "Page {n} of {total}", position: "bottom-center", start: 1, size: 10 },
    "header-footer": { type: "header-footer", header: "", footer: "{file}", align: "center", size: 9 },
    bates: { type: "bates", prefix: "", start: 1, digits: 6, position: "bottom-right" },
    grayscale: { type: "grayscale" },
    flatten: { type: "flatten", forms: true, annotations: true },
    compress: { type: "compress", preset: "balanced" },
    ocr: { type: "ocr", languages: ["eng"], skipText: true },
    merge: { type: "merge", name: "combined.pdf" },
    protect: { type: "protect", password: "", allowPrinting: true, allowCopying: false, allowModifying: false },
    sign: { type: "sign", reason: "", location: "", visible: false, anchor: "bottom-right", certify: 0 },
    "convert-image": { type: "convert-image", format: "jpeg", quality: 0.85, maxSide: null },
    "clean-media": { type: "clean-media", keepCover: true },
    "convert-audio": { type: "convert-audio", target: "mp3", bitrate: 192, normalize: false },
  };
  return structuredClone(defaults[type]);
}

// ---------------------------------------------------------------------------- Page lists

/**
 * Pages to delete, typed once for files of different lengths: "1", "1-2, 5", "-1" (the last page),
 * "-2" (the last two)… Pages a file doesn't have are ignored. Returns 0-based indices, or an error.
 */
export function pagesToDelete(spec: string, count: number): number[] {
  const out = new Set<number>();
  for (const part of splitSpec(spec)) {
    const parsed = parsePart(part);
    if (!parsed) throw new ProcessingError(`“${part}” isn't a page number or range.`, "invalid");
    if ("fromEnd" in parsed) {
      for (let i = Math.max(0, count - parsed.fromEnd); i < count; i++) out.add(i);
    } else {
      const to = Math.min(parsed.to ?? count, count);
      for (let n = parsed.from; n <= to; n++) out.add(n - 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

const splitSpec = (spec: string) =>
  spec
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);

function parsePart(part: string): { from: number; to: number | null } | { fromEnd: number } | null {
  const last = /^(?:-|last\s*)(\d+)$/i.exec(part);
  if (last) return Number(last[1]) > 0 ? { fromEnd: Number(last[1]) } : null;
  if (/^last$/i.test(part)) return { fromEnd: 1 };
  const m = /^(\d+)\s*(?:(-|–|to)\s*(\d*))?$/i.exec(part);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] ? (m[3] ? Number(m[3]) : null) : from;
  if (from < 1 || (to !== null && to < from)) return null;
  return { from, to };
}

function pageSpecProblem(spec: string): string | null {
  const parts = splitSpec(spec);
  if (!parts.length) return "Type the pages to delete, such as 1 or 1-2.";
  const bad = parts.find((p) => !parsePart(p));
  return bad ? `“${bad}” isn't a page number or range.` : null;
}

// ---------------------------------------------------------------------------- Checking and planning

export interface StepProblem {
  index: number;
  message: string;
}

/** Settings that can't work, and steps in an order that can't work. */
export function checkSteps(steps: BatchStep[], context: { hasCertificate: boolean }): StepProblem[] {
  const problems: StepProblem[] = [];
  const add = (index: number, message: string) => problems.push({ index, message });
  let locked: { index: number; by: "protect" | "sign" } | null = null;
  const seen = new Set<StepType>();
  steps.forEach((step, index) => {
    const info = STEP_INFO[step.type];
    if (locked && info.accepts.includes("pdf")) {
      add(
        index,
        locked.by === "protect"
          ? "A password-protected PDF can't be changed any more: move this step before Password-protect."
          : "Changing a PDF after signing it breaks the signature: move this step before Digital signature.",
      );
    }
    if (info.once && seen.has(step.type)) add(index, `${info.name} can only be used once.`);
    seen.add(step.type);
    const problem = settingsProblem(step, context);
    if (problem) add(index, problem);
    if (step.type === "protect" || step.type === "sign") locked ??= { index, by: step.type };
  });
  return problems;
}

function settingsProblem(step: BatchStep, context: { hasCertificate: boolean }): string | null {
  switch (step.type) {
    case "delete-pages":
      return pageSpecProblem(step.pages);
    case "watermark":
      return step.text.trim() ? null : "Type the watermark text.";
    case "page-numbers":
      return step.format.includes("{n}") ? null : "The format needs {n} where the number goes.";
    case "header-footer":
      return step.header.trim() || step.footer.trim() ? null : "Type a header or a footer.";
    case "bates":
      if (!Number.isInteger(step.start) || step.start < 0) return "The first number must be a whole number, 0 or more.";
      return Number.isInteger(step.digits) && step.digits >= 1 && step.digits <= 12 ? null : "Use between 1 and 12 digits.";
    case "ocr":
      return step.languages.length ? null : "Choose at least one language.";
    case "merge":
      return step.name.trim() ? null : "Name the combined PDF.";
    case "protect":
      return step.password ? null : "Choose a password.";
    case "sign":
      return context.hasCertificate ? null : "Open or create a certificate to sign with.";
    case "convert-image":
      return step.maxSide === null || (Number.isInteger(step.maxSide) && step.maxSide >= 16 && step.maxSide <= 16384) ? null : "The longest side must be 16 to 16384 pixels.";
    default:
      return null;
  }
}

export interface FilePlan {
  /** Indices of the steps that will change this file. */
  steps: number[];
  /** What it is at the end. */
  kind: FileKind;
  /** Index of the Combine step that joins it with the others, if any. */
  mergedAt: number | null;
}

/** What happens to each file, by following its kind through the steps. */
export function planFiles(kinds: FileKind[], steps: BatchStep[]): FilePlan[] {
  return kinds.map((start) => {
    let kind = start;
    const applied: number[] = [];
    let mergedAt: number | null = null;
    steps.forEach((step, index) => {
      const info = STEP_INFO[step.type];
      if (!info.accepts.includes(kind)) return;
      applied.push(index);
      kind = info.produces ?? kind;
      if (step.type === "merge" && mergedAt === null) mergedAt = index;
    });
    return { steps: applied, kind, mergedAt };
  });
}

/** A short line describing a step's settings, for its collapsed card. */
export function describeStep(step: BatchStep): string {
  switch (step.type) {
    case "sanitize":
      return step.keepTechnical ? "Keeps technical photo data" : "Everything";
    case "to-pdf":
      return `${step.pageSize === "a4" ? "A4" : "Letter"} pages${step.photoPages === "fit" ? "; photos at their own size" : ""}`;
    case "rotate":
      return `${step.angle}° clockwise`;
    case "delete-pages":
      return `Pages ${step.pages.trim()}`;
    case "resize":
      return step.size === "a4" || step.size === "a3" || step.size === "a5" ? step.size.toUpperCase() : step.size[0].toUpperCase() + step.size.slice(1);
    case "watermark":
      return `“${step.text}”${step.position === "tile" ? ", tiled" : ""}`;
    case "page-numbers":
      return step.format;
    case "header-footer":
      return [step.header && `Header “${step.header}”`, step.footer && `Footer “${step.footer}”`].filter(Boolean).join(" · ");
    case "bates":
      return `${step.prefix}${String(step.start).padStart(step.digits, "0")} onwards`;
    case "grayscale":
      return "Every page";
    case "flatten":
      return [step.forms && "Forms", step.annotations && "Comments"].filter(Boolean).join(" and ") || "Nothing";
    case "compress":
      return { light: "Light", balanced: "Balanced", strong: "Strong" }[step.preset];
    case "ocr":
      return `${step.languages.join(", ")}${step.skipText ? "; skips pages with text" : ""}`;
    case "merge":
      return step.name;
    case "protect":
      return step.password ? "Password set" : "No password yet";
    case "sign":
      return `${step.certify ? "Certify" : "Sign"}, ${step.visible ? "with a box on the last page" : "invisible"}`;
    case "convert-image":
      return `${step.format === "jpeg" ? "JPG" : step.format.toUpperCase()}${step.maxSide ? `, up to ${step.maxSide} px` : ""}`;
    case "clean-media":
      return step.keepCover ? "Keeps cover art" : "Removes cover art too";
    case "convert-audio":
      return `${step.target.toUpperCase()}${["wav", "flac"].includes(step.target) ? "" : `, ${step.bitrate} kbps`}`;
  }
}
