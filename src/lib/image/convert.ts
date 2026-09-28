import { ProcessingError } from "../errors";
import { heifIccProfile, isHeif } from "../metadata/heif";
import { decodeImage, encodeBitmap } from "./canvas";
import { encodeBmp, encodeIco, encodeTiff, targetSize, type ResizeMode } from "./formats";
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

// ---------------------------------------------------------------------------- Convert Image

export type TargetFormat = "jpeg" | "png" | "webp" | "avif" | "bmp" | "tiff" | "ico";

export const TARGET_TYPES: Record<TargetFormat, { mime: string; extension: string; label: string }> = {
  jpeg: { mime: "image/jpeg", extension: ".jpg", label: "JPG" },
  png: { mime: "image/png", extension: ".png", label: "PNG" },
  webp: { mime: "image/webp", extension: ".webp", label: "WebP" },
  avif: { mime: "image/avif", extension: ".avif", label: "AVIF" },
  bmp: { mime: "image/bmp", extension: ".bmp", label: "BMP" },
  tiff: { mime: "image/tiff", extension: ".tiff", label: "TIFF" },
  ico: { mime: "image/x-icon", extension: ".ico", label: "ICO" },
};

/** Formats without transparency: the background shows through instead. */
export const OPAQUE_FORMATS = new Set<TargetFormat>(["jpeg", "bmp"]);
export const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

const encodable = new Map<string, Promise<boolean>>();
/** Whether this browser's canvas can write the format (WebP and AVIF vary by browser). */
export function canEncode(mime: string): Promise<boolean> {
  if (!encodable.has(mime)) {
    const canvas = new OffscreenCanvas(2, 2);
    // convertToBlob needs a rendering context.
    canvas.getContext("2d")?.fillRect(0, 0, 2, 2);
    encodable.set(
      mime,
      canvas
        .convertToBlob({ type: mime })
        .then((blob) => blob.type === mime)
        .catch(() => false),
    );
  }
  return encodable.get(mime)!;
}

export interface ConvertOptions {
  format: TargetFormat;
  /** 0-1, for JPG, WebP and AVIF. */
  quality: number;
  resize: ResizeMode;
  /** Fill behind transparent parts ("#rrggbb"); null keeps transparency where the format allows. */
  background: string | null;
  /** ICO only: the sizes to include. */
  iconSizes: number[];
}

const rgbOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", ""), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Decode any supported image (rotation applied), resize it, and write it in another format. */
export async function convertImageTo(bytes: Uint8Array, mimeType: string, options: ConvertOptions): Promise<ConvertedImage> {
  const { format } = options;
  const { mime } = TARGET_TYPES[format];
  if (["webp", "avif"].includes(format) && !(await canEncode(mime))) {
    throw new ProcessingError(`This browser can't write ${TARGET_TYPES[format].label} images. Try Chrome or Edge, or choose another format.`, "unsupported");
  }
  const bitmap = await decodeImage(bytes, mimeType);
  try {
    if (format === "ico") return await iconFrom(bitmap, options);
    const { width, height } = targetSize(bitmap.width, bitmap.height, options.resize);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: format === "bmp" || format === "tiff" });
    if (!ctx) throw new ProcessingError("Your browser couldn't create an image canvas.", "unsupported");
    const background = options.background ?? (OPAQUE_FORMATS.has(format) ? "#ffffff" : null);
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    let out: Uint8Array;
    if (format === "bmp" || format === "tiff") {
      const { data } = ctx.getImageData(0, 0, width, height);
      out = format === "bmp" ? encodeBmp(data, width, height, rgbOf(background ?? "#ffffff")) : encodeTiff(data, width, height);
    } else {
      const blob = await canvas.convertToBlob({ type: mime, quality: options.quality });
      out = new Uint8Array(await blob.arrayBuffer());
      // Keep the colour profile of HEIC photos, as HEIC to JPG does.
      const icc = (format === "jpeg" || format === "png") && isHeif(bytes) ? heifIccProfile(bytes) : null;
      if (icc) out = await withIccProfile(out, format as ImageFormat, icc);
    }
    return { bytes: out, width, height };
  } finally {
    bitmap.close();
  }
}

/** Square PNGs at each chosen size (the picture centred, transparent around it), in one .ico. */
async function iconFrom(bitmap: ImageBitmap, options: ConvertOptions): Promise<ConvertedImage> {
  const sizes = [...new Set(options.iconSizes)].filter((s) => ICON_SIZES.includes(s)).sort((a, b) => a - b);
  if (!sizes.length) throw new ProcessingError("Choose at least one icon size.", "unsupported");
  const images: { size: number; png: Uint8Array }[] = [];
  for (const size of sizes) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d")!;
    if (options.background) {
      ctx.fillStyle = options.background;
      ctx.fillRect(0, 0, size, size);
    }
    const scale = Math.min(size / bitmap.width, size / bitmap.height);
    const [w, h] = [bitmap.width * scale, bitmap.height * scale];
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
    images.push({ size, png: new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer()) });
  }
  const largest = sizes[sizes.length - 1];
  return { bytes: encodeIco(images), width: largest, height: largest };
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
