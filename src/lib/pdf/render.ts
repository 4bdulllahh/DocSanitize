import type { PDFDocumentProxy } from "pdfjs-dist";
import { ProcessingError } from "../errors";

type Pdfjs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<{ pdfjs: Pdfjs; worker: InstanceType<Pdfjs["PDFWorker"]> }> | null = null;

/**
 * Load pdf.js on first use (it's large) with one worker for every document. The worker is passed
 * to each getDocument call rather than set as GlobalWorkerOptions.workerPort: pdf.js only takes
 * ownership of workers it creates itself, and an owned, shared worker is torn down whenever any
 * one document is closed, so a document opened at that moment failed ("the worker is being
 * destroyed"), e.g. when switching tools.
 */
function loadPdfjs() {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    const port = new Worker(new URL("../../workers/pdfjs.worker.ts", import.meta.url), { type: "module" });
    return { pdfjs, worker: pdfjs.PDFWorker.create({ port }) };
  });
  return pdfjsPromise;
}

// Copied into public/ by scripts/copy-pdfjs-assets.mjs.
const ASSETS = "/pdfjs";

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** Release the document and its worker-side resources. */
  destroy: () => void;
}

/** Open a PDF for rendering. The caller must call `destroy()` when done. */
export async function openPdfForRendering(blob: Blob): Promise<OpenedPdf> {
  const { pdfjs, worker } = await loadPdfjs();
  const task = pdfjs.getDocument({
    worker,
    // A private copy: pdf.js transfers the buffer to its worker.
    data: new Uint8Array(await blob.arrayBuffer()),
    cMapUrl: `${ASSETS}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}/standard_fonts/`,
    wasmUrl: `${ASSETS}/wasm/`,
    iccUrl: `${ASSETS}/iccs/`,
    enableXfa: false,
  });
  try {
    const doc = await task.promise;
    return { doc, destroy: () => void task.destroy() };
  } catch (error) {
    void task.destroy();
    if (error instanceof Error && error.name === "PasswordException") {
      throw new ProcessingError("This PDF is password-protected. Unlock it first.", "encrypted");
    }
    throw new ProcessingError("This file couldn't be read as a PDF.", "corrupt");
  }
}

// pdf.js renders on the main thread; a small queue keeps big documents from stalling the UI.
const MAX_CONCURRENT_RENDERS = 3;
let active = 0;
const queue: (() => void)[] = [];

export async function withRenderSlot<T>(job: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_RENDERS) await new Promise<void>((resolve) => queue.push(resolve));
  active++;
  try {
    return await job();
  } finally {
    active--;
    queue.shift()?.();
  }
}
