import { rgb, degrees, type PDFDocument, type PDFFont, type PDFImage, type PDFPage, type RGB } from "@cantoo/pdf-lib";
import { ProcessingError } from "../errors";
import { stripJpeg } from "../metadata/jpeg";
import { DEFAULT_STRIP_OPTIONS } from "../metadata/types";
import type { FontFiles } from "../office/flow";
import { loadPdf, savePdf } from "./load";
import { anchorBox, displaySize, drawableText, embedStampFonts, pageGeometry, placeRect, sendDrawingBehind, toUserSpace, type Anchor, type PageGeometry } from "./stamp";

type Fonts = Pick<FontFiles, "regular" | "bold">;

/** "#263a81" -> rgb(…); anything unparsable becomes dark grey. */
export function hexColor(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return rgb(0.2, 0.2, 0.2);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function selectedPages(all: PDFPage[], indices?: number[]): PDFPage[] {
  if (!indices || indices.length === 0) return all;
  if (indices.some((i) => i < 0 || i >= all.length)) throw new ProcessingError("A page number is out of range.", "invalid");
  return [...new Set(indices)].sort((a, b) => a - b).map((i) => all[i]);
}

// ---------------------------------------------------------------------------- Watermark

export interface WatermarkOptions {
  kind: "text" | "image";
  text: string;
  bold: boolean;
  /** Font size in points. */
  size: number;
  color: string;
  /** 0–1. */
  opacity: number;
  /** Counter-clockwise, as the reader sees it. */
  angle: number;
  position: Anchor | "tile";
  /** PNG or JPEG. */
  image?: { bytes: Uint8Array; format: "png" | "jpeg" };
  /** Image width as a fraction of the page width. */
  imageScale: number;
  /** Put it underneath the page content instead of on top. */
  behind: boolean;
  /** 0-based pages; empty means every page. */
  pages?: number[];
}

/**
 * Draw an item of `width` × `height` (text: baseline to cap height; image: its box) centred on a
 * displayed point, turned `angle` degrees counter-clockwise as seen by the reader.
 */
function drawCentered(page: PDFPage, geometry: PageGeometry, center: { u: number; v: number }, width: number, height: number, angle: number, draw: (x: number, y: number, rotate: number) => void) {
  const rad = (angle * Math.PI) / 180;
  // Displayed coordinates run downwards, so "up" on the item is (-sin, -cos).
  const along = { u: Math.cos(rad), v: -Math.sin(rad) };
  const up = { u: -Math.sin(rad), v: -Math.cos(rad) };
  const u = center.u - (width / 2) * along.u - (height / 2) * up.u;
  const v = center.v - (width / 2) * along.v - (height / 2) * up.v;
  const origin = toUserSpace(geometry, u, v);
  draw(origin.x, origin.y, angle + geometry.rotation);
}

export async function addWatermark(bytes: Uint8Array, options: WatermarkOptions, fontFiles: Fonts): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  let font: PDFFont | null = null;
  let image: PDFImage | null = null;
  if (options.kind === "text") {
    if (!options.text.trim()) throw new ProcessingError("Type the watermark text.", "invalid");
    const fonts = await embedStampFonts(doc, fontFiles);
    font = options.bold ? fonts.bold : fonts.regular;
  } else {
    if (!options.image) throw new ProcessingError("Choose an image for the watermark.", "invalid");
    try {
      // A photo's camera metadata (EXIF, GPS) must not end up inside the PDF.
      image = options.image.format === "png" ? await doc.embedPng(options.image.bytes) : await doc.embedJpg(await stripJpeg(options.image.bytes, DEFAULT_STRIP_OPTIONS, false));
    } catch {
      throw new ProcessingError("The watermark image couldn't be read.", "corrupt");
    }
  }
  const text = font ? drawableText(font, options.text.trim()) : "";
  const color = hexColor(options.color);
  const opacity = Math.min(1, Math.max(0.05, options.opacity));

  for (const page of selectedPages(doc.getPages(), options.pages)) {
    const geometry = pageGeometry(page);
    const display = displaySize(geometry);
    // The item's own size on this page.
    let width: number;
    let height: number;
    if (font) {
      width = font.widthOfTextAtSize(text, options.size);
      height = font.heightAtSize(options.size, { descender: false });
    } else {
      width = display.width * Math.min(1, Math.max(0.05, options.imageScale));
      height = width * (image!.height / image!.width);
    }
    const draw = (x: number, y: number, rotate: number) => {
      if (font) page.drawText(text, { x, y, size: options.size, font, color, opacity, rotate: degrees(rotate) });
      else page.drawImage(image!, { x, y, width, height, opacity, rotate: degrees(rotate) });
    };

    // The rotated item's bounding box, for positioning against the page edges.
    const rad = (options.angle * Math.PI) / 180;
    const bounds = { width: Math.abs(width * Math.cos(rad)) + Math.abs(height * Math.sin(rad)), height: Math.abs(width * Math.sin(rad)) + Math.abs(height * Math.cos(rad)) };
    if (options.position === "tile") {
      // Rows running along the item's own direction (diagonal rows for an angled watermark), centred
      // on the page with one tile exactly in the middle; alternate rows are offset by half a step.
      const along = { u: Math.cos(rad), v: -Math.sin(rad) };
      const across = { u: Math.sin(rad), v: Math.cos(rad) };
      const stepAlong = width + Math.max(48, width * 0.5);
      const stepAcross = height + Math.max(48, height * 2);
      const reach = Math.hypot(display.width, display.height) / 2;
      const cols = Math.ceil((reach + width) / stepAlong) + 1;
      const rows = Math.ceil((reach + height) / stepAcross);
      for (let r = -rows; r <= rows; r++) {
        for (let c = -cols; c <= cols; c++) {
          const a = (c + (Math.abs(r) % 2) / 2) * stepAlong;
          const b = r * stepAcross;
          const u = display.width / 2 + a * along.u + b * across.u;
          const v = display.height / 2 + a * along.v + b * across.v;
          // Only tiles that reach onto the page.
          if (Math.abs(u - display.width / 2) < (display.width + bounds.width) / 2 && Math.abs(v - display.height / 2) < (display.height + bounds.height) / 2) {
            drawCentered(page, geometry, { u, v }, width, height, options.angle, draw);
          }
        }
      }
    } else {
      const corner = anchorBox(options.position, display, bounds, Math.min(36, display.width / 12));
      drawCentered(page, geometry, { u: corner.u + bounds.width / 2, v: corner.v + bounds.height / 2 }, width, height, options.angle, draw);
    }
    if (options.behind) sendDrawingBehind(page);
  }
  return savePdf(doc);
}

// ---------------------------------------------------------------------------- Page numbers

export interface PageNumberOptions {
  /** Text with {n} (this page's number) and {total} (the last number). */
  format: string;
  position: Anchor;
  /** Distance from the page edges, in points. */
  margin: number;
  size: number;
  color: string;
  /** Number given to the first numbered page. */
  start: number;
  /** 0-based pages to number; empty means every page. */
  pages?: number[];
}

/** The label each page gets (null = not numbered), for a document of `pageCount` pages. */
export function pageLabels(options: PageNumberOptions, pageCount: number): (string | null)[] {
  if (!options.format.includes("{n}")) throw new ProcessingError("The format needs {n} where the number goes.", "invalid");
  const numbered = options.pages?.length ? [...new Set(options.pages)].filter((i) => i >= 0 && i < pageCount).sort((a, b) => a - b) : Array.from({ length: pageCount }, (_, i) => i);
  const last = options.start + numbered.length - 1;
  const labels: (string | null)[] = new Array(pageCount).fill(null);
  numbered.forEach((index, k) => (labels[index] = options.format.replace(/\{n\}/g, String(options.start + k)).replace(/\{total\}/g, String(last))));
  return labels;
}

export type LabelStyle = Pick<PageNumberOptions, "position" | "margin" | "size" | "color">;

/** Draw one label per page (null skips the page). Used directly for previews of a few pages. */
export async function stampPageLabels(bytes: Uint8Array, labels: (string | null)[], style: LabelStyle, fontFiles: Fonts): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  await drawLabels(doc, labels, style, fontFiles);
  return savePdf(doc);
}

export async function addPageNumbers(bytes: Uint8Array, options: PageNumberOptions, fontFiles: Fonts): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  await drawLabels(doc, pageLabels(options, doc.getPageCount()), options, fontFiles);
  return savePdf(doc);
}

async function drawLabels(doc: PDFDocument, labels: (string | null)[], style: LabelStyle, fontFiles: Fonts, embedded?: PDFFont) {
  const font = embedded ?? (await embedStampFonts(doc, fontFiles)).regular;
  const color = hexColor(style.color);
  doc.getPages().forEach((page, i) => {
    const label = labels[i];
    if (!label) return;
    const text = drawableText(font, label);
    const geometry = pageGeometry(page);
    const width = font.widthOfTextAtSize(text, style.size);
    const ascent = font.heightAtSize(style.size, { descender: false });
    const height = font.heightAtSize(style.size);
    const corner = anchorBox(style.position, displaySize(geometry), { width, height }, style.margin);
    const { x, y, rotate } = placeRect(geometry, { u: corner.u, v: corner.v, width, height: ascent });
    page.drawText(text, { x, y, size: style.size, font, color, rotate: degrees(rotate) });
  });
}

// ---------------------------------------------------------------------------- Signatures

/** Something placed on a page; the rectangle is in fractions (0–1) of the displayed page. */
export type Placement = { page: number; x: number; y: number; width: number; height: number } & (
  | { kind: "image"; /** Key into the images map. */ image: string }
  | { kind: "text"; text: string }
);

/**
 * Stamp signature images and text (e.g. a date) onto pages. This is a visible signature, not a
 * certificate-based digital signature.
 */
export async function applySignatures(bytes: Uint8Array, placements: Placement[], images: Record<string, Uint8Array>, fontFiles: Fonts): Promise<Uint8Array> {
  if (placements.length === 0) throw new ProcessingError("Place a signature on a page first.", "invalid");
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const embedded = new Map<string, PDFImage>();
  const needsFont = placements.some((p) => p.kind === "text");
  const font = needsFont ? (await embedStampFonts(doc, fontFiles)).regular : null;

  for (const placement of placements) {
    const page = pages[placement.page];
    if (!page) throw new ProcessingError("A signature is placed on a page that doesn't exist.", "invalid");
    const geometry = pageGeometry(page);
    const display = displaySize(geometry);
    const rect = { u: placement.x * display.width, v: placement.y * display.height, width: placement.width * display.width, height: placement.height * display.height };

    if (placement.kind === "image") {
      let image = embedded.get(placement.image);
      if (!image) {
        const data = images[placement.image];
        if (!data) throw new ProcessingError("A signature image is missing.", "invalid");
        image = await doc.embedPng(data);
        embedded.set(placement.image, image);
      }
      const { x, y, rotate } = placeRect(geometry, rect);
      page.drawImage(image, { x, y, width: rect.width, height: rect.height, rotate: degrees(rotate) });
    } else {
      const text = drawableText(font!, placement.text);
      // As large as fits the box, with the text's full height (ascent + descent) centred in it.
      const size = Math.max(4, Math.min(rect.height / (font!.heightAtSize(1) || 1), (rect.width / Math.max(0.01, font!.widthOfTextAtSize(text, 1))) * 0.98));
      const full = font!.heightAtSize(size);
      const ascent = font!.heightAtSize(size, { descender: false });
      const baseline = rect.v + (rect.height - full) / 2 + ascent;
      const { x, y } = toUserSpace(geometry, rect.u, baseline);
      page.drawText(text, { x, y, size, font: font!, color: rgb(0.05, 0.05, 0.1), rotate: degrees(geometry.rotation) });
    }
  }
  return savePdf(doc);
}

// ---------------------------------------------------------------------------- Headers, footers and Bates numbers

export type Slot = "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";
export const SLOTS: Slot[] = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"];

export interface HeaderFooterOptions {
  /** Text per position, with {page}, {pages}, {date} and {file}. Empty positions are skipped. */
  slots: Partial<Record<Slot, string>>;
  size: number;
  color: string;
  margin: number;
  /** Number given to the first page for {page}. */
  start: number;
  /** 0-based pages that get the header and footer; empty means every page. */
  pages?: number[];
  /** Filled in by the page (so the user's locale and file name are used). */
  date: string;
  file: string;
  /** Page count for {pages} when stamping only part of a document (the live preview). */
  total?: number;
}

/** The text of one slot on one page. */
export function fillTemplate(template: string, values: { page: number; pages: number; date: string; file: string }): string {
  return template
    .replace(/\{page\}/g, String(values.page))
    .replace(/\{pages\}/g, String(values.pages))
    .replace(/\{date\}/g, values.date)
    .replace(/\{file\}/g, values.file);
}

export async function addHeaderFooter(bytes: Uint8Array, options: HeaderFooterOptions, fontFiles: Fonts): Promise<Uint8Array> {
  const slots = SLOTS.filter((s) => options.slots[s]?.trim());
  if (slots.length === 0) throw new ProcessingError("Type a header or footer first.", "invalid");
  const doc = await loadPdf(bytes);
  const count = doc.getPageCount();
  const chosen = new Set(options.pages?.length ? options.pages : Array.from({ length: count }, (_, i) => i));
  const { regular: font } = await embedStampFonts(doc, fontFiles);
  for (const slot of slots) {
    const labels = Array.from({ length: count }, (_, i) =>
      chosen.has(i) ? fillTemplate(options.slots[slot]!, { page: options.start + i, pages: options.start + (options.total ?? count) - 1, date: options.date, file: options.file }) : null,
    );
    await drawLabels(doc, labels, { position: slot, size: options.size, color: options.color, margin: options.margin }, fontFiles, font);
  }
  return savePdf(doc);
}

export interface BatesOptions extends LabelStyle {
  prefix: string;
  suffix: string;
  /** First number. */
  start: number;
  /** Zero-padded to this many digits. */
  digits: number;
}

export function batesLabel(options: Pick<BatesOptions, "prefix" | "suffix" | "digits">, n: number): string {
  return `${options.prefix}${String(n).padStart(options.digits, "0")}${options.suffix}`;
}

/**
 * Bates-number a set of documents in order: numbering continues from one file to the next.
 * Returns each file with its first and last number.
 */
export async function addBatesNumbers(files: Uint8Array[], options: BatesOptions, fontFiles: Fonts): Promise<{ bytes: Uint8Array; first: string; last: string }[]> {
  if (!Number.isInteger(options.start) || options.start < 0) throw new ProcessingError("The first number must be a whole number, 0 or more.", "invalid");
  if (!Number.isInteger(options.digits) || options.digits < 1 || options.digits > 12) throw new ProcessingError("Use between 1 and 12 digits.", "invalid");
  let next = options.start;
  const out: { bytes: Uint8Array; first: string; last: string }[] = [];
  for (const bytes of files) {
    const doc = await loadPdf(bytes);
    const count = doc.getPageCount();
    const labels = Array.from({ length: count }, (_, i) => batesLabel(options, next + i));
    await drawLabels(doc, labels, options, fontFiles);
    out.push({ bytes: await savePdf(doc), first: labels[0], last: labels[count - 1] });
    next += count;
  }
  return out;
}
