import fontkit from "@cantoo/fontkit";
import { PDFArray, PDFName, type PDFDocument, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import type { FontFiles } from "../office/flow";

/*
 * Drawing on existing pages "as the reader sees them". Users place things on the displayed page
 * (top-left origin, page rotation applied, cropped to the CropBox); PDF drawing happens in the
 * page's own user space. These helpers convert between the two and keep drawings upright.
 */

export interface PageGeometry {
  /** Clockwise rotation viewers apply: 0, 90, 180 or 270. */
  rotation: 0 | 90 | 180 | 270;
  /** Visible area in user space. */
  box: { x: number; y: number; width: number; height: number };
}

export function pageGeometry(page: PDFPage): PageGeometry {
  const angle = ((Math.round(page.getRotation().angle / 90) * 90) % 360 + 360) % 360;
  return { rotation: angle as PageGeometry["rotation"], box: page.getCropBox() };
}

/** Size of the page as displayed (width and height swap for quarter turns). */
export function displaySize({ rotation, box }: PageGeometry): { width: number; height: number } {
  return rotation % 180 === 0 ? { width: box.width, height: box.height } : { width: box.height, height: box.width };
}

/** A displayed point (points from the top-left of what the reader sees) -> user space. */
export function toUserSpace({ rotation, box }: PageGeometry, u: number, v: number): { x: number; y: number } {
  const { x, y, width, height } = box;
  switch (rotation) {
    case 90:
      return { x: x + v, y: y + u };
    case 180:
      return { x: x + width - u, y: y + v };
    case 270:
      return { x: x + width - v, y: y + height - u };
    default:
      return { x: x + u, y: y + height - v };
  }
}

/**
 * Where to draw a rectangle given in displayed coordinates so it appears upright: pass `x`, `y`
 * and `rotate` (degrees, counter-clockwise) to pdf-lib's drawImage / drawText with the same size.
 */
export function placeRect(geometry: PageGeometry, rect: { u: number; v: number; width: number; height: number }) {
  // pdf-lib draws from the item's bottom-left corner; on screen that's (u, v + height).
  const origin = toUserSpace(geometry, rect.u, rect.v + rect.height);
  return { ...origin, rotate: geometry.rotation };
}

export { anchorBox, type Anchor } from "./anchor";

/** Embed Liberation Sans (regular and bold) for stamped text; covers Latin, Greek and Cyrillic. */
export async function embedStampFonts(doc: PDFDocument, files: Pick<FontFiles, "regular" | "bold">): Promise<{ regular: PDFFont; bold: PDFFont }> {
  doc.registerFontkit(fontkit);
  const [regular, bold] = await Promise.all([doc.embedFont(files.regular, { subset: true }), doc.embedFont(files.bold, { subset: true })]);
  return { regular, bold };
}

/** Characters the font can't draw become "?" (pdf-lib would otherwise throw). */
export function drawableText(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  return Array.from(text, (ch) => (ch === " " || supported.has(ch.codePointAt(0)!) ? ch : "?")).join("");
}

/**
 * Move what was just drawn on the page underneath the existing content. pdf-lib appends its
 * stream last (after wrapping the original content in q/Q), so it's moved to the front.
 */
export function sendDrawingBehind(page: PDFPage) {
  const contents = page.node.lookup(PDFName.of("Contents"));
  if (!(contents instanceof PDFArray) || contents.size() < 2) return;
  const last = contents.get(contents.size() - 1);
  contents.remove(contents.size() - 1);
  contents.insert(0, last);
}
