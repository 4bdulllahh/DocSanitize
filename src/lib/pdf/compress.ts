import { PDFArray, PDFBool, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, type PDFDocument, type PDFObject } from "@cantoo/pdf-lib";
import { zlibSync } from "fflate";
import { isJpeg } from "../metadata/jpeg";
import { stripPdfDocument } from "../metadata/pdf";
import { DEFAULT_STRIP_OPTIONS } from "../metadata/types";
import { collectGarbage, loadPdf, savePdf } from "./load";

export type CompressPreset = "light" | "balanced" | "strong";

export interface CompressOptions {
  /** Target image resolution, assuming an image fills its page (so smaller placements get more). */
  dpi: number;
  /** JPEG quality, 0–1. */
  quality: number;
  /** Also strip document metadata, as Sanitize does. */
  removeMetadata: boolean;
}

export const COMPRESS_PRESETS: Record<CompressPreset, Pick<CompressOptions, "dpi" | "quality">> = {
  light: { dpi: 200, quality: 0.82 },
  balanced: { dpi: 150, quality: 0.72 },
  strong: { dpi: 100, quality: 0.55 },
};

/**
 * Decodes a JPEG and re-encodes it no larger than `maxSide` pixels on its longest side. Injected so
 * the PDF logic stays testable in Node; the browser implementation lives in lib/image/canvas.ts.
 */
export type JpegReencoder = (jpeg: Uint8Array, maxSide: number, quality: number) => Promise<{ bytes: Uint8Array; width: number; height: number }>;

export interface CompressResult {
  bytes: Uint8Array;
  /** Images drawn on the pages. */
  images: number;
  /** Images that were downscaled or re-encoded. */
  recompressed: number;
  /** The result wasn't smaller, so the original file is returned untouched. */
  keptOriginal: boolean;
}

/** Small images save little and show artefacts first; leave them alone. */
const MIN_IMAGE_BYTES = 16 * 1024;
/** Only swap an image in when it shrinks by at least 10%. */
const MAX_SIZE_RATIO = 0.9;

const N = {
  BitsPerComponent: PDFName.of("BitsPerComponent"),
  ColorSpace: PDFName.of("ColorSpace"),
  DCTDecode: PDFName.of("DCTDecode"),
  Decode: PDFName.of("Decode"),
  DecodeParms: PDFName.of("DecodeParms"),
  DeviceGray: PDFName.of("DeviceGray"),
  DeviceRGB: PDFName.of("DeviceRGB"),
  Filter: PDFName.of("Filter"),
  FlateDecode: PDFName.of("FlateDecode"),
  Form: PDFName.of("Form"),
  Height: PDFName.of("Height"),
  ICCBased: PDFName.of("ICCBased"),
  Image: PDFName.of("Image"),
  ImageMask: PDFName.of("ImageMask"),
  Mask: PDFName.of("Mask"),
  Metadata: PDFName.of("Metadata"),
  N: PDFName.of("N"),
  Resources: PDFName.of("Resources"),
  Subtype: PDFName.of("Subtype"),
  Type: PDFName.of("Type"),
  Width: PDFName.of("Width"),
  XObject: PDFName.of("XObject"),
};

/**
 * Shrink a PDF: downscale and re-encode its JPEG images, deflate uncompressed streams, drop
 * unreferenced objects and pack objects into streams. Returns the original if nothing was gained.
 */
export async function compressPdf(bytes: Uint8Array, options: CompressOptions, reencode: JpegReencoder): Promise<CompressResult> {
  const doc = await loadPdf(bytes);
  const placements = imagePlacements(doc);
  let recompressed = 0;

  for (const [ref, pageSide] of placements) {
    const image = doc.context.lookup(ref);
    const color = image instanceof PDFRawStream ? recompressibleJpeg(image) : null;
    if (!color || !(image instanceof PDFRawStream) || image.contents.length < MIN_IMAGE_BYTES) continue;

    const maxSide = Math.ceil((pageSide / 72) * options.dpi);
    let result: Awaited<ReturnType<JpegReencoder>>;
    try {
      result = await reencode(image.contents, maxSide, options.quality);
    } catch {
      continue; // An image the browser can't decode is left as it was.
    }
    if (result.bytes.length > image.contents.length * MAX_SIZE_RATIO) continue;

    const { dict } = image;
    dict.set(N.Width, PDFNumber.of(result.width));
    dict.set(N.Height, PDFNumber.of(result.height));
    dict.set(N.BitsPerComponent, PDFNumber.of(8));
    dict.set(N.Filter, N.DCTDecode);
    // Canvas encoders always write colour JPEGs.
    if (color === "gray") dict.set(N.ColorSpace, N.DeviceRGB);
    doc.context.assign(ref, PDFRawStream.of(dict, result.bytes));
    recompressed++;
  }

  deflateUncompressedStreams(doc);
  if (options.removeMetadata) await stripPdfDocument(doc, DEFAULT_STRIP_OPTIONS);
  else collectGarbage(doc);
  const output = await savePdf(doc);

  // With metadata removal requested, the stripped file is what the user asked for even if bigger.
  if (!options.removeMetadata && output.length >= bytes.length) {
    return { bytes, images: placements.size, recompressed: 0, keptOriginal: true };
  }
  return { bytes: output, images: placements.size, recompressed, keptOriginal: false };
}

/** Every image drawn on a page (directly or through forms) -> longest side, in points, of the largest such page. */
function imagePlacements(doc: PDFDocument): Map<PDFRef, number> {
  const placements = new Map<PDFRef, number>();
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const side = Math.max(width, height);
    const seen = new Set<PDFDict>();
    const visit = (resources: PDFObject | undefined) => {
      const dict = resources && doc.context.lookup(resources);
      if (!(dict instanceof PDFDict) || seen.has(dict)) return;
      seen.add(dict);
      const xobjects = dict.lookup(N.XObject);
      if (!(xobjects instanceof PDFDict)) return;
      for (const [, value] of xobjects.entries()) {
        if (!(value instanceof PDFRef)) continue;
        const xobject = doc.context.lookup(value);
        if (!(xobject instanceof PDFStream)) continue;
        const subtype = xobject.dict.lookup(N.Subtype);
        if (subtype === N.Image) placements.set(value, Math.max(placements.get(value) ?? 0, side));
        else if (subtype === N.Form) visit(xobject.dict.get(N.Resources));
      }
    };
    visit(page.node.Resources());
  }
  return placements;
}

/**
 * Whether an image is a plain 8-bit RGB or grayscale JPEG that can be re-encoded without changing
 * how it renders. Masked, inverted, CMYK and indexed images are skipped.
 */
function recompressibleJpeg(image: PDFRawStream): "rgb" | "gray" | null {
  const { dict } = image;
  if (dict.lookup(N.Subtype) !== N.Image) return null;
  const filter = dict.lookup(N.Filter);
  const dctOnly = filter === N.DCTDecode || (filter instanceof PDFArray && filter.size() === 1 && filter.lookup(0) === N.DCTDecode);
  if (!dctOnly) return null;
  // Colour-key masks match exact sample values, which lossy re-encoding would shift.
  if (dict.has(N.Mask) || dict.has(N.Decode) || dict.has(N.DecodeParms) || dict.lookup(N.ImageMask) === PDFBool.True) return null;
  const bits = dict.lookup(N.BitsPerComponent);
  if (bits !== undefined && !(bits instanceof PDFNumber && bits.asNumber() === 8)) return null;
  if (!isJpeg(image.contents)) return null;

  const space = dict.lookup(N.ColorSpace);
  if (space === N.DeviceRGB) return "rgb";
  if (space === N.DeviceGray) return "gray";
  if (space instanceof PDFArray && space.lookup(0) === N.ICCBased) {
    const profile = space.lookup(1);
    const components = profile instanceof PDFStream ? profile.dict.lookup(N.N) : undefined;
    if (components instanceof PDFNumber) return components.asNumber() === 3 ? "rgb" : components.asNumber() === 1 ? "gray" : null;
  }
  return null;
}

/** Losslessly compress streams stored without any filter (common in older or generated PDFs). */
function deflateUncompressedStreams(doc: PDFDocument) {
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.has(N.Filter) || obj.contents.length < 512) continue;
    // XMP is meant to stay readable by tools that don't parse PDF.
    if (obj.dict.lookup(N.Type) === N.Metadata) continue;
    const packed = zlibSync(obj.contents, { level: 9 });
    if (packed.length > obj.contents.length * MAX_SIZE_RATIO) continue;
    obj.dict.set(N.Filter, N.FlateDecode);
    doc.context.assign(ref, PDFRawStream.of(obj.dict, packed));
  }
}
