import type { PdfWorkerApi } from "@/workers/pdf.worker";
import { createWorkerClient } from "../worker-rpc";
import type { PageEdit } from "./assemble";
import type { CompressOptions, CompressResult } from "./compress";
import type { Box, EditRequest, ReplaceObject } from "./edit/types";
import type { FlattenOptions } from "./flatten";
import type { FieldValues, FillOptions, FormInfo } from "./forms";
import type { Bookmark, DocumentInfo } from "./info";
import type { BatesOptions, HeaderFooterOptions } from "./markup";
import type { InsertOptions, ResizeOptions } from "./pages";
import type { ImagesToPdfOptions } from "./images";
import type { LabelStyle, PageNumberOptions, Placement, WatermarkOptions } from "./markup";
import type { OcrPageText } from "./ocr-layer";
import type { RedactedPage, RedactOptions } from "./redact";
import type { EncryptionInfo, ProtectOptions } from "./security";
import type { TranslatedBlock } from "./translate";

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

/** Apply the Edit PDF objects. Image bytes are copied: the originals stay usable in the editor. */
export async function editFile(file: Blob, request: EditRequest): Promise<{ blob: Blob; warnings: string[] }> {
  const images = Object.fromEntries(Object.entries(request.images).map(([id, image]) => [id, { ...image, bytes: image.bytes.slice() }]));
  const { bytes, warnings } = await worker.edit(await bytesOf(file), { ...request, images });
  return { blob: asPdf(bytes), warnings };
}

// ---------------------------------------------------------------------------- Page tools and forms

export const rotateFile = async (file: Blob, pages: number[], angle: number) => asPdf(await worker.rotate(await bytesOf(file), pages, angle));
export const deletePagesOfFile = async (file: Blob, pages: number[]) => asPdf(await worker.deletePages(await bytesOf(file), pages));
export async function insertIntoFile(file: Blob, options: Omit<InsertOptions, "source"> & { source?: { file: Blob; name?: string; pages?: number[] } }): Promise<Blob> {
  const source = options.source ? { bytes: await bytesOf(options.source.file), name: options.source.name, pages: options.source.pages } : undefined;
  return asPdf(await worker.insert(await bytesOf(file), { at: options.at, blank: options.blank, source }));
}
export const cropFile = async (file: Blob, crops: { page: number; box: Box }[]) => asPdf(await worker.crop(await bytesOf(file), crops));
export const resizeFile = async (file: Blob, options: ResizeOptions) => asPdf(await worker.resize(await bytesOf(file), options));
export const headerFooterFile = async (file: Blob, options: HeaderFooterOptions) => asPdf(await worker.headerFooter(await bytesOf(file), options));
export async function batesFiles(files: Blob[], options: BatesOptions): Promise<{ blob: Blob; first: string; last: string }[]> {
  const results = await worker.bates(await Promise.all(files.map(bytesOf)), options);
  return results.map((r) => ({ blob: asPdf(r.bytes), first: r.first, last: r.last }));
}
export async function flattenFile(file: Blob, options: FlattenOptions) {
  const { bytes, ...counts } = await worker.flatten(await bytesOf(file), options);
  return { blob: asPdf(bytes), ...counts };
}
export async function grayscaleFile(file: Blob) {
  const { bytes, ...counts } = await worker.grayscale(await bytesOf(file));
  return { blob: asPdf(bytes), ...counts };
}
export const readFileInfo = async (file: Blob): Promise<DocumentInfo> => worker.readInfo(await bytesOf(file));
export const writeFileInfo = async (file: Blob, info: Omit<DocumentInfo, "hasXmp">) => asPdf(await worker.writeInfo(await bytesOf(file), info));
export const readFileBookmarks = async (file: Blob): Promise<Bookmark[]> => worker.readBookmarks(await bytesOf(file));
export const writeFileBookmarks = async (file: Blob, bookmarks: Bookmark[]) => asPdf(await worker.writeBookmarks(await bytesOf(file), bookmarks));
export const readFileForm = async (file: Blob): Promise<FormInfo> => worker.readForm(await bytesOf(file));
export const fillFileForm = async (file: Blob, values: FieldValues, options: FillOptions) => asPdf(await worker.fillForm(await bytesOf(file), values, options));

// ---------------------------------------------------------------------------- OCR and translation

export const addOcrTextToFile = async (file: Blob, pages: OcrPageText[]) => asPdf(await worker.ocrLayer(await bytesOf(file), pages));
export async function translateFile(file: Blob, blocks: TranslatedBlock[]): Promise<{ blob: Blob; warnings: string[] }> {
  const { bytes, warnings } = await worker.translate(await bytesOf(file), blocks);
  return { blob: asPdf(bytes), warnings };
}

/** PDF to PowerPoint: a copy without the lines that become text boxes (for the slide pictures). */
export async function stripTextFromFile(file: Blob, pages: ReplaceObject["sources"][][]): Promise<{ blob: Blob; removed: boolean[][] }> {
  const { bytes, removed } = await worker.stripText(await bytesOf(file), pages);
  return { blob: asPdf(bytes), removed };
}
