/// <reference lib="webworker" />
import { reencodeJpeg } from "@/lib/image/canvas";
import { prepareImage, type ImageInput } from "@/lib/image/prepare";
import { extractPages, mergePdfs, rearrangePages } from "@/lib/pdf/assemble";
import { compressPdf, type CompressOptions } from "@/lib/pdf/compress";
import { imagesToPdf, type ImagesToPdfOptions, type PreparedImage } from "@/lib/pdf/images";
import { applyRedactions } from "@/lib/pdf/redact";
import { inspectEncryption, protectPdf, unlockPdf } from "@/lib/pdf/security";
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
};
export type PdfWorkerApi = typeof api;

exposeWorkerApi(api);
