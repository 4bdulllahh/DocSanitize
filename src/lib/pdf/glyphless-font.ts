import { PDFString, type PDFDocument, type PDFRef } from "@cantoo/pdf-lib";

/*
 * A font with no visible glyphs, for invisible OCR text (the approach of Tesseract's own PDF
 * renderer). Every character code is two bytes (Identity-H) holding a UTF-16 code unit; all codes
 * draw the same empty glyph, half an em wide, and the ToUnicode map gives each code back as that
 * code unit. So text in any script can be searched and copied without embedding real fonts.
 */

const UNITS_PER_EM = 1000;
const ADVANCE = 500;
const ASCENT = 800;
const DESCENT = -200;

/** Width of every character, as a fraction of the font size. */
export const GLYPHLESS_ADVANCE = ADVANCE / UNITS_PER_EM;
/** Ascent and descent (fractions of the size) readers use for selection boxes. */
export const GLYPHLESS_ASCENT = ASCENT / UNITS_PER_EM;

class Writer {
  bytes: number[] = [];
  u16(...values: number[]) {
    for (const v of values) this.bytes.push((v >> 8) & 255, v & 255);
    return this;
  }
  u32(...values: number[]) {
    for (const v of values) this.u16((v >>> 16) & 0xffff, v & 0xffff);
    return this;
  }
  zeros(n: number) {
    for (let i = 0; i < n; i++) this.bytes.push(0);
    return this;
  }
}

const checksum = (data: number[]) => {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum = (sum + (((data[i] << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0)) >>> 0)) >>> 0;
  return sum;
};

/** A minimal TrueType font: .notdef and one empty glyph, both ADVANCE wide. */
export function glyphlessTrueType(): Uint8Array {
  const glyphs = 2;
  const name = new Writer();
  const family = Array.from("GlyphLessFont", (ch) => ch.charCodeAt(0));
  const records = [1, 4, 6];
  name.u16(0, records.length, 6 + records.length * 12);
  for (const id of records) name.u16(3, 1, 0x409, id, family.length * 2, 0);
  name.u16(...family);

  const tables: Record<string, number[]> = {
    // Format 4 with only the required final segment: no character maps to a glyph (the PDF's
    // CIDToGIDMap does that).
    cmap: new Writer().u16(0, 1).u16(3, 1).u32(12).u16(4, 24, 0, 2, 2, 0, 0, 0xffff, 0, 0xffff, 1, 0).bytes,
    // Both glyphs are empty (all loca offsets 0); readers reject a zero-length table, so pad it.
    glyf: [0, 0, 0, 0],
    head: new Writer()
      .u32(0x00010000, 0x00010000, 0, 0x5f0f3cf5)
      .u16(0b1011, UNITS_PER_EM)
      .zeros(16) // created, modified: none
      .u16(0, DESCENT & 0xffff, ADVANCE, ASCENT, 0, 3, 2, 0, 0).bytes,
    hhea: new Writer().u32(0x00010000).u16(ASCENT, DESCENT & 0xffff, 0, ADVANCE, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, glyphs).bytes,
    hmtx: new Writer().u16(ADVANCE, 0, ADVANCE, 0).bytes,
    loca: new Writer().u16(...new Array(glyphs + 1).fill(0)).bytes,
    maxp: new Writer().u32(0x00010000).u16(glyphs, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0).bytes,
    name: name.bytes,
    post: new Writer().u32(0x00030000, 0).u16(-100 & 0xffff, 50).u32(1, 0, 0, 0, 0).bytes,
  };

  const tags = Object.keys(tables).sort();
  const power = 2 ** Math.floor(Math.log2(tags.length));
  const font = new Writer().u32(0x00010000).u16(tags.length, power * 16, Math.log2(power), tags.length * 16 - power * 16);
  let offset = 12 + tags.length * 16;
  const body: number[] = [];
  let headOffset = 0;
  for (const tag of tags) {
    const data = tables[tag];
    if (tag === "head") headOffset = offset;
    font.u16(tag.charCodeAt(0) << 8 | tag.charCodeAt(1), tag.charCodeAt(2) << 8 | tag.charCodeAt(3)).u32(checksum(data), offset, data.length);
    const padded = [...data, ...new Array((4 - (data.length % 4)) % 4).fill(0)];
    body.push(...padded);
    offset += padded.length;
  }
  const bytes = new Uint8Array([...font.bytes, ...body]);
  const adjustment = (0xb1b0afba - checksum([...bytes])) >>> 0;
  new DataView(bytes.buffer).setUint32(headOffset + 8, adjustment);
  return bytes;
}

/** ToUnicode CMap: each two-byte code is the UTF-16 code unit it maps to. */
function identityToUnicode(): string {
  // bfrange destinations may only vary in their last byte, so one range per high byte.
  const ranges: string[] = [];
  for (let hi = 0; hi < 256; hi++) {
    const h = hi.toString(16).padStart(2, "0").toUpperCase();
    ranges.push(`<${h}00> <${h}FF> <${h}00>`);
  }
  const blocks: string[] = [];
  for (let i = 0; i < ranges.length; i += 100) {
    const chunk = ranges.slice(i, i + 100);
    blocks.push(`${chunk.length} beginbfrange\n${chunk.join("\n")}\nendbfrange`);
  }
  return [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
    ...blocks,
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
}

/** Add the glyphless font to a document; returns the Type0 font's reference. */
export function embedGlyphlessFont(doc: PDFDocument): PDFRef {
  const { context } = doc;
  const ttf = glyphlessTrueType();
  const fontFile = context.register(context.flateStream(ttf, { Length1: ttf.length }));
  const descriptor = context.register(
    context.obj({
      Type: "FontDescriptor",
      FontName: "GlyphLessFont",
      Flags: 5, // fixed pitch, symbolic
      FontBBox: [0, DESCENT, ADVANCE, ASCENT],
      ItalicAngle: 0,
      Ascent: ASCENT,
      Descent: DESCENT,
      CapHeight: ASCENT,
      StemV: 80,
      FontFile2: fontFile,
    }),
  );
  // Every CID draws glyph 1.
  const gids = new Uint8Array(0x10000 * 2);
  for (let i = 1; i < gids.length; i += 2) gids[i] = 1;
  const cidFont = context.register(
    context.obj({
      Type: "Font",
      Subtype: "CIDFontType2",
      BaseFont: "GlyphLessFont",
      CIDSystemInfo: { Registry: PDFString.of("Adobe"), Ordering: PDFString.of("Identity"), Supplement: 0 },
      FontDescriptor: descriptor,
      DW: ADVANCE,
      CIDToGIDMap: context.register(context.flateStream(gids)),
    }),
  );
  return context.register(
    context.obj({
      Type: "Font",
      Subtype: "Type0",
      BaseFont: "GlyphLessFont",
      Encoding: "Identity-H",
      DescendantFonts: [cidFont],
      ToUnicode: context.register(context.flateStream(identityToUnicode())),
    }),
  );
}

/** Text as the font's two-byte codes, in hex. */
export function glyphlessHex(text: string): string {
  let hex = "";
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, "0");
  return hex.toUpperCase();
}
