import type { PdfWorkerApi } from "@/workers/pdf.worker";
import { createWorkerClient } from "../worker-rpc";
import type { PageEdit } from "./assemble";
import type { CompressOptions, CompressResult } from "./compress";
import type { ImagesToPdfOptions } from "./images";
import type { LabelStyle, PageNumberOptions, Placement, WatermarkOptions } from "./markup";
import type { RedactedPage, RedactOptions } from "./redact";
import type { EncryptionInfo, ProtectOptions } from "./security";

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

export async function protectFile(file: Blob, options: ProtectOptions): Promise<Blob> {
  return new Blob([(await worker.protect(await bytesOf(file), options)) as BlobPart], { type: PDF_MIME });
}

export async function unlockFile(file: Blob, password?: string): Promise<Blob> {
  return new Blob([(await worker.unlock(await bytesOf(file), password)) as BlobPart], { type: PDF_MIME });
}

export async function inspectFileEncryption(file: Blob): Promise<EncryptionInfo> {
  return worker.inspectEncryption(await bytesOf(file));
}

export async function redactFile(file: Blob, pages: RedactedPage[], options: RedactOptions): Promise<Blob> {
  return new Blob([(await worker.redact(await bytesOf(file), pages, options)) as BlobPart], { type: PDF_MIME });
}

const asPdf = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: PDF_MIME });

// Image bytes are copied: worker calls transfer their buffers, and the caller keeps its own.
export async function watermarkFile(file: Blob, options: WatermarkOptions): Promise<Blob> {
  const image = options.image && { ...options.image, bytes: options.image.bytes.slice() };
  return asPdf(await worker.watermark(await bytesOf(file), { ...options, image }));
}

export async function numberPagesOfFile(file: Blob, options: PageNumberOptions): Promise<Blob> {
  return asPdf(await worker.pageNumbers(await bytesOf(file), options));
}

/** Previews: stamp precomputed labels onto a few pages. */
export async function stampLabelsOnFile(file: Blob, labels: (string | null)[], style: LabelStyle): Promise<Blob> {
  return asPdf(await worker.stampLabels(await bytesOf(file), labels, style));
}

export async function signFile(file: Blob, placements: Placement[], images: Record<string, Uint8Array>): Promise<Blob> {
  const copies = Object.fromEntries(Object.entries(images).map(([id, bytes]) => [id, bytes.slice()]));
  return asPdf(await worker.sign(await bytesOf(file), placements, copies));
}
