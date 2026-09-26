import { degrees, PDFName, PDFNumber, PDFRef } from "@cantoo/pdf-lib";
import { ProcessingError } from "../errors";
import { collectGarbage, createPdf, loadPdf, savePdf } from "./load";

export interface NamedPdf {
  name: string;
  bytes: Uint8Array;
}

/** Combine documents in order into one new PDF. */
export async function mergePdfs(files: NamedPdf[]): Promise<Uint8Array> {
  if (files.length < 2) throw new ProcessingError("Choose at least two PDFs to merge.", "invalid");
  const out = await createPdf();
  for (const file of files) {
    const src = await loadPdf(file.bytes, file.name);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  return savePdf(out);
}

/** Build one new PDF per group of 0-based page indices. */
export async function extractPages(bytes: Uint8Array, groups: number[][]): Promise<Uint8Array[]> {
  const src = await loadPdf(bytes);
  const count = src.getPageCount();
  const results: Uint8Array[] = [];
  for (const group of groups) {
    if (group.length === 0) throw new ProcessingError("Each part needs at least one page.", "invalid");
    if (group.some((i) => i < 0 || i >= count)) throw new ProcessingError("A page number is out of range.", "invalid");
    const out = await createPdf();
    const pages = await out.copyPages(src, group);
    for (const page of pages) out.addPage(page);
    results.push(await savePdf(out));
  }
  return results;
}

export interface PageEdit {
  /** 0-based index of the page in the original document. */
  index: number;
  /** Extra clockwise rotation in degrees (multiple of 90). */
  rotate: number;
}

/**
 * Reorder, rotate and drop pages. Pages not listed are deleted. Edits the original document in
 * place, so links, bookmarks and form fields survive, and deleted pages are purged from the file.
 */
export async function rearrangePages(bytes: Uint8Array, edits: PageEdit[]): Promise<Uint8Array> {
  if (edits.length === 0) throw new ProcessingError("Keep at least one page.", "invalid");
  const doc = await loadPdf(bytes);
  const original = doc.getPages();
  const seen = new Set<number>();
  for (const { index, rotate } of edits) {
    if (index < 0 || index >= original.length || seen.has(index)) {
      throw new ProcessingError("The page list is invalid.", "invalid");
    }
    if (rotate % 90 !== 0) throw new ProcessingError("Pages can only be rotated in steps of 90°.", "invalid");
    seen.add(index);
  }

  // Copy inherited attributes onto each page so they survive flattening the page tree.
  for (const page of original) {
    for (const key of INHERITABLE) {
      const value = page.node.getInheritableAttribute(key);
      if (value && !page.node.has(key)) page.node.set(key, value);
    }
  }
  for (const { index, rotate } of edits) {
    const page = original[index];
    if (rotate) page.setRotation(degrees((((page.getRotation().angle + rotate) % 360) + 360) % 360));
  }

  // Replace the page tree with a single flat node holding the kept pages in their new order.
  const pagesRef = doc.catalog.get(PDFName.of("Pages"));
  if (!(pagesRef instanceof PDFRef)) throw new ProcessingError("This PDF's page structure is damaged.", "corrupt");
  const root = doc.catalog.Pages();
  root.set(PDFName.of("Kids"), doc.context.obj(edits.map(({ index }) => original[index].ref)));
  root.set(PDFName.of("Count"), PDFNumber.of(edits.length));
  for (const key of INHERITABLE) root.delete(key);
  for (const { index } of edits) original[index].node.set(PDFName.of("Parent"), pagesRef);

  // Deleted pages can still be referenced by bookmarks or links; empty them so no content survives.
  original.forEach((page, i) => {
    if (seen.has(i)) return;
    for (const key of page.node.keys()) if (key !== PDFName.of("Type")) page.node.delete(key);
  });

  collectGarbage(doc);
  return savePdf(doc);
}

const INHERITABLE = ["Resources", "MediaBox", "CropBox", "Rotate"].map((k) => PDFName.of(k));
