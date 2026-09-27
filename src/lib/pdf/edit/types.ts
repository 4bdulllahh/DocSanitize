/*
 * The Edit PDF object model, shared by the editor and the code that writes the PDF. Positions
 * are in points on the page as the reader sees it: origin at the top-left, y downwards, page
 * rotation applied, cropped to the CropBox (the same space as a pdf.js viewport at scale 1).
 */

export type FontFamily = "sans" | "serif" | "mono";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Base {
  id: string;
  /** 0-based page index. */
  page: number;
}

export interface TextStyle {
  font: FontFamily;
  /** Points. */
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
}

/** New text. `x`, `y` is the top-left of the first line box; lines are 1.2 × size apart. */
export interface TextObject extends Base, TextStyle {
  kind: "text";
  x: number;
  y: number;
  text: string;
}

/** Existing text on the page replaced by new text. The original is removed from the file. */
export interface ReplaceObject extends Base, TextStyle {
  kind: "replace";
  x: number;
  y: number;
  text: string;
  /** Area covered to hide what was drawn there (the original line, displayed coordinates). */
  cover: Box;
  /** Colour of that cover, sampled from the page around the text. */
  background: string;
  /** The original text runs (pdf.js geometry, user space), used to find and remove their operators. */
  sources: { transform: number[]; width: number; height: number; str: string }[];
}

/** White-out: covers whatever is underneath. */
export interface WhiteoutObject extends Base, Box {
  kind: "whiteout";
  color: string;
}

export interface ShapeObject extends Base, Box {
  kind: "rect" | "ellipse";
  stroke: string | null;
  fill: string | null;
  strokeWidth: number;
  opacity: number;
}

export interface LineObject extends Base {
  kind: "line" | "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  strokeWidth: number;
  opacity: number;
}

/** Freehand drawing: one or more strokes, each a flat list of x, y pairs. */
export interface InkObject extends Base {
  kind: "ink";
  strokes: number[][];
  color: string;
  strokeWidth: number;
  opacity: number;
  /** Highlighter pen: drawn with a multiply blend so the text below stays readable. */
  highlighter: boolean;
}

/** Text markup over lines of text (or any area on a page without text). */
export interface MarkupObject extends Base {
  kind: "highlight" | "underline" | "strikeout";
  rects: Box[];
  color: string;
  opacity: number;
}

export interface MarkObject extends Base {
  kind: "check" | "cross" | "dot";
  x: number;
  y: number;
  /** Width and height of the mark's square. */
  size: number;
  color: string;
}

/** A picture or a signature. `image` is a key into the request's images. */
export interface ImageObject extends Base, Box {
  kind: "image";
  image: string;
  opacity: number;
}

/** A sticky note: a comment icon with text that opens in PDF readers. Always kept as a comment. */
export interface NoteObject extends Base {
  kind: "note";
  x: number;
  y: number;
  text: string;
  color: string;
}

export type EditObject = TextObject | ReplaceObject | WhiteoutObject | ShapeObject | LineObject | InkObject | MarkupObject | MarkObject | ImageObject | NoteObject;
export type EditKind = EditObject["kind"];

export interface EditRequest {
  objects: EditObject[];
  /** PNG or JPEG bytes by key. */
  images: Record<string, { bytes: Uint8Array; format: "png" | "jpeg" }>;
  /**
   * true: draw everything into the page. false: add annotations other PDF apps can select, move
   * or delete. Replaced text and white-out are always drawn into the page, and notes are always
   * comments.
   */
  flatten: boolean;
}

export interface EditResult {
  bytes: Uint8Array;
  warnings: string[];
}

/** Line height, and where the baseline sits in a line box, per font family (fractions of the size). */
export const FONT_METRICS: Record<FontFamily, { ascent: number; descent: number }> = {
  // Liberation Sans / Arial, Times, Courier: ascent and descent as browsers lay them out.
  sans: { ascent: 0.905, descent: 0.212 },
  serif: { ascent: 0.891, descent: 0.216 },
  mono: { ascent: 0.833, descent: 0.3 },
};
export const LINE_HEIGHT = 1.2;

/** Distance from the top of a line box to its baseline, as CSS lays it out. */
export function baselineOffset(font: FontFamily, size: number): number {
  const { ascent, descent } = FONT_METRICS[font];
  return ((LINE_HEIGHT - ascent - descent) / 2 + ascent) * size;
}

/** Page count (and sizes) aren't known to the model; objects just name their page. */
export function objectsOnPage<T extends EditObject>(objects: T[], page: number): T[] {
  return objects.filter((o) => o.page === page);
}
