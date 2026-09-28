/*
 * Image formats browsers can't write themselves: BMP, TIFF and ICO, encoded from RGBA pixels.
 * Like the canvas encoders, they write pixels only, no metadata.
 */

/** 24-bit BMP. Transparency is flattened onto `background` ([r, g, b]). */
export function encodeBmp(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, background: [number, number, number] = [255, 255, 255]): Uint8Array {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set([0x42, 0x4d]); // "BM"
  view.setUint32(2, size, true);
  view.setUint32(10, 54, true); // pixel data offset
  view.setUint32(14, 40, true); // BITMAPINFOHEADER
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive: rows bottom-up
  view.setUint16(26, 1, true); // planes
  view.setUint16(28, 24, true); // bits per pixel
  view.setUint32(34, rowSize * height, true);
  view.setInt32(38, 2835, true); // 72 dpi
  view.setInt32(42, 2835, true);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3] / 255;
      const o = row + x * 3;
      out[o] = Math.round(rgba[i + 2] * a + background[2] * (1 - a));
      out[o + 1] = Math.round(rgba[i + 1] * a + background[1] * (1 - a));
      out[o + 2] = Math.round(rgba[i] * a + background[0] * (1 - a));
    }
  }
  return out;
}

/** Baseline TIFF: uncompressed RGB, or RGBA (unassociated alpha) when the picture has transparency. */
export function encodeTiff(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  let alpha = false;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) {
      alpha = true;
      break;
    }
  }
  const channels = alpha ? 4 : 3;
  const pixelBytes = width * height * channels;
  const entries: [tag: number, type: number, count: number, value: number | number[]][] = [
    [256, 4, 1, width], // ImageWidth
    [257, 4, 1, height], // ImageLength
    [258, 3, channels, new Array(channels).fill(8)], // BitsPerSample
    [259, 3, 1, 1], // Compression: none
    [262, 3, 1, 2], // PhotometricInterpretation: RGB
    [273, 4, 1, 0], // StripOffsets (filled in below)
    [277, 3, 1, channels], // SamplesPerPixel
    [278, 4, 1, height], // RowsPerStrip
    [279, 4, 1, pixelBytes], // StripByteCounts
    [282, 5, 1, 0], // XResolution (rational, below)
    [283, 5, 1, 0], // YResolution
    [284, 3, 1, 1], // PlanarConfiguration: chunky
    [296, 3, 1, 2], // ResolutionUnit: inch
  ];
  if (alpha) entries.push([338, 3, 1, 2]); // ExtraSamples: unassociated alpha
  entries.sort((a, b) => a[0] - b[0]);

  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  let extra = ifdOffset + ifdSize;
  const bitsOffset = channels > 2 ? extra : 0;
  extra += channels * 2;
  const resolutionOffset = extra;
  extra += 8; // one rational (72/1), shared by X and Y
  const dataOffset = extra + (extra % 2);
  const out = new Uint8Array(dataOffset + pixelBytes);
  const view = new DataView(out.buffer);
  out.set([0x49, 0x49]); // "II": little-endian
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entries.length, true);
  entries.forEach(([tag, type, count, value], n) => {
    const at = ifdOffset + 2 + n * 12;
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, count, true);
    if (tag === 258) {
      view.setUint32(at + 8, bitsOffset, true);
      for (let k = 0; k < channels; k++) view.setUint16(bitsOffset + k * 2, 8, true);
    } else if (tag === 273) view.setUint32(at + 8, dataOffset, true);
    else if (type === 5) view.setUint32(at + 8, resolutionOffset, true);
    else if (type === 3) view.setUint16(at + 8, value as number, true);
    else view.setUint32(at + 8, value as number, true);
  });
  view.setUint32(resolutionOffset, 72, true);
  view.setUint32(resolutionOffset + 4, 1, true);
  if (alpha) out.set(rgba.subarray(0, pixelBytes), dataOffset);
  else for (let i = 0, o = dataOffset; i < rgba.length; i += 4, o += 3) out.set([rgba[i], rgba[i + 1], rgba[i + 2]], o);
  return out;
}

/** An .ico holding PNG images (Windows Vista and later, and every browser), one per size. */
export function encodeIco(images: { size: number; png: Uint8Array }[]): Uint8Array {
  const header = 6 + images.length * 16;
  const out = new Uint8Array(header + images.reduce((n, i) => n + i.png.length, 0));
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, images.length, true);
  let offset = header;
  images.forEach(({ size, png }, n) => {
    const at = 6 + n * 16;
    out[at] = size >= 256 ? 0 : size; // 0 means 256
    out[at + 1] = size >= 256 ? 0 : size;
    view.setUint16(at + 4, 1, true); // planes
    view.setUint16(at + 6, 32, true); // bits per pixel
    view.setUint32(at + 8, png.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(png, offset);
    offset += png.length;
  });
  return out;
}

export type ResizeMode = { mode: "none" } | { mode: "percent"; percent: number } | { mode: "fit"; width: number; height: number } | { mode: "exact"; width: number; height: number };

/** The output size for a resize choice. "fit" keeps the proportions within the box; it never enlarges. */
export function targetSize(width: number, height: number, resize: ResizeMode): { width: number; height: number } {
  const clamp = (n: number) => Math.max(1, Math.min(16384, Math.round(n)));
  switch (resize.mode) {
    case "percent":
      return { width: clamp((width * resize.percent) / 100), height: clamp((height * resize.percent) / 100) };
    case "fit": {
      const scale = Math.min(1, (resize.width || Infinity) / width, (resize.height || Infinity) / height);
      return { width: clamp(width * scale), height: clamp(height * scale) };
    }
    case "exact":
      return { width: clamp(resize.width || width), height: clamp(resize.height || height) };
    default:
      return { width, height };
  }
}
