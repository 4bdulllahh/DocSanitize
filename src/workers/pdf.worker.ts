/// <reference lib="webworker" />
import { reencodeJpeg } from "@/lib/image/canvas";
import { prepareImage, type ImageInput } from "@/lib/image/prepare";
import { extractPages, mergePdfs, rearrangePages } from "@/lib/pdf/assemble";
import { compressPdf, type CompressOptions } from "@/lib/pdf/compress";
import { imagesToPdf, type ImagesToPdfOptions, type PreparedImage } from "@/lib/pdf/images";
import { addPageNumbers, addWatermark, applySignatures, stampPageLabels, type LabelStyle, type PageNumberOptions, type Placement, type WatermarkOptions } from "@/lib/pdf/markup";
import { applyRedactions } from "@/lib/pdf/redact";
import { inspectEncryption, protectPdf, unlockPdf } from "@/lib/pdf/security";
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
};
export type PdfWorkerApi = typeof api;

exposeWorkerApi(api);
