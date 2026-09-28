import { ascii, concat, startsWith, utf8 } from "./bytes";
import { readExif, technicalOnlyExif } from "./exif";
import { MetadataError, type MetadataEntry, type MetadataReport, type StripOptions } from "./types";
import { xmpEntries } from "./xmp";
import { msg } from "@/i18n/msg";

/*
 * HEIF container: HEIC (iPhone photos), HEIF and AVIF. The file is a tree of ISO-BMFF boxes; the
 * `meta` box lists items (the image, its tiles, a thumbnail, an Exif block, XMP…) and where each
 * item's bytes are, as absolute offsets. Moving bytes would mean rewriting every offset, so
 * stripping works in place: a metadata item's bytes are zeroed and its type is changed to one no
 * reader knows (readers must ignore unknown item types), and so are the references that tie it
 * to the image. The file keeps its size and the image data is untouched.
 */

const BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "mif2", "msf1", "avif", "avis", "heif"]);
/** Item and reference type given to removed items. Readers skip types they don't recognise. */
const NEUTRAL = "skip";
const METADATA_TYPES = new Set(["Exif", "mime", "uri "]);

interface Box {
  type: string;
  start: number;
  /** First byte after the header. */
  body: number;
  end: number;
}

interface Extent {
  start: number;
  length: number;
}

interface Item {
  id: number;
  type: string;
  /** Offset of the item_type four-character code in the `infe` box. */
  typeAt: number;
  contentType?: string;
  extents: Extent[];
}

interface Reference {
  type: string;
  typeAt: number;
  from: number;
  to: number[];
}

const corrupt = () => new MetadataError("This HEIF image's structure is damaged.", "corrupt");

function u32(bytes: Uint8Array, at: number) {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

export function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || !startsWith(bytes, "ftyp", 4)) return false;
  const size = Math.min(u32(bytes, 0), bytes.length);
  if (BRANDS.has(ascii(bytes, 8, 4))) return true;
  for (let at = 16; at + 4 <= size; at += 4) if (BRANDS.has(ascii(bytes, at, 4))) return true;
  return false;
}

/** AVIF rather than HEIC: the file's brands name AV1 and no HEVC. */
export function isAvif(bytes: Uint8Array): boolean {
  if (!isHeif(bytes)) return false;
  const size = Math.min(u32(bytes, 0), bytes.length);
  const brands = [ascii(bytes, 8, 4)];
  for (let at = 16; at + 4 <= size; at += 4) brands.push(ascii(bytes, at, 4));
  return brands.some((b) => b === "avif" || b === "avis") && !brands.some((b) => b.startsWith("hei") || b.startsWith("hev"));
}

function boxes(bytes: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let pos = from;
  while (pos + 8 <= to) {
    let size = u32(bytes, pos);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > to) throw corrupt();
      size = u32(bytes, pos + 8) * 2 ** 32 + u32(bytes, pos + 12);
      header = 16;
    } else if (size === 0) {
      size = to - pos;
    }
    if (size < header || pos + size > to) throw corrupt();
    out.push({ type: ascii(bytes, pos + 4, 4), start: pos, body: pos + header, end: pos + size });
    pos += size;
  }
  return out;
}

class Reader {
  constructor(
    private bytes: Uint8Array,
    public pos: number,
    private end: number,
  ) {}
  private need(n: number) {
    if (this.pos + n > this.end) throw corrupt();
  }
  u8() {
    this.need(1);
    return this.bytes[this.pos++];
  }
  u16() {
    this.need(2);
    const v = (this.bytes[this.pos] << 8) | this.bytes[this.pos + 1];
    this.pos += 2;
    return v;
  }
  u32() {
    this.need(4);
    const v = u32(this.bytes, this.pos);
    this.pos += 4;
    return v;
  }
  /** An unsigned integer of 0, 4 or 8 bytes (iloc field sizes). */
  uint(size: number) {
    if (size === 0) return 0;
    if (size === 4) return this.u32();
    if (size === 8) return this.u32() * 2 ** 32 + this.u32();
    throw corrupt();
  }
  string() {
    const zero = this.bytes.indexOf(0, this.pos);
    const stop = zero === -1 || zero >= this.end ? this.end : zero;
    const s = utf8.decode(this.bytes.subarray(this.pos, stop));
    this.pos = Math.min(this.end, stop + 1);
    return s;
  }
}

interface Parsed {
  items: Map<number, Item>;
  refs: Reference[];
  /** The colour profile property, if the image has one. */
  hasIcc: boolean;
}

function parse(bytes: Uint8Array): Parsed {
  if (!isHeif(bytes)) throw new MetadataError("Not a valid HEIF image.", "corrupt");
  const meta = boxes(bytes, 0, bytes.length).find((b) => b.type === "meta");
  if (!meta) throw new MetadataError("This HEIF file holds no still image.", "unsupported");
  // `meta` is a full box: version and flags come before its children.
  const children = boxes(bytes, meta.body + 4, meta.end);
  const find = (type: string) => children.find((b) => b.type === type);
  const items = new Map<number, Item>();

  const iinf = find("iinf");
  if (iinf) {
    const r = new Reader(bytes, iinf.body, iinf.end);
    const version = r.u8();
    r.pos += 3;
    if (version === 0) r.u16();
    else r.u32();
    for (const infe of boxes(bytes, r.pos, iinf.end)) {
      if (infe.type !== "infe") continue;
      const e = new Reader(bytes, infe.body, infe.end);
      const v = e.u8();
      e.pos += 3;
      if (v < 2) continue; // versions 0 and 1 predate item types and aren't used by HEIF
      const id = v === 2 ? e.u16() : e.u32();
      e.u16(); // protection index
      const typeAt = e.pos;
      const type = ascii(bytes, typeAt, 4);
      e.pos += 4;
      e.string(); // name
      items.set(id, { id, type, typeAt, contentType: type === "mime" ? e.string() : undefined, extents: [] });
    }
  }

  const idat = find("idat");
  const iloc = find("iloc");
  if (iloc) {
    const r = new Reader(bytes, iloc.body, iloc.end);
    const version = r.u8();
    r.pos += 3;
    const sizes = r.u8();
    const more = r.u8();
    const [offsetSize, lengthSize, baseSize] = [sizes >> 4, sizes & 15, more >> 4];
    const indexSize = version === 1 || version === 2 ? more & 15 : 0;
    const count = version < 2 ? r.u16() : r.u32();
    for (let i = 0; i < count; i++) {
      const id = version < 2 ? r.u16() : r.u32();
      const method = version === 1 || version === 2 ? r.u16() & 15 : 0;
      r.u16(); // data reference index
      const base = r.uint(baseSize);
      const extentCount = r.u16();
      const extents: Extent[] = [];
      for (let k = 0; k < extentCount; k++) {
        r.uint(indexSize);
        const offset = r.uint(offsetSize);
        const length = r.uint(lengthSize);
        // Method 0: offsets into the file; 1: into the idat box; 2: other items (no bytes of its own).
        if (method === 2 || (method === 1 && !idat)) continue;
        const start = (method === 1 ? idat!.body : 0) + base + offset;
        const len = length === 0 ? (method === 1 ? idat!.end : bytes.length) - start : length;
        if (start < 0 || start + len > bytes.length) throw corrupt();
        extents.push({ start, length: len });
      }
      const item = items.get(id);
      if (item) item.extents = extents;
    }
  }

  const refs: Reference[] = [];
  const iref = find("iref");
  if (iref) {
    const r = new Reader(bytes, iref.body, iref.end);
    const version = r.u8();
    r.pos += 3;
    for (const box of boxes(bytes, r.pos, iref.end)) {
      const e = new Reader(bytes, box.body, box.end);
      const from = version === 0 ? e.u16() : e.u32();
      const n = e.u16();
      const to = Array.from({ length: n }, () => (version === 0 ? e.u16() : e.u32()));
      refs.push({ type: box.type, typeAt: box.start + 4, from, to });
    }
  }

  let hasIcc = false;
  const ipco = find("iprp") && boxes(bytes, find("iprp")!.body, find("iprp")!.end).find((b) => b.type === "ipco");
  if (ipco) {
    hasIcc = boxes(bytes, ipco.body, ipco.end).some((b) => b.type === "colr" && ["prof", "rICC"].includes(ascii(bytes, b.body, 4)));
  }

  return { items, refs, hasIcc };
}

/**
 * The ICC colour profile stored with the image (a `colr` property of type "prof" or "rICC"), so
 * a converted copy can carry it: iPhone photos are Display P3 and look dull without it.
 */
export function heifIccProfile(bytes: Uint8Array): Uint8Array | null {
  try {
    const meta = boxes(bytes, 0, bytes.length).find((b) => b.type === "meta");
    const iprp = meta && boxes(bytes, meta.body + 4, meta.end).find((b) => b.type === "iprp");
    const ipco = iprp && boxes(bytes, iprp.body, iprp.end).find((b) => b.type === "ipco");
    const colr = ipco && boxes(bytes, ipco.body, ipco.end).find((b) => b.type === "colr" && ["prof", "rICC"].includes(ascii(bytes, b.body, 4)));
    return colr ? bytes.slice(colr.body + 4, colr.end) : null;
  } catch {
    return null;
  }
}

function itemData(bytes: Uint8Array, item: Item): Uint8Array {
  return concat(item.extents.map((e) => bytes.subarray(e.start, e.start + e.length)));
}

/** An Exif item is a 4-byte offset to the TIFF header, then (usually "Exif\0\0" and) the TIFF block. */
function exifTiff(data: Uint8Array): Uint8Array | null {
  if (data.length < 12) return null;
  const at = 4 + u32(data, 0);
  const isTiff = (i: number) => (startsWith(data, "II*\0", i) || startsWith(data, "MM\0*", i));
  if (at < data.length && isTiff(at)) return data.subarray(at);
  // Some writers get the offset wrong; look for the header nearby.
  for (let i = 4; i < Math.min(data.length - 4, 32); i++) if (isTiff(i)) return data.subarray(i);
  return null;
}

const thumbnailIds = (refs: Reference[]) => new Set(refs.filter((r) => r.type === "thmb").map((r) => r.from));

export async function auditHeif(bytes: Uint8Array): Promise<MetadataReport> {
  const { items, refs, hasIcc } = parse(bytes);
  const entries: MetadataEntry[] = [];
  let location: MetadataReport["location"];

  for (const item of items.values()) {
    if (item.type === "Exif") {
      const tiff = exifTiff(itemData(bytes, item));
      if (!tiff) {
        entries.push({ group: msg("EXIF"), key: "Exif", label: msg("Unreadable EXIF block"), value: msg`${itemData(bytes, item).length.toLocaleString()} bytes`, sensitivity: "medium" });
        continue;
      }
      const exif = await readExif(tiff);
      entries.push(...exif.entries);
      location ??= exif.location;
    } else if (item.type === "mime") {
      const data = itemData(bytes, item);
      const text = utf8.decode(data.subarray(0, 4096));
      if (item.contentType?.includes("rdf+xml") || text.includes("<x:xmpmeta") || text.includes("<rdf:RDF")) {
        const xmp = xmpEntries(utf8.decode(data));
        entries.push(...(xmp.length ? xmp : [{ group: msg("XMP"), key: "XMP", label: msg("XMP packet"), value: msg`${data.length.toLocaleString()} bytes`, sensitivity: "medium" as const }]));
      } else {
        entries.push({ group: msg("Other metadata"), key: item.contentType || "mime", label: msg`Embedded ${item.contentType || "data"}`, value: msg`${data.length.toLocaleString()} bytes`, sensitivity: "medium" });
      }
    } else if (item.type === "uri ") {
      entries.push({ group: msg("Other metadata"), key: "uri", label: msg("Embedded vendor data"), value: msg`${itemData(bytes, item).length.toLocaleString()} bytes`, sensitivity: "medium" });
    }
  }

  const thumbnails = thumbnailIds(refs).size;
  if (thumbnails) {
    entries.push({
      group: msg("Embedded thumbnail"),
      key: "thmb",
      label: msg("Thumbnail preview"),
      value: msg`${thumbnails === 1 ? "A small preview image" : `${thumbnails} small preview images`} — can show the original before cropping or edits`,
      sensitivity: "high",
    });
  }

  const kept = hasIcc ? [{ label: msg("Colour profile"), reason: msg("it's part of the image's colour information, needed to show its colours correctly") }] : [];
  return { format: "heif", entries, kept, location };
}

export async function stripHeif(bytes: Uint8Array, options: StripOptions): Promise<Uint8Array> {
  const { items, refs } = parse(bytes);
  const out = bytes.slice();
  const thumbnails = thumbnailIds(refs);
  const removed = new Set<number>();
  const retype = (at: number) => {
    for (let i = 0; i < 4; i++) out[at + i] = NEUTRAL.charCodeAt(i);
  };

  for (const item of items.values()) {
    if (!METADATA_TYPES.has(item.type) && !thumbnails.has(item.id)) continue;
    if (item.type === "Exif" && options.keepTechnical && item.extents.length === 1) {
      // Rewrite the block in place: offset 0, the technical-only TIFF, then zeros. Orientation
      // isn't kept: in HEIF the image's own rotation property is what readers follow.
      const tiff = exifTiff(itemData(bytes, item));
      const technical = tiff && technicalOnlyExif(tiff, false);
      const { start, length } = item.extents[0];
      if (technical && 4 + technical.length <= length) {
        out.fill(0, start, start + length);
        out.set(technical, start + 4);
        continue;
      }
    }
    for (const { start, length } of item.extents) out.fill(0, start, start + length);
    retype(item.typeAt);
    removed.add(item.id);
  }
  // "cdsc" (describes) and "thmb" (thumbnail of) references from removed items.
  for (const ref of refs) if (removed.has(ref.from)) retype(ref.typeAt);
  return out;
}
