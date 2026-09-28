/// <reference lib="webworker" />
import { compareWords } from "@/lib/convert/compare";
import { textPagesToText } from "@/lib/convert/pdf-to-text";
import { pptxToPdf, type PptxToPdfOptions } from "@/lib/convert/pptx-to-pdf";
import { writePptx } from "@/lib/convert/pptx-write";
import { blocksToPdf, type TextToPdfOptions } from "@/lib/convert/text-to-pdf";
import { pictureToPng } from "@/lib/image/canvas";
import type { Block } from "@/lib/office/flow";
import { loadFonts } from "@/lib/office/fonts";
import { textPagesToDocx, textPagesToXlsx } from "@/lib/office/pdf-to-office";
import { inspectWorkbook, workbookToPdf, type SheetToPdfOptions } from "@/lib/office/sheet";
import { docxToPdf, type OfficeToPdfOptions } from "@/lib/office/word";
import { exposeWorkerApi } from "@/lib/worker-rpc";

const api = {
  textToDocx: textPagesToDocx,
  textToXlsx: textPagesToXlsx,
  textToText: textPagesToText,
  inspectWorkbook,
  docxToPdf: async (bytes: Uint8Array, options: OfficeToPdfOptions, name: string) => docxToPdf(bytes, options, await loadFonts(), name),
  workbookToPdf: async (bytes: Uint8Array, options: SheetToPdfOptions, name: string) => workbookToPdf(bytes, options, await loadFonts(), name),
  blocksToPdf: async (blocks: Block[], options: TextToPdfOptions) => blocksToPdf(blocks, options, await loadFonts()),
  pptxToPdf: async (bytes: Uint8Array, options: PptxToPdfOptions, name: string) => pptxToPdf(bytes, options, await loadFonts(), pictureToPng, name),
  writePptx,
  compare: compareWords,
};
export type OfficeWorkerApi = typeof api;

exposeWorkerApi(api);
