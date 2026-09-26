import exifr from "exifr";
import { compact, entry } from "./classify";
import type { MetadataEntry, MetadataReport } from "./types";

const GROUPS: Record<string, string> = {
  ifd0: "Image (EXIF)",
  exif: "Camera (EXIF)",
  gps: "GPS location",
  interop: "EXIF interoperability",
  iptc: "IPTC",
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
      entries: compact([entry("EXIF", "UnreadableExif", `${input.byteLength.toLocaleString()} bytes`, { label: "Unreadable EXIF block", sensitivity: "medium" })]),
    };
  }
  if (!output) return { entries: [] };

  const entries: MetadataEntry[] = [];
  for (const [block, values] of Object.entries(output)) {
    if (!values || typeof values !== "object") continue;
    if (block === "ifd1") {
      // IFD1 describes the embedded thumbnail — report it once rather than tag by tag.
      const size = values.ThumbnailLength ?? values.JPEGInterchangeFormatLength;
      entries.push({
        group: "Embedded thumbnail",
        key: "IFD1",
        label: "Thumbnail preview",
        value: `Small preview image${typeof size === "number" ? ` (${size.toLocaleString()} bytes)` : ""} — can show the original before cropping or edits`,
        sensitivity: "high",
      });
      continue;
    }
    const group = GROUPS[block] ?? block.toUpperCase();
    for (const [key, value] of Object.entries(values)) {
      if (block === "gps" && (key === "latitude" || key === "longitude")) continue;
      const e = entry(group, key, value);
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
