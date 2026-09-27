import type { PdfWorkerApi } from "@/workers/pdf.worker";
import { createWorkerClient } from "../worker-rpc";
import type { PageEdit } from "./assemble";
import type { CompressOptions, CompressResult } from "./compress";
import type { ImagesToPdfOptions } from "./images";

const worker = createWorkerClient<PdfWorkerApi>(
  () => new Worker(new URL("../../workers/pdf.worker.ts", import.meta.url), { type: "module" }),
);

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

export const PDF_MIME = "application/pdf";

export async function mergeFiles(files: { name: string; file: Blob }[]): Promise<Blob> {
  const inputs = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: await bytesOf(f.file) })));
  return new Blob([(await worker.merge(inputs)) as BlobPart], { type: PDF_MIME });
}

export async function extractFromFile(file: Blob, groups: number[][]): Promise<Blob[]> {
  const parts = await worker.extract(await bytesOf(file), groups);
  return parts.map((bytes) => new Blob([bytes as BlobPart], { type: PDF_MIME }));
}

export async function rearrangeFile(file: Blob, edits: PageEdit[]): Promise<Blob> {
  return new Blob([(await worker.rearrange(await bytesOf(file), edits)) as BlobPart], { type: PDF_MIME });
}

export async function imagesToPdfFile(images: { name: string; file: Blob; rotate: number }[], options: ImagesToPdfOptions): Promise<Blob> {
  const inputs = await Promise.all(images.map(async (i) => ({ name: i.name, rotate: i.rotate, bytes: await bytesOf(i.file) })));
  return new Blob([(await worker.fromImages(inputs, options)) as BlobPart], { type: PDF_MIME });
}

export async function compressFile(file: Blob, options: CompressOptions): Promise<Omit<CompressResult, "bytes"> & { blob: Blob }> {
  const { bytes, ...rest } = await worker.compress(await bytesOf(file), options);
  return { ...rest, blob: new Blob([bytes as BlobPart], { type: PDF_MIME }) };
}
