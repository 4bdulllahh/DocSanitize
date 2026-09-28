/*
 * Picture comparisons for Image Forensics, which run on the page (they need a canvas):
 * - Error level analysis: save the picture again as a JPEG and show how much each area changed.
 *   Areas edited after the last save often recompress differently from their surroundings.
 * - The EXIF thumbnail compared with the picture: a mismatch means the picture was changed
 *   after the camera wrote the thumbnail.
 */

/** Amplified difference between two RGBA images of the same size (alpha kept opaque). */
export function errorLevels(original: Uint8ClampedArray, resaved: Uint8ClampedArray, gain = 20): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(original.length);
  for (let i = 0; i < original.length; i += 4) {
    out[i] = Math.abs(original[i] - resaved[i]) * gain;
    out[i + 1] = Math.abs(original[i + 1] - resaved[i + 1]) * gain;
    out[i + 2] = Math.abs(original[i + 2] - resaved[i + 2]) * gain;
    out[i + 3] = 255;
  }
  return out;
}

/** Mean absolute difference (0–255) between two grayscale images of the same size. */
export function grayDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  const n = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const ga = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    const gb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
    sum += Math.abs(ga - gb);
  }
  return n ? sum / n : 0;
}

export interface ThumbnailComparison {
  /** 0–255: how different the thumbnail looks from the picture, both shrunk to 32 × 32. */
  difference: number;
  /** Width ÷ height of the thumbnail and of the picture. */
  thumbnailAspect: number;
  imageAspect: number;
}

const SIDE = 32;
const MAX_ELA_SIDE = 1600;

function pixels(source: CanvasImageSource, width: number, height: number): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

export async function compareThumbnail(image: ImageBitmap, thumbnail: Uint8Array): Promise<ThumbnailComparison> {
  const thumb = await createImageBitmap(new Blob([thumbnail as BlobPart], { type: "image/jpeg" }));
  try {
    return {
      difference: grayDifference(pixels(image, SIDE, SIDE), pixels(thumb, SIDE, SIDE)),
      thumbnailAspect: thumb.width / thumb.height,
      imageAspect: image.width / image.height,
    };
  } finally {
    thumb.close();
  }
}

/** An error level analysis picture (PNG), at most MAX_ELA_SIDE pixels on its long side. */
export async function errorLevelAnalysis(image: ImageBitmap, quality = 0.9): Promise<Blob> {
  const scale = Math.min(1, MAX_ELA_SIDE / Math.max(image.width, image.height));
  const [width, height] = [Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale))];
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, width, height);
  const original = ctx.getImageData(0, 0, width, height).data;
  const resaved = await createImageBitmap(await canvas.convertToBlob({ type: "image/jpeg", quality }));
  const again = pixels(resaved, width, height);
  resaved.close();
  ctx.putImageData(new ImageData(errorLevels(original, again), width, height), 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}
