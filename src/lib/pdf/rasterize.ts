import type { PDFDocumentProxy } from "pdfjs-dist";
import { ProcessingError } from "../errors";
import { withRenderSlot } from "./render";

export type RasterFormat = "jpeg" | "png" | "webp";

export const RASTER_FORMATS: Record<RasterFormat, { label: string; mime: string; extension: string; lossy: boolean }> = {
  jpeg: { label: "JPG", mime: "image/jpeg", extension: ".jpg", lossy: true },
  png: { label: "PNG", mime: "image/png", extension: ".png", lossy: false },
  webp: { label: "WebP", mime: "image/webp", extension: ".webp", lossy: true },
};

export interface RasterOptions {
  dpi: number;
  format: RasterFormat;
  /** 0–1, for JPG and WebP. */
  quality: number;
}

// Beyond these, browsers refuse to allocate a canvas or silently render it blank
// (iOS Safari caps the area at about 16.7 megapixels).
const MAX_CANVAS_SIDE = 10_000;
const MAX_CANVAS_AREA = 16_000_000;

export interface RasterSize {
  scale: number;
  width: number;
  height: number;
  /** The requested DPI was lowered to stay within canvas limits. */
  capped: boolean;
}

/** Pixel size of a page (in points, rotation applied) rendered at `dpi`, within canvas limits. */
export function rasterSize(pageWidth: number, pageHeight: number, dpi: number): RasterSize {
  const wanted = dpi / 72;
  const fit = Math.min(
    1,
    MAX_CANVAS_SIDE / (Math.max(pageWidth, pageHeight) * wanted),
    Math.sqrt(MAX_CANVAS_AREA / (pageWidth * pageHeight * wanted * wanted)),
  );
  const scale = wanted * fit;
  return {
    scale,
    width: Math.max(1, Math.round(pageWidth * scale)),
    height: Math.max(1, Math.round(pageHeight * scale)),
    capped: fit < 1,
  };
}

let webpEncoding: boolean | undefined;

/** Safari can't encode WebP: its canvas silently hands back a PNG instead. */
export function canEncode(format: RasterFormat): boolean {
  if (format !== "webp") return true;
  if (webpEncoding === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    webpEncoding = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return webpEncoding;
}

export interface RenderedImage extends RasterSize {
  blob: Blob;
}

/** Render one page (1-based) to an image file. Canvas encoders add no metadata. */
export function renderPageToImage(doc: PDFDocumentProxy, pageNumber: number, options: RasterOptions): Promise<RenderedImage> {
  return withRenderSlot(async () => {
    const page = await doc.getPage(pageNumber);
    const natural = page.getViewport({ scale: 1 });
    const size = rasterSize(natural.width, natural.height, options.dpi);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    try {
      // pdf.js paints a white background first, so JPG output has no black transparent areas.
      await page.render({ canvas, viewport: page.getViewport({ scale: size.scale }) }).promise;
      const format = RASTER_FORMATS[options.format];
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format.mime, options.quality));
      if (!blob) throw new ProcessingError(`Page ${pageNumber} couldn't be converted to an image.`, "unsupported");
      return { ...size, blob };
    } finally {
      // Release the pixel buffer now rather than whenever garbage collection runs.
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  });
}
