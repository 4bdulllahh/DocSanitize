import fontkit from "@cantoo/fontkit";
import {
  appendBezierCurve,
  beginText,
  closePath,
  concatTransformationMatrix,
  decodePDFRawStream,
  drawObject,
  endText,
  fill,
  fillAndStroke,
  LineCapStyle,
  LineJoinStyle,
  lineTo,
  moveTo,
  PDFArray,
  PDFContentStream,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
  setFontAndSize,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  setTextMatrix,
  showText,
  StandardFonts,
  stroke,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
  type PDFRef,
} from "@cantoo/pdf-lib";
import { Encodings } from "@cantoo/pdf-lib/standard-fonts";
import { ProcessingError } from "../../errors";
import type { FontFiles } from "../../office/flow";
import { collectGarbage, loadPdf, savePdf } from "../load";
import { displaySize, pageGeometry, type PageGeometry } from "../stamp";
import { removeTextInRegions } from "./content";
import { pageFontMetrics } from "./fonts";
import { bounds } from "./geometry";
import { baselineOffset, LINE_HEIGHT, type Box, type EditObject, type EditRequest, type EditResult, type ReplaceObject, type TextObject } from "./types";
import { msg } from "@/i18n/msg";

/*
 * Writes the editor's objects into a PDF. Everything is drawn in "upright" space: points from
 * the bottom-left of the page as the reader sees it. One matrix per page maps that to the page's
 * own user space, whatever its rotation and crop box, so the same drawing code serves content
 * drawn into the page and annotation appearances (as the form's /Matrix).
 */

type Matrix = [number, number, number, number, number, number];

/** Upright space -> user space for a page. */
export function uprightMatrix({ rotation, box }: PageGeometry): Matrix {
  const { x, y, width, height } = box;
  switch (rotation) {
    case 90:
      return [0, 1, -1, 0, x + width, y];
    case 180:
      return [-1, 0, 0, -1, x + width, y + height];
    case 270:
      return [0, -1, 1, 0, x, y + height];
    default:
      return [1, 0, 0, 1, x, y];
  }
}

const transformPoint = (m: Matrix, px: number, py: number) => [px * m[0] + py * m[2] + m[4], px * m[1] + py * m[3] + m[5]];

function rgbOf(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x333333;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ---------------------------------------------------------------------------- Resources

/** Names for fonts, images and graphics states used by a drawing, in a page or in a form. */
interface Resources {
  font(font: PDFFont): PDFName;
  image(image: PDFImage): PDFName;
  /** Opacity and blend mode; null when nothing needs changing. */
  state(opacity: number, multiply: boolean): PDFName | null;
}

function pageResources(page: PDFPage): Resources {
  const fonts = new Map<PDFRef, PDFName>();
  const images = new Map<PDFRef, PDFName>();
  const states = new Map<string, PDFName>();
  return {
    font: (font) => fonts.get(font.ref) ?? fonts.set(font.ref, page.node.newFontDictionary("EdF", font.ref)).get(font.ref)!,
    image: (image) => images.get(image.ref) ?? images.set(image.ref, page.node.newXObject("EdIm", image.ref)).get(image.ref)!,
    state: (opacity, multiply) => {
      if (opacity >= 1 && !multiply) return null;
      const key = `${opacity}:${multiply}`;
      if (!states.has(key)) {
        const dict = page.doc.context.obj({ Type: "ExtGState", ca: opacity, CA: opacity, ...(multiply ? { BM: "Multiply" } : {}) });
        states.set(key, page.node.newExtGState("EdGS", dict));
      }
      return states.get(key)!;
    },
  };
}

/** Resources collected for one annotation appearance; `dict()` builds its /Resources. */
function formResources(doc: PDFDocument) {
  const fonts = new Map<string, PDFRef>();
  const images = new Map<string, PDFRef>();
  const states = new Map<string, PDFDict>();
  const resources: Resources & { dict(): PDFDict } = {
    font: (font) => {
      const name = `F${[...fonts.values()].indexOf(font.ref) + 1 || fonts.size + 1}`;
      fonts.set(name, font.ref);
      return PDFName.of(name);
    },
    image: (image) => {
      const name = `Im${images.size + 1}`;
      images.set(name, image.ref);
      return PDFName.of(name);
    },
    state: (opacity, multiply) => {
      if (opacity >= 1 && !multiply) return null;
      const name = `GS${states.size + 1}`;
      states.set(name, doc.context.obj({ Type: "ExtGState", ca: opacity, CA: opacity, ...(multiply ? { BM: "Multiply" } : {}) }));
      return PDFName.of(name);
    },
    dict: () =>
      doc.context.obj({
        ...(fonts.size ? { Font: Object.fromEntries(fonts) } : {}),
        ...(images.size ? { XObject: Object.fromEntries(images) } : {}),
        ...(states.size ? { ExtGState: Object.fromEntries(states) } : {}),
      }),
  };
  return resources;
}

// ---------------------------------------------------------------------------- Fonts

export interface FontSet {
  /** The font to draw `text` with, and whether it had to fall back to the sans font. */
  pick(object: Pick<TextObject, "font" | "bold" | "italic" | "text">): Promise<{ font: PDFFont; text: string; fellBack: boolean; missing: boolean }>;
}

export function fontSet(doc: PDFDocument, files: FontFiles): FontSet {
  const cache = new Map<string, Promise<PDFFont>>();
  const load = (key: string, make: () => Promise<PDFFont>) => cache.get(key) ?? cache.set(key, make()).get(key)!;
  const sans = (bold: boolean, italic: boolean) =>
    load(`sans-${bold}-${italic}`, () => {
      doc.registerFontkit(fontkit);
      return doc.embedFont(bold ? (italic ? files.boldItalic : files.bold) : italic ? files.italic : files.regular, { subset: true });
    });
  const standard: Record<"serif" | "mono", [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
    serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
    mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
  };
  return {
    async pick(object) {
      const chars = Array.from(object.text.replace(/\n/g, ""));
      if (object.font !== "sans" && chars.every((ch) => Encodings.WinAnsi.canEncodeUnicodeCodePoint(ch.codePointAt(0)!))) {
        const variant = standard[object.font][(object.bold ? 1 : 0) + (object.italic ? 2 : 0)];
        return { font: await load(variant, () => doc.embedFont(variant)), text: object.text, fellBack: false, missing: false };
      }
      const font = await sans(object.bold, object.italic);
      const supported = new Set(font.getCharacterSet());
      let missing = false;
      const text = Array.from(object.text, (ch) => {
        if (ch === "\n" || ch === " " || supported.has(ch.codePointAt(0)!)) return ch;
        missing = true;
        return "?";
      }).join("");
      return { font, text, fellBack: object.font !== "sans", missing };
    },
  };
}

// ---------------------------------------------------------------------------- Drawing

interface DrawContext {
  /** Displayed page height; upright y = height - displayed y. */
  height: number;
  resources: Resources;
  fonts: FontSet;
  images: Map<string, PDFImage>;
  /** Include opacity in the drawing (content), or leave it to the annotation's /CA. */
  opacityInDrawing: boolean;
  warnings: Set<string>;
}

const KAPPA = 0.5522847498;

function ellipsePath(cx: number, cy: number, rx: number, ry: number): PDFOperator[] {
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return [
    moveTo(cx - rx, cy),
    appendBezierCurve(cx - rx, cy + oy, cx - ox, cy + ry, cx, cy + ry),
    appendBezierCurve(cx + ox, cy + ry, cx + rx, cy + oy, cx + rx, cy),
    appendBezierCurve(cx + rx, cy - oy, cx + ox, cy - ry, cx, cy - ry),
    appendBezierCurve(cx - ox, cy - ry, cx - rx, cy - oy, cx - rx, cy),
    closePath(),
  ];
}

/** Points of a mark's path in a unit square (displayed orientation: y down). */
const MARK_PATHS: Record<"check" | "cross", number[][]> = {
  check: [[0.12, 0.55, 0.4, 0.84, 0.9, 0.16]],
  cross: [
    [0.16, 0.16, 0.84, 0.84],
    [0.84, 0.16, 0.16, 0.84],
  ],
};

async function draw(object: EditObject, ctx: DrawContext): Promise<PDFOperator[]> {
  const Y = (v: number) => ctx.height - v;
  const ops: PDFOperator[] = [pushGraphicsState()];
  const withState = (opacity: number, multiply = false) => {
    const name = ctx.resources.state(ctx.opacityInDrawing ? opacity : 1, multiply);
    if (name) ops.push(setGraphicsState(name));
  };
  const rect = (b: Box) => rectangle(b.x, Y(b.y + b.height), b.width, b.height);

  switch (object.kind) {
    case "whiteout":
      ops.push(setFillingRgbColor(...rgbOf(object.color)), rect(object), fill());
      break;
    case "rect":
    case "ellipse": {
      withState(object.opacity);
      if (object.fill) ops.push(setFillingRgbColor(...rgbOf(object.fill)));
      if (object.stroke) ops.push(setStrokingRgbColor(...rgbOf(object.stroke)), setLineWidth(object.strokeWidth), setLineJoin(LineJoinStyle.Miter));
      if (object.kind === "rect") ops.push(rect(object));
      else ops.push(...ellipsePath(object.x + object.width / 2, Y(object.y + object.height / 2), object.width / 2, object.height / 2));
      ops.push(object.fill && object.stroke ? fillAndStroke() : object.fill ? fill() : stroke());
      break;
    }
    case "line":
    case "arrow": {
      withState(object.opacity);
      const [r, g, b] = rgbOf(object.color);
      ops.push(setStrokingRgbColor(r, g, b), setFillingRgbColor(r, g, b), setLineWidth(object.strokeWidth), setLineCap(LineCapStyle.Round));
      let { x2, y2 } = object;
      if (object.kind === "arrow") {
        const length = Math.hypot(x2 - object.x1, y2 - object.y1) || 1;
        const head = Math.min(length, Math.max(8, object.strokeWidth * 4));
        const [ux, uy] = [(x2 - object.x1) / length, (y2 - object.y1) / length];
        const [bx, by] = [x2 - ux * head, y2 - uy * head];
        const [px, py] = [-uy * head * 0.45, ux * head * 0.45];
        ops.push(moveTo(x2, Y(y2)), lineTo(bx + px, Y(by + py)), lineTo(bx - px, Y(by - py)), closePath(), fill());
        [x2, y2] = [bx + ux * 0.5, by + uy * 0.5];
      }
      ops.push(moveTo(object.x1, Y(object.y1)), lineTo(x2, Y(y2)), stroke());
      break;
    }
    case "ink": {
      withState(object.opacity, object.highlighter);
      ops.push(setStrokingRgbColor(...rgbOf(object.color)), setLineWidth(object.strokeWidth), setLineCap(object.highlighter ? LineCapStyle.Projecting : LineCapStyle.Round), setLineJoin(LineJoinStyle.Round));
      for (const points of object.strokes) {
        if (points.length < 2) continue;
        ops.push(moveTo(points[0], Y(points[1])));
        // A single tap still leaves a dot.
        if (points.length === 2) ops.push(lineTo(points[0] + 0.01, Y(points[1])));
        for (let i = 2; i + 1 < points.length; i += 2) ops.push(lineTo(points[i], Y(points[i + 1])));
        ops.push(stroke());
      }
      break;
    }
    case "highlight":
    case "underline":
    case "strikeout": {
      const [r, g, b] = rgbOf(object.color);
      withState(object.opacity, object.kind === "highlight");
      for (const box of object.rects) {
        if (object.kind === "highlight") {
          ops.push(setFillingRgbColor(r, g, b), rect(box), fill());
        } else {
          const width = Math.max(0.6, box.height * 0.07);
          const v = object.kind === "underline" ? box.y + box.height - width : box.y + box.height * 0.55;
          ops.push(setFillingRgbColor(r, g, b), rectangle(box.x, Y(v + width / 2), box.width, width), fill());
        }
      }
      break;
    }
    case "check":
    case "cross":
    case "dot": {
      const [r, g, b] = rgbOf(object.color);
      const s = object.size;
      if (object.kind === "dot") {
        ops.push(setFillingRgbColor(r, g, b), ...ellipsePath(object.x + s / 2, Y(object.y + s / 2), s * 0.32, s * 0.32), fill());
      } else {
        ops.push(setStrokingRgbColor(r, g, b), setLineWidth(s * 0.12), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round));
        for (const path of MARK_PATHS[object.kind]) {
          ops.push(moveTo(object.x + path[0] * s, Y(object.y + path[1] * s)));
          for (let i = 2; i < path.length; i += 2) ops.push(lineTo(object.x + path[i] * s, Y(object.y + path[i + 1] * s)));
          ops.push(stroke());
        }
      }
      break;
    }
    case "image": {
      const image = ctx.images.get(object.image);
      if (!image) throw new ProcessingError("An image placed on the page is missing.", "invalid");
      withState(object.opacity);
      ops.push(concatTransformationMatrix(object.width, 0, 0, object.height, object.x, Y(object.y + object.height)), drawObject(ctx.resources.image(image)));
      break;
    }
    case "note": {
      // A speech-bubble icon, 20 × 20.
      const [r, g, b] = rgbOf(object.color);
      const { x } = object;
      const top = Y(object.y);
      ops.push(setFillingRgbColor(r, g, b), setStrokingRgbColor(r * 0.6, g * 0.6, b * 0.6), setLineWidth(0.8), setLineJoin(LineJoinStyle.Round));
      ops.push(moveTo(x + 1, top - 1), lineTo(x + 19, top - 1), lineTo(x + 19, top - 14), lineTo(x + 9, top - 14), lineTo(x + 5, top - 19), lineTo(x + 5, top - 14), lineTo(x + 1, top - 14), closePath(), fillAndStroke());
      ops.push(setStrokingRgbColor(0.15, 0.15, 0.15), setLineWidth(1));
      for (const v of [4.5, 7.5, 10.5]) ops.push(moveTo(x + 4, top - v), lineTo(x + 16, top - v), stroke());
      break;
    }
    case "text":
    case "replace": {
      if (object.kind === "replace") ops.push(setFillingRgbColor(...rgbOf(object.background)), rect(object.cover), fill());
      const { font, text, fellBack, missing } = await ctx.fonts.pick(object);
      if (fellBack) ctx.warnings.add(msg("Some text uses characters the serif or monospaced font doesn't have, so it was set in the sans font."));
      if (missing) ctx.warnings.add(msg("Some characters aren't in the built-in font (it covers Latin, Greek and Cyrillic) and were replaced with “?”."));
      const name = ctx.resources.font(font);
      ops.push(beginText(), setFillingRgbColor(...rgbOf(object.color)), setFontAndSize(name, object.size));
      text.split("\n").forEach((line, i) => {
        if (!line) return;
        const baseline = object.y + baselineOffset(object.font, object.size) + i * LINE_HEIGHT * object.size;
        ops.push(setTextMatrix(1, 0, 0, 1, object.x, Y(baseline)), showText(font.encodeText(line)));
      });
      ops.push(endText());
      break;
    }
  }
  ops.push(popGraphicsState());
  return ops;
}

// ---------------------------------------------------------------------------- Annotations

const SUBTYPES: Record<Exclude<EditObject["kind"], "replace" | "whiteout">, string> = {
  text: "FreeText",
  rect: "Square",
  ellipse: "Circle",
  line: "Line",
  arrow: "Line",
  ink: "Ink",
  highlight: "Highlight",
  underline: "Underline",
  strikeout: "StrikeOut",
  check: "Stamp",
  cross: "Stamp",
  dot: "Stamp",
  image: "Stamp",
  note: "Text",
};

/**
 * Add an object as an annotation whose appearance is the same drawing. No author (/T) or dates
 * (/M, /CreationDate) are written: they'd be metadata the user didn't ask for.
 */
async function addAnnotation(doc: PDFDocument, page: PDFPage, object: Exclude<EditObject, ReplaceObject | { kind: "whiteout" }>, ctx: Omit<DrawContext, "resources" | "opacityInDrawing">, matrix: Matrix) {
  const resources = formResources(doc);
  const ops = await draw(object, { ...ctx, resources, opacityInDrawing: false });
  const box = bounds(object);
  const upright = [box.x, ctx.height - box.y - box.height, box.x + box.width, ctx.height - box.y];
  const corners = [transformPoint(matrix, upright[0], upright[1]), transformPoint(matrix, upright[2], upright[3])];
  const rect = [Math.min(corners[0][0], corners[1][0]), Math.min(corners[0][1], corners[1][1]), Math.max(corners[0][0], corners[1][0]), Math.max(corners[0][1], corners[1][1])];
  const appearance = doc.context.formXObject(ops, { BBox: upright, Matrix: matrix, Resources: resources.dict() });
  const toUser = (u: number, v: number) => transformPoint(matrix, u, ctx.height - v);
  const color = "color" in object ? rgbOf(object.color) : "stroke" in object ? rgbOf(object.stroke ?? object.fill ?? "#000000") : [0, 0, 0];

  const fields: Record<string, unknown> = {
    Type: "Annot",
    Subtype: SUBTYPES[object.kind],
    Rect: rect,
    AP: { N: doc.context.register(appearance) },
    F: 4, // print
    C: color,
  };
  if ("opacity" in object && object.opacity < 1) fields.CA = object.opacity;
  switch (object.kind) {
    case "text":
      fields.Contents = PDFHexString.fromText(object.text);
      fields.DA = PDFString.of(`${rgbOf(object.color).map((c) => c.toFixed(3)).join(" ")} rg /Helv ${object.size} Tf`);
      delete fields.C;
      break;
    case "rect":
    case "ellipse":
      fields.BS = { W: object.stroke ? object.strokeWidth : 0 };
      if (object.fill) fields.IC = rgbOf(object.fill);
      if (!object.stroke) delete fields.C;
      break;
    case "line":
    case "arrow":
      fields.L = [...toUser(object.x1, object.y1), ...toUser(object.x2, object.y2)];
      fields.BS = { W: object.strokeWidth };
      if (object.kind === "arrow") {
        fields.LE = ["None", "ClosedArrow"];
        fields.IC = rgbOf(object.color);
      }
      break;
    case "ink":
      fields.InkList = object.strokes.map((s) => {
        const out: number[] = [];
        for (let i = 0; i + 1 < s.length; i += 2) out.push(...toUser(s[i], s[i + 1]));
        return out;
      });
      fields.BS = { W: object.strokeWidth };
      break;
    case "highlight":
    case "underline":
    case "strikeout":
      // Upper-left, upper-right, lower-left, lower-right of each line, as readers see them.
      fields.QuadPoints = object.rects.flatMap((r) => [...toUser(r.x, r.y), ...toUser(r.x + r.width, r.y), ...toUser(r.x, r.y + r.height), ...toUser(r.x + r.width, r.y + r.height)]);
      break;
    case "note":
      fields.Contents = PDFHexString.fromText(object.text);
      fields.Name = "Comment";
      fields.Open = false;
      break;
    case "image":
    case "check":
    case "cross":
    case "dot":
      fields.Name = object.kind === "image" ? "Image" : "Mark";
      delete fields.C;
      break;
  }
  page.node.addAnnot(doc.context.register(doc.context.obj(fields as Parameters<typeof doc.context.obj>[0])));
}

// ---------------------------------------------------------------------------- Text removal

/** The page's content streams, decoded and joined. */
function pageContent(page: PDFPage): Uint8Array | null {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => page.doc.context.lookup(ref)) : [contents];
  const parts: Uint8Array[] = [];
  for (const stream of streams) {
    if (stream instanceof PDFRawStream) parts.push(decodePDFRawStream(stream).decode());
    else if (stream instanceof PDFContentStream) parts.push(stream.getUnencodedContents());
    else if (stream) return null;
    parts.push(new Uint8Array([10]));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Remove the text of each group of runs (a line) from the page content. Returns, per group,
 * whether all of its runs were found and removed.
 */
export function removePageText(page: PDFPage, groups: ReplaceObject["sources"][]): boolean[] {
  const content = pageContent(page);
  if (!content) return groups.map(() => false);
  const result = removeTextInRegions(content, groups.flat(), pageFontMetrics(page));
  if (result.removed.some((n) => n > 0)) {
    const { context } = page.doc;
    // An array, as pdf-lib expects once a page is normalised (drawing appends to it).
    page.node.set(PDFName.of("Contents"), context.obj([context.register(context.flateStream(result.bytes))]));
  }
  let at = 0;
  return groups.map((g) => result.removed.slice(at, (at += g.length)).every((n) => n > 0));
}

/** Remove the original text of replaced lines from the page content. Returns the lines it couldn't find. */
function removeReplacedText(page: PDFPage, replaced: ReplaceObject[]): ReplaceObject[] {
  const removed = removePageText(page, replaced.map((r) => r.sources));
  return replaced.filter((_, i) => !removed[i]);
}

// ---------------------------------------------------------------------------- Entry point

export async function applyEdits(bytes: Uint8Array, request: EditRequest, files: FontFiles): Promise<EditResult> {
  if (request.objects.length === 0) throw new ProcessingError("Make a change to the document first.", "invalid");
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  if (request.objects.some((o) => !pages[o.page])) throw new ProcessingError("Something is placed on a page that doesn't exist.", "invalid");
  const warnings = new Set<string>();

  // 1. Remove the original text of edited lines, then drop the old content streams.
  let removedAny = false;
  for (const [index, page] of pages.entries()) {
    const replaced = request.objects.filter((o): o is ReplaceObject => o.kind === "replace" && o.page === index);
    if (replaced.length === 0) continue;
    const missed = removeReplacedText(page, replaced);
    removedAny ||= missed.length < replaced.length;
    for (const m of missed) {
      const original = m.sources.map((r) => r.str).join(" ");
      warnings.add(msg`“${original.length > 40 ? `${original.slice(0, 40)}…` : original}” is covered, but some of its original text is still in the file because of the way the page draws it. Use Redact to remove it for good.`);
    }
  }
  if (removedAny) collectGarbage(doc);

  // 2. Draw.
  const fonts = fontSet(doc, files);
  const images = new Map<string, PDFImage>();
  for (const key of new Set(request.objects.flatMap((o) => (o.kind === "image" ? [o.image] : [])))) {
    const image = request.images[key];
    if (!image) throw new ProcessingError("An image placed on the page is missing.", "invalid");
    images.set(key, image.format === "png" ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes));
  }

  for (const [index, page] of pages.entries()) {
    const objects = request.objects.filter((o) => o.page === index);
    if (objects.length === 0) continue;
    const geometry = pageGeometry(page);
    const matrix = uprightMatrix(geometry);
    const { height } = displaySize(geometry);
    const shared = { height, fonts, images, warnings };
    const content: PDFOperator[] = [];
    const resources = pageResources(page);
    for (const object of objects) {
      const intoPage = object.kind === "replace" || object.kind === "whiteout" || (request.flatten && object.kind !== "note");
      if (intoPage) content.push(...(await draw(object, { ...shared, resources, opacityInDrawing: true })));
      else await addAnnotation(doc, page, object as Exclude<EditObject, ReplaceObject | { kind: "whiteout" }>, shared, matrix);
    }
    if (content.length) page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix), ...content, popGraphicsState());
  }

  return { bytes: await savePdf(doc), warnings: [...warnings] };
}
