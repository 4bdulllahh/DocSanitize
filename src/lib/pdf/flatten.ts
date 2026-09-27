import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, PDFStream, type PDFDocument, type PDFPage } from "@cantoo/pdf-lib";
import { ProcessingError } from "../errors";
import { collectGarbage, loadPdf, savePdf } from "./load";

/*
 * Flatten: draw form fields and annotations into the page content so they can't be changed any
 * more (and look the same in every reader), then remove them. Links are kept: they only make
 * areas clickable. Annotations with no appearance can't be drawn and are kept, and reported.
 */

export interface FlattenOptions {
  forms: boolean;
  annotations: boolean;
}

export interface FlattenResult {
  bytes: Uint8Array;
  fields: number;
  annotations: number;
  /** Annotations kept because they have no appearance to draw (e.g. some comment notes). */
  kept: number;
}

const HIDDEN = 1 << 1;
const numbers = (a: unknown) => (a instanceof PDFArray ? a.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0)) : null);

/** The stream an annotation shows normally (its /AP /N, or the state /AS picks from it). */
function normalAppearance(annot: PDFDict): PDFRef | null {
  const ap = annot.lookup(PDFName.of("AP"));
  if (!(ap instanceof PDFDict)) return null;
  const n = ap.get(PDFName.of("N"));
  const target = annot.context.lookup(n);
  if (target instanceof PDFStream) return n instanceof PDFRef ? n : annot.context.register(target);
  if (target instanceof PDFDict) {
    const state = annot.lookup(PDFName.of("AS"));
    const chosen = state instanceof PDFName ? target.get(state) : undefined;
    return chosen instanceof PDFRef && annot.context.lookup(chosen) instanceof PDFStream ? chosen : null;
  }
  return null;
}

/**
 * Draw an appearance stream at its annotation's rectangle (PDF 32000 12.5.5: the form's BBox,
 * transformed by its Matrix, is fitted to Rect).
 */
function drawAppearance(doc: PDFDocument, page: PDFPage, annot: PDFDict, appearance: PDFRef): boolean {
  const rect = numbers(annot.lookup(PDFName.of("Rect")));
  const form = doc.context.lookup(appearance) as PDFStream;
  const bbox = numbers(form.dict.lookup(PDFName.of("BBox")));
  if (!rect || rect.length !== 4 || !bbox || bbox.length !== 4) return false;
  const m = numbers(form.dict.lookup(PDFName.of("Matrix"))) ?? [1, 0, 0, 1, 0, 0];
  const corners = [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[0], bbox[3]],
    [bbox[2], bbox[3]],
  ].map(([x, y]) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]]);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const [bx, by, bw, bh] = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  const [rx, ry] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3])];
  const [rw, rh] = [Math.abs(rect[2] - rect[0]), Math.abs(rect[3] - rect[1])];
  if (bw <= 0 || bh <= 0 || rw <= 0 || rh <= 0) return true; // nothing visible to draw
  const [sx, sy] = [rw / bw, rh / bh];
  // Make sure the form is a Form XObject, then place it.
  form.dict.set(PDFName.of("Type"), PDFName.of("XObject"));
  form.dict.set(PDFName.of("Subtype"), PDFName.of("Form"));
  const name = page.node.newXObject("Flat", appearance);
  const ops = `q ${[sx, 0, 0, sy, rx - bx * sx, ry - by * sy].map((v) => +v.toFixed(5)).join(" ")} cm ${name.asString()} Do Q\n`;
  page.node.normalize();
  const contents = page.node.Contents();
  const stream = doc.context.register(doc.context.flateStream(ops));
  if (contents instanceof PDFArray) contents.push(stream);
  return true;
}

export async function flattenPdf(bytes: Uint8Array, options: FlattenOptions): Promise<FlattenResult> {
  if (!options.forms && !options.annotations) throw new ProcessingError("Choose what to flatten.", "invalid");
  const doc = await loadPdf(bytes);
  let fields = 0;
  let annotations = 0;
  let kept = 0;

  if (options.forms) {
    const form = doc.getForm();
    fields = form.getFields().length;
    if (fields) {
      // Use each field's own appearance when it has one; build them only if something is missing.
      try {
        form.flatten({ updateFieldAppearances: false });
      } catch {
        form.updateFieldAppearances();
        form.flatten({ updateFieldAppearances: false });
      }
    }
    doc.catalog.delete(PDFName.of("AcroForm"));
  }

  if (options.annotations) {
    for (const page of doc.getPages()) {
      // Drawing the page's own content first would need the original wrapped; pushOperators does it.
      page.pushOperators();
      const annots = page.node.Annots();
      if (!annots) continue;
      const keep: PDFRef[] = [];
      const removed = new Set<string>();
      for (const ref of annots.asArray()) {
        const annot = doc.context.lookup(ref);
        if (!(ref instanceof PDFRef) || !(annot instanceof PDFDict)) continue;
        const subtype = annot.lookup(PDFName.of("Subtype"));
        const kind = subtype instanceof PDFName ? subtype.decodeText() : "";
        // Links stay clickable; widgets are form fields (handled above, or left alone).
        if (kind === "Link" || kind === "Widget" || kind === "Popup") {
          keep.push(ref);
          continue;
        }
        const flags = annot.lookup(PDFName.of("F"));
        if (flags instanceof PDFNumber && flags.asNumber() & HIDDEN) {
          removed.add(ref.toString());
          continue;
        }
        const appearance = normalAppearance(annot);
        if (appearance && drawAppearance(doc, page, annot, appearance)) {
          annotations++;
          removed.add(ref.toString());
        } else {
          kept++;
          keep.push(ref);
        }
      }
      // Popups belong to the annotation they explain; drop the orphans.
      const remaining = keep.filter((ref) => {
        const annot = doc.context.lookup(ref) as PDFDict;
        const parent = annot.get(PDFName.of("Parent"));
        return !(parent instanceof PDFRef && removed.has(parent.toString()));
      });
      if (remaining.length) page.node.set(PDFName.of("Annots"), doc.context.obj(remaining));
      else page.node.delete(PDFName.of("Annots"));
    }
  }

  if (fields === 0 && annotations === 0 && !options.annotations) throw new ProcessingError("This PDF has no form fields to flatten.", "invalid");
  collectGarbage(doc);
  return { bytes: await savePdf(doc), fields, annotations, kept };
}
