import { LINE_HEIGHT } from "../pdf/edit/types";

/*
 * Fitting translated text into the space the original took: wrap it to the original width and,
 * if it's longer, shrink the font step by step (to no less than MIN_SCALE of the original).
 */

export const MIN_SCALE = 0.6;

/** Width of `text` at a font size. */
export type Measure = (text: string, size: number) => number;

/** Greedy word wrap; words wider than the line (or scripts without spaces) break between characters. */
export function wrapText(text: string, width: number, fits: (line: string) => boolean): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    if (fits(word)) {
      line = word;
      continue;
    }
    for (const ch of Array.from(word)) {
      if (line && !fits(line + ch)) {
        lines.push(line);
        line = "";
      }
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface Fitted {
  size: number;
  lines: string[];
  /** Even at the smallest size the text is taller than the space. */
  overflow: boolean;
}

/** The largest size (up to `size`) at which `text`, wrapped to `width`, fits in `height`. */
export function fitText(text: string, box: { width: number; height: number }, size: number, measure: Measure): Fitted {
  // Room for the lines the original had, measured as the editor lays out text.
  const room = Math.max(box.height, size * LINE_HEIGHT) + 0.2 * size;
  let fitted: Fitted | null = null;
  for (let s = size; s >= size * MIN_SCALE - 1e-9; s *= 0.95) {
    const lines = wrapText(text, box.width, (line) => measure(line, s) <= box.width + 0.01);
    fitted = { size: s, lines, overflow: false };
    if (lines.length * LINE_HEIGHT * s <= room) return fitted;
  }
  return { ...fitted!, overflow: true };
}
