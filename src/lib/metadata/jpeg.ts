import { ascii, concat, latin1, nullIndex, startsWith, utf8 } from "./bytes";
import { compact, entry } from "./classify";
import { orientationOnlyExif, readExif } from "./exif";
import { MetadataError, type MetadataEntry, type MetadataReport, type StripOptions } from "./types";
import { xmpEntries } from "./xmp";

const EXIF_ID = "Exif\0\0";
const XMP_ID = "http://ns.adobe.com/xap/1.0/\0";
const XMP_EXT_ID = "http://ns.adobe.com/xmp/extension/\0";
const ICC_ID = "ICC_PROFILE\0";

interface Segment {
  marker: number;
  /** Offset of the 0xFF marker byte. */
  start: number;
  /** Payload (after the 2-byte length), exclusive end. */
  dataStart: number;
  end: number;
}

interface ParsedJpeg {
  segments: Segment[];
  /** Offset of the SOS marker; everything from here to `eoiEnd` is image data. */
  scanStart: number;
  /** Offset just past the EOI marker. */
  eoiEnd: number;
}

const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP14 = 0xee;
const COM = 0xfe;
const SOS = 0xda;
const EOI = 0xd9;

export function isJpeg(bytes: Uint8Array) {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function parse(bytes: Uint8Array): ParsedJpeg {
  if (!isJpeg(bytes)) throw new MetadataError("Not a valid JPEG file.", "corrupt");
  const segments: Segment[] = [];
  let pos = 2;
  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) throw new MetadataError("JPEG structure is damaged.", "corrupt");
    // Skip fill bytes.
    while (bytes[pos + 1] === 0xff) pos++;
    const marker = bytes[pos + 1];
    const start = pos;
    if (marker === SOS) return { segments, scanStart: start, eoiEnd: findEoi(bytes, start) };
    if (marker === EOI) return { segments, scanStart: start, eoiEnd: start + 2 };
    // Markers without a length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    const length = (bytes[pos + 2] << 8) | bytes[pos + 3];
    const end = pos + 2 + length;
    if (length < 2 || end > bytes.length) throw new MetadataError("JPEG structure is damaged.", "corrupt");
    segments.push({ marker, start, dataStart: pos + 4, end });
    pos = end;
  }
  throw new MetadataError("JPEG has no image data.", "corrupt");
}

/** Find the end of the entropy-coded data. 0xFF inside scan data is always followed by 0x00 or RSTn. */
function findEoi(bytes: Uint8Array, from: number): number {
  for (let i = from + 2; i < bytes.length - 1; i++) {
    if (bytes[i] !== 0xff) continue;
    const next = bytes[i + 1];
    if (next === EOI) return i + 2;
  }
  // Truncated file: treat everything as image data.
  return bytes.length;
}

const payload = (bytes: Uint8Array, s: Segment) => bytes.subarray(s.dataStart, s.end);

/** The ASCII identifier at the start of an APPn payload, e.g. "Exif", "Ducky". */
function identifier(data: Uint8Array): string {
  const end = nullIndex(data);
  const raw = ascii(data, 0, Math.min(end === -1 ? data.length : end, 32));
  return /^[\x20-\x7e]+$/.test(raw) ? raw : "";
}

export async function auditJpeg(bytes: Uint8Array): Promise<MetadataReport> {
  const { segments, eoiEnd } = parse(bytes);
  const entries: MetadataEntry[] = [];
  const extendedXmp: Uint8Array[] = [];
  let hasExif = false;
  let hasIcc = false;

  for (const s of segments) {
    const data = payload(bytes, s);
    if (s.marker === APP1 && startsWith(data, EXIF_ID)) {
      hasExif = true;
    } else if (s.marker === APP1 && startsWith(data, XMP_ID)) {
      entries.push(...xmpEntries(utf8.decode(data.subarray(XMP_ID.length))));
    } else if (s.marker === APP1 && startsWith(data, XMP_EXT_ID)) {
      // GUID (32) + full length (4) + offset (4) precede each chunk.
      extendedXmp.push(data.subarray(XMP_EXT_ID.length + 40));
    } else if (s.marker === APP2 && startsWith(data, ICC_ID)) {
      hasIcc = true;
    } else if (s.marker === APP2 && startsWith(data, "MPF\0")) {
      entries.push({ group: "Hidden content", key: "MPF", label: "Multi-picture data", value: "Index of extra images stored after the main photo (depth maps, HDR gain maps, bursts)", sensitivity: "medium" });
    } else if (s.marker === APP0 && startsWith(data, "JFXX\0")) {
      entries.push({ group: "Embedded thumbnail", key: "JFXX", label: "JFIF thumbnail", value: `${data.length.toLocaleString()} bytes`, sensitivity: "high" });
    } else if (s.marker === COM) {
      const e = entry("Comments", "Comment", latin1.decode(data), { sensitivity: "medium" });
      if (e) entries.push(e);
    } else if (s.marker >= APP0 && s.marker <= 0xef && s.marker !== APP14 && !(s.marker === APP0 && startsWith(data, "JFIF\0"))) {
      // Any other application segment (Photoshop/IPTC is decoded by exifr below; others are opaque).
      const id = identifier(data);
      if (s.marker === 0xed && id.startsWith("Photoshop")) continue;
      entries.push({
        group: "Other segments",
        key: `APP${s.marker - APP0}`,
        label: `APP${s.marker - APP0} segment${id ? ` (${id})` : ""}`,
        value: `${data.length.toLocaleString()} bytes of vendor data`,
        sensitivity: "medium",
      });
    }
  }

  if (extendedXmp.length) entries.push(...xmpEntries(utf8.decode(concat(extendedXmp)), "XMP (extended)"));

  const exif = hasExif || segments.some((s) => s.marker === 0xed) ? await readExif(bytes) : { entries: [] };
  // Orientation is reported under `kept` instead: it survives stripping on purpose.
  entries.unshift(...exif.entries.filter((e) => e.key !== "Orientation"));

  if (hasIcc) {
    entries.push({ group: "Color profile", key: "ICC_PROFILE", label: "ICC color profile", value: "Embedded color profile (may name the device or editing software)", sensitivity: "low" });
  }

  const trailing = bytes.length - eoiEnd;
  if (trailing > 16) {
    entries.push({
      group: "Hidden content",
      key: "Trailer",
      label: "Data after end of image",
      value: `${trailing.toLocaleString()} bytes appended after the photo — often a motion-photo video or extra images`,
      sensitivity: "high",
    });
  }

  const kept = compact([
    exif.orientation && exif.orientation !== 1
      ? { label: "Orientation", reason: "Keeps the photo displaying the right way up" }
      : null,
  ]);

  return { format: "jpeg", entries, kept, location: exif.location };
}

/**
 * Remove every metadata segment. The EXIF orientation is re-inserted on its own unless
 * `keepOrientation` is false (for callers that apply the rotation themselves, e.g. PDF embedding).
 */
export async function stripJpeg(bytes: Uint8Array, options: StripOptions, keepOrientation = true): Promise<Uint8Array> {
  const { segments, scanStart, eoiEnd } = parse(bytes);
  const { orientation } =
    keepOrientation && segments.some((s) => s.marker === APP1) ? await readExif(bytes) : { orientation: undefined };

  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  let insertedOrientation = false;
  const insertOrientation = () => {
    if (insertedOrientation || !orientation || orientation === 1) return;
    insertedOrientation = true;
    const tiff = orientationOnlyExif(orientation);
    const length = 2 + EXIF_ID.length + tiff.length;
    const header = new Uint8Array([0xff, APP1, length >> 8, length & 0xff, ...Array.from(EXIF_ID, (c) => c.charCodeAt(0))]);
    parts.push(header, tiff);
  };

  for (const s of segments) {
    const data = payload(bytes, s);
    const isApp = s.marker >= APP0 && s.marker <= 0xef;
    const keep =
      !isApp && s.marker !== COM
        ? true // DQT, SOF, DHT, DRI, … — required to decode the image
        : (s.marker === APP0 && startsWith(data, "JFIF\0")) ||
          s.marker === APP14 || // Adobe: colour transform flag, needed for CMYK decoding
          (options.keepColorProfile && s.marker === APP2 && startsWith(data, ICC_ID));
    // EXIF (with orientation) goes after JFIF, before the tables.
    if (!(s.marker === APP0 && keep)) insertOrientation();
    if (keep) parts.push(bytes.subarray(s.start, s.end));
  }
  insertOrientation();
  parts.push(bytes.subarray(scanStart, eoiEnd));
  return concat(parts);
}
