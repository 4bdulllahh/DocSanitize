import {
  clip,
  concatTransformationMatrix,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  type PDFImage,
  type PDFPage,
} from "@cantoo/pdf-lib";
import { drawLine, embedFonts, hexColor, tokenize, wrap, type Context, type FontFiles, type Line as FlowLine } from "../office/flow";
import { missingCharactersWarning } from "../office/word";
import { createPdf, savePdf } from "../pdf/load";
import { readPresentation, type Box, type Geometry, type Paragraph, type Shape, type Slide, type TextBody } from "./pptx-model";

/*
 * PowerPoint -> PDF, the drawing half: each slide becomes a page the slide's size, drawn with
 * pdf-lib: background, master and layout decorations, then the slide's shapes, pictures, tables
 * and text (wrapped and aligned as PowerPoint lays it out, in Liberation Sans).
 */

export interface PptxToPdfOptions {
  /** Include slides hidden in the slide show. */
  hiddenSlides: boolean;
}

export interface PptxPdfResult {
  bytes: Uint8Array;
  pages: number;
  warnings: string[];
}

/** Turns a picture PDF can't hold (GIF, BMP, TIFF, WebP) into PNG; null when it can't. */
export type PictureDecoder = (bytes: Uint8Array) => Promise<Uint8Array | null>;

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isMetafile = (b: Uint8Array) => (b[0] === 0xd7 && b[1] === 0xcd && b[2] === 0xc6 && b[3] === 0x9a) || (b[0] === 1 && b[1] === 0 && b[2] === 0 && b[3] === 0 && b[41] === 0x45 && b[42] === 0x4d && b[43] === 0x46);

// ---------------------------------------------------------------------------- Geometry

type Point = [number, number];

function presetPath(geometry: Extract<Geometry, { preset: string }>, w: number, h: number): Point[][] | "ellipse" | "line" | null {
  const ss = Math.min(w, h);
  const adj = (name: string, fallback: number) => (geometry.adjust[name] ?? fallback) / 100000;
  const poly = (...points: Point[]) => [points];
  switch (geometry.preset) {
    case "rect":
    case "flowChartProcess":
    case "textBox":
    case "wedgeRectCallout":
    case "snip1Rect":
    case "snip2SameRect":
    case "round1Rect":
    case "round2SameRect":
    case "plaque":
    case "frame":
    case "bevel":
      return poly([0, 0], [w, 0], [w, h], [0, h]);
    case "ellipse":
    case "flowChartConnector":
    case "wedgeEllipseCallout":
    case "cloud":
    case "cloudCallout":
    case "donut":
      return "ellipse";
    case "line":
    case "straightConnector1":
    case "bentConnector2":
    case "bentConnector3":
    case "curvedConnector3":
      return "line";
    case "triangle":
    case "flowChartExtract":
      return poly([w * adj("adj", 50000), 0], [w, h], [0, h]);
    case "rtTriangle":
      return poly([0, 0], [w, h], [0, h]);
    case "diamond":
    case "flowChartDecision":
      return poly([w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]);
    case "parallelogram":
    case "flowChartInputOutput": {
      const o = ss * adj("adj", 25000);
      return poly([o, 0], [w, 0], [w - o, h], [0, h]);
    }
    case "trapezoid": {
      const o = ss * adj("adj", 25000);
      return poly([0, h], [o, 0], [w - o, 0], [w, h]);
    }
    case "hexagon": {
      const o = ss * adj("adj", 25000);
      return poly([0, h / 2], [o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h]);
    }
    case "octagon": {
      const o = ss * adj("adj", 29289);
      return poly([o, 0], [w - o, 0], [w, o], [w, h - o], [w - o, h], [o, h], [0, h - o], [0, o]);
    }
    case "pentagon":
      return poly([w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]);
    case "homePlate": {
      const o = ss * adj("adj", 50000);
      return poly([0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h]);
    }
    case "chevron": {
      const o = ss * adj("adj", 50000);
      return poly([0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h], [o, h / 2]);
    }
    case "rightArrow":
    case "leftArrow": {
      const shaft = h * adj("adj1", 50000);
      const head = ss * adj("adj2", 50000);
      const [t, b] = [(h - shaft) / 2, (h + shaft) / 2];
      const points: Point[] = [[0, t], [w - head, t], [w - head, 0], [w, h / 2], [w - head, h], [w - head, b], [0, b]];
      return [geometry.preset === "leftArrow" ? points.map(([x, y]) => [w - x, y]) : points];
    }
    case "upArrow":
    case "downArrow": {
      const shaft = w * adj("adj1", 50000);
      const head = ss * adj("adj2", 50000);
      const [l, r] = [(w - shaft) / 2, (w + shaft) / 2];
      const points: Point[] = [[l, h], [l, head], [0, head], [w / 2, 0], [w, head], [r, head], [r, h]];
      return [geometry.preset === "downArrow" ? points.map(([x, y]) => [x, h - y]) : points];
    }
    case "plus":
    case "mathPlus": {
      const o = ss * adj("adj", 25000);
      return poly([o, 0], [w - o, 0], [w - o, o], [w, o], [w, h - o], [w - o, h - o], [w - o, h], [o, h], [o, h - o], [0, h - o], [0, o], [o, o]);
    }
    case "star5": {
      const points: Point[] = [];
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 0.38 : 0.5;
        points.push([w / 2 + Math.cos(angle) * w * r, h / 2 + Math.sin(angle) * h * r * 1.05]);
      }
      return [points];
    }
    default:
      return poly([0, 0], [w, 0], [w, h], [0, h]);
  }
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** The shape's outline as an SVG path in its own box (y down), flips applied. */
function shapePath(shape: Extract<Shape, { kind: "shape" }>): { d: string; closed: boolean } | null {
  const { width: w, height: h } = shape.box;
  const flip = ([x, y]: Point): Point => [shape.flipH ? w - x : x, shape.flipV ? h - y : y];
  const geometry = shape.geometry;
  if ("paths" in geometry) {
    let d = "";
    for (const p of geometry.paths) {
      const sx = p.width ? w / p.width : 1;
      const sy = p.height ? h / p.height : 1;
      const pt = (x: number, y: number) => flip([x * sx, y * sy]).map(f).join(" ");
      for (const c of p.commands) {
        if (c.op === "Z") d += "Z ";
        else if (c.op === "C") d += `C ${pt(c.points[0], c.points[1])} ${pt(c.points[2], c.points[3])} ${pt(c.points[4], c.points[5])} `;
        else d += `${c.op} ${pt(c.x, c.y)} `;
      }
    }
    return d ? { d, closed: /Z/.test(d) } : null;
  }
  if (geometry.preset === "roundRect" || geometry.preset === "flowChartAlternateProcess" || geometry.preset === "flowChartTerminator") {
    const r = geometry.preset === "flowChartTerminator" ? Math.min(w, h) / 2 : Math.min(w, h) * ((geometry.adjust.adj ?? 16667) / 100000);
    return {
      d: `M ${f(r)} 0 H ${f(w - r)} A ${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)} V ${f(h - r)} A ${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)} H ${f(r)} A ${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)} V ${f(r)} A ${f(r)} ${f(r)} 0 0 1 ${f(r)} 0 Z`,
      closed: true,
    };
  }
  const outline = presetPath(geometry, w, h);
  if (outline === "ellipse") return { d: `M 0 ${f(h / 2)} A ${f(w / 2)} ${f(h / 2)} 0 1 0 ${f(w)} ${f(h / 2)} A ${f(w / 2)} ${f(h / 2)} 0 1 0 0 ${f(h / 2)} Z`, closed: true };
  if (outline === "line") {
    const [a, b] = [flip([0, 0]), flip([w, h])];
    return { d: `M ${a.map(f).join(" ")} L ${b.map(f).join(" ")}`, closed: false };
  }
  if (!outline) return null;
  return { d: outline.map((points) => `M ${points.map((p) => flip(p).map(f).join(" ")).join(" L ")} Z`).join(" "), closed: true };
}

// ---------------------------------------------------------------------------- Text

interface LaidLine {
  line: FlowLine;
  x: number;
  width: number;
  top: number;
  height: number;
  baseline: number;
  extra: number;
  bullet?: { text: string; x: number; size: number; color: string };
}

/** Lay text out in a column `width` wide; returns lines relative to the column's top-left, and the height used. */
function layoutText(ctx: Context, body: Pick<TextBody, "paragraphs" | "wrap">, width: number): { lines: LaidLine[]; height: number } {
  const lines: LaidLine[] = [];
  let y = 0;
  body.paragraphs.forEach((p, index) => {
    if (index > 0) y += p.spaceBefore;
    // Line breaks inside a paragraph: laid out as separate pieces with the same settings.
    const pieces: Paragraph["runs"][] = [[]];
    for (const run of p.runs) {
      if (run.text === "\n") pieces.push([]);
      else pieces.at(-1)!.push(run);
    }
    pieces.forEach((runs, pieceIndex) => {
      const size = runs.length ? Math.max(...runs.map((r) => r.size)) : p.size;
      const tokens = tokenize(
        {
          type: "paragraph",
          runs: runs.map((r) => ({ text: r.text.replace(/\t/g, "    "), bold: r.bold, italic: r.italic, underline: r.underline, strike: r.strike, size: r.size, script: r.script, href: r.href, mono: r.mono, color: r.color.rgb })),
        },
        ctx.fonts,
        size,
      );
      const bulletHere = pieceIndex === 0 && p.bullet ? p.bullet : null;
      const bulletX = Math.max(0, p.marginLeft + p.indent);
      const bulletFont = ctx.fonts.get();
      const bulletText = bulletHere ? ctx.fonts.clean(bulletHere) : "";
      const bulletWidth = bulletHere ? bulletFont.widthOfTextAtSize(bulletText, size) : 0;
      // Text starts at the left margin; a first line with a hanging indent starts further left.
      const left = bulletHere ? Math.max(p.marginLeft, bulletX + bulletWidth + size * 0.3) : p.marginLeft;
      const firstLeft = bulletHere || pieceIndex > 0 ? left : Math.max(0, p.marginLeft + p.indent);
      const available = body.wrap ? Math.max(size, width - Math.max(left, firstLeft)) : Infinity;
      const wrapped = wrap(tokens, available, size);
      wrapped.forEach((line, i) => {
        const lineSize = line.tokens.length ? Math.max(...line.tokens.map((t) => t.run.size ?? size)) : size;
        const height = "points" in p.lineSpacing ? p.lineSpacing.points : lineSize * 1.2 * p.lineSpacing.percent;
        const x0 = i === 0 ? firstLeft : left;
        const room = (body.wrap ? width : Math.max(width, line.width + x0)) - x0;
        const last = i === wrapped.length - 1;
        const spaces = line.tokens.filter((t) => t.space).reduce((n, t) => n + t.text.length, 0);
        const offset = p.align === "center" ? (room - line.width) / 2 : p.align === "right" ? room - line.width : 0;
        const firstRun = runs[0];
        lines.push({
          line,
          x: x0 + offset,
          width: line.width,
          top: y,
          height,
          baseline: y + height - lineSize * 0.24,
          extra: p.align === "justify" && !last && spaces ? (room - line.width) / spaces : 0,
          bullet: i === 0 && bulletHere && firstRun ? { text: bulletText, x: bulletX, size, color: firstRun.color.rgb } : undefined,
        });
        y += height;
      });
    });
    y += p.spaceAfter;
  });
  return { lines, height: y };
}

function drawText(ctx: Context, page: PDFPage, body: TextBody, box: Box) {
  const area = {
    x: box.x + body.insets.left,
    y: box.y + body.insets.top,
    width: Math.max(1, box.width - body.insets.left - body.insets.right),
    height: Math.max(1, box.height - body.insets.top - body.insets.bottom),
  };
  const { lines, height } = layoutText(ctx, body, area.width);
  const top = area.y + (body.anchor === "middle" ? (area.height - height) / 2 : body.anchor === "bottom" ? area.height - height : 0);
  for (const l of lines) {
    if (l.bullet) {
      const color = hexColor(l.bullet.color) ?? undefined;
      page.drawText(l.bullet.text, { x: area.x + l.bullet.x, y: page.getHeight() - (top + l.baseline), size: l.bullet.size, font: ctx.fonts.get(), color });
    }
    drawLine(ctx, page, l.line, area.x + l.x, top + l.baseline, l.extra);
  }
}

/** Run `draw` rotated `degrees` clockwise about the centre of `box` (top-down page coordinates). */
function rotated(page: PDFPage, box: Box, degrees: number, draw: () => void) {
  if (!degrees) return draw();
  const angle = (-degrees * Math.PI) / 180;
  const [cx, cy] = [box.x + box.width / 2, page.getHeight() - (box.y + box.height / 2)];
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos));
  draw();
  page.pushOperators(popGraphicsState());
}

// ---------------------------------------------------------------------------- Slides

interface DrawContext extends Context {
  images: Map<string, PDFImage | null>;
  media: Map<string, Uint8Array>;
  decode?: PictureDecoder;
  skippedPictures: number;
}

async function imageFor(ctx: DrawContext, name: string): Promise<PDFImage | null> {
  if (ctx.images.has(name)) return ctx.images.get(name)!;
  const bytes = ctx.media.get(name);
  let image: PDFImage | null = null;
  if (bytes) {
    try {
      if (isJpeg(bytes)) image = await ctx.doc.embedJpg(bytes);
      else if (isPng(bytes)) image = await ctx.doc.embedPng(bytes);
      else if (!isMetafile(bytes) && ctx.decode) {
        const png = await ctx.decode(bytes);
        if (png) image = await ctx.doc.embedPng(png);
      }
    } catch {
      image = null;
    }
  }
  if (!image) ctx.skippedPictures++;
  ctx.images.set(name, image);
  return image;
}

const alpha = (a: number) => (a < 1 ? a : undefined);

async function drawShape(ctx: DrawContext, page: PDFPage, shape: Shape) {
  const H = page.getHeight();
  if (shape.kind === "table") return drawTable(ctx, page, shape);
  const { box } = shape;
  if (shape.kind === "picture") {
    const image = await imageFor(ctx, shape.image);
    if (!image) return;
    const { left, top, right, bottom } = shape.crop;
    const fullW = box.width / Math.max(0.01, 1 - left - right);
    const fullH = box.height / Math.max(0.01, 1 - top - bottom);
    rotated(page, box, shape.rotation, () => {
      page.pushOperators(pushGraphicsState(), rectangle(box.x, H - box.y - box.height, box.width, box.height), clip(), endPath());
      page.drawImage(image, { x: box.x - left * fullW, y: H - (box.y - top * fullH) - fullH, width: fullW, height: fullH });
      page.pushOperators(popGraphicsState());
    });
    return;
  }
  const outline = shapePath(shape);
  const image = shape.image ? await imageFor(ctx, shape.image) : null;
  rotated(page, box, shape.rotation, () => {
    if (outline && (shape.fill || shape.line)) {
      const fill = outline.closed && shape.fill ? shape.fill : null;
      page.drawSvgPath(outline.d, {
        x: box.x,
        y: H - box.y,
        color: fill ? (hexColor(fill.rgb) ?? undefined) : undefined,
        opacity: fill ? alpha(fill.alpha) : undefined,
        borderColor: shape.line ? (hexColor(shape.line.color.rgb) ?? undefined) : undefined,
        borderOpacity: shape.line ? alpha(shape.line.color.alpha) : undefined,
        borderWidth: shape.line ? shape.line.width : undefined,
        borderDashArray: shape.line?.dash ? [shape.line.width * 3, shape.line.width * 2] : undefined,
      });
    }
    if (image) page.drawImage(image, { x: box.x, y: H - box.y - box.height, width: box.width, height: box.height });
    if (shape.text) {
      const text = shape.text;
      if (text.rotate) {
        // Vertical text: laid out in the box turned a quarter, then turned back.
        const turned = { x: box.x + (box.width - box.height) / 2, y: box.y + (box.height - box.width) / 2, width: box.height, height: box.width };
        rotated(page, turned, text.rotate, () => drawText(ctx, page, text, turned));
      } else {
        drawText(ctx, page, text, box);
      }
    }
  });
}

function drawTable(ctx: DrawContext, page: PDFPage, table: Extract<Shape, { kind: "table" }>) {
  const H = page.getHeight();
  const border = hexColor("#9ca3af")!;
  const columns = table.columns.length ? table.columns : [table.box.width];
  const colX = columns.reduce<number[]>((xs, w) => [...xs, xs[xs.length - 1] + w], [0]);
  // Rows grow to fit their text, as in PowerPoint.
  const heights = table.rows.map((row) => {
    let needed = row.height;
    let col = 0;
    for (const cell of row.cells) {
      const span = Math.max(1, cell.colSpan);
      if (cell.colSpan > 0 && cell.rowSpan === 1) {
        const width = colX[Math.min(columns.length, col + span)] - colX[col] - cell.text.insets.left - cell.text.insets.right;
        needed = Math.max(needed, layoutText(ctx, cell.text, Math.max(1, width)).height + cell.text.insets.top + cell.text.insets.bottom);
      }
      col += span;
    }
    return needed;
  });
  const rowY = heights.reduce<number[]>((ys, h) => [...ys, ys[ys.length - 1] + h], [0]);
  table.rows.forEach((row, r) => {
    let col = 0;
    for (const cell of row.cells) {
      const span = Math.max(1, cell.colSpan);
      if (cell.colSpan > 0 && cell.rowSpan > 0 && col < columns.length) {
        const box = {
          x: table.box.x + colX[col],
          y: table.box.y + rowY[r],
          width: colX[Math.min(columns.length, col + span)] - colX[col],
          height: rowY[Math.min(table.rows.length, r + cell.rowSpan)] - rowY[r],
        };
        page.drawRectangle({
          x: box.x,
          y: H - box.y - box.height,
          width: box.width,
          height: box.height,
          color: cell.fill ? (hexColor(cell.fill.rgb) ?? undefined) : undefined,
          opacity: cell.fill ? alpha(cell.fill.alpha) : undefined,
          borderColor: border,
          borderWidth: 0.75,
        });
        if (cell.text.paragraphs.length) drawText(ctx, page, cell.text, box);
      }
      col += span;
    }
  });
}

async function drawSlide(ctx: DrawContext, slide: Slide, width: number, height: number) {
  const page = ctx.doc.addPage([width, height]);
  const bg = slide.background;
  if (bg && "color" in bg) page.drawRectangle({ x: 0, y: 0, width, height, color: hexColor(bg.color.rgb) ?? undefined });
  else if (bg && "image" in bg) {
    const image = await imageFor(ctx, bg.image);
    if (image) page.drawImage(image, { x: 0, y: 0, width, height });
  }
  for (const shape of slide.shapes) await drawShape(ctx, page, shape);
}

export async function pptxToPdf(bytes: Uint8Array, options: PptxToPdfOptions, files: FontFiles, decode?: PictureDecoder, name?: string): Promise<PptxPdfResult> {
  const presentation = readPresentation(bytes, name);
  const doc = await createPdf();
  const fonts = await embedFonts(doc, files);
  const ctx: DrawContext = { doc, fonts, size: 18, images: new Map(), media: presentation.media, decode, skippedPictures: 0 };
  const slides = presentation.slides.filter((s) => options.hiddenSlides || !s.hidden);
  for (const slide of slides) await drawSlide(ctx, slide, presentation.width, presentation.height);
  if (!slides.length) doc.addPage([presentation.width, presentation.height]);

  const warnings: string[] = [];
  const hidden = presentation.slides.length - slides.length;
  if (hidden) warnings.push(`${hidden} hidden slide${hidden === 1 ? " was" : "s were"} left out.`);
  const { charts, diagrams, media } = presentation.skipped;
  if (charts + diagrams) {
    const parts = [charts && `${charts} chart${charts === 1 ? "" : "s"}`, diagrams && `${diagrams} SmartArt diagram${diagrams === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
    warnings.push(`${parts} can't be drawn and ${charts + diagrams === 1 ? "is" : "are"} left out.`);
  }
  if (media) warnings.push("Videos, sounds and embedded objects are left out (their preview pictures are kept).");
  if (ctx.skippedPictures) warnings.push(`${ctx.skippedPictures} picture${ctx.skippedPictures === 1 ? " is" : "s are"} in a format that can't be drawn here (such as EMF or WMF) and ${ctx.skippedPictures === 1 ? "is" : "are"} left out.`);
  if (fonts.missing) warnings.push(missingCharactersWarning(fonts.missing));
  return { bytes: await savePdf(doc), pages: doc.getPageCount(), warnings };
}
