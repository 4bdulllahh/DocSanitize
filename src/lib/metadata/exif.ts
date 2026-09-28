import exifr from "exifr";
import { latin1, utf8 } from "./bytes";
import { compact, entry } from "./classify";
import type { MetadataEntry, MetadataReport } from "./types";
import { msg } from "@/i18n/msg";

const GROUPS: Record<string, string> = {
  ifd0: msg("Image (EXIF)"),
  exif: msg("Camera (EXIF)"),
  gps: msg("GPS location"),
  interop: msg("EXIF interoperability"),
  iptc: msg("IPTC"),
};

const PARSE_OPTIONS: Parameters<typeof exifr.parse>[1] = {
  tiff: true, // includes IFD0
  ifd1: true,
  exif: true,
  gps: true,
  interop: true,
  iptc: true,
  // XMP, ICC and JFIF are read by our own container parsers.
  xmp: false,
  icc: false,
  jfif: false,
  ihdr: false,
  makerNote: true,
  userComment: true,
  translateKeys: true,
  translateValues: true,
  reviveValues: true,
  sanitize: true,
  mergeOutput: false,
};

export interface ExifReadout {
  entries: MetadataEntry[];
  location?: MetadataReport["location"];
  /** Raw EXIF orientation (1–8), if present. */
  orientation?: number;
}

/**
 * Decode EXIF/GPS/IPTC from either a whole JPEG or a bare TIFF block (PNG eXIf, WebP EXIF).
 * Never throws: an unreadable block is reported as such rather than hiding it.
 */
export async function readExif(input: Uint8Array): Promise<ExifReadout> {
  let output: Record<string, Record<string, unknown> | undefined> | undefined;
  try {
    output = await exifr.parse(input, PARSE_OPTIONS);
  } catch {
    return {
      entries: compact([entry(msg("EXIF"), "UnreadableExif", msg`${input.byteLength.toLocaleString()} bytes`, { label: msg("Unreadable EXIF block"), sensitivity: "medium" })]),
    };
  }
  if (!output) return { entries: [] };

  const entries: MetadataEntry[] = [];
  for (const [block, values] of Object.entries(output)) {
    if (!values || typeof values !== "object") continue;
    if (ArrayBuffer.isView(values) || Array.isArray(values)) {
      // exifr returns the user comment as its own block of raw bytes.
      const e = block.toLowerCase() === "usercomment" ? entry(msg("Camera (EXIF)"), "UserComment", userComment(values as ArrayLike<number>)) : entry(GROUPS[block] ?? block.toUpperCase(), block, values);
      if (e) entries.push(e);
      continue;
    }
    if (block === "ifd1") {
      // IFD1 describes the embedded thumbnail — report it once rather than tag by tag.
      const size = values.ThumbnailLength ?? values.JPEGInterchangeFormatLength;
      entries.push({
        group: msg("Embedded thumbnail"),
        key: "IFD1",
        label: msg("Thumbnail preview"),
        value: msg`Small preview image${typeof size === "number" ? ` (${size.toLocaleString()} bytes)` : ""} — can show the original before cropping or edits`,
        sensitivity: "high",
      });
      continue;
    }
    const group = GROUPS[block] ?? block.toUpperCase();
    for (const [key, value] of Object.entries(values)) {
      if (block === "gps" && (key === "latitude" || key === "longitude")) continue;
      const e = entry(group, key, value instanceof Date ? exifDate(value) : cameraValue(key, value));
      if (e) entries.push(e);
    }
  }

  const gps = output.gps;
  const latitude = gps?.latitude;
  const longitude = gps?.longitude;
  const location =
    typeof latitude === "number" && typeof longitude === "number" && isFinite(latitude) && isFinite(longitude)
      ? { latitude, longitude }
      : undefined;

  let orientation: number | undefined;
  try {
    orientation = (await exifr.orientation(input)) ?? undefined;
  } catch {
    orientation = undefined;
  }

  return { entries, location, orientation };
}

/**
 * EXIF dates have no time zone; exifr reads them as local time. Show them as written, rather than
 * converted to UTC as if the zone were known.
 */
function exifDate(date: Date): string {
  if (isNaN(date.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/** Camera settings as a camera shows them: 1/120 s, f/1.8, 6.86 mm. */
function cameraValue(key: string, value: unknown): unknown {
  if (typeof value !== "number" || !isFinite(value) || value <= 0) return value;
  const round = (n: number) => String(Math.round(n * 100) / 100);
  if (key === "ExposureTime") return value < 1 ? `1/${Math.round(1 / value)} s` : `${round(value)} s`;
  if (key === "FNumber") return `f/${round(value)}`;
  if (key === "FocalLength" || key === "FocalLengthIn35mmFormat") return `${round(value)} mm`;
  return value;
}

/** UserComment: an 8-byte character code ("ASCII", "UNICODE", "JIS" or blank), then the text. */
function userComment(raw: ArrayLike<number>): string {
  const bytes = Uint8Array.from(raw);
  const code = latin1.decode(bytes.subarray(0, 8)).replace(/\0+$/, "");
  const body = bytes.subarray(8);
  let text: string;
  if (code === "UNICODE") {
    // UTF-16 in the file's byte order, which isn't known here: pick the reading with fewer control characters.
    const readings = ["utf-16be", "utf-16le"].map((enc) => new TextDecoder(enc).decode(body));
    text = readings.sort((a, b) => controls(a) - controls(b))[0];
  } else {
    text = (code === "ASCII" ? latin1 : utf8).decode(code === "ASCII" || code === "" || code === "JIS" ? body : bytes);
  }
  return text.replace(/[\0\s]+$/, "").trim();
}

const controls = (s: string) => (s.match(/[\u0000-\u0008\u000e-\u001f\ufffd]/g) ?? []).length;

/** A minimal big-endian EXIF block containing only the Orientation tag. */
export function orientationOnlyExif(orientation: number): Uint8Array {
  const tiff = new Uint8Array(26);
  const view = new DataView(tiff.buffer);
  tiff.set([0x4d, 0x4d, 0x00, 0x2a]); // "MM", 42
  view.setUint32(4, 8); // IFD0 offset
  view.setUint16(8, 1); // one entry
  view.setUint16(10, 0x0112); // Orientation
  view.setUint16(12, 3); // SHORT
  view.setUint32(14, 1); // count
  view.setUint16(18, orientation);
  view.setUint32(22, 0); // no next IFD
  return tiff;
}

// ------------------------------------------------------------------ Technical-only EXIF

/**
 * Tags that describe how a photo was taken or should be displayed, and nothing about who, where,
 * when or with which device. "Keep technical data" rebuilds EXIF from these alone; anything not
 * listed (make, model, serial numbers, dates, software, GPS, maker notes, comments, thumbnails…)
 * is dropped. An allow-list, so an unknown tag is never kept by accident.
 */
const TECHNICAL_IFD0 = new Set([
  0x011a, // XResolution
  0x011b, // YResolution
  0x0128, // ResolutionUnit
  0x0213, // YCbCrPositioning
]);
const TECHNICAL_EXIF = new Set([
  0x829a, // ExposureTime
  0x829d, // FNumber
  0x8822, // ExposureProgram
  0x8827, // ISO
  0x8830, // SensitivityType
  0x8832, // RecommendedExposureIndex
  0x9000, // ExifVersion
  0x9101, // ComponentsConfiguration
  0x9201, // ShutterSpeedValue
  0x9202, // ApertureValue
  0x9203, // BrightnessValue
  0x9204, // ExposureBiasValue
  0x9205, // MaxApertureValue
  0x9206, // SubjectDistance
  0x9207, // MeteringMode
  0x9208, // LightSource
  0x9209, // Flash
  0x920a, // FocalLength
  0xa000, // FlashpixVersion
  0xa001, // ColorSpace
  0xa002, // PixelXDimension
  0xa003, // PixelYDimension
  0xa217, // SensingMethod
  0xa401, // CustomRendered
  0xa402, // ExposureMode
  0xa403, // WhiteBalance
  0xa404, // DigitalZoomRatio
  0xa405, // FocalLengthIn35mmFilm
  0xa406, // SceneCaptureType
  0xa407, // GainControl
  0xa408, // Contrast
  0xa409, // Saturation
  0xa40a, // Sharpness
  0xa40c, // SubjectDistanceRange
]);
const ORIENTATION = 0x0112;
const EXIF_POINTER = 0x8769;
const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

interface RawTag {
  tag: number;
  type: number;
  count: number;
  /** The value's bytes, in the file's byte order. */
  value: Uint8Array;
}

/** Read one IFD's tags (values copied raw). Returns null if the structure doesn't hold together. */
function readIfd(tiff: Uint8Array, view: DataView, offset: number, little: boolean): RawTag[] | null {
  if (offset < 8 || offset + 2 > tiff.length) return null;
  const count = view.getUint16(offset, little);
  if (offset + 2 + count * 12 > tiff.length) return null;
  const tags: RawTag[] = [];
  for (let i = 0; i < count; i++) {
    const at = offset + 2 + i * 12;
    const tag = view.getUint16(at, little);
    const type = view.getUint16(at + 2, little);
    const n = view.getUint32(at + 4, little);
    const size = (TYPE_SIZES[type] ?? 0) * n;
    if (!TYPE_SIZES[type] || size > tiff.length) continue;
    const start = size <= 4 ? at + 8 : view.getUint32(at + 8, little);
    if (start + size > tiff.length) continue;
    tags.push({ tag, type, count: n, value: tiff.slice(start, start + size) });
  }
  return tags;
}

/**
 * Rebuild a TIFF/EXIF block (as found in JPEG APP1 after "Exif\0\0", PNG eXIf, WebP EXIF or a
 * HEIF Exif item) with only the technical tags above, plus the orientation if asked to.
 * Returns null when nothing would be left, or when the block can't be parsed.
 */
export function technicalOnlyExif(tiff: Uint8Array, keepOrientation: boolean): Uint8Array | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return null;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const ifd0 = readIfd(tiff, view, view.getUint32(4, little), little);
  if (!ifd0) return null;
  const pointer = ifd0.find((t) => t.tag === EXIF_POINTER && t.value.length === 4);
  const exifIfd = pointer ? (readIfd(tiff, view, new DataView(pointer.value.buffer).getUint32(0, little), little) ?? []) : [];

  const keep0 = ifd0.filter((t) => TECHNICAL_IFD0.has(t.tag) || (keepOrientation && t.tag === ORIENTATION));
  const keepExif = exifIfd.filter((t) => TECHNICAL_EXIF.has(t.tag));
  if (keep0.length === 0 && keepExif.length === 0) return null;

  // Layout: header, IFD0, its values, Exif IFD, its values. Values are word-aligned.
  const ifdSize = (n: number) => 2 + n * 12 + 4;
  const extra = (tags: RawTag[]) => tags.reduce((n, t) => n + (t.value.length > 4 ? t.value.length + (t.value.length % 2) : 0), 0);
  const count0 = keep0.length + (keepExif.length ? 1 : 0);
  const exifStart = 8 + ifdSize(count0) + extra(keep0);
  const total = exifStart + (keepExif.length ? ifdSize(keepExif.length) + extra(keepExif) : 0);
  const out = new Uint8Array(total);
  const w = new DataView(out.buffer);
  out.set(tiff.subarray(0, 2));
  w.setUint16(2, 42, little);
  w.setUint32(4, 8, little);

  const writeIfd = (at: number, tags: RawTag[]) => {
    const sorted = [...tags].sort((a, b) => a.tag - b.tag);
    w.setUint16(at, sorted.length, little);
    let data = at + ifdSize(sorted.length);
    sorted.forEach((t, i) => {
      const e = at + 2 + i * 12;
      w.setUint16(e, t.tag, little);
      w.setUint16(e + 2, t.type, little);
      w.setUint32(e + 4, t.count, little);
      if (t.value.length <= 4) {
        out.set(t.value, e + 8);
      } else {
        w.setUint32(e + 8, data, little);
        out.set(t.value, data);
        data += t.value.length + (t.value.length % 2);
      }
    });
    w.setUint32(at + 2 + sorted.length * 12, 0, little); // no next IFD (so no thumbnail)
  };

  const pointerValue = new Uint8Array(4);
  new DataView(pointerValue.buffer).setUint32(0, exifStart, little);
  writeIfd(8, keepExif.length ? [...keep0, { tag: EXIF_POINTER, type: 4, count: 1, value: pointerValue }] : keep0);
  if (keepExif.length) writeIfd(exifStart, keepExif);
  return out;
}
