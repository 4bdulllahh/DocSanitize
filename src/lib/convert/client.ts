import type { PDFDocumentProxy } from "pdfjs-dist";
import { ProcessingError } from "../errors";
import { isJpeg, stripJpeg } from "../metadata/jpeg";
import { DEFAULT_STRIP_OPTIONS } from "../metadata/types";
import { officeWorker } from "../office/client";
import { extractText } from "../office/extract";
import { PDF_MIME, stripTextFromFile } from "../pdf/client";
import { readPhrases, sampleColors } from "../pdf/edit/page-text";
import type { EditObject } from "../pdf/edit/types";
import { renderPageToImage } from "../pdf/rasterize";
import { openPdfForRendering, withRenderSlot } from "../pdf/render";
import { groupLines, type TextBlock } from "../translate/blocks";
import { pageWords, type Comparison } from "./compare";
import type { LoadedImage } from "./html-blocks";
import type { PdfToTextOptions } from "./pdf-to-text";
import type { PptxToPdfOptions } from "./pptx-to-pdf";
import { PPTX_MIME, type SlideInput, type SlideText } from "./pptx-write";
import { dataUrlBytes, decodeText, hasContent, readTextDocument, textFormatOf } from "./text-document";
import type { TextToPdfOptions } from "./text-to-pdf";
import { msg } from "@/i18n/msg";
import { createTranslator, type Translator } from "@/i18n/translate";

/*
 * The page side of the M15 conversions: reading with pdf.js and DOMParser here, writing in the
 * office worker. Nothing leaves the device and nothing is fetched.
 */

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------- Text to PDF

/** A picture stored in the file (data: URL) as JPEG or PNG. Other formats are redrawn as PNG. */
async function loadDataImage(url: string): Promise<LoadedImage | null> {
  const data = dataUrlBytes(url);
  if (!data) return null;
  const { bytes } = data;
  if (isJpeg(bytes)) return { bytes: await stripJpeg(bytes, DEFAULT_STRIP_OPTIONS, false).catch(() => bytes), format: "jpeg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { bytes, format: "png" };
  // SVG, GIF, WebP…: drawn by the browser from the in-memory data URL.
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    return null;
  }
  const scale = Math.min(1, 3000 / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((image.naturalWidth || 300) * scale));
  canvas.height = Math.max(1, Math.round((image.naturalHeight || 150) * scale));
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  canvas.width = canvas.height = 0;
  return blob ? { bytes: await bytesOf(blob), format: "png" } : null;
}

export interface TextPdfOptions extends TextToPdfOptions {
  /** Plain text only: fixed-width font. */
  mono: boolean;
}

export async function textFileToPdf(file: Blob, name: string, options: TextPdfOptions) {
  const text = decodeText(await bytesOf(file));
  const format = textFormatOf(name);
  const read = await readTextDocument(text, format, {
    mono: options.mono,
    parseHtml: (html) => new DOMParser().parseFromString(html, "text/html"),
    loadImage: loadDataImage,
  });
  if (!hasContent(read.blocks)) throw new ProcessingError(`“${name}” has no text to put in a PDF.`, "invalid");
  const { bytes, pages, warnings } = await officeWorker.blocksToPdf(read.blocks, { pageSize: options.pageSize, margins: options.margins });
  if (read.linkedImages) {
    warnings.unshift(msg`${plural(read.linkedImages, "picture")} on the web or in other files ${read.linkedImages === 1 ? "was" : "were"} left out: only pictures stored inside the file are used, and nothing is downloaded.`);
  }
  if (read.skippedImages) warnings.unshift(msg`${plural(read.skippedImages, "picture")} couldn't be placed (inside a table, or in a format that can't be read).`);
  return { blob: new Blob([bytes as BlobPart], { type: PDF_MIME }), pages, warnings, format };
}

// ---------------------------------------------------------------------------- PDF to Text

export async function pdfToText(doc: PDFDocumentProxy, pages: number[], options: PdfToTextOptions, onPage?: (done: number) => void) {
  return officeWorker.textToText(await extractText(doc, pages, onPage), pages, options);
}

// ---------------------------------------------------------------------------- PowerPoint to PDF

export async function powerPointToPdf(file: Blob, name: string, options: PptxToPdfOptions) {
  const { bytes, ...rest } = await officeWorker.pptxToPdf(await bytesOf(file), options, name);
  return { ...rest, blob: new Blob([bytes as BlobPart], { type: PDF_MIME }) };
}

// ---------------------------------------------------------------------------- PDF to PowerPoint

export type SlideMode = "editable" | "pictures";

const SLIDE_DPI = 150;

async function pagePicture(doc: PDFDocumentProxy, page: number): Promise<SlideInput["picture"]> {
  const image = await renderPageToImage(doc, page, { dpi: SLIDE_DPI, format: "jpeg", quality: 0.85 });
  return { bytes: await bytesOf(image.blob), format: "jpeg" };
}

interface PageText {
  width: number;
  height: number;
  blocks: TextBlock[];
  colors: string[];
}

/** The page's text as blocks (paragraphs), with each block's colour sampled from the rendered page. */
async function readPageText(doc: PDFDocumentProxy, number: number): Promise<PageText> {
  return withRenderSlot(async () => {
    const page = await doc.getPage(number);
    const natural = page.getViewport({ scale: 1 });
    const scale = Math.min(1.5, 3000 / Math.max(natural.width, natural.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(natural.width * scale);
    canvas.height = Math.ceil(natural.height * scale);
    try {
      await page.render({ canvas, viewport: page.getViewport({ scale }) }).promise;
      // After rendering, pdf.js knows the real fonts, so bold and italic can be told.
      const blocks = groupLines(await readPhrases(page));
      const colors = blocks.map((b) => sampleColors(canvas, natural.width, b.lines[0]).text);
      return { width: natural.width, height: natural.height, blocks, colors };
    } finally {
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  });
}

function slideTexts(page: PageText, removed: boolean[]): SlideText[] {
  const texts: SlideText[] = [];
  let at = 0;
  page.blocks.forEach((block, b) => {
    // Lines whose text couldn't be taken out of the picture stay in the picture only.
    const lines = block.lines.filter((_, i) => removed[at + i]);
    at += block.lines.length;
    if (!lines.length) return;
    const x = Math.min(...lines.map((l) => l.x));
    const y = Math.min(...lines.map((l) => l.y));
    const pitches = lines.slice(1).map((l, i) => l.baseline - lines[i].baseline);
    texts.push({
      x,
      y,
      width: Math.max(...lines.map((l) => l.x + l.width)) - x,
      height: Math.max(...lines.map((l) => l.y + l.height)) - y,
      pitch: pitches.length ? pitches.reduce((s, p) => s + p, 0) / pitches.length : lines[0].size * 1.2,
      color: page.colors[b],
      lines: lines.map((l) => ({ text: l.str, size: l.size, bold: l.bold, italic: l.italic, font: l.font })),
    });
  });
  return texts;
}

export async function pdfToPowerPoint(file: Blob, doc: PDFDocumentProxy, pages: number[], mode: SlideMode, onPage?: (done: number) => void) {
  const slides: SlideInput[] = [];
  if (mode === "pictures") {
    for (const [i, n] of pages.entries()) {
      const { width, height } = (await doc.getPage(n)).getViewport({ scale: 1 });
      slides.push({ width, height, picture: await pagePicture(doc, n), texts: [] });
      onPage?.(i + 1);
    }
  } else {
    // 1. Read each page's text. 2. Take it out of a copy of the PDF. 3. Picture that copy behind text boxes.
    const texts = new Map<number, PageText>();
    for (const [i, n] of pages.entries()) {
      texts.set(n, await readPageText(doc, n));
      // Reading counts as the first half of the work, building the slides as the second.
      onPage?.((i + 1) / 2);
    }
    const lines = Array.from({ length: doc.numPages }, (_, i) => texts.get(i + 1)?.blocks.flatMap((b) => b.lines.map((l) => l.sources)) ?? []);
    const stripped = await stripTextFromFile(file, lines);
    const copy = await openPdfForRendering(stripped.blob);
    try {
      for (const [i, n] of pages.entries()) {
        const page = texts.get(n)!;
        slides.push({ width: page.width, height: page.height, picture: await pagePicture(copy.doc, n), texts: slideTexts(page, stripped.removed[n - 1] ?? []) });
        onPage?.((pages.length + i + 1) / 2);
      }
    } finally {
      copy.destroy();
    }
  }
  const bytes = await officeWorker.writePptx(slides);
  return { blob: new Blob([bytes as BlobPart], { type: PPTX_MIME }), slides: slides.length, textBoxes: slides.reduce((n, s) => n + s.texts.length, 0) };
}

// ---------------------------------------------------------------------------- Compare PDFs

export interface PageSize {
  width: number;
  height: number;
}

export interface ComparedDocuments extends Comparison {
  sizes: { before: PageSize[]; after: PageSize[] };
}

export async function comparePdfs(before: PDFDocumentProxy, after: PDFDocumentProxy, onProgress?: (done: number, total: number) => void): Promise<ComparedDocuments> {
  const total = before.numPages + after.numPages;
  const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  const pagesA = await extractText(before, range(before.numPages), (d) => onProgress?.(d, total), false);
  const pagesB = await extractText(after, range(after.numPages), (d) => onProgress?.(before.numPages + d, total), false);
  const comparison = await officeWorker.compare(
    pagesA.flatMap((p, i) => pageWords(p, i)),
    pagesB.flatMap((p, i) => pageWords(p, i)),
  );
  const size = (p: PageSize) => ({ width: p.width, height: p.height });
  return { ...comparison, sizes: { before: pagesA.map(size), after: pagesB.map(size) } };
}

const COLORS = { removed: "#f87171", added: "#4ade80", changed: "#fbbf24" };

/** Highlights (and notes) marking the changes, for Edit PDF to add as annotations. */
export function changeMarks(comparison: ComparedDocuments, side: "before" | "after", t: Translator = createTranslator("en")): EditObject[] {
  const sizes = comparison.sizes[side];
  const objects: EditObject[] = [];
  comparison.changes.forEach((change, c) => {
    const words = side === "before" ? change.beforeWords : change.afterWords;
    const color = side === "before" ? COLORS.removed : COLORS[change.kind];
    const byPage = new Map<number, { x: number; y: number; width: number; height: number }[]>();
    for (const word of words) {
      const size = sizes[word.page];
      if (!size) continue;
      const rects = byPage.get(word.page) ?? [];
      for (const b of word.boxes) {
        const rect = { x: b.x * size.width, y: b.y * size.height, width: b.width * size.width, height: b.height * size.height };
        const last = rects.at(-1);
        // Words next to each other on a line make one highlight.
        if (last && Math.abs(last.y - rect.y) < rect.height * 0.3 && rect.x - (last.x + last.width) < rect.height) {
          const right = Math.max(last.x + last.width, rect.x + rect.width);
          last.y = Math.min(last.y, rect.y);
          last.height = Math.max(last.height, rect.height);
          last.width = right - last.x;
        } else rects.push(rect);
      }
      byPage.set(word.page, rects);
    }
    for (const [page, rects] of byPage) objects.push({ id: `c${c}p${page}`, kind: "highlight", page, rects, color, opacity: 0.45 });
    if (side === "after" && change.kind !== "added") {
      const quoted = change.before.length > 300 ? `${change.before.slice(0, 300)}…` : change.before;
      const text = change.kind === "removed" ? t("Removed: “{text}”", { text: quoted }) : t("Was: “{text}”", { text: quoted });
      const at = change.afterWords[0] ?? change.anchor;
      const anchor = at?.boxes[0];
      const page = at?.page ?? change.afterPage;
      const size = sizes[page];
      if (size) {
        objects.push({
          id: `n${c}`,
          kind: "note",
          page,
          x: anchor ? Math.max(0, anchor.x * size.width - 20) : 12,
          y: anchor ? anchor.y * size.height : 12,
          text,
          color: change.kind === "removed" ? COLORS.removed : COLORS.changed,
        });
      }
    }
  });
  return objects;
}
