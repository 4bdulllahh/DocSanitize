// Builders for test files that carry known metadata. Self-contained (relative imports only)
// so they can also be run directly with Node's TypeScript support to write fixture files.
import { crc32, deflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFString } from "@cantoo/pdf-lib";

const enc = new TextEncoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// TIFF / EXIF

type TiffTag =
  | { tag: number; type: "ascii"; value: string }
  | { tag: number; type: "short" | "long"; value: number[] }
  | { tag: number; type: "rational"; value: [number, number][] };

const TYPE_CODE = { ascii: 2, short: 3, long: 4, rational: 5 } as const;

function tagBytes(t: TiffTag): { count: number; data: Uint8Array } {
  if (t.type === "ascii") return { count: t.value.length + 1, data: concat([enc.encode(t.value), new Uint8Array([0])]) };
  const size = t.type === "short" ? 2 : t.type === "long" ? 4 : 8;
  const values = t.value as (number | [number, number])[];
  const data = new Uint8Array(values.length * size);
  const view = new DataView(data.buffer);
  values.forEach((v, i) => {
    if (t.type === "short") view.setUint16(i * 2, v as number);
    else if (t.type === "long") view.setUint32(i * 4, v as number);
    else {
      view.setUint32(i * 8, (v as [number, number])[0]);
      view.setUint32(i * 8 + 4, (v as [number, number])[1]);
    }
  });
  return { count: values.length, data };
}

/** Write one IFD at `offset`; out-of-line values go right after it. Returns the end offset. */
function writeIfd(buf: Uint8Array, offset: number, tags: TiffTag[]): number {
  const view = new DataView(buf.buffer, buf.byteOffset);
  const sorted = [...tags].sort((a, b) => a.tag - b.tag);
  view.setUint16(offset, sorted.length);
  let data = offset + 2 + sorted.length * 12 + 4;
  sorted.forEach((t, i) => {
    const e = offset + 2 + i * 12;
    const { count, data: bytes } = tagBytes(t);
    view.setUint16(e, t.tag);
    view.setUint16(e + 2, TYPE_CODE[t.type]);
    view.setUint32(e + 4, count);
    if (bytes.length <= 4) buf.set(bytes, e + 8);
    else {
      view.setUint32(e + 8, data);
      buf.set(bytes, data);
      data += bytes.length + (bytes.length % 2);
    }
  });
  view.setUint32(offset + 2 + sorted.length * 12, 0);
  return data;
}

function ifdSize(tags: TiffTag[]): number {
  return tags.reduce((n, t) => {
    const len = tagBytes(t).data.length;
    return n + (len > 4 ? len + (len % 2) : 0);
  }, 2 + tags.length * 12 + 4);
}

export interface ExifSpec {
  artist?: string;
  make?: string;
  model?: string;
  serial?: string;
  orientation?: number;
  gps?: { lat: number; lon: number };
}

const dms = (deg: number): [number, number][] => {
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = Math.round(((a - d) * 60 - m) * 60 * 100);
  return [[d, 1], [m, 1], [s, 100]];
};

/** A big-endian TIFF block with IFD0, an optional EXIF IFD (serial) and an optional GPS IFD. */
export function buildExif(spec: ExifSpec): Uint8Array {
  const ifd0: TiffTag[] = [];
  if (spec.make) ifd0.push({ tag: 0x010f, type: "ascii", value: spec.make });
  if (spec.model) ifd0.push({ tag: 0x0110, type: "ascii", value: spec.model });
  if (spec.orientation) ifd0.push({ tag: 0x0112, type: "short", value: [spec.orientation] });
  if (spec.artist) ifd0.push({ tag: 0x013b, type: "ascii", value: spec.artist });
  const exifIfd: TiffTag[] = spec.serial ? [{ tag: 0xa431, type: "ascii", value: spec.serial }] : [];
  const gpsIfd: TiffTag[] = spec.gps
    ? [
        { tag: 0x0001, type: "ascii", value: spec.gps.lat >= 0 ? "N" : "S" },
        { tag: 0x0002, type: "rational", value: dms(spec.gps.lat) },
        { tag: 0x0003, type: "ascii", value: spec.gps.lon >= 0 ? "E" : "W" },
        { tag: 0x0004, type: "rational", value: dms(spec.gps.lon) },
      ]
    : [];
  // Pointer tags are added with placeholder offsets first so IFD0's size is final.
  if (exifIfd.length) ifd0.push({ tag: 0x8769, type: "long", value: [0] });
  if (gpsIfd.length) ifd0.push({ tag: 0x8825, type: "long", value: [0] });

  const ifd0At = 8;
  const exifAt = ifd0At + ifdSize(ifd0);
  const gpsAt = exifAt + (exifIfd.length ? ifdSize(exifIfd) : 0);
  const total = gpsAt + (gpsIfd.length ? ifdSize(gpsIfd) : 0);
  for (const t of ifd0) {
    if (t.tag === 0x8769 && t.type === "long") t.value = [exifAt];
    if (t.tag === 0x8825 && t.type === "long") t.value = [gpsAt];
  }

  const buf = new Uint8Array(total);
  buf.set([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]);
  writeIfd(buf, ifd0At, ifd0);
  if (exifIfd.length) writeIfd(buf, exifAt, exifIfd);
  if (gpsIfd.length) writeIfd(buf, gpsAt, gpsIfd);
  return buf;
}

export const SAMPLE_XMP = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"
  xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
  xmp:CreatorTool="Adobe Photoshop 26.1 (Macintosh)" photoshop:City="Dubai">
  <dc:creator><rdf:Seq><rdf:li>Jane Doe</rdf:li></rdf:Seq></dc:creator>
  <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Q3 &amp; Q4 plan</rdf:li></rdf:Alt></dc:title>
  <xmpMM:DocumentID>xmp.did:8f2a61c4-0000-4b4b-9d3e-1c2f3a4b5c6d</xmpMM:DocumentID>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;

// ---------------------------------------------------------------------------------------------
// JPEG

/**
 * A valid 1×1 grey baseline JPEG, assembled segment by segment. Both Huffman tables hold a single
 * 1-bit code, so the only 8×8 block (DC diff 0, then EOB) encodes as bits "00" -> 0x3F with padding.
 */
export const TINY_JPEG = concat([
  new Uint8Array([0xff, 0xd8]),
  segment(0xe0, concat([enc.encode("JFIF\0"), new Uint8Array([1, 1, 0, 0, 1, 0, 1, 0, 0])])),
  segment(0xdb, concat([new Uint8Array([0]), new Uint8Array(64).fill(1)])),
  segment(0xc0, new Uint8Array([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
  segment(0xc4, concat([new Uint8Array([0x00, 1]), new Uint8Array(15), new Uint8Array([0])])),
  segment(0xc4, concat([new Uint8Array([0x10, 1]), new Uint8Array(15), new Uint8Array([0])])),
  segment(0xda, new Uint8Array([1, 1, 0, 0, 63, 0])),
  new Uint8Array([0x3f, 0xff, 0xd9]),
]);

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const len = payload.length + 2;
  return concat([new Uint8Array([0xff, marker, len >> 8, len & 0xff]), payload]);
}

export interface JpegSpec {
  exif?: ExifSpec;
  xmp?: string;
  comment?: string;
  icc?: boolean;
  trailer?: Uint8Array;
}

/** Insert metadata segments into an existing JPEG right after SOI/JFIF. */
export function addJpegMetadata(jpeg: Uint8Array, spec: JpegSpec): Uint8Array {
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] << 8) | jpeg[5]);
  const parts: Uint8Array[] = [];
  if (spec.exif) parts.push(segment(0xe1, concat([enc.encode("Exif\0\0"), buildExif(spec.exif)])));
  if (spec.xmp) parts.push(segment(0xe1, concat([enc.encode("http://ns.adobe.com/xap/1.0/\0"), enc.encode(spec.xmp)])));
  if (spec.icc) parts.push(segment(0xe2, concat([enc.encode("ICC_PROFILE\0"), new Uint8Array([1, 1]), new Uint8Array(64)])));
  if (spec.comment) parts.push(segment(0xfe, enc.encode(spec.comment)));
  return concat([jpeg.subarray(0, at), ...parts, jpeg.subarray(at), spec.trailer ?? new Uint8Array(0)]);
}

// ---------------------------------------------------------------------------------------------
// PNG

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, data.length);
  head.set(enc.encode(type), 4);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(concat([enc.encode(type), data])));
  return concat([head, data, crc]);
}

export function tinyPng(): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, 1);
  v.setUint32(4, 1);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 0x26, 0x3a, 0x81]))),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

export interface PngSpec {
  text?: Record<string, string>;
  compressedText?: Record<string, string>;
  xmp?: string;
  exif?: ExifSpec;
  time?: Date;
  icc?: boolean;
  privateChunk?: boolean;
}

/** Insert metadata chunks after IHDR. */
export function addPngMetadata(png: Uint8Array, spec: PngSpec): Uint8Array {
  const ihdrEnd = 8 + 12 + new DataView(png.buffer, png.byteOffset).getUint32(8);
  const chunks: Uint8Array[] = [];
  for (const [k, t] of Object.entries(spec.text ?? {})) chunks.push(pngChunk("tEXt", enc.encode(`${k}\0${t}`)));
  for (const [k, t] of Object.entries(spec.compressedText ?? {})) {
    chunks.push(pngChunk("zTXt", concat([enc.encode(`${k}\0`), new Uint8Array([0]), deflateSync(Buffer.from(t))])));
  }
  if (spec.xmp) chunks.push(pngChunk("iTXt", concat([enc.encode("XML:com.adobe.xmp\0"), new Uint8Array([0, 0]), enc.encode("\0\0"), enc.encode(spec.xmp)])));
  if (spec.exif) chunks.push(pngChunk("eXIf", buildExif(spec.exif)));
  if (spec.time) {
    const t = new Uint8Array(7);
    const d = spec.time;
    new DataView(t.buffer).setUint16(0, d.getUTCFullYear());
    t.set([d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()], 2);
    chunks.push(pngChunk("tIME", t));
  }
  if (spec.icc) chunks.push(pngChunk("iCCP", concat([enc.encode("Display P3\0"), new Uint8Array([0]), deflateSync(Buffer.alloc(32))])));
  if (spec.privateChunk) chunks.push(pngChunk("iDOT", new Uint8Array(28)));
  return concat([png.subarray(0, ihdrEnd), ...chunks, png.subarray(ihdrEnd)]);
}

// ---------------------------------------------------------------------------------------------
// WebP

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  head.set(enc.encode(fourcc));
  new DataView(head.buffer).setUint32(4, data.length, true);
  return concat([head, data, data.length % 2 ? new Uint8Array(1) : new Uint8Array(0)]);
}

/** A structurally valid WebP container around placeholder VP8L data (not decodable). */
export function tinyWebp(): Uint8Array {
  return wrapRiff([riffChunk("VP8L", new Uint8Array([0x2f, 0, 0, 0, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07]))]);
}

function wrapRiff(chunks: Uint8Array[]): Uint8Array {
  const body = concat([enc.encode("WEBP"), ...chunks]);
  const head = new Uint8Array(8);
  head.set(enc.encode("RIFF"));
  new DataView(head.buffer).setUint32(4, body.length, true);
  return concat([head, body]);
}

/** Convert a simple WebP to the extended format and add EXIF/XMP/ICC chunks. */
export function addWebpMetadata(webp: Uint8Array, spec: { exif?: ExifSpec; xmp?: string; icc?: boolean; width: number; height: number }): Uint8Array {
  // An already-extended file (e.g. with alpha) keeps its VP8X flags; the chunk itself is rebuilt.
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  const extended = new TextDecoder().decode(webp.subarray(12, 16)) === "VP8X";
  const existingFlags = extended ? webp[20] : 0;
  const image = extended ? webp.subarray(12 + 8 + view.getUint32(16, true)) : webp.subarray(12);
  const vp8x = new Uint8Array(10);
  vp8x[0] = existingFlags | (spec.icc ? 0x20 : 0) | (spec.exif ? 0x08 : 0) | (spec.xmp ? 0x04 : 0);
  const w = spec.width - 1;
  const h = spec.height - 1;
  vp8x.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 4);
  const chunks = [riffChunk("VP8X", vp8x)];
  if (spec.icc) chunks.push(riffChunk("ICCP", new Uint8Array(64)));
  chunks.push(image);
  if (spec.exif) chunks.push(riffChunk("EXIF", buildExif(spec.exif)));
  if (spec.xmp) chunks.push(riffChunk("XMP ", enc.encode(spec.xmp)));
  return wrapRiff(chunks);
}

// ---------------------------------------------------------------------------------------------
// PDF

/** A PDF with Info, XMP, a commented annotation, an attachment, JavaScript, a geotagged photo and a second revision. */
export async function leakyPdf(photo: Uint8Array = addJpegMetadata(TINY_JPEG, { exif: { artist: "Jane Doe", gps: { lat: 25.2048, lon: 55.2708 } } })): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle("Confidential merger memo");
  doc.setAuthor("Jane Doe");
  doc.setSubject("Project Falcon");
  doc.setKeywords(["merger", "draft"]);
  doc.setCreator("Microsoft Word for Microsoft 365");
  doc.setProducer("Acrobat Distiller 24.0");
  doc.setCreationDate(new Date("2026-01-15T09:30:00Z"));
  doc.setModificationDate(new Date("2026-02-01T12:00:00Z"));

  const page = doc.addPage([400, 300]);
  const image = await doc.embedJpg(photo);
  page.drawImage(image, { x: 50, y: 50, width: 100, height: 100 });

  const annot = doc.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [10, 10, 30, 30],
    Contents: PDFString.of("Please remove the pricing section"),
    T: PDFString.of("Bob Reviewer"),
    M: PDFString.of("D:20260120101500Z"),
  });
  page.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(annot)]));

  const xmp = doc.context.stream(SAMPLE_XMP, { Type: "Metadata", Subtype: "XML" });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(xmp));

  await doc.attach(enc.encode("salary,name\n100,Jane"), "salaries.csv", { mimeType: "text/csv" });
  doc.addJavaScript("hello", "app.alert('hi');");

  const first = await doc.save({ useObjectStreams: false });

  // Second revision appended as an incremental update, as Acrobat does on "Save".
  const again = await PDFDocument.load(first, { forIncrementalUpdate: true, updateMetadata: false });
  again.setTitle("Merger memo (final)");
  return again.save();
}
