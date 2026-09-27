import {
  clip,
  concatTransformationMatrix,
  drawObject,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  type PDFImage,
} from "@cantoo/pdf-lib";
import { ProcessingError } from "../errors";
import { createPdf, savePdf } from "./load";

export type PageSizeOption = "fit" | "a4" | "letter";
export type PageOrientation = "auto" | "portrait" | "landscape";
/** contain: the whole image is visible; cover: the image fills the page and is cropped. */
export type ImageFit = "contain" | "cover";

export interface ImagesToPdfOptions {
  pageSize: PageSizeOption;
  /** Ignored when the page is fitted to the image. */
  orientation: PageOrientation;
  /** Blank border around the image, in points. */
  margin: number;
  /** Ignored when the page is fitted to the image. */
  fit: ImageFit;
}

export const DEFAULT_IMAGES_TO_PDF: ImagesToPdfOptions = { pageSize: "a4", orientation: "auto", margin: 0, fit: "contain" };

/** Page sizes in points (portrait). */
export const PAGE_SIZES: Record<Exclude<PageSizeOption, "fit">, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** "Fit image" pages treat pixels as 96 DPI, like a browser does. */
const POINTS_PER_PIXEL = 72 / 96;
/** PDF viewers' maximum page size (200 inches). */
const MAX_PAGE_SIDE = 14_400;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageLayout {
  width: number;
  height: number;
  /** Where the (displayed, upright) image is drawn, in PDF coordinates (origin bottom-left). */
  image: Rect;
  /** Area the image is clipped to, when it overflows (cover mode). */
  clip: Rect | null;
}

/** Where an image of the given displayed size lands on its page. Pure, so the UI preview uses it too. */
export function layoutPage(imageWidth: number, imageHeight: number, options: ImagesToPdfOptions): PageLayout {
  if (options.pageSize === "fit") {
    const margin = Math.max(0, options.margin);
    let w = imageWidth * POINTS_PER_PIXEL;
    let h = imageHeight * POINTS_PER_PIXEL;
    const shrink = Math.min(1, (MAX_PAGE_SIDE - 2 * margin) / Math.max(w, h));
    w *= shrink;
    h *= shrink;
    return { width: w + 2 * margin, height: h + 2 * margin, image: { x: margin, y: margin, width: w, height: h }, clip: null };
  }

  let [width, height] = PAGE_SIZES[options.pageSize];
  const landscape = options.orientation === "landscape" || (options.orientation === "auto" && imageWidth > imageHeight);
  if (landscape) [width, height] = [height, width];
  // Never let the margin eat the whole page.
  const margin = Math.min(Math.max(0, options.margin), Math.min(width, height) / 4);
  const box: Rect = { x: margin, y: margin, width: width - 2 * margin, height: height - 2 * margin };
  const cover = options.fit === "cover";
  const scale = (cover ? Math.max : Math.min)(box.width / imageWidth, box.height / imageHeight);
  const w = imageWidth * scale;
  const h = imageHeight * scale;
  return {
    width,
    height,
    image: { x: box.x + (box.width - w) / 2, y: box.y + (box.height - h) / 2, width: w, height: h },
    clip: cover ? box : null,
  };
}

/**
 * An affine map [a b c d e f] from the stored image's unit square (u right, v up; v = 1 is the
 * first pixel row) to the displayed unit square: s = a·u + c·v + e, t = b·u + d·v + f.
 */
type Affine = [number, number, number, number, number, number];

// One per EXIF orientation: where the stored image's first row and column end up on screen.
const ORIENTATIONS: Record<number, Affine> = {
  1: [1, 0, 0, 1, 0, 0], // as stored
  2: [-1, 0, 0, 1, 1, 0], // mirrored horizontally
  3: [-1, 0, 0, -1, 1, 1], // rotated 180°
  4: [1, 0, 0, -1, 0, 1], // mirrored vertically
  5: [0, -1, -1, 0, 1, 1], // transposed
  6: [0, -1, 1, 0, 0, 1], // rotated 90° clockwise
  7: [0, 1, 1, 0, 0, 0], // transversed
  8: [0, 1, -1, 0, 1, 0], // rotated 90° counter-clockwise
};

/** Turn the displayed square a quarter clockwise: (s, t) -> (t, 1 - s). */
const quarterTurn = ([a, b, c, d, e, f]: Affine): Affine => [b, -a, d, -c, f, 1 - e];

/** EXIF orientation followed by an extra clockwise rotation (a multiple of 90°). */
export function unitTransform(orientation: number, rotate: number): Affine {
  let m = ORIENTATIONS[orientation] ?? ORIENTATIONS[1];
  const turns = ((Math.round(rotate / 90) % 4) + 4) % 4;
  for (let i = 0; i < turns; i++) m = quarterTurn(m);
  return m.map((n) => n + 0) as Affine; // -0 -> 0
}

/** Size the image appears at once oriented and rotated. */
export function displayedSize(width: number, height: number, orientation: number, rotate: number): [number, number] {
  const [a] = unitTransform(orientation, rotate);
  // a = 0 means the axes are swapped.
  return a === 0 ? [height, width] : [width, height];
}

export interface PreparedImage {
  name: string;
  /** JPEG or PNG bytes, already stripped of metadata. */
  bytes: Uint8Array;
  format: "jpeg" | "png";
  /** EXIF orientation (1–8) that still has to be applied when drawing. */
  orientation: number;
  /** Extra clockwise rotation chosen by the user: 0, 90, 180 or 270. */
  rotate: number;
}

/** One page per image, in order. JPEGs are embedded as-is (no re-encoding, no quality loss). */
export async function imagesToPdf(images: PreparedImage[], options: ImagesToPdfOptions): Promise<Uint8Array> {
  if (images.length === 0) throw new ProcessingError("Add at least one image.", "invalid");
  const doc = await createPdf();
  for (const input of images) {
    let image: PDFImage;
    try {
      image = input.format === "jpeg" ? await doc.embedJpg(input.bytes) : await doc.embedPng(input.bytes);
    } catch {
      throw new ProcessingError(`“${input.name}” couldn't be read as an image.`, "corrupt");
    }
    const [w, h] = displayedSize(image.width, image.height, input.orientation, input.rotate);
    const layout = layoutPage(w, h, options);
    const page = doc.addPage([layout.width, layout.height]);
    const name = page.node.newXObject("Image", image.ref);

    const [a, b, c, d, e, f] = unitTransform(input.orientation, input.rotate);
    const { x, y, width: W, height: H } = layout.image;
    const box = layout.clip;
    page.pushOperators(
      pushGraphicsState(),
      ...(box ? [rectangle(box.x, box.y, box.width, box.height), clip(), endPath()] : []),
      concatTransformationMatrix(W * a, H * b, W * c, H * d, x + W * e, y + H * f),
      drawObject(name),
      popGraphicsState(),
    );
  }
  return savePdf(doc);
}
