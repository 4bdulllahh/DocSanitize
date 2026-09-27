/// <reference lib="webworker" />
import { loadFonts } from "@/lib/office/fonts";
import { textPagesToDocx, textPagesToXlsx } from "@/lib/office/pdf-to-office";
import { inspectWorkbook, workbookToPdf, type SheetToPdfOptions } from "@/lib/office/sheet";
import { docxToPdf, type OfficeToPdfOptions } from "@/lib/office/word";
import { exposeWorkerApi } from "@/lib/worker-rpc";

const api = {
  textToDocx: textPagesToDocx,
  textToXlsx: textPagesToXlsx,
  inspectWorkbook,
  docxToPdf: async (bytes: Uint8Array, options: OfficeToPdfOptions, name: string) => docxToPdf(bytes, options, await loadFonts(), name),
  workbookToPdf: async (bytes: Uint8Array, options: SheetToPdfOptions, name: string) => workbookToPdf(bytes, options, await loadFonts(), name),
};
export type OfficeWorkerApi = typeof api;

exposeWorkerApi(api);
