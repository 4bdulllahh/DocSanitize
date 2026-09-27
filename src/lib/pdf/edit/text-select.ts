import type { Box } from "./types";

/** A run of text on the displayed page (horizontal only), with its box. */
export interface TextRun extends Box {
  str: string;
}

interface Line {
  top: number;
  bottom: number;
  runs: TextRun[];
}

/** Group runs into lines (runs whose boxes mostly overlap vertically), top to bottom, left to right. */
export function textLines(runs: TextRun[]): Line[] {
  const lines: Line[] = [];
  for (const run of [...runs].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2))) {
    const line = lines.find((l) => {
      const overlap = Math.min(l.bottom, run.y + run.height) - Math.max(l.top, run.y);
      return overlap > 0.5 * Math.min(run.height, l.bottom - l.top);
    });
    if (line) {
      line.runs.push(run);
      line.top = Math.min(line.top, run.y);
      line.bottom = Math.max(line.bottom, run.y + run.height);
    } else {
      lines.push({ top: run.y, bottom: run.y + run.height, runs: [run] });
    }
  }
  for (const line of lines) line.runs.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => a.top - b.top);
}

/** Snap an x position to the nearest character boundary within the line. */
function snap(line: Line, x: number): number {
  let best = line.runs[0].x;
  for (const run of line.runs) {
    const n = Math.max(1, run.str.length);
    for (let i = 0; i <= n; i++) {
      const edge = run.x + (run.width * i) / n;
      if (Math.abs(edge - x) < Math.abs(best - x)) best = edge;
    }
  }
  return best;
}

/** The line a point is on, or the nearest one. */
function lineAt(lines: Line[], y: number): number {
  let best = 0;
  let distance = Infinity;
  lines.forEach((line, i) => {
    const d = y < line.top ? line.top - y : y > line.bottom ? y - line.bottom : 0;
    if (d < distance) {
      distance = d;
      best = i;
    }
  });
  return best;
}

/**
 * The text selected by dragging from `from` to `to`, as one rectangle per line, like selecting
 * text in a PDF reader. Empty when nothing is selected.
 */
export function selectText(runs: TextRun[], from: { x: number; y: number }, to: { x: number; y: number }): Box[] {
  const lines = textLines(runs);
  if (lines.length === 0) return [];
  let a = { line: lineAt(lines, from.y), x: from.x };
  let b = { line: lineAt(lines, to.y), x: to.x };
  if (b.line < a.line || (b.line === a.line && b.x < a.x)) [a, b] = [b, a];

  const rects: Box[] = [];
  for (let i = a.line; i <= b.line; i++) {
    const line = lines[i];
    const left = line.runs[0].x;
    const right = Math.max(...line.runs.map((r) => r.x + r.width));
    const start = i === a.line ? snap(line, Math.max(left, Math.min(right, a.x))) : left;
    const end = i === b.line ? snap(line, Math.max(left, Math.min(right, b.x))) : right;
    if (end - start > 0.5) rects.push({ x: start, y: line.top, width: end - start, height: line.bottom - line.top });
  }
  return rects;
}
