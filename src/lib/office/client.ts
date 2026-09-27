import type { PDFDocumentProxy } from "pdfjs-dist";
import type { OfficeWorkerApi } from "@/workers/office.worker";
import { PDF_MIME } from "../pdf/client";
import { createWorkerClient } from "../worker-rpc";
import { DOCX_MIME } from "./docx";
import { extractText } from "./extract";
import type { PdfToExcelOptions, PdfToWordOptions } from "./pdf-to-office";
import type { SheetToPdfOptions } from "./sheet";
import type { OfficeToPdfOptions } from "./word";
import { XLSX_MIME } from "./xlsx";

const worker = createWorkerClient<OfficeWorkerApi>(
  () => new Worker(new URL("../../workers/office.worker.ts", import.meta.url), { type: "module" }),
);

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/** Text is read with pdf.js on the page; rebuilding and writing the .docx happens in a worker. */
export async function pdfToWord(doc: PDFDocumentProxy, pages: number[], options: PdfToWordOptions, onPage?: (done: number) => void) {
  const { bytes, ...rest } = await worker.textToDocx(await extractText(doc, pages, onPage), options);
  return { ...rest, blob: new Blob([bytes as BlobPart], { type: DOCX_MIME }) };
}

export async function pdfToExcel(doc: PDFDocumentProxy, pages: number[], options: PdfToExcelOptions, onPage?: (done: number) => void) {
  const { bytes, ...rest } = await worker.textToXlsx(await extractText(doc, pages, onPage), pages, options);
  return { ...rest, blob: new Blob([bytes as BlobPart], { type: XLSX_MIME }) };
}

export async function wordToPdf(file: Blob, name: string, options: OfficeToPdfOptions) {
  const { bytes, ...rest } = await worker.docxToPdf(await bytesOf(file), options, name);
  return { ...rest, blob: new Blob([bytes as BlobPart], { type: PDF_MIME }) };
}

export async function inspectSpreadsheet(file: Blob, name: string) {
  return worker.inspectWorkbook(await bytesOf(file), name);
}

export async function spreadsheetToPdf(file: Blob, name: string, options: SheetToPdfOptions) {
  const { bytes, ...rest } = await worker.workbookToPdf(await bytesOf(file), options, name);
  return { ...rest, blob: new Blob([bytes as BlobPart], { type: PDF_MIME }) };
}
