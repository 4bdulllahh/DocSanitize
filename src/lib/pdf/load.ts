import { PDFArray, PDFDict, PDFDocument, PDFRef, PDFStream, type PDFObject } from "@cantoo/pdf-lib";
import { ProcessingError } from "../errors";
import { msg } from "@/i18n/msg";

/**
 * Load a PDF for editing. `updateMetadata: false` stops the library from stamping its own
 * Producer/ModDate — DocSanitize never adds metadata to a user's file.
 */
export async function loadPdf(bytes: Uint8Array, name?: string): Promise<PDFDocument> {
  const label = name ? `“${name}”` : msg("This PDF");
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  } catch (error) {
    if (error instanceof Error && /encrypt|password/i.test(error.message)) {
      throw new ProcessingError(`${label} is password-protected. Unlock it first.`, "encrypted");
    }
    throw new ProcessingError(`${label} couldn't be read as a PDF.`, "corrupt");
  }
  if (doc.isEncrypted) throw new ProcessingError(`${label} is password-protected. Unlock it first.`, "encrypted");
  return doc;
}

/** A new, empty document that carries no Producer/Creator/date metadata. */
export function createPdf(): Promise<PDFDocument> {
  return PDFDocument.create({ updateMetadata: false });
}

export function savePdf(doc: PDFDocument): Promise<Uint8Array> {
  // rewrite: never an incremental append that would keep the original bytes around.
  return doc.save({ rewrite: true, useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
}

/**
 * Delete every object no longer reachable from the trailer. pdf-lib writes out every object
 * it parsed, so without this, removed pages or metadata would silently remain in the file.
 */
export function collectGarbage(doc: PDFDocument) {
  const { context } = doc;
  const reachable = new Set<string>();
  const stack: PDFObject[] = [];
  const { Root, Info, Encrypt } = context.trailerInfo;
  for (const start of [Root, Info, Encrypt]) if (start) stack.push(start);

  while (stack.length > 0) {
    const obj = stack.pop();
    if (obj instanceof PDFRef) {
      const key = obj.toString();
      if (reachable.has(key)) continue;
      reachable.add(key);
      const target = context.lookup(obj);
      if (target) stack.push(target);
    } else if (obj instanceof PDFDict) {
      for (const [, value] of obj.entries()) stack.push(value);
    } else if (obj instanceof PDFArray) {
      stack.push(...obj.asArray());
    } else if (obj instanceof PDFStream) {
      stack.push(obj.dict);
    }
  }

  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) context.delete(ref);
  }
}
