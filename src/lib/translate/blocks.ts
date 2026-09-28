import type { Box, FontFamily, ReplaceObject } from "../pdf/edit/types";

/*
 * Groups a page's lines into blocks (paragraphs, headings, table cells) so each is translated as a
 * whole, with its context, and the translation is laid out in the space the original used.
 */

/** A line of the page's text, as `readPhrases` gives it (displayed points). */
export interface Line extends Box {
  str: string;
  size: number;
  baseline: number;
  font: FontFamily;
  bold: boolean;
  italic: boolean;
  sources: ReplaceObject["sources"];
}

export interface TextBlock {
  lines: Line[];
  text: string;
  box: Box;
  /** Displayed y of the first line's baseline. */
  baseline: number;
  size: number;
  font: FontFamily;
  bold: boolean;
  italic: boolean;
}

const right = (b: Box) => b.x + b.width;

/** Whether `line` continues the paragraph that `block` is building. */
function continues(block: Line[], line: Line): boolean {
  const last = block[block.length - 1];
  const size = Math.max(last.size, line.size);
  if (Math.abs(last.size - line.size) > 0.15 * size || last.bold !== line.bold) return false;
  const pitch = line.baseline - last.baseline;
  if (pitch < 0.9 * size || pitch > 1.9 * size) return false;
  // Lines of the same column overlap horizontally.
  const overlap = Math.min(right(last), right(line)) - Math.max(last.x, line.x);
  if (overlap < 0.3 * Math.min(last.width, line.width)) return false;
  // A clearly short line ends a paragraph (unless the text is centred or ragged throughout).
  const blockRight = Math.max(...block.map(right));
  const blockLeft = Math.min(...block.map((l) => l.x));
  const short = right(last) < blockRight - Math.max(0.2 * (blockRight - blockLeft), 3 * size);
  return !(short && Math.abs(line.x - blockLeft) < size);
}

/** Paragraph text from its lines, rejoining words hyphenated across a line break. */
export function joinLines(lines: string[]): string {
  let text = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/\p{L}-$/u.test(text) && /^\p{Ll}/u.test(line)) text = text.slice(0, -1) + line;
    else text = text ? `${text} ${line}` : line;
  }
  return text;
}

/** Group lines (in reading order: top to bottom, left to right) into blocks. */
export function groupLines(lines: Line[]): TextBlock[] {
  const open: Line[][] = [];
  for (const line of lines) {
    let best: Line[] | null = null;
    for (const block of open) {
      if (!continues(block, line)) continue;
      if (!best || block[block.length - 1].baseline > best[best.length - 1].baseline) best = block;
    }
    if (best) best.push(line);
    else open.push([line]);
  }
  return open.map((block) => {
    const x = Math.min(...block.map((l) => l.x));
    const y = Math.min(...block.map((l) => l.y));
    const first = block[0];
    return {
      lines: block,
      text: joinLines(block.map((l) => l.str)),
      box: { x, y, width: Math.max(...block.map(right)) - x, height: Math.max(...block.map((l) => l.y + l.height)) - y },
      baseline: first.baseline,
      size: first.size,
      font: first.font,
      bold: first.bold,
      italic: block.every((l) => l.italic),
    };
  });
}

/** Whether a block has words to translate (not just numbers, symbols or a single letter). */
export const hasWords = (text: string) => /\p{L}{2}/u.test(text);
