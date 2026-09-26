import type { PDFDocumentProxy } from "pdfjs-dist";
import { ProcessingError } from "../errors";

type Pdfjs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<Pdfjs> | null = null;

/** Load pdf.js on first use (it's large) and point it at our bundled worker. */
function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("../../workers/pdfjs.worker.ts", import.meta.url), {
      type: "module",
    });
    return pdfjs;
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
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
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
