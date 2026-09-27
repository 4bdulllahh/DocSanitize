import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, type PDFDocument } from "@cantoo/pdf-lib";
import { ProcessingError } from "../errors";
import { collectGarbage, loadPdf, savePdf } from "./load";

// ---------------------------------------------------------------------------- Document properties

export const INFO_FIELDS = ["Title", "Author", "Subject", "Keywords", "Creator", "Producer"] as const;
export type InfoField = (typeof INFO_FIELDS)[number];

export interface DocumentInfo {
  fields: Record<InfoField, string>;
  /** ISO strings (or "" when absent). */
  created: string;
  modified: string;
  /** Whether the file also has an XMP metadata packet (it's removed on save; see writeInfo). */
  hasXmp: boolean;
}

function infoDict(doc: PDFDocument): PDFDict | null {
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  return info instanceof PDFDict ? info : null;
}

function text(value: unknown): string {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  if (value instanceof PDFName) return value.decodeText();
  return "";
}

/** "D:20260314092653+04'00'" -> ISO; "" if it can't be read. */
export function parsePdfDate(raw: string): string {
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(raw.trim());
  if (!m) return "";
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00", sign, oh = "00", om = "00"] = m;
  const zone = !sign || sign.toUpperCase() === "Z" ? "Z" : `${sign}${oh}:${om}`;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${zone}`);
  return isNaN(date.getTime()) ? "" : date.toISOString();
}

export function toPdfDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export async function readInfo(bytes: Uint8Array): Promise<DocumentInfo> {
  const doc = await loadPdf(bytes);
  const info = infoDict(doc);
  const get = (key: string) => (info ? text(info.lookup(PDFName.of(key))) : "");
  return {
    fields: Object.fromEntries(INFO_FIELDS.map((k) => [k, get(k)])) as Record<InfoField, string>,
    created: parsePdfDate(get("CreationDate")),
    modified: parsePdfDate(get("ModDate")),
    hasXmp: doc.catalog.has(PDFName.of("Metadata")),
  };
}

/**
 * Set the document properties exactly as given (empty fields are removed). The XMP packet, which
 * holds its own copy of these values and would contradict them, is removed.
 */
export async function writeInfo(bytes: Uint8Array, info: Omit<DocumentInfo, "hasXmp">): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const entries: Record<string, PDFHexString | PDFString> = {};
  for (const key of INFO_FIELDS) if (info.fields[key].trim()) entries[key] = PDFHexString.fromText(info.fields[key].trim());
  for (const [key, iso] of [["CreationDate", info.created], ["ModDate", info.modified]] as const) {
    if (!iso) continue;
    if (isNaN(new Date(iso).getTime())) throw new ProcessingError("A date isn't valid.", "invalid");
    entries[key] = PDFString.of(toPdfDate(iso));
  }
  if (Object.keys(entries).length) doc.context.trailerInfo.Info = doc.context.register(doc.context.obj(entries));
  else delete doc.context.trailerInfo.Info;
  doc.catalog.delete(PDFName.of("Metadata"));
  collectGarbage(doc);
  return savePdf(doc);
}

// ---------------------------------------------------------------------------- Bookmarks

export interface Bookmark {
  title: string;
  /** 0-based target page, or null when it points nowhere this editor understands. */
  page: number | null;
  /** 0 for top level. */
  level: number;
}

const MAX_BOOKMARKS = 5000;

/** Resolve an outline item's destination to a page ref (explicit arrays, named destinations and GoTo actions). */
function destinationPage(doc: PDFDocument, item: PDFDict): PDFRef | null {
  let dest: unknown = item.lookup(PDFName.of("Dest"));
  if (!dest) {
    const action = item.lookup(PDFName.of("A"));
    if (action instanceof PDFDict && text(action.lookup(PDFName.of("S"))) === "GoTo") dest = action.lookup(PDFName.of("D"));
  }
  if (dest instanceof PDFName || dest instanceof PDFString || dest instanceof PDFHexString) dest = namedDestination(doc, text(dest));
  if (dest instanceof PDFDict) dest = dest.lookup(PDFName.of("D"));
  if (dest instanceof PDFArray) {
    const first = dest.get(0);
    return first instanceof PDFRef ? first : null;
  }
  return null;
}

function namedDestination(doc: PDFDocument, name: string): unknown {
  const old = doc.catalog.lookup(PDFName.of("Dests"));
  if (old instanceof PDFDict) {
    const hit = old.lookup(PDFName.of(name));
    if (hit) return hit;
  }
  const names = doc.catalog.lookup(PDFName.of("Names"));
  const tree = names instanceof PDFDict ? names.lookup(PDFName.of("Dests")) : undefined;
  // Walk the name tree (depth-limited).
  const search = (node: unknown, depth: number): unknown => {
    if (!(node instanceof PDFDict) || depth > 32) return undefined;
    const leaf = node.lookup(PDFName.of("Names"));
    if (leaf instanceof PDFArray) {
      for (let i = 0; i + 1 < leaf.size(); i += 2) if (text(leaf.lookup(i)) === name) return leaf.lookup(i + 1);
    }
    const kids = node.lookup(PDFName.of("Kids"));
    if (kids instanceof PDFArray) {
      for (const kid of kids.asArray()) {
        const found = search(doc.context.lookup(kid), depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  };
  return search(tree, 0);
}

export async function readBookmarks(bytes: Uint8Array): Promise<Bookmark[]> {
  const doc = await loadPdf(bytes);
  const pageIndex = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i]));
  const outlines = doc.catalog.lookup(PDFName.of("Outlines"));
  const out: Bookmark[] = [];
  const seen = new Set<string>();
  const walk = (first: unknown, level: number) => {
    let ref = first;
    while (ref instanceof PDFRef && !seen.has(ref.toString()) && out.length < MAX_BOOKMARKS && level < 32) {
      seen.add(ref.toString());
      const item = doc.context.lookup(ref);
      if (!(item instanceof PDFDict)) break;
      const target = destinationPage(doc, item);
      out.push({ title: text(item.lookup(PDFName.of("Title"))), page: target ? (pageIndex.get(target.toString()) ?? null) : null, level });
      walk(item.get(PDFName.of("First")), level + 1);
      ref = item.get(PDFName.of("Next"));
    }
  };
  if (outlines instanceof PDFDict) walk(outlines.get(PDFName.of("First")), 0);
  return out;
}

/**
 * Replace the document's bookmarks. `level` may go up by at most one from one bookmark to the
 * next. Bookmarks open at the top of their page; all are shown expanded.
 */
export async function writeBookmarks(bytes: Uint8Array, bookmarks: Bookmark[]): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const { context } = doc;
  doc.catalog.delete(PDFName.of("Outlines"));
  if (bookmarks.length) {
    bookmarks.forEach((b, i) => {
      if (!b.title.trim()) throw new ProcessingError(`Bookmark ${i + 1} has no title.`, "invalid");
      if (b.page !== null && (b.page < 0 || b.page >= pages.length)) throw new ProcessingError(`Bookmark “${b.title}” points to a page that doesn't exist.`, "invalid");
      if (b.level < 0 || (i === 0 ? b.level !== 0 : b.level > bookmarks[i - 1].level + 1)) throw new ProcessingError(`Bookmark “${b.title}” is indented too far.`, "invalid");
    });
    const rootRef = context.nextRef();
    const refs = bookmarks.map(() => context.nextRef());
    const dicts = bookmarks.map((b) => {
      const dict = context.obj({ Title: PDFHexString.fromText(b.title.trim()) });
      if (b.page !== null) dict.set(PDFName.of("Dest"), context.obj([pages[b.page].ref, PDFName.of("Fit")]));
      return dict;
    });
    // Link each item to its parent, siblings and children.
    const childrenOf = new Map<number, number[]>(); // -1 = root
    const stack: number[] = [];
    bookmarks.forEach((b, i) => {
      stack.length = b.level;
      const parent = stack.length ? stack[stack.length - 1] : -1;
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), i]);
      stack.push(i);
    });
    const descendants = (i: number): number => (childrenOf.get(i) ?? []).reduce((n, c) => n + 1 + descendants(c), 0);
    for (const [parent, children] of childrenOf) {
      const parentDict = parent === -1 ? null : dicts[parent];
      children.forEach((c, k) => {
        dicts[c].set(PDFName.of("Parent"), parent === -1 ? rootRef : refs[parent]);
        if (k > 0) dicts[c].set(PDFName.of("Prev"), refs[children[k - 1]]);
        if (k < children.length - 1) dicts[c].set(PDFName.of("Next"), refs[children[k + 1]]);
      });
      if (parentDict) {
        parentDict.set(PDFName.of("First"), refs[children[0]]);
        parentDict.set(PDFName.of("Last"), refs[children[children.length - 1]]);
        parentDict.set(PDFName.of("Count"), PDFNumber.of(descendants(parent)));
      }
    }
    dicts.forEach((d, i) => context.assign(refs[i], d));
    const top = childrenOf.get(-1)!;
    context.assign(rootRef, context.obj({ Type: "Outlines", First: refs[top[0]], Last: refs[top[top.length - 1]], Count: bookmarks.length }));
    doc.catalog.set(PDFName.of("Outlines"), rootRef);
  }
  collectGarbage(doc);
  return savePdf(doc);
}
