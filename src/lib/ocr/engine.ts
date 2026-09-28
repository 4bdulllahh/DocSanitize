import type { PDFDocumentProxy } from "pdfjs-dist";
import corePackage from "tesseract.js-core/package.json";
import tesseractPackage from "tesseract.js/package.json";
import { ProcessingError } from "../errors";
import { withRenderSlot } from "../pdf/render";
import { OCR_LANGUAGES, TESSDATA_DIR } from "./languages";
import { readTesseractPage, type OcrPageResult, type TesseractPage } from "./result";
import { msg } from "@/i18n/msg";

/*
 * OCR with Tesseract (tesseract.js), an add-on: its worker, engine and language models are served
 * from our own site under /addons/ (see scripts/copy-addons.mjs), downloaded the first time and
 * kept by the service worker for offline use. Nothing is fetched from anywhere else, and
 * tesseract.js's own IndexedDB cache is turned off.
 */

export const OCR_WORKER_URL = `/addons/tesseract-${tesseractPackage.version}/worker.min.js`;
const CORE_DIR = `/addons/tesseract-core-${corePackage.version}/`;

export type OcrProgress =
  | { stage: "loading"; label: string }
  | { stage: "reading"; done: number; total: number; fraction: number };

export interface OcrOptions {
  /** Tesseract language codes, e.g. ["eng", "deu"]. */
  languages: string[];
  /** The PDF was made from a photo or screenshot: read it near its own resolution. */
  fromImage?: boolean;
  onProgress?: (progress: OcrProgress) => void;
  signal?: AbortSignal;
}

/** Scans are read at 300 dpi, the resolution Tesseract is tuned for. */
const DPI = 300;
/** Upper bounds for a rendered page (a phone's canvas limit is about 16 megapixels). */
const MAX_SIDE = 5000;
const MAX_PIXELS = 16_000_000;

/** Rendered pixels per point for a page of this displayed size. */
export function ocrScale(width: number, height: number, fromImage = false): number {
  let scale = DPI / 72;
  if (fromImage) {
    // "Fit" pages from Images to PDF are 96 pixels per inch: keep the photo's own pixels, and
    // enlarge small ones (up to 2×), which helps with small text in screenshots.
    const pixels = (Math.max(width, height) * 96) / 72;
    scale = (96 / 72) * Math.min(2, Math.max(1, 2000 / pixels));
  }
  return Math.min(scale, MAX_SIDE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
}

const LOADING_LABELS: Record<string, string> = {
  "loading tesseract core": msg("Loading the OCR engine…"),
  "initializing tesseract": msg("Starting the OCR engine…"),
  "loading language traineddata": msg("Loading the language data…"),
  "initializing api": msg("Starting the OCR engine…"),
};

function unavailable(): ProcessingError {
  return new ProcessingError(
    "The OCR engine couldn't be loaded. It's downloaded from this site the first time you use OCR (the engine plus each language, a few MB), then works offline — check your connection and try again.",
    "unsupported",
  );
}

type TesseractWorker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;
/** A Tesseract worker plus a hook for the current page's progress. */
type Engine = TesseractWorker & { onReading(fn: ((fraction: number) => void) | null): void };

async function startEngine(languages: string[], onProgress?: (progress: OcrProgress) => void): Promise<Engine> {
  const unknown = languages.filter((code) => !OCR_LANGUAGES.some((l) => l.code === code));
  if (languages.length === 0 || unknown.length) throw new ProcessingError("Pick at least one language the text is in.", "invalid");
  const { createWorker, OEM } = await import("tesseract.js");
  let reading: ((fraction: number) => void) | null = null;
  // tesseract.js only rejects createWorker when its script fails; a model that can't be fetched
  // is reported to errorHandler and would otherwise leave it pending forever.
  let fail: (error: unknown) => void = () => {};
  // After a failure the worker may still report progress on the other languages: ignore it.
  let failedAlready = false;
  const failed = new Promise<never>((_, reject) => (fail = reject));
  failed.catch(() => {});
  try {
    const worker = await Promise.race([
      createWorker(languages, OEM.LSTM_ONLY, {
        workerPath: OCR_WORKER_URL,
        corePath: CORE_DIR,
        langPath: TESSDATA_DIR,
        // Load the worker script itself (a blob: worker would break the CSP), and let the service
        // worker cache the downloads instead of tesseract.js's IndexedDB.
        workerBlobURL: false,
        cacheMethod: "none",
        gzip: true,
        logger: (m) => {
          if (failedAlready) return;
          if (m.status === "recognizing text") reading?.(m.progress);
          else if (LOADING_LABELS[m.status]) onProgress?.({ stage: "loading", label: LOADING_LABELS[m.status] });
        },
        errorHandler: (error) => fail(error),
      }),
      failed,
    ]);
    return Object.assign(worker, {
      onReading(fn: ((fraction: number) => void) | null) {
        reading = fn;
      },
    });
  } catch {
    // A missing script or model shows up as a network error or an unreadable file.
    failedAlready = true;
    throw unavailable();
  }
}

async function renderForOcr(doc: PDFDocumentProxy, index: number, fromImage: boolean): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
  return withRenderSlot(async () => {
    const page = await doc.getPage(index + 1);
    const natural = page.getViewport({ scale: 1 });
    const scale = ocrScale(natural.width, natural.height, fromImage);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    // Transparent areas are paper: white, not black, once Tesseract reads the image.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, viewport, background: "#ffffff" }).promise;
    page.cleanup();
    return { canvas, scale: canvas.width / natural.width };
  });
}

/** Pages (0-based) that already have text, so they needn't be read again. */
export async function pagesWithText(doc: PDFDocumentProxy, cancelled: () => boolean = () => false): Promise<Set<number>> {
  const pages = new Set<number>();
  for (let i = 0; i < doc.numPages && !cancelled(); i++) {
    const content = await (await doc.getPage(i + 1)).getTextContent();
    if (content.items.some((item) => "str" in item && item.str.trim())) pages.add(i);
  }
  return pages;
}

/** Recognise the text of the given pages (0-based), one page at a time. */
export async function recognizePages(doc: PDFDocumentProxy, pages: number[], options: OcrOptions): Promise<OcrPageResult[]> {
  const { onProgress, signal } = options;
  onProgress?.({ stage: "loading", label: msg("Loading the OCR engine…") });
  const engine = await startEngine(options.languages, onProgress);
  const aborted = new Promise<never>((_, reject) => {
    const stop = () => reject(new DOMException(msg("OCR was cancelled."), "AbortError"));
    if (signal?.aborted) stop();
    signal?.addEventListener("abort", stop, { once: true });
  });
  aborted.catch(() => {});
  try {
    const results: OcrPageResult[] = [];
    for (const [done, index] of pages.entries()) {
      const report = (fraction: number) => onProgress?.({ stage: "reading", done, total: pages.length, fraction });
      report(0);
      const { canvas, scale } = await Promise.race([renderForOcr(doc, index, options.fromImage ?? false), aborted]);
      engine.onReading(report);
      try {
        await Promise.race([engine.setParameters({ user_defined_dpi: String(Math.round(scale * 72)) }), aborted]);
        const { data } = await Promise.race([engine.recognize(canvas, {}, { text: false, blocks: true }), aborted]);
        results.push(readTesseractPage(data as unknown as TesseractPage, index, scale));
      } finally {
        engine.onReading(null);
        canvas.width = canvas.height = 0;
      }
    }
    return results;
  } finally {
    void engine.terminate();
  }
}
