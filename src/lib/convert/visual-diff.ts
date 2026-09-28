/*
 * Compare PDFs, picture by picture: two renderings of a page, same size, compared pixel by pixel.
 * The result shows the newer page faded, with every pixel that differs in red.
 */

/** Channels must differ by more than this (0-255) to count: anti-aliasing noise stays out. */
const THRESHOLD = 48;

export interface PixelDiff {
  /** RGBA overlay image, same size as the inputs. */
  data: Uint8ClampedArray;
  /** Share of pixels that differ, 0-1. */
  changed: number;
}

export function diffPixels(before: Uint8ClampedArray, after: Uint8ClampedArray, width: number, height: number): PixelDiff {
  const out = new Uint8ClampedArray(width * height * 4);
  let changed = 0;
  for (let i = 0; i < out.length; i += 4) {
    const delta = Math.max(Math.abs(before[i] - after[i]), Math.abs(before[i + 1] - after[i + 1]), Math.abs(before[i + 2] - after[i + 2]));
    if (delta > THRESHOLD) {
      changed++;
      out[i] = 220;
      out[i + 1] = 38;
      out[i + 2] = 38;
    } else {
      // The page, faded towards white.
      const gray = 0.299 * after[i] + 0.587 * after[i + 1] + 0.114 * after[i + 2];
      out[i] = out[i + 1] = out[i + 2] = 255 - (255 - gray) * 0.3;
    }
    out[i + 3] = 255;
  }
  return { data: out, changed: changed / (width * height) };
}
