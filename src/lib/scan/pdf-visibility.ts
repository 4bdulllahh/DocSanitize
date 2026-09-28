import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { withRenderSlot } from "../pdf/render";
import type { Box } from "../pdf/redact-search";

/*
 * Text that's in the file but that a reader can't see. Each page is rendered as a reader shows it
 * (comments and form fields included) and every piece of text is checked against the pixels where
 * it should appear: a flat area there means the text is hidden. Dark and flat: covered by a black
 * box, a "fake redaction" whose text can still be copied. Light and flat: invisible (white text,
 * render mode 3, hidden behind a shape). Text too small to read is reported as well.
 */

export type HiddenKind = "covered" | "invisible" | "tiny";

export interface HiddenText {
  kind: HiddenKind;
  /** 0-based page index. */
  page: number;
  text: string;
  /** Where it is, as fractions of the displayed page. */
  box: Box;
}

/** Flat means the lightest and darkest pixels are this close (0-255 luminance). */
const FLAT = 24;
/** Below this mean luminance a flat area counts as a black box. */
const DARK = 90;
/** Text smaller than this (points) is too small to read. */
const TINY = 1.5;
const SCALE = 1.5;

/** Luminance range and mean of a rectangle of RGBA pixels. */
export function regionStats(data: Uint8ClampedArray, width: number, rect: { x0: number; y0: number; x1: number; y1: number }) {
  let min = 255;
  let max = 0;
  let sum = 0;
  let n = 0;
  for (let y = Math.max(0, rect.y0); y < rect.y1; y++) {
    for (let x = Math.max(0, rect.x0); x < Math.min(width, rect.x1); x++) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3] / 255;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * alpha + 255 * (1 - alpha);
      if (lum < min) min = lum;
      if (lum > max) max = lum;
      sum += lum;
      n++;
    }
  }
  return n ? { range: max - min, mean: sum / n } : null;
}

/** How a piece of text looks given the pixels under it: null when it's visible. */
export function classify(stats: { range: number; mean: number } | null): Exclude<HiddenKind, "tiny"> | null {
  if (!stats || stats.range >= FLAT) return null;
  return stats.mean < DARK ? "covered" : "invisible";
}

/**
 * Stretches of hidden characters in a run of text (`kinds[i]` per character; spaces are null and
 * join their neighbours). Only stretches with two or more letters or digits count: a lone
 * punctuation mark can look "flat" where it's simply small.
 */
export function hiddenRuns(chars: string[], kinds: (Exclude<HiddenKind, "tiny"> | null)[]): { kind: Exclude<HiddenKind, "tiny">; from: number; to: number; text: string }[] {
  const runs: { kind: Exclude<HiddenKind, "tiny">; from: number; to: number; text: string }[] = [];
  let current: (typeof runs)[number] | null = null;
  chars.forEach((ch, i) => {
    const kind = kinds[i];
    if (kind && current?.kind === kind) current.to = i + 1;
    else if (kind) runs.push((current = { kind, from: i, to: i + 1, text: "" }));
    else if (!/\s/.test(ch)) current = null;
  });
  return runs
    .map((r) => ({ ...r, text: chars.slice(r.from, r.to).join("").trim() }))
    .filter((r) => (r.text.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2);
}

/** Join neighbouring finds of the same kind on the same line into one snippet. */
export function mergeHidden(items: HiddenText[]): HiddenText[] {
  const out: HiddenText[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    const sameLine = last && last.page === item.page && last.kind === item.kind && Math.abs(last.box.y - item.box.y) < last.box.height * 0.5;
    const gap = last ? item.box.x - (last.box.x + last.box.width) : Infinity;
    if (sameLine && gap < last.box.height * 2 && gap > -last.box.width) {
      const left = Math.min(last.box.x, item.box.x);
      const top = Math.min(last.box.y, item.box.y);
      const right = Math.max(last.box.x + last.box.width, item.box.x + item.box.width);
      const bottom = Math.max(last.box.y + last.box.height, item.box.y + item.box.height);
      last.text = `${last.text}${gap > last.box.height * 0.15 ? " " : ""}${item.text}`;
      last.box = { x: left, y: top, width: right - left, height: bottom - top };
    } else {
      out.push({ ...item, box: { ...item.box } });
    }
  }
  return out;
}

type Matrix = number[];
const multiply = (m: Matrix, n: Matrix) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** Check every page; `onPage` reports progress. */
export async function findHiddenText(doc: PDFDocumentProxy, onPage?: (done: number) => void, signal?: AbortSignal): Promise<HiddenText[]> {
  const found: HiddenText[] = [];
  for (let p = 0; p < doc.numPages && !signal?.aborted; p++) {
    await withRenderSlot(async () => {
      const page = await doc.getPage(p + 1);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport, background: "#ffffff" }).promise;
      const { data } = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
      const content = await page.getTextContent();
      const items: HiddenText[] = [];
      for (const raw of content.items) {
        if (!("str" in raw) || !raw.str.trim()) continue;
        const item = raw as TextItem;
        const [a, b, c, d, e, f] = multiply(viewport.transform, item.transform);
        // Horizontal text only; rotated text is rare and hard to box.
        if (a <= 0 || Math.abs(b) > Math.abs(a) * 0.05) continue;
        const size = Math.hypot(c, d);
        const width = item.width * SCALE;
        if (!(size > 0) || width <= 0) continue;
        // In points while merging; fractions of the page afterwards.
        const box: Box = { x: e / SCALE, y: (f - size) / SCALE, width: width / SCALE, height: (size * 1.2) / SCALE };
        if (size / SCALE < TINY) {
          items.push({ kind: "tiny", page: p, text: item.str, box });
          continue;
        }
        // Character by character (a box may cover only part of a run), in the body of the letters:
        // between the baseline and about the x-height. Positions assume equal widths, which is
        // close enough to find a covered word.
        const chars = Array.from(item.str);
        const step = width / chars.length;
        const kinds = chars.map((ch, i) =>
          /\s/.test(ch) ? null : classify(regionStats(data, canvas.width, { x0: Math.round(e + i * step), x1: Math.max(Math.round(e + i * step) + 1, Math.round(e + (i + 1) * step)), y0: Math.round(f - size * 0.6), y1: Math.round(f - size * 0.05) })),
        );
        for (const run of hiddenRuns(chars, kinds)) {
          items.push({ kind: run.kind, page: p, text: run.text, box: { x: (e + run.from * step) / SCALE, y: box.y, width: ((run.to - run.from) * step) / SCALE, height: box.height } });
        }
      }
      const [w, h] = [viewport.width / SCALE, viewport.height / SCALE];
      found.push(...mergeHidden(items).map((t) => ({ ...t, box: { x: t.box.x / w, y: t.box.y / h, width: t.box.width / w, height: t.box.height / h } })));
      canvas.width = canvas.height = 0;
      page.cleanup();
    });
    onPage?.(p + 1);
  }
  return found;
}
