import { ascii, concat, startsWith, utf8 } from "./bytes";
import { readExif, technicalOnlyExif } from "./exif";
import { MetadataError, type MetadataEntry, type MetadataReport, type StripOptions } from "./types";
import { xmpEntries } from "./xmp";

const IMAGE_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);

// VP8X feature flags.
const FLAG_ICC = 0x20;
const FLAG_EXIF = 0x08;
const FLAG_XMP = 0x04;

interface Chunk {
  fourcc: string;
  start: number;
  data: Uint8Array;
  end: number;
}

export function isWebp(bytes: Uint8Array) {
  return startsWith(bytes, "RIFF") && startsWith(bytes, "WEBP", 8);
}

function parse(bytes: Uint8Array): Chunk[] {
  if (!isWebp(bytes)) throw new MetadataError("Not a valid WebP file.", "corrupt");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const size = view.getUint32(pos + 4, true);
    const end = pos + 8 + size + (size % 2); // chunks are padded to an even length
    if (pos + 8 + size > bytes.length) throw new MetadataError("WebP structure is damaged.", "corrupt");
    chunks.push({ fourcc: ascii(bytes, pos, 4), start: pos, data: bytes.subarray(pos + 8, pos + 8 + size), end: Math.min(end, bytes.length) });
    pos = end;
  }
  return chunks;
}

/** Whether the image is lossless or has transparency, so re-encoding it as JPEG would lose something. */
export function webpIsLosslessOrTransparent(bytes: Uint8Array): boolean {
  return parse(bytes).some((c) => c.fourcc === "VP8L" || c.fourcc === "ALPH");
}

/** EXIF chunks should hold a bare TIFF block, but some writers keep the JPEG "Exif\0\0" prefix. */
function tiffBlock(data: Uint8Array) {
  return startsWith(data, "Exif\0\0") ? data.subarray(6) : data;
}

export async function auditWebp(bytes: Uint8Array): Promise<MetadataReport> {
  const entries: MetadataEntry[] = [];
  let location: MetadataReport["location"];

  for (const { fourcc, data } of parse(bytes)) {
    if (fourcc === "EXIF") {
      const exif = await readExif(tiffBlock(data));
      entries.push(...exif.entries);
      location = exif.location;
    } else if (fourcc === "XMP ") {
      entries.push(...xmpEntries(utf8.decode(data)));
    } else if (fourcc === "ICCP") {
      entries.push({ group: "Color profile", key: "ICCP", label: "ICC color profile", value: "Embedded color profile (may name the device or editing software)", sensitivity: "low" });
    } else if (!IMAGE_CHUNKS.has(fourcc)) {
      entries.push({
        group: "Other chunks",
        key: fourcc.trim(),
        label: `${fourcc.trim()} chunk`,
        value: `${data.length.toLocaleString()} bytes of application data`,
        sensitivity: "medium",
      });
    }
  }
  return { format: "webp", entries, kept: [], location };
}

export async function stripWebp(bytes: Uint8Array, options: StripOptions): Promise<Uint8Array> {
  const keepIcc = options.keepColorProfile || options.keepTechnical;
  const chunks = parse(bytes);
  const exif = chunks.find((c) => c.fourcc === "EXIF");
  const technical = options.keepTechnical && exif ? technicalOnlyExif(tiffBlock(exif.data), true) : null;
  const parts: Uint8Array[] = [];
  for (const c of chunks) {
    if (IMAGE_CHUNKS.has(c.fourcc) || (keepIcc && c.fourcc === "ICCP")) {
      const chunk = bytes.slice(c.start, c.end);
      if (c.fourcc === "VP8X") {
        // Clear the flags for chunks we removed so decoders don't look for them.
        chunk[8] &= ~(FLAG_XMP | (technical ? 0 : FLAG_EXIF) | (keepIcc ? 0 : FLAG_ICC));
      }
      parts.push(chunk);
    } else if (c === exif && technical) {
      // EXIF must come after the image data in an extended WebP; it replaces the original in place.
      parts.push(riffChunk("EXIF", technical));
    }
  }
  const body = concat(parts);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 12));
  new DataView(header.buffer).setUint32(4, 4 + body.length, true);
  return concat([header, body]);
}

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(8 + data.length + (data.length % 2));
  for (let i = 0; i < 4; i++) chunk[i] = fourcc.charCodeAt(i);
  new DataView(chunk.buffer).setUint32(4, data.length, true);
  chunk.set(data, 8);
  return chunk;
}
