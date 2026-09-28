import type { PDFPageProxy } from "pdfjs-dist";
import type { Box, FontFamily, ReplaceObject } from "./types";

/* The page's own text as phrases that can be replaced (Edit PDF, Translate PDF), and its colours. */

/** A phrase of the page's own text (one or more pdf.js runs on a line), in displayed points. */
export interface PagePhrase extends Box {
  str: string;
  /** Font size in points, and the baseline's displayed y. */
  size: number;
  baseline: number;
  font: FontFamily;
  bold: boolean;
  italic: boolean;
  sources: ReplaceObject["sources"];
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

interface FontInfo {
  bold?: boolean;
  italic?: boolean;
  black?: boolean;
  name?: string;
}

/** The page's horizontal text, joined into phrases (runs on one line, same size, close together). */
export async function readPhrases(page: PDFPageProxy): Promise<PagePhrase[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const runs: PagePhrase[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str) continue;
    const [a, b, c, d, e, f] = multiply(viewport.transform, item.transform);
    // Only text that reads left to right on the displayed page can be edited in place.
    if (a <= 0 || Math.abs(b) > Math.abs(a) * 0.02 || Math.abs(c) > Math.abs(d) * 0.02) continue;
    const size = Math.abs(d);
    if (size < 1 || !item.str.trim()) continue;
    const style = content.styles[item.fontName] ?? {};
    const ascent = style.ascent || 0.8;
    const descent = style.descent ? Math.abs(style.descent) : 0.2;
    let info: FontInfo = {};
    try {
      if (page.commonObjs.has(item.fontName)) info = page.commonObjs.get(item.fontName) as FontInfo;
    } catch {
      // Fonts load as the page renders; without it we just can't tell bold or italic.
    }
    const family = `${style.fontFamily ?? ""} ${info.name ?? ""}`.toLowerCase();
    const font: FontFamily = /mono|courier/.test(family) ? "mono" : /(^|[^-])serif|times|georgia|garamond|cambria|minion/.test(family) && !/sans/.test(family) ? "serif" : "sans";
    runs.push({
      str: item.str,
      x: e,
      y: f - ascent * size,
      width: item.width * (a / Math.hypot(item.transform[0], item.transform[1]) || 1),
      height: (ascent + descent) * size,
      size,
      baseline: f,
      font,
      bold: Boolean(info.bold || info.black || /bold|black|heavy|semibold/.test(info.name?.toLowerCase() ?? "")),
      italic: Boolean(info.italic || /italic|oblique/.test(info.name?.toLowerCase() ?? "")),
      sources: [{ transform: item.transform, width: item.width, height: item.height || size, str: item.str }],
    });
  }

  // Join runs into phrases: same line, same size, close together.
  runs.sort((p, q) => (Math.abs(p.baseline - q.baseline) > Math.min(p.size, q.size) * 0.3 ? p.baseline - q.baseline : p.x - q.x));
  const phrases: PagePhrase[] = [];
  for (const run of runs) {
    const last = phrases[phrases.length - 1];
    const gap = last ? run.x - (last.x + last.width) : Infinity;
    if (last && Math.abs(last.baseline - run.baseline) < run.size * 0.3 && Math.abs(last.size - run.size) < run.size * 0.15 && gap > -run.size * 0.3 && gap < run.size * 0.9) {
      const space = gap > run.size * 0.15 && !last.str.endsWith(" ") && !run.str.startsWith(" ") ? " " : "";
      last.str += space + run.str;
      last.width = run.x + run.width - last.x;
      last.y = Math.min(last.y, run.y);
      last.height = Math.max(last.y + last.height, run.y + run.height) - last.y;
      last.sources.push(...run.sources);
      last.bold &&= run.bold;
      last.italic &&= run.italic;
    } else {
      phrases.push({ ...run, sources: [...run.sources] });
    }
  }
  for (const p of phrases) p.str = p.str.trim();
  return phrases.filter((p) => p.str);
}

// ---------------------------------------------------------------------------- Colours

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/**
 * Background and text colours around a box on the rendered page: the most common colour along
 * the box's edge, and the pixel inside that differs most from it.
 */
export function sampleColors(canvas: HTMLCanvasElement | null, pageWidth: number, box: Box): { background: string; text: string } {
  const fallback = { background: "#ffffff", text: "#111827" };
  const ctx = canvas?.getContext("2d", { willReadFrequently: true });
  if (!canvas || !ctx || !canvas.width) return fallback;
  const k = canvas.width / pageWidth;
  const x0 = Math.max(0, Math.floor((box.x - 2) * k));
  const y0 = Math.max(0, Math.floor((box.y - 2) * k));
  const x1 = Math.min(canvas.width, Math.ceil((box.x + box.width + 2) * k));
  const y1 = Math.min(canvas.height, Math.ceil((box.y + box.height + 2) * k));
  if (x1 - x0 < 2 || y1 - y0 < 2) return fallback;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  } catch {
    return fallback;
  }
  const w = x1 - x0;
  const h = y1 - y0;
  const at = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const counts = new Map<string, { n: number; rgb: number[] }>();
  const edge = (x: number, y: number) => {
    const rgb = at(x, y);
    const key = rgb.map((v) => v >> 4).join(",");
    const entry = counts.get(key) ?? { n: 0, rgb };
    entry.n++;
    counts.set(key, entry);
  };
  for (let x = 0; x < w; x++) {
    edge(x, 0);
    edge(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    edge(0, y);
    edge(w - 1, y);
  }
  const bg = [...counts.values()].sort((p, q) => q.n - p.n)[0].rgb;
  let best = bg;
  let distance = -1;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const rgb = at(x, y);
      const d = Math.abs(rgb[0] - bg[0]) + Math.abs(rgb[1] - bg[1]) + Math.abs(rgb[2] - bg[2]);
      if (d > distance) {
        distance = d;
        best = rgb;
      }
    }
  }
  return { background: hex(bg[0], bg[1], bg[2]), text: distance > 60 ? hex(best[0], best[1], best[2]) : fallback.text };
}
