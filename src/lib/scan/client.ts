import type { ScanWorkerApi } from "@/workers/scan.worker";
import { PDF_MIME } from "../pdf/client";
import { createWorkerClient } from "../worker-rpc";
import type { OfficeCleanOptions, OfficeKind } from "./office-inspect";
import type { CleanOptions } from "./pdf-inspect";

const worker = createWorkerClient<ScanWorkerApi>(() => new Worker(new URL("../../workers/scan.worker.ts", import.meta.url), { type: "module" }));

// A private copy each time: the bytes are transferred to the worker.
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

const OFFICE_MIME: Record<OfficeKind, string> = {
  word: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  powerpoint: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const inspectPdfFile = async (file: Blob) => worker.inspectPdf(await bytesOf(file));
export const cleanPdfFile = async (file: Blob, options: CleanOptions) => new Blob([(await worker.cleanPdf(await bytesOf(file), options)) as BlobPart], { type: PDF_MIME });
export const inspectOfficeFile = async (file: Blob) => worker.inspectOffice(await bytesOf(file));
export async function cleanOfficeFile(file: Blob, kind: OfficeKind, options: OfficeCleanOptions): Promise<Blob> {
  return new Blob([(await worker.cleanOffice(await bytesOf(file), options)) as BlobPart], { type: OFFICE_MIME[kind] });
}
export const inspectImageFile = async (file: Blob) => worker.inspectImage(await bytesOf(file));
export const checkFileType = async (file: File) => worker.checkFile(file.name, await bytesOf(file));
export const hashFile = async (file: Blob) => worker.hashAll(await bytesOf(file));
