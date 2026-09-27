import type { TextPage } from "../office/text-layout";

/** A rectangle as fractions (0–1) of the displayed page, origin top-left. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Text shown by an annotation (form field value, comment, free text) and where it sits. */
export interface AnnotationText {
  text: string;
  /** Rectangle in top-down page coordinates (points, rotation applied): [x1, y1, x2, y2]. */
  rect: [number, number, number, number];
}

/**
 * Boxes over annotations showing `query`. Their text isn't part of the page's text content, but it
 * is drawn on the page, so a flattened page would still show it. The whole annotation is covered.
 */
export function findAnnotationBoxes(annotations: AnnotationText[], query: string, pageWidth: number, pageHeight: number): Box[] {
  const needle = normalize(query);
  if (!needle) return [];
  return annotations
    .filter((a) => normalize(a.text).includes(needle))
    .map(({ rect: [x1, y1, x2, y2] }) => {
      const [left, right, top, bottom] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(y1, y2), Math.max(y1, y2)];
      return { x: (left - 1) / pageWidth, y: (top - 1) / pageHeight, width: (right - left + 2) / pageWidth, height: (bottom - top + 2) / pageHeight };
    });
}

/**
 * Boxes covering every case-insensitive occurrence of `query` on a page. A match that spans
 * several text items (e.g. "Jane" + "Doe") gets one box per item.
 */
export function findTextBoxes(page: TextPage, query: string): Box[] {
  const needle = normalize(query);
  if (!needle) return [];

  // The page's text with runs of whitespace collapsed, remembering where each character came from.
  let text = "";
  const origin: { item: number; char: number }[] = [];
  page.items.forEach((item, i) => {
    for (let c = 0; c < item.text.length; c++) {
      const ch = /\s/.test(item.text[c]) ? " " : item.text[c];
      if (ch === " " && (text === "" || text.endsWith(" "))) continue;
      text += ch.toLowerCase();
      origin.push({ item: i, char: c });
    }
    // Separate items that aren't touching, so words don't run together.
    const next = page.items[i + 1];
    if (next && !text.endsWith(" ") && next.x - (item.x + item.width) > item.size * 0.15) {
      text += " ";
      origin.push({ item: i, char: item.text.length });
    }
  });

  const boxes: Box[] = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
    // Characters of the match, grouped by the item they belong to.
    const spans = new Map<number, [number, number]>();
    for (const { item, char } of origin.slice(at, at + needle.length)) {
      const span = spans.get(item);
      spans.set(item, span ? [Math.min(span[0], char), Math.max(span[1], char + 1)] : [char, char + 1]);
    }
    for (const [index, [from, to]] of spans) {
      const item = page.items[index];
      const length = Math.max(1, item.text.length);
      const x0 = item.x + (item.width * from) / length;
      const x1 = item.x + (item.width * Math.min(to, length)) / length;
      if (x1 - x0 <= 0) continue;
      // Ascent ~0.9 em above the baseline, descent ~0.25 em below, plus a point of margin.
      const top = item.y - item.size * 0.9 - 1;
      const bottom = item.y + item.size * 0.25 + 1;
      boxes.push({ x: (x0 - 1) / page.width, y: top / page.height, width: (x1 - x0 + 2) / page.width, height: (bottom - top) / page.height });
    }
  }
  return boxes;
}
