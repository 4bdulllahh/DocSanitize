/// <reference lib="webworker" />
import { jpegToGray, reencodeJpeg } from "@/lib/image/canvas";
import { prepareImage, type ImageInput } from "@/lib/image/prepare";
import { extractPages, mergePdfs, rearrangePages } from "@/lib/pdf/assemble";
import { compressPdf, type CompressOptions } from "@/lib/pdf/compress";
import { imagesToPdf, type ImagesToPdfOptions, type PreparedImage } from "@/lib/pdf/images";
import { addBatesNumbers, addHeaderFooter, addPageNumbers, addWatermark, applySignatures, stampPageLabels, type BatesOptions, type HeaderFooterOptions, type LabelStyle, type PageNumberOptions, type Placement, type WatermarkOptions } from "@/lib/pdf/markup";
import { applyEdits } from "@/lib/pdf/edit/apply";
import { flattenPdf } from "@/lib/pdf/flatten";
import { fillForm, readForm, type FieldValues, type FillOptions } from "@/lib/pdf/forms";
import { grayscalePdf } from "@/lib/pdf/grayscale";
import { readBookmarks, readInfo, writeBookmarks, writeInfo } from "@/lib/pdf/info";
import { cropPages, deletePages, insertPages, resizePages, rotatePages } from "@/lib/pdf/pages";
import type { EditRequest } from "@/lib/pdf/edit/types";
import { addTextLayer } from "@/lib/pdf/ocr-layer";
import { applyRedactions } from "@/lib/pdf/redact";
import { stripText } from "@/lib/pdf/strip-text";
import { translatePdf, type TranslatedBlock } from "@/lib/pdf/translate";
import { inspectEncryption, protectPdf, unlockPdf } from "@/lib/pdf/security";
import { loadPdf } from "@/lib/pdf/load";
import { loadFonts } from "@/lib/office/fonts";
import { exposeWorkerApi } from "@/lib/worker-rpc";

async function fromImages(inputs: ImageInput[], options: ImagesToPdfOptions): Promise<Uint8Array> {
  // One at a time: decoding several large photos at once can exhaust a phone's memory.
  const prepared: PreparedImage[] = [];
  for (const input of inputs) prepared.push(await prepareImage(input));
  return imagesToPdf(prepared, options);
}

const api = {
  merge: mergePdfs,
  extract: extractPages,
  rearrange: rearrangePages,
  fromImages,
  compress: (bytes: Uint8Array, options: CompressOptions) => compressPdf(bytes, options, reencodeJpeg),
  protect: protectPdf,
  unlock: unlockPdf,
  inspectEncryption,
  redact: applyRedactions,
  watermark: async (bytes: Uint8Array, options: WatermarkOptions) => addWatermark(bytes, options, await loadFonts()),
  pageNumbers: async (bytes: Uint8Array, options: PageNumberOptions) => addPageNumbers(bytes, options, await loadFonts()),
  stampLabels: async (bytes: Uint8Array, labels: (string | null)[], style: LabelStyle) => stampPageLabels(bytes, labels, style, await loadFonts()),
  sign: async (bytes: Uint8Array, placements: Placement[], images: Record<string, Uint8Array>) => applySignatures(bytes, placements, images, await loadFonts()),
  edit: async (bytes: Uint8Array, request: EditRequest) => applyEdits(bytes, request, await loadFonts()),
  pageCount: async (bytes: Uint8Array) => (await loadPdf(bytes)).getPageCount(),
  rotate: rotatePages,
  deletePages,
  insert: insertPages,
  crop: cropPages,
  resize: resizePages,
  headerFooter: async (bytes: Uint8Array, options: HeaderFooterOptions) => addHeaderFooter(bytes, options, await loadFonts()),
  bates: async (files: Uint8Array[], options: BatesOptions) => addBatesNumbers(files, options, await loadFonts()),
  flatten: flattenPdf,
  grayscale: (bytes: Uint8Array) => grayscalePdf(bytes, jpegToGray),
  readInfo,
  writeInfo,
  readBookmarks,
  writeBookmarks,
  readForm,
  ocrLayer: addTextLayer,
  translate: async (bytes: Uint8Array, blocks: TranslatedBlock[]) => translatePdf(bytes, blocks, await loadFonts()),
  fillForm: async (bytes: Uint8Array, values: FieldValues, options: FillOptions) => fillForm(bytes, values, options, await loadFonts()),
  stripText,
};
export type PdfWorkerApi = typeof api;

exposeWorkerApi(api);
