import { PDFArray, PDFDict, PDFName, PDFRef, type PDFDocument } from "@cantoo/pdf-lib";
import { ProcessingError } from "../errors";
import { stripPdfDocument } from "../metadata/pdf";
import { DEFAULT_STRIP_OPTIONS } from "../metadata/types";
import { collectGarbage, loadPdf, savePdf } from "./load";

export interface RedactedPage {
  /** 0-based page index. */
  index: number;
  /** The page rendered with the redaction boxes painted in (JPEG). */
  image: Uint8Array;
  /** Page size in points, as displayed (rotation applied). */
  width: number;
  height: number;
}

export interface RedactOptions {
  /** Also strip document metadata, as Sanitize does. */
  removeMetadata: boolean;
}

const N = {
  AcroForm: PDFName.of("AcroForm"),
  Annots: PDFName.of("Annots"),
  Contents: PDFName.of("Contents"),
  Fields: PDFName.of("Fields"),
  Kids: PDFName.of("Kids"),
  MarkInfo: PDFName.of("MarkInfo"),
  MediaBox: PDFName.of("MediaBox"),
  Parent: PDFName.of("Parent"),
  Resources: PDFName.of("Resources"),
  Rotate: PDFName.of("Rotate"),
  StructTreeRoot: PDFName.of("StructTreeRoot"),
  Type: PDFName.of("Type"),
};

/**
 * Replace each redacted page with a flat image of itself, boxes burned in. Everything the page
 * held (text, fonts, vector art, annotations, form fields, page metadata) is removed and purged
 * from the file, so the covered content can't be recovered by selecting, copying or editing.
 */
export async function applyRedactions(bytes: Uint8Array, pages: RedactedPage[], options: RedactOptions): Promise<Uint8Array> {
  if (pages.length === 0) throw new ProcessingError("Mark at least one area to redact.", "invalid");
  const doc = await loadPdf(bytes);
  const all = doc.getPages();
  const removedAnnotations = new Set<PDFRef>();

  for (const redacted of pages) {
    const page = all[redacted.index];
    if (!page) throw new ProcessingError("A redacted page is out of range.", "invalid");
    const annots = page.node.lookup(N.Annots);
    if (annots instanceof PDFArray) for (const ref of annots.asArray()) if (ref instanceof PDFRef) removedAnnotations.add(ref);

    const image = await doc.embedJpg(redacted.image);
    const { node } = page;
    for (const key of node.keys()) if (key !== N.Type && key !== N.Parent) node.delete(key);
    // Set everything a page could otherwise inherit from the page tree.
    const { width, height } = redacted;
    node.set(N.MediaBox, doc.context.obj([0, 0, width, height]));
    node.set(N.Rotate, doc.context.obj(0));
    node.set(N.Resources, doc.context.obj({ XObject: { Im0: image.ref } }));
    node.set(N.Contents, doc.context.register(doc.context.flateStream(`q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`)));
  }

  removeFormFields(doc, removedAnnotations);
  // Accessibility tags can repeat a page's text (ActualText, Alt); drop the structure tree.
  doc.catalog.delete(N.StructTreeRoot);
  doc.catalog.delete(N.MarkInfo);

  if (options.removeMetadata) await stripPdfDocument(doc, DEFAULT_STRIP_OPTIONS);
  else collectGarbage(doc);
  return savePdf(doc);
}

/** Remove form fields whose widgets sat on redacted pages; their values would otherwise survive in the form. */
function removeFormFields(doc: PDFDocument, widgets: Set<PDFRef>) {
  const form = doc.catalog.lookup(N.AcroForm);
  if (!(form instanceof PDFDict) || widgets.size === 0) return;
  const prune = (fields: PDFArray) => {
    for (let i = fields.size() - 1; i >= 0; i--) {
      const ref = fields.get(i);
      const field = fields.lookup(i);
      if (ref instanceof PDFRef && widgets.has(ref)) {
        fields.remove(i);
        continue;
      }
      const kids = field instanceof PDFDict ? field.lookup(N.Kids) : undefined;
      if (kids instanceof PDFArray) {
        prune(kids);
        if (kids.size() === 0) fields.remove(i);
      }
    }
  };
  const fields = form.lookup(N.Fields);
  if (fields instanceof PDFArray) prune(fields);
}
