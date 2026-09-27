import { heifIccProfile, isHeif } from "../metadata/heif";
import { decodeImage, encodeBitmap } from "./canvas";
import { needsHeicDecoder } from "./heic";

/*
 * Image conversion on the page (HEIC decoding happens in the libheif add-on's worker; encoding
 * uses the browser's canvas codecs, which write no metadata). The only thing carried over from
 * the original is its colour profile, so colours don't shift.
 */

export type ImageFormat = "jpeg" | "png";

export interface ConvertedImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Decode any supported image (JPEG, PNG, WebP, HEIC, AVIF), rotation applied, and re-encode it. */
export async function convertImage(bytes: Uint8Array, mimeType: string, format: ImageFormat, quality = 0.92): Promise<ConvertedImage> {
  const bitmap = await decodeImage(bytes, mimeType);
  try {
    const encoded = await encodeBitmap(bitmap, bitmap.width, bitmap.height, format === "jpeg" ? "image/jpeg" : "image/png", quality);
    const icc = isHeif(bytes) ? heifIccProfile(bytes) : null;
    return { bytes: icc ? await withIccProfile(encoded, format, icc) : encoded, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** A blob an <img> can show: the file itself, or a JPEG copy for HEIC, which most browsers can't display. */
export async function displayableImage(file: Blob): Promise<Blob> {
  if (!needsHeicDecoder(new Uint8Array(await file.slice(0, 256).arrayBuffer()))) return file;
  const { bytes } = await convertImage(new Uint8Array(await file.arrayBuffer()), file.type, "jpeg", 0.9);
  return new Blob([bytes as BlobPart], { type: "image/jpeg" });
}

/** Any supported image as PNG or JPEG bytes (for pdf-lib, which embeds only those). */
export async function asPngOrJpeg(bytes: Uint8Array, mimeType: string): Promise<{ bytes: Uint8Array; format: ImageFormat }> {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (isPng) return { bytes, format: "png" };
  if (isJpeg) return { bytes, format: "jpeg" };
  return { bytes: (await convertImage(bytes, mimeType, "png")).bytes, format: "png" };
}

// ---------------------------------------------------------------------------- ICC embedding

const ICC_ID = "ICC_PROFILE\0";
const MAX_ICC_CHUNK = 65535 - 2 - ICC_ID.length - 2;

async function withIccProfile(image: Uint8Array, format: ImageFormat, icc: Uint8Array): Promise<Uint8Array> {
  return format === "jpeg" ? jpegWithIcc(image, icc) : pngWithIcc(image, icc);
}

/** Insert APP2 ICC_PROFILE segments right after SOI (and JFIF, if present). */
function jpegWithIcc(jpeg: Uint8Array, icc: Uint8Array): Uint8Array {
  const count = Math.ceil(icc.length / MAX_ICC_CHUNK);
  if (count > 255) return jpeg;
  const segments: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const chunk = icc.subarray(i * MAX_ICC_CHUNK, (i + 1) * MAX_ICC_CHUNK);
    const length = 2 + ICC_ID.length + 2 + chunk.length;
    const segment = new Uint8Array(2 + length);
    segment.set([0xff, 0xe2, length >> 8, length & 0xff]);
    for (let k = 0; k < ICC_ID.length; k++) segment[4 + k] = ICC_ID.charCodeAt(k);
    segment.set([i + 1, count], 4 + ICC_ID.length);
    segment.set(chunk, 6 + ICC_ID.length);
    segments.push(segment);
  }
  // Canvas JPEGs start with SOI then an APP0 JFIF segment.
  const afterJfif = jpeg[2] === 0xff && jpeg[3] === 0xe0 ? 4 + ((jpeg[4] << 8) | jpeg[5]) : 2;
  return join([jpeg.subarray(0, afterJfif), ...segments, jpeg.subarray(afterJfif)]);
}

/** Insert a zlib-compressed iCCP chunk right after IHDR. */
async function pngWithIcc(png: Uint8Array, icc: Uint8Array): Promise<Uint8Array> {
  const compressed = new Uint8Array(await new Response(new Blob([icc as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const name = "ICC Profile";
  const data = new Uint8Array(name.length + 2 + compressed.length);
  for (let k = 0; k < name.length; k++) data[k] = name.charCodeAt(k);
  data.set(compressed, name.length + 2); // name, NUL, compression method 0, profile
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set([0x69, 0x43, 0x43, 0x50], 4); // "iCCP"
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  const ihdrEnd = 8 + 12 + new DataView(png.buffer, png.byteOffset).getUint32(8);
  return join([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)]);
}

let crcTable: number[] | null = null;
function crc32(data: Uint8Array): number {
  crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
