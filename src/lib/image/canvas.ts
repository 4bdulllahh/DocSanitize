import { ProcessingError } from "../errors";
import { isAvif } from "../metadata/heif";
import { stripJpeg } from "../metadata/jpeg";
import { DEFAULT_STRIP_OPTIONS } from "../metadata/types";
import type { JpegReencoder } from "../pdf/compress";
import { decodeHeic, needsHeicDecoder } from "./heic";

/*
 * Image decoding and encoding with the browser's own codecs. These need createImageBitmap and
 * OffscreenCanvas, so they run in workers (or on the page), never in the Node unit tests.
 */

export type EncodeType = "image/jpeg" | "image/png";

/** Decode an image, applying its EXIF orientation. HEIC goes through the libheif add-on. */
export async function decodeImage(bytes: Uint8Array, type: string): Promise<ImageBitmap> {
  if (needsHeicDecoder(bytes)) {
    const { width, height, pixels } = await decodeHeic(bytes);
    return createImageBitmap(new ImageData(pixels, width, height), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  }
  try {
    return await createImageBitmap(new Blob([bytes as BlobPart], { type }), {
      imageOrientation: "from-image",
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
  } catch {
    if (isAvif(bytes)) throw new ProcessingError("This browser can't decode AVIF images. Use a current version of Chrome, Edge, Firefox or Safari.", "unsupported");
    throw new ProcessingError("This image couldn't be decoded.", "corrupt");
  }
}

/** Draw a bitmap at the given size and encode it. Canvas encoders write no metadata. */
export async function encodeBitmap(bitmap: ImageBitmap, width: number, height: number, type: EncodeType, quality?: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ProcessingError("Your browser couldn't create an image canvas.", "unsupported");
  if (type === "image/jpeg") {
    // JPEG has no transparency; composite onto white rather than black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type, quality });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Re-encode a JPEG taken from a PDF, no larger than `maxSide` pixels on its longest side.
 * EXIF is stripped first: PDF viewers ignore it, so the decoder must not rotate the pixels.
 */
export const reencodeJpeg: JpegReencoder = async (jpeg, maxSide, quality) => {
  const bitmap = await decodeImage(await stripJpeg(jpeg, DEFAULT_STRIP_OPTIONS, false), "image/jpeg");
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    return { bytes: await encodeBitmap(bitmap, width, height, "image/jpeg", quality), width, height };
  } finally {
    bitmap.close();
  }
};
