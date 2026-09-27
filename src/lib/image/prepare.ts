import { ProcessingError } from "../errors";
import { readExif } from "../metadata/exif";
import { isJpeg, stripJpeg } from "../metadata/jpeg";
import { isPng } from "../metadata/png";
import { DEFAULT_STRIP_OPTIONS } from "../metadata/types";
import { isWebp, webpIsLosslessOrTransparent } from "../metadata/webp";
import type { PreparedImage } from "../pdf/images";
import { decodeImage, encodeBitmap } from "./canvas";

export interface ImageInput {
  name: string;
  bytes: Uint8Array;
  /** Extra clockwise rotation chosen by the user. */
  rotate: number;
}

/** Quality used when a WebP has to be re-encoded as JPEG. */
const WEBP_TO_JPEG_QUALITY = 0.92;

/**
 * Get an image ready for pdf-lib, which embeds JPEG and PNG only.
 * - JPEG: metadata stripped (EXIF/GPS would otherwise be copied into the PDF), orientation kept aside.
 * - PNG: embedded from decoded pixels, so its text chunks never reach the PDF.
 * - WebP: re-encoded with the browser's codecs (PNG if lossless or transparent, else JPEG).
 */
export async function prepareImage(input: ImageInput): Promise<PreparedImage> {
  try {
    return await prepare(input);
  } catch (error) {
    if (error instanceof ProcessingError && error.code === "unsupported") throw error;
    throw new ProcessingError(`“${input.name}” couldn't be read as an image.`, "corrupt");
  }
}

async function prepare({ name, bytes, rotate }: ImageInput): Promise<PreparedImage> {
  if (isJpeg(bytes)) {
    const { orientation } = await readExif(bytes);
    const clean = await stripJpeg(bytes, DEFAULT_STRIP_OPTIONS, false);
    return { name, bytes: clean, format: "jpeg", orientation: orientation ?? 1, rotate };
  }
  if (isPng(bytes)) return { name, bytes, format: "png", orientation: 1, rotate };
  if (isWebp(bytes)) {
    const lossless = webpIsLosslessOrTransparent(bytes);
    const bitmap = await decodeImage(bytes, "image/webp");
    try {
      const type = lossless ? "image/png" : "image/jpeg";
      const encoded = await encodeBitmap(bitmap, bitmap.width, bitmap.height, type, WEBP_TO_JPEG_QUALITY);
      return { name, bytes: encoded, format: lossless ? "png" : "jpeg", orientation: 1, rotate };
    } finally {
      bitmap.close();
    }
  }
  throw new ProcessingError(`“${name}” isn't a JPEG, PNG or WebP image.`, "unsupported");
}
