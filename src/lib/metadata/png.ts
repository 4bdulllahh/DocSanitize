import { ascii, concat, inflate, latin1, nullIndex, utf8 } from "./bytes";
import { entry } from "./classify";
import { readExif, technicalOnlyExif } from "./exif";
import { MetadataError, type MetadataEntry, type MetadataReport, type StripOptions } from "./types";
import { xmpEntries } from "./xmp";
import { msg } from "@/i18n/msg";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Chunks needed to render the image correctly (including APNG and HDR signalling). Everything else is dropped. */
const RENDERING_CHUNKS = new Set([
  "IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "bKGD", "hIST", "pHYs",
  "sPLT", "acTL", "fcTL", "fdAT", "cICP", "mDCv", "cLLi", "mDCV", "cLLI",
]);

interface Chunk {
  type: string;
  start: number;
  data: Uint8Array;
  end: number;
}

export function isPng(bytes: Uint8Array) {
  return SIGNATURE.every((b, i) => bytes[i] === b);
}

function parse(bytes: Uint8Array): Chunk[] {
  if (!isPng(bytes)) throw new MetadataError("Not a valid PNG file.", "corrupt");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const length = view.getUint32(pos);
    const end = pos + 12 + length;
    if (end > bytes.length) throw new MetadataError("PNG structure is damaged.", "corrupt");
    const type = ascii(bytes, pos + 4, 4);
    chunks.push({ type, start: pos, data: bytes.subarray(pos + 8, pos + 8 + length), end });
    pos = end;
    if (type === "IEND") break;
  }
  return chunks;
}

async function textChunk(chunk: Chunk): Promise<{ keyword: string; text: string } | null> {
  const { data, type } = chunk;
  const sep = nullIndex(data);
  if (sep <= 0) return null;
  const keyword = latin1.decode(data.subarray(0, sep));
  try {
    if (type === "tEXt") return { keyword, text: latin1.decode(data.subarray(sep + 1)) };
    if (type === "zTXt") return { keyword, text: latin1.decode(await inflate(data.subarray(sep + 2))) };
    // iTXt: keyword \0 compressed? method language \0 translated keyword \0 text
    const compressed = data[sep + 1] === 1;
    const langEnd = nullIndex(data, sep + 3);
    const translatedEnd = nullIndex(data, langEnd + 1);
    if (langEnd === -1 || translatedEnd === -1) return null;
    const body = data.subarray(translatedEnd + 1);
    return { keyword, text: utf8.decode(compressed ? await inflate(body) : body) };
  } catch {
    return { keyword, text: `${data.length.toLocaleString()} bytes (unreadable)` };
  }
}

export async function auditPng(bytes: Uint8Array): Promise<MetadataReport> {
  const entries: MetadataEntry[] = [];
  let location: MetadataReport["location"];

  for (const chunk of parse(bytes)) {
    const { type, data } = chunk;
    if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      const text = await textChunk(chunk);
      if (!text) continue;
      if (text.keyword === "XML:com.adobe.xmp") {
        entries.push(...xmpEntries(text.text));
      } else {
        const e = entry(msg("PNG text"), text.keyword, text.text);
        if (e) entries.push(e);
      }
    } else if (type === "eXIf") {
      const exif = await readExif(data);
      entries.push(...exif.entries);
      location ??= exif.location;
    } else if (type === "tIME") {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const date = new Date(Date.UTC(view.getUint16(0), data[2] - 1, data[3], data[4], data[5], data[6]));
      const e = entry(msg("PNG"), "tIME", date, { label: msg("Last modified") });
      if (e) entries.push(e);
    } else if (type === "iCCP") {
      const sep = nullIndex(data);
      const name = sep > 0 ? latin1.decode(data.subarray(0, sep)) : "unnamed";
      entries.push({ group: msg("Color profile"), key: "iCCP", label: msg("ICC color profile"), value: name, sensitivity: "low" });
    } else if (!RENDERING_CHUNKS.has(type)) {
      entries.push({
        group: msg("Other chunks"),
        key: type,
        label: msg`${type} chunk`,
        value: msg`${data.length.toLocaleString()} bytes of application data`,
        sensitivity: "medium",
      });
    }
  }

  return { format: "png", entries, kept: [], location };
}

export async function stripPng(bytes: Uint8Array, options: StripOptions): Promise<Uint8Array> {
  const keepIcc = options.keepColorProfile || options.keepTechnical;
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  // Chunks are copied verbatim (with their original CRCs); only whole chunks are removed,
  // except eXIf, which "keep technical data" rebuilds with its technical tags only.
  for (const c of parse(bytes)) {
    if (RENDERING_CHUNKS.has(c.type) || (keepIcc && c.type === "iCCP")) {
      parts.push(bytes.subarray(c.start, c.end));
    } else if (options.keepTechnical && c.type === "eXIf") {
      const tiff = technicalOnlyExif(c.data, true);
      if (tiff) parts.push(pngChunk("eXIf", tiff));
    }
  }
  return concat(parts);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) crc = CRC_TABLE[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
  view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}
