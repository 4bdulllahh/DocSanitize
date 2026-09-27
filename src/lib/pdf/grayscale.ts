import { decodePDFRawStream, PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString, type PDFContext, type PDFDocument, type PDFPage } from "@cantoo/pdf-lib";
import { ProcessingError } from "../errors";
import { parseContent, type Operand } from "./edit/content";
import { collectGarbage, loadPdf, savePdf } from "./load";

/*
 * Grayscale: colours in page content, forms and annotation appearances are rewritten as grays,
 * and images are converted (JPEGs through a re-encoder the caller provides, 8-bit RGB/CMYK and
 * palettes directly). Anything else (gradients, spot colours, patterns, unusual images) is covered
 * on its page by a "saturation" blend layer, so the page still shows and prints in gray.
 */

export type JpegToGray = (jpeg: Uint8Array) => Promise<Uint8Array | null>;

export interface GrayscaleResult {
  bytes: Uint8Array;
  images: number;
  /** Pages that needed the blend layer for something that couldn't be converted. */
  overlaid: number;
}

const luminance = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const cmykGray = (c: number, m: number, y: number, k: number) => Math.max(0, Math.min(1, 1 - Math.min(1, 0.3 * c + 0.59 * m + 0.11 * y + k)));
const fmt = (n: number) => String(Math.round(n * 10000) / 10000);

type Space = "gray" | "rgb" | "cmyk" | "other";

function spaceOf(context: PDFContext, value: unknown, depth = 0): Space {
  const v = context.lookup(value as PDFRef) ?? value;
  if (v instanceof PDFName) {
    const n = v.decodeText();
    if (n === "DeviceGray" || n === "G" || n === "CalGray") return "gray";
    if (n === "DeviceRGB" || n === "RGB" || n === "CalRGB") return "rgb";
    if (n === "DeviceCMYK" || n === "CMYK") return "cmyk";
    return "other";
  }
  if (v instanceof PDFArray && depth < 4) {
    const family = v.lookup(0);
    const name = family instanceof PDFName ? family.decodeText() : "";
    if (name === "ICCBased") {
      const stream = v.lookup(1);
      const n = stream instanceof PDFStream ? stream.dict.lookup(PDFName.of("N")) : undefined;
      const count = n instanceof PDFNumber ? n.asNumber() : 0;
      return count === 1 ? "gray" : count === 3 ? "rgb" : count === 4 ? "cmyk" : "other";
    }
    if (name === "CalRGB") return "rgb";
    if (name === "CalGray") return "gray";
  }
  return "other";
}

/** Rewrite a content stream's colours as grays. `complete` is false if something was left in colour. */
function grayContent(bytes: Uint8Array, resources: PDFDict | undefined, context: PDFContext): { bytes: Uint8Array; complete: boolean } {
  const ops = parseContent(bytes);
  const colorSpaces = resources?.lookup(PDFName.of("ColorSpace"));
  const named = (operand: Operand | undefined): Space => {
    if (!operand || typeof operand !== "object" || !("name" in operand)) return "other";
    const direct = spaceOf(context, PDFName.of(operand.name));
    if (direct !== "other") return direct;
    return colorSpaces instanceof PDFDict ? spaceOf(context, colorSpaces.get(PDFName.of(operand.name))) : "other";
  };
  const nums = (o: Operand[]) => o.filter((v): v is number => typeof v === "number");
  let fill: Space = "gray";
  let strokeSpace: Space = "gray";
  const stack: [Space, Space][] = [];
  let complete = true;
  const edits: { start: number; end: number; text: string }[] = [];
  const replace = (op: { start: number; end: number }, text: string) => edits.push({ start: op.start, end: op.end, text });
  const toGray = (space: Space, values: number[]) => (space === "rgb" ? luminance(values[0], values[1], values[2]) : cmykGray(values[0], values[1], values[2], values[3]));

  for (const op of ops) {
    const o = op.operands;
    switch (op.op) {
      case "q":
        stack.push([fill, strokeSpace]);
        break;
      case "Q":
        [fill, strokeSpace] = stack.pop() ?? [fill, strokeSpace];
        break;
      case "rg":
      case "RG": {
        const [r, g, b] = nums(o);
        replace(op, `${fmt(luminance(r, g, b))} ${op.op === "rg" ? "g" : "G"}`);
        if (op.op === "rg") fill = "gray";
        else strokeSpace = "gray";
        break;
      }
      case "k":
      case "K": {
        const [c, m, y, k] = nums(o);
        replace(op, `${fmt(cmykGray(c, m, y, k))} ${op.op === "k" ? "g" : "G"}`);
        if (op.op === "k") fill = "gray";
        else strokeSpace = "gray";
        break;
      }
      case "g":
        fill = "gray";
        break;
      case "G":
        strokeSpace = "gray";
        break;
      case "cs":
      case "CS": {
        const space = named(o[0]);
        if (space === "rgb" || space === "cmyk") replace(op, `/DeviceGray ${op.op}`);
        else if (space === "other") complete = false;
        if (op.op === "cs") fill = space;
        else strokeSpace = space;
        break;
      }
      case "sc":
      case "scn":
      case "SC":
      case "SCN": {
        const space = op.op === "sc" || op.op === "scn" ? fill : strokeSpace;
        const values = nums(o);
        if ((space === "rgb" && values.length === 3) || (space === "cmyk" && values.length === 4)) replace(op, `${fmt(toGray(space, values))} ${op.op}`);
        else if (space === "other") complete = false;
        break;
      }
      case "sh":
      case "BI":
        complete = false;
        break;
    }
  }
  if (!edits.length) return { bytes, complete };
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  let at = 0;
  for (const e of edits) {
    parts.push(bytes.subarray(at, e.start), enc.encode(e.text));
    at = e.end;
  }
  parts.push(bytes.subarray(at));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return { bytes: out, complete };
}

/** Undo PNG predictors (Predictor >= 10) for 8-bit samples. */
export function unpredict(data: Uint8Array, columns: number, colors: number): Uint8Array | null {
  const rowLength = columns * colors;
  const rows = Math.floor(data.length / (rowLength + 1));
  const out = new Uint8Array(rows * rowLength);
  for (let r = 0; r < rows; r++) {
    const filter = data[r * (rowLength + 1)];
    const src = r * (rowLength + 1) + 1;
    const dst = r * rowLength;
    for (let i = 0; i < rowLength; i++) {
      const raw = data[src + i];
      const left = i >= colors ? out[dst + i - colors] : 0;
      const up = r > 0 ? out[dst - rowLength + i] : 0;
      const upLeft = r > 0 && i >= colors ? out[dst - rowLength + i - colors] : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
          value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default:
          return null;
      }
      out[dst + i] = value & 255;
    }
  }
  return out;
}

const filterNames = (dict: PDFDict) => {
  const f = dict.lookup(PDFName.of("Filter"));
  if (f instanceof PDFName) return [f.decodeText()];
  if (f instanceof PDFArray) return f.asArray().map((n) => (n instanceof PDFName ? n.decodeText() : "?"));
  return [];
};

/** Convert one image XObject in place. Returns false if it was left in colour. */
async function grayImage(context: PDFContext, ref: PDFRef, stream: PDFStream, jpegToGray?: JpegToGray): Promise<boolean | "converted"> {
  const dict = stream.dict;
  if (dict.lookup(PDFName.of("ImageMask"))?.toString() === "true") return true;
  const cs = dict.lookup(PDFName.of("ColorSpace"));
  const space = spaceOf(context, cs);
  if (space === "gray") return true;
  const bpc = dict.lookup(PDFName.of("BitsPerComponent"));
  const width = (dict.lookup(PDFName.of("Width")) as PDFNumber | undefined)?.asNumber() ?? 0;
  const height = (dict.lookup(PDFName.of("Height")) as PDFNumber | undefined)?.asNumber() ?? 0;
  const filters = filterNames(dict);
  type Literal = NonNullable<Parameters<PDFContext["stream"]>[1]>;
  const keep = (extra: Literal): Literal => {
    const base: Literal = { Type: "XObject", Subtype: "Image", Width: width, Height: height, ColorSpace: "DeviceGray", BitsPerComponent: 8, ...extra };
    for (const key of ["SMask", "Interpolate", "Intent", "OC"]) {
      const v = dict.get(PDFName.of(key));
      if (v) base[key] = v;
    }
    return base;
  };

  // A palette: make every entry gray, keeping the indexes.
  if (cs instanceof PDFArray && (cs.lookup(0) as PDFName | undefined)?.decodeText?.() === "Indexed") {
    const base = spaceOf(context, cs.get(1));
    const lookup = cs.lookup(3);
    let table: Uint8Array | null = null;
    if (lookup instanceof PDFString || lookup instanceof PDFHexString) table = lookup.asBytes();
    else if (lookup instanceof PDFRawStream) table = decodePDFRawStream(lookup).decode();
    if (!table || (base !== "rgb" && base !== "cmyk")) return false;
    const n = base === "rgb" ? 3 : 4;
    const gray = new Uint8Array(table.length);
    for (let i = 0; i + n <= table.length; i += n) {
      const v = base === "rgb" ? luminance(table[i], table[i + 1], table[i + 2]) : 255 * cmykGray(table[i] / 255, table[i + 1] / 255, table[i + 2] / 255, table[i + 3] / 255);
      gray.fill(Math.round(v), i, i + n);
    }
    const newCs = cs.clone();
    newCs.set(3, PDFHexString.of(Array.from(gray, (b) => b.toString(16).padStart(2, "0")).join("")));
    dict.set(PDFName.of("ColorSpace"), newCs);
    return "converted";
  }

  if (space === "other" || dict.has(PDFName.of("Decode"))) return false;

  if (filters.length === 1 && filters[0] === "DCTDecode") {
    if (!jpegToGray || !(stream instanceof PDFRawStream)) return false;
    const gray = await jpegToGray(stream.contents);
    if (!gray) return false;
    // Browsers only write 3-channel JPEGs: the pixels are gray, the colour space stays RGB.
    context.assign(ref, context.stream(gray, keep({ Filter: "DCTDecode", ColorSpace: "DeviceRGB" })));
    return "converted";
  }

  if ((filters.length === 0 || (filters.length === 1 && filters[0] === "FlateDecode")) && bpc instanceof PDFNumber && bpc.asNumber() === 8 && stream instanceof PDFRawStream) {
    const colors = space === "rgb" ? 3 : 4;
    let data = decodePDFRawStream(stream).decode();
    const parms = dict.lookup(PDFName.of("DecodeParms"));
    const predictor = parms instanceof PDFDict ? ((parms.lookup(PDFName.of("Predictor")) as PDFNumber | undefined)?.asNumber() ?? 1) : 1;
    if (predictor >= 10) {
      const unpredicted = unpredict(data, width, colors);
      if (!unpredicted) return false;
      data = unpredicted;
    } else if (predictor !== 1) {
      return false;
    }
    if (data.length < width * height * colors) return false;
    const gray = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < gray.length; i++, j += colors) {
      gray[i] = colors === 3 ? Math.round(luminance(data[j], data[j + 1], data[j + 2])) : Math.round(255 * cmykGray(data[j] / 255, data[j + 1] / 255, data[j + 2] / 255, data[j + 3] / 255));
    }
    context.assign(ref, context.flateStream(gray, keep({})));
    return "converted";
  }
  return false;
}

interface Walk {
  context: PDFContext;
  jpegToGray?: JpegToGray;
  done: Set<string>;
  images: number;
}

/** Convert everything a set of resources draws (images, nested forms). Returns false if something stayed in colour. */
async function grayResources(resources: PDFDict | undefined, walk: Walk, depth: number): Promise<boolean> {
  if (!resources || depth > 12) return true;
  let complete = true;
  const patterns = resources.lookup(PDFName.of("Pattern"));
  if (patterns instanceof PDFDict && patterns.keys().length) complete = false;
  const xobjects = resources.lookup(PDFName.of("XObject"));
  if (!(xobjects instanceof PDFDict)) return complete;
  for (const [, value] of xobjects.entries()) {
    if (!(value instanceof PDFRef) || walk.done.has(value.toString())) continue;
    walk.done.add(value.toString());
    const object = walk.context.lookup(value);
    if (!(object instanceof PDFStream)) continue;
    const subtype = object.dict.lookup(PDFName.of("Subtype"));
    if (subtype === PDFName.of("Image")) {
      const result = await grayImage(walk.context, value, object, walk.jpegToGray);
      if (result === "converted") walk.images++;
      else if (!result) complete = false;
    } else if (subtype === PDFName.of("Form")) {
      complete = (await grayForm(value, object, walk, depth + 1)) && complete;
    }
  }
  return complete;
}

async function grayForm(ref: PDFRef, stream: PDFStream, walk: Walk, depth: number): Promise<boolean> {
  if (!(stream instanceof PDFRawStream)) return true;
  const resources = stream.dict.lookup(PDFName.of("Resources"));
  const res = resources instanceof PDFDict ? resources : undefined;
  const { bytes, complete } = grayContent(decodePDFRawStream(stream).decode(), res, walk.context);
  const dict = stream.dict.clone(walk.context);
  dict.delete(PDFName.of("Filter"));
  dict.delete(PDFName.of("DecodeParms"));
  dict.delete(PDFName.of("Length"));
  walk.context.assign(ref, walk.context.flateStream(bytes, Object.fromEntries(dict.entries().map(([k, v]) => [k.decodeText(), v]))));
  return (await grayResources(res, walk, depth)) && complete;
}

function pageContent(page: PDFPage): Uint8Array {
  page.node.normalize();
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => page.doc.context.lookup(r)) : [contents];
  const parts = streams.flatMap((s) => (s instanceof PDFRawStream ? [decodePDFRawStream(s).decode(), new Uint8Array([10])] : []));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function overlay(doc: PDFDocument, page: PDFPage) {
  const name = page.node.newExtGState("GrayGS", doc.context.obj({ Type: "ExtGState", BM: "Saturation" }));
  const { x, y, width, height } = page.getMediaBox();
  page.pushOperators(); // wraps the existing content in q … Q first
  const stream = doc.context.register(doc.context.flateStream(`q ${name.asString()} gs 0 g ${x} ${y} ${width} ${height} re f Q\n`));
  (page.node.Contents() as PDFArray).push(stream);
}

export async function grayscalePdf(bytes: Uint8Array, jpegToGray?: JpegToGray): Promise<GrayscaleResult> {
  const doc = await loadPdf(bytes);
  const walk: Walk = { context: doc.context, jpegToGray, done: new Set(), images: 0 };
  let overlaid = 0;
  for (const page of doc.getPages()) {
    const resources = page.node.Resources();
    const { bytes: content, complete: contentDone } = grayContent(pageContent(page), resources, doc.context);
    page.node.set(PDFName.of("Contents"), doc.context.obj([doc.context.register(doc.context.flateStream(content))]));
    let complete = (await grayResources(resources, walk, 0)) && contentDone;
    // Annotation appearances (comments, stamps, form fields) are forms too.
    for (const ref of page.node.Annots()?.asArray() ?? []) {
      const annot = doc.context.lookup(ref);
      const ap = annot instanceof PDFDict ? annot.lookup(PDFName.of("AP")) : undefined;
      if (!(ap instanceof PDFDict)) continue;
      for (const [, value] of ap.entries()) {
        const entries = value instanceof PDFRef && doc.context.lookup(value) instanceof PDFDict ? (doc.context.lookup(value) as PDFDict).entries().map(([, v]) => v) : [value];
        for (const r of entries) {
          const form = doc.context.lookup(r);
          if (r instanceof PDFRef && form instanceof PDFStream && !walk.done.has(r.toString())) {
            walk.done.add(r.toString());
            complete = (await grayForm(r, form, walk, 1)) && complete;
          }
        }
      }
    }
    if (!complete) {
      overlay(doc, page);
      overlaid++;
    }
  }
  if (doc.getPageCount() === 0) throw new ProcessingError("This PDF has no pages.", "invalid");
  collectGarbage(doc);
  return { bytes: await savePdf(doc), images: walk.images, overlaid };
}
