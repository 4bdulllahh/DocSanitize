import { degrees, PDFArray, PDFDict, PDFName, PDFNumber, type PDFDocument, type PDFPage } from "@cantoo/pdf-lib";
import { ProcessingError } from "../errors";
import { pruneStrayPages, rearrangePages } from "./assemble";
import type { Box } from "./edit/types";
import { loadPdf, savePdf } from "./load";
import { displaySize, pageGeometry, toUserSpace } from "./stamp";

/* Page tools: rotate, delete, insert, crop and resize. */

/** Portrait sizes in points. */
export const PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89, label: "A4" },
  letter: { width: 612, height: 792, label: "Letter" },
  legal: { width: 612, height: 1008, label: "Legal" },
  a3: { width: 841.89, height: 1190.55, label: "A3" },
  a5: { width: 419.53, height: 595.28, label: "A5" },
} as const;
export type PageSizeName = keyof typeof PAGE_SIZES;

function checkPages(pages: number[], count: number) {
  if (pages.length === 0) throw new ProcessingError("Select at least one page.", "invalid");
  if (pages.some((i) => !Number.isInteger(i) || i < 0 || i >= count)) throw new ProcessingError("A page number is out of range.", "invalid");
}

/** Turn pages clockwise by `angle` (90, 180 or 270), adding to any rotation they already have. */
export async function rotatePages(bytes: Uint8Array, pages: number[], angle: number): Promise<Uint8Array> {
  if (angle % 90 !== 0) throw new ProcessingError("Pages can only be rotated in steps of 90°.", "invalid");
  const doc = await loadPdf(bytes);
  const all = doc.getPages();
  checkPages(pages, all.length);
  for (const i of new Set(pages)) all[i].setRotation(degrees((((all[i].getRotation().angle + angle) % 360) + 360) % 360));
  return savePdf(doc);
}

/** Remove pages (purged from the file, not just unlinked). */
export async function deletePages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const count = (await loadPdf(bytes)).getPageCount();
  checkPages(pages, count);
  const gone = new Set(pages);
  if (gone.size >= count) throw new ProcessingError("You can't delete every page. Keep at least one.", "invalid");
  return rearrangePages(
    bytes,
    Array.from({ length: count }, (_, index) => ({ index, rotate: 0 })).filter((e) => !gone.has(e.index)),
  );
}

export interface InsertOptions {
  /** Insert before this 0-based page; the page count means "at the end". */
  at: number;
  /** Blank pages: how many, and their size ("match" = the same as the neighbouring page). */
  blank?: { count: number; size: PageSizeName | "match" };
  /** Pages from another PDF (all of them when `pages` is omitted). */
  source?: { bytes: Uint8Array; name?: string; pages?: number[] };
}

export async function insertPages(bytes: Uint8Array, options: InsertOptions): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const count = doc.getPageCount();
  const at = Math.max(0, Math.min(count, Math.round(options.at)));
  if (options.blank) {
    const n = Math.round(options.blank.count);
    if (n < 1 || n > 500) throw new ProcessingError("Insert between 1 and 500 blank pages.", "invalid");
    let size: [number, number];
    if (options.blank.size === "match") {
      // As the neighbouring page is displayed, so it lines up in a reader.
      const neighbour = doc.getPage(Math.min(at, count - 1));
      const shown = displaySize(pageGeometry(neighbour));
      size = [shown.width, shown.height];
    } else {
      const s = PAGE_SIZES[options.blank.size];
      size = [s.width, s.height];
    }
    for (let k = 0; k < n; k++) doc.insertPage(at + k, size);
  } else if (options.source) {
    const src = await loadPdf(options.source.bytes, options.source.name);
    const indices = options.source.pages ?? src.getPageIndices();
    checkPages(indices, src.getPageCount());
    const copies = await doc.copyPages(src, indices);
    copies.forEach((page, k) => doc.insertPage(at + k, page));
    pruneStrayPages(doc);
  } else {
    throw new ProcessingError("Choose what to insert.", "invalid");
  }
  return savePdf(doc);
}

// ---------------------------------------------------------------------------- Crop

/** A displayed rectangle on a page -> its user-space box. */
function userBox(page: PDFPage, box: Box) {
  const geometry = pageGeometry(page);
  const a = toUserSpace(geometry, box.x, box.y);
  const b = toUserSpace(geometry, box.x + box.width, box.y + box.height);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/**
 * Crop pages to rectangles given on the displayed page (points from its top-left corner). Only the
 * visible area changes: what's cut off stays in the file (the UI points to Redact for that).
 */
export async function cropPages(bytes: Uint8Array, crops: { page: number; box: Box }[]): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  checkPages(
    crops.map((c) => c.page),
    pages.length,
  );
  for (const { page: index, box } of crops) {
    const page = pages[index];
    const shown = displaySize(pageGeometry(page));
    const clipped = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(shown.width, box.x + box.width) - Math.max(0, box.x), height: Math.min(shown.height, box.y + box.height) - Math.max(0, box.y) };
    if (clipped.width < 18 || clipped.height < 18) throw new ProcessingError("The crop area is too small (at least a quarter of an inch each way).", "invalid");
    const b = userBox(page, clipped);
    page.setCropBox(b.x, b.y, b.width, b.height);
    // Bleed, trim and art boxes outside the new crop would confuse printers and some readers.
    for (const key of ["BleedBox", "TrimBox", "ArtBox"]) page.node.delete(PDFName.of(key));
  }
  return savePdf(doc);
}

// ---------------------------------------------------------------------------- Resize

export interface ResizeOptions {
  size: PageSizeName | { width: number; height: number };
  /** "auto" keeps each page's own orientation. */
  orientation: "auto" | "portrait" | "landscape";
  /** 0-based pages; empty or omitted means all. */
  pages?: number[];
}

type Matrix = [number, number, number, number, number, number];
const apply = (m: Matrix, x: number, y: number): [number, number] => [x * m[0] + m[4], y * m[3] + m[5]];

/** Move an annotation's geometry by a scale-and-translate matrix. */
function transformAnnotation(annot: PDFDict, m: Matrix) {
  const numbers = (key: string) => {
    const array = annot.lookup(PDFName.of(key));
    return array instanceof PDFArray ? array.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0)) : null;
  };
  const points = (values: number[]) => values.flatMap((_, i) => (i % 2 ? [] : apply(m, values[i], values[i + 1])));
  const rect = numbers("Rect");
  if (rect?.length === 4) annot.set(PDFName.of("Rect"), annot.context.obj([...apply(m, rect[0], rect[1]), ...apply(m, rect[2], rect[3])]));
  for (const key of ["QuadPoints", "L", "Vertices", "CL"]) {
    const values = numbers(key);
    if (values) annot.set(PDFName.of(key), annot.context.obj(points(values)));
  }
  const ink = annot.lookup(PDFName.of("InkList"));
  if (ink instanceof PDFArray) {
    annot.set(
      PDFName.of("InkList"),
      annot.context.obj(ink.asArray().map((path) => (path instanceof PDFArray ? points(path.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0))) : []))),
    );
  }
}

/** Wrap a page's content in `q <matrix> cm … Q`. */
function transformContent(doc: PDFDocument, page: PDFPage, m: Matrix) {
  page.node.normalize();
  const contents = page.node.Contents();
  const { context } = doc;
  const before = context.register(context.flateStream(`q ${m.map((v) => +v.toFixed(5)).join(" ")} cm\n`));
  const after = context.register(context.flateStream("\nQ"));
  if (contents instanceof PDFArray) {
    contents.insert(0, before);
    contents.push(after);
  } else {
    page.node.set(PDFName.of("Contents"), context.obj(contents ? [before, page.node.get(PDFName.of("Contents"))!, after] : [before, after]));
  }
}

/**
 * Put pages on a new paper size, scaling their content to fit (never cropping) and centring it.
 * Annotations move and scale with it.
 */
export async function resizePages(bytes: Uint8Array, options: ResizeOptions): Promise<Uint8Array> {
  const target = typeof options.size === "string" ? PAGE_SIZES[options.size] : options.size;
  if (!(target.width >= 72 && target.height >= 72 && target.width <= 14400 && target.height <= 14400)) throw new ProcessingError("Page sizes must be between 1 and 200 inches.", "invalid");
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const chosen = options.pages?.length ? options.pages : pages.map((_, i) => i);
  checkPages(chosen, pages.length);

  for (const index of new Set(chosen)) {
    const page = pages[index];
    const geometry = pageGeometry(page);
    const shown = displaySize(geometry);
    const landscape = options.orientation === "auto" ? shown.width > shown.height : options.orientation === "landscape";
    const [short, long] = [Math.min(target.width, target.height), Math.max(target.width, target.height)];
    const displayed = landscape ? { width: long, height: short } : { width: short, height: long };
    // In user space the sides swap for quarter turns.
    const user = geometry.rotation % 180 ? { width: displayed.height, height: displayed.width } : displayed;
    const { box } = geometry;
    const s = Math.min(user.width / box.width, user.height / box.height);
    const m: Matrix = [s, 0, 0, s, (user.width - s * box.width) / 2 - s * box.x, (user.height - s * box.height) / 2 - s * box.y];

    transformContent(doc, page, m);
    for (const ref of page.node.Annots()?.asArray() ?? []) {
      const annot = doc.context.lookup(ref);
      if (annot instanceof PDFDict) transformAnnotation(annot, m);
    }
    page.setMediaBox(0, 0, user.width, user.height);
    for (const key of ["CropBox", "BleedBox", "TrimBox", "ArtBox"]) page.node.delete(PDFName.of(key));
  }
  return savePdf(doc);
}
