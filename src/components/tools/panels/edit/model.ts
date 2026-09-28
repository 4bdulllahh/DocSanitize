import {
  Brush,
  Check,
  Circle,
  CircleDot,
  Eraser,
  Highlighter,
  ImagePlus,
  MousePointer2,
  MoveUpRight,
  PenLine,
  Minus,
  Signature,
  Square,
  StickyNote,
  Strikethrough,
  TextCursorInput,
  Type,
  Underline,
  X,
  type LucideIcon,
} from "lucide-react";
import type { EditObject, FontFamily, TextStyle } from "@/lib/pdf/edit/types";
import { msg } from "@/i18n/msg";

export type Tool =
  | "select"
  | "text"
  | "edit-text"
  | "whiteout"
  | "highlight"
  | "underline"
  | "strikeout"
  | "pen"
  | "highlighter"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "check"
  | "cross"
  | "dot"
  | "image"
  | "sign"
  | "note";

export interface ToolInfo {
  id: Tool;
  label: string;
  icon: LucideIcon;
  /** Single-key shortcut. */
  key?: string;
  /** What to do with it, shown in the inspector. */
  hint: string;
}

export const TOOL_GROUPS: ToolInfo[][] = [
  [{ id: "select", label: msg("Select"), icon: MousePointer2, key: "v", hint: msg("Click something you added to select it. Drag to move it, drag the handle to resize it, and press Delete to remove it. Double-click text to change it.") }],
  [
    { id: "text", label: msg("Add text"), icon: Type, key: "t", hint: msg("Click where the text should start, then type.") },
    { id: "edit-text", label: msg("Edit text"), icon: TextCursorInput, key: "e", hint: msg("Click a line of the document's own text to change it. The original words are removed from the file, not just covered.") },
    { id: "whiteout", label: msg("White-out"), icon: Eraser, key: "w", hint: msg("Drag over anything to cover it. It hides content but doesn't remove it from the file; use Redact for that.") },
  ],
  [
    { id: "highlight", label: msg("Highlight"), icon: Highlighter, key: "h", hint: msg("Drag across text to highlight it. On pages without text, drag over the area instead.") },
    { id: "underline", label: msg("Underline"), icon: Underline, key: "u", hint: msg("Drag across text to underline it.") },
    { id: "strikeout", label: msg("Strikethrough"), icon: Strikethrough, key: "k", hint: msg("Drag across text to strike it through.") },
  ],
  [
    { id: "pen", label: msg("Pen"), icon: PenLine, key: "p", hint: msg("Draw freehand with a mouse, pen or finger.") },
    { id: "highlighter", label: msg("Marker"), icon: Brush, key: "m", hint: msg("Draw freehand with a see-through marker.") },
  ],
  [
    { id: "rect", label: msg("Rectangle"), icon: Square, key: "r", hint: msg("Drag to draw a rectangle. Hold Shift for a square.") },
    { id: "ellipse", label: msg("Ellipse"), icon: Circle, key: "o", hint: msg("Drag to draw an ellipse. Hold Shift for a circle.") },
    { id: "line", label: msg("Line"), icon: Minus, key: "l", hint: msg("Drag to draw a line. Hold Shift to keep it straight.") },
    { id: "arrow", label: msg("Arrow"), icon: MoveUpRight, key: "a", hint: msg("Drag to draw an arrow. Hold Shift to keep it straight.") },
  ],
  [
    { id: "check", label: msg("Check mark"), icon: Check, key: "c", hint: msg("Click to put a check mark, e.g. in a form's box.") },
    { id: "cross", label: msg("Cross"), icon: X, key: "x", hint: msg("Click to put a cross.") },
    { id: "dot", label: msg("Dot"), icon: CircleDot, key: "d", hint: msg("Click to put a dot.") },
  ],
  [
    { id: "image", label: msg("Image"), icon: ImagePlus, key: "i", hint: msg("Choose a picture; it's placed on this page, then you can move and resize it.") },
    { id: "sign", label: msg("Signature"), icon: Signature, key: "s", hint: msg("Create a signature, then place it on the page.") },
    { id: "note", label: msg("Note"), icon: StickyNote, key: "n", hint: msg("Click to add a sticky note. Its text opens when someone clicks it in a PDF reader.") },
  ],
];

export const TOOLS_BY_ID = Object.fromEntries(TOOL_GROUPS.flat().map((t) => [t.id, t])) as Record<Tool, ToolInfo>;

/** Tools that stay active after use (the others select what they made). */
export const STAYS_ACTIVE = new Set<Tool>(["pen", "highlighter", "highlight", "underline", "strikeout", "check", "cross", "dot", "edit-text", "whiteout"]);

export const COLORS = [
  { value: "#111827", name: msg("Black") },
  { value: "#1d3a8a", name: msg("Blue") },
  { value: "#dc2626", name: msg("Red") },
  { value: "#16a34a", name: msg("Green") },
  { value: "#f97316", name: msg("Orange") },
  { value: "#7c3aed", name: msg("Purple") },
  { value: "#6b7280", name: msg("Grey") },
  { value: "#ffffff", name: msg("White") },
];

export const MARKER_COLORS = [
  { value: "#fde047", name: msg("Yellow") },
  { value: "#86efac", name: msg("Green") },
  { value: "#7dd3fc", name: msg("Blue") },
  { value: "#f9a8d4", name: msg("Pink") },
  { value: "#fdba74", name: msg("Orange") },
];

/** Settings new objects are made with; changed from the inspector. */
export interface Defaults {
  text: TextStyle;
  stroke: string | null;
  fill: string | null;
  strokeWidth: number;
  opacity: number;
  pen: { color: string; width: number };
  marker: { color: string; width: number };
  markup: Record<"highlight" | "underline" | "strikeout", string>;
  mark: { color: string; size: number };
  whiteout: string;
  note: string;
}

export const DEFAULTS: Defaults = {
  text: { font: "sans", size: 12, bold: false, italic: false, color: "#111827" },
  stroke: "#dc2626",
  fill: null,
  strokeWidth: 2,
  opacity: 1,
  pen: { color: "#1d3a8a", width: 2 },
  marker: { color: "#fde047", width: 12 },
  markup: { highlight: "#fde047", underline: "#2563eb", strikeout: "#dc2626" },
  mark: { color: "#111827", size: 14 },
  whiteout: "#ffffff",
  note: "#fde047",
};

/** CSS font stacks that match the PDF fonts' metrics (Liberation Sans ≈ Arial, Times, Courier). */
export const CSS_FONTS: Record<FontFamily, string> = {
  sans: '"Liberation Sans", Arial, Helvetica, sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", serif',
  mono: '"Courier New", Courier, "Liberation Mono", monospace',
};

export type TextLike = Extract<EditObject, { kind: "text" | "replace" }>;

let measureContext: CanvasRenderingContext2D | null = null;
/** Width in points of a text object's longest line, measured with the browser's fonts. */
export function measureText(object: TextLike): number {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return object.text.length * object.size * 0.6;
  measureContext.font = `${object.italic ? "italic " : ""}${object.bold ? "bold " : ""}100px ${CSS_FONTS[object.font]}`;
  return Math.max(...object.text.split("\n").map((line) => measureContext!.measureText(line).width)) * (object.size / 100);
}
