import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
  type PDFContext,
  type PDFObject,
} from "@cantoo/pdf-lib";
import { utf8 } from "./bytes";
import { entry } from "./classify";
import { auditJpeg, isJpeg, stripJpeg } from "./jpeg";
import { MetadataError, type MetadataEntry, type MetadataReport, type StripOptions } from "./types";
import { xmpEntries } from "./xmp";

const N = {
  Metadata: PDFName.of("Metadata"),
  PieceInfo: PDFName.of("PieceInfo"),
  Names: PDFName.of("Names"),
  Kids: PDFName.of("Kids"),
  EmbeddedFiles: PDFName.of("EmbeddedFiles"),
  JavaScript: PDFName.of("JavaScript"),
  OpenAction: PDFName.of("OpenAction"),
  AA: PDFName.of("AA"),
  AF: PDFName.of("AF"),
  S: PDFName.of("S"),
  Annots: PDFName.of("Annots"),
  Subtype: PDFName.of("Subtype"),
  Type: PDFName.of("Type"),
  Filter: PDFName.of("Filter"),
  T: PDFName.of("T"),
  M: PDFName.of("M"),
  CreationDate: PDFName.of("CreationDate"),
  NM: PDFName.of("NM"),
  FileAttachment: PDFName.of("FileAttachment"),
  Image: PDFName.of("Image"),
  DCTDecode: PDFName.of("DCTDecode"),
};

// Info dictionary keys whose generic classification would be misleading.
const INFO_KEYS: Record<string, { label: string; sensitivity?: MetadataEntry["sensitivity"] }> = {
  Title: { label: "Title" },
  Author: { label: "Author", sensitivity: "high" },
  Subject: { label: "Subject" },
  Keywords: { label: "Keywords" },
  Creator: { label: "Creator application", sensitivity: "medium" },
  Producer: { label: "PDF producer", sensitivity: "medium" },
  CreationDate: { label: "Created" },
  ModDate: { label: "Modified" },
  Trapped: { label: "Trapped", sensitivity: "low" },
};

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    // updateMetadata: false — otherwise the library stamps its own Producer/ModDate on load.
    doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  } catch (error) {
    if (error instanceof Error && /encrypt|password/i.test(error.message)) {
      throw new MetadataError("This PDF is password-protected. Unlock it first, then sanitize it.", "encrypted");
    }
    throw new MetadataError("This file couldn't be read as a PDF.", "corrupt");
  }
  if (doc.isEncrypted) {
    throw new MetadataError("This PDF is password-protected. Unlock it first, then sanitize it.", "encrypted");
  }
  return doc;
}

/** "D:20240115093000+01'00'" -> Date */
function parsePdfDate(value: string): Date | null {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?)?/.exec(value);
  if (!m) return null;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00", tz] = m;
  let offset = "Z";
  if (tz && tz !== "Z") offset = `${tz.slice(0, 3)}:${tz.replace(/'/g, "").slice(3, 5) || "00"}`;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`);
  return isNaN(date.getTime()) ? null : date;
}

function toValue(obj: PDFObject | undefined): unknown {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    const text = obj.decodeText();
    return parsePdfDate(text) ?? text;
  }
  if (obj instanceof PDFName) return obj.decodeText();
  if (obj instanceof PDFNumber) return obj.asNumber();
  if (obj instanceof PDFBool) return obj.asBoolean();
  if (obj instanceof PDFArray) return obj.asArray().map(toValue);
  if (obj instanceof PDFDict || obj instanceof PDFStream) return "(structured data)";
  return obj?.toString();
}

function readStream(stream: PDFObject | undefined): string | null {
  if (!(stream instanceof PDFRawStream)) return null;
  try {
    return utf8.decode(decodePDFRawStream(stream).decode());
  } catch {
    return null;
  }
}

/** Collect the keys of a PDF name tree (e.g. embedded file names). */
function nameTreeKeys(context: PDFContext, node: PDFObject | undefined, seen = new Set<PDFDict>()): string[] {
  const dict = node instanceof PDFRef ? context.lookup(node) : node;
  if (!(dict instanceof PDFDict) || seen.has(dict)) return [];
  seen.add(dict);
  const keys: string[] = [];
  const names = dict.lookup(N.Names);
  if (names instanceof PDFArray) {
    for (let i = 0; i < names.size(); i += 2) keys.push(String(toValue(names.lookup(i)) ?? ""));
  }
  const kids = dict.lookup(N.Kids);
  if (kids instanceof PDFArray) {
    for (let i = 0; i < kids.size(); i++) keys.push(...nameTreeKeys(context, kids.get(i), seen));
  }
  return keys;
}

function isJavaScriptAction(obj: PDFObject | undefined): boolean {
  return obj instanceof PDFDict && obj.lookup(N.S) === N.JavaScript;
}

/** Count saved revisions: each incremental update appends another %%EOF. */
function countRevisions(bytes: Uint8Array): number {
  const marker = [0x25, 0x25, 0x45, 0x4f, 0x46]; // %%EOF
  let count = 0;
  for (let i = bytes.indexOf(0x25); i !== -1 && i < bytes.length; i = bytes.indexOf(0x25, i + 1)) {
    if (marker.every((b, j) => bytes[i + j] === b)) count++;
  }
  // A linearized ("fast web view") file legitimately has two.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("/Linearized") ? Math.max(1, count - 1) : count;
}

function objectKind(dict: PDFDict): string {
  const type = dict.lookup(N.Type);
  const subtype = dict.lookup(N.Subtype);
  if (type === PDFName.of("Catalog")) return "Document";
  if (type === PDFName.of("Page")) return "Page";
  if (subtype === N.Image) return "Image";
  if (subtype === PDFName.of("Form")) return "Form object";
  return "Object";
}

/** Raw JPEG bytes of an image XObject that is stored as a plain DCT stream, or null. */
function jpegImage(obj: PDFObject): Uint8Array | null {
  if (!(obj instanceof PDFRawStream) || obj.dict.lookup(N.Subtype) !== N.Image) return null;
  if (obj.dict.lookup(N.Filter) !== N.DCTDecode) return null;
  return isJpeg(obj.contents) ? obj.contents : null;
}

export async function auditPdf(bytes: Uint8Array): Promise<MetadataReport> {
  const doc = await load(bytes);
  const { context, catalog } = doc;
  const entries: MetadataEntry[] = [];
  const push = (e: MetadataEntry | null) => e && entries.push(e);

  // 1. Document Info dictionary
  const info = context.lookup(context.trailerInfo.Info);
  if (info instanceof PDFDict) {
    for (const [key, value] of info.entries()) {
      const name = key.decodeText();
      const known = INFO_KEYS[name];
      push(entry("Document info", name, toValue(value), known ?? {}));
    }
  }

  // 2. File identifier
  const id = context.trailerInfo.ID;
  const idArray = id instanceof PDFArray ? id : context.lookup(id);
  if (idArray instanceof PDFArray && idArray.size() > 0) {
    const first = idArray.get(0);
    const hex = first instanceof PDFHexString ? first.asString() : first instanceof PDFString ? first.asString() : "";
    push(entry("Document info", "ID", hex, { label: "Document ID", sensitivity: "medium" }));
  }

  // 3. XMP packets and private application data attached to any object
  let pieceInfo = 0;
  let imageIndex = 0;
  let location: MetadataReport["location"];
  for (const [, obj] of context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
    if (!dict) continue;
    const xml = dict.has(N.Metadata) ? readStream(dict.lookup(N.Metadata)) : null;
    if (xml) entries.push(...xmpEntries(xml, objectKind(dict) === "Document" ? "XMP metadata" : `XMP (${objectKind(dict).toLowerCase()})`));
    if (dict.has(N.PieceInfo)) pieceInfo++;

    const jpeg = jpegImage(obj);
    if (jpeg) {
      imageIndex++;
      try {
        const report = await auditJpeg(jpeg);
        entries.push(...report.entries.map((e) => ({ ...e, group: `Embedded photo ${imageIndex}` })));
        location ??= report.location;
      } catch {
        // Not a parseable JPEG header — nothing to report.
      }
    }
  }
  if (pieceInfo > 0) {
    push(entry("Hidden content", "PieceInfo", `${pieceInfo} object${pieceInfo === 1 ? "" : "s"} — editing apps (e.g. Illustrator) can store the original editable file here`, { label: "Private application data", sensitivity: "high" }));
  }

  // 4. Comments / annotations
  const authors = new Set<string>();
  let timestamps = 0;
  let attachmentAnnots = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(N.Annots);
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict)) continue;
      const author = toValue(annot.lookup(N.T));
      if (typeof author === "string" && author.trim()) authors.add(author.trim());
      if (annot.has(N.M) || annot.has(N.CreationDate)) timestamps++;
      if (annot.lookup(N.Subtype) === N.FileAttachment) attachmentAnnots++;
    }
  }
  if (authors.size > 0) push(entry("Comments", "AnnotationAuthors", [...authors], { label: "Comment authors", sensitivity: "high" }));
  if (timestamps > 0) push(entry("Comments", "AnnotationDates", `${timestamps} comment${timestamps === 1 ? "" : "s"} with timestamps`, { label: "Comment timestamps", sensitivity: "medium" }));

  // 5. Attachments and scripts
  const names = catalog.lookup(N.Names);
  const files = names instanceof PDFDict ? nameTreeKeys(context, names.get(N.EmbeddedFiles)) : [];
  if (files.length > 0) push(entry("Hidden content", "EmbeddedFiles", files, { label: "Attached files", sensitivity: "high" }));
  if (attachmentAnnots > 0) push(entry("Hidden content", "FileAttachmentAnnots", `${attachmentAnnots} file${attachmentAnnots === 1 ? "" : "s"} attached to comments`, { label: "Comment attachments", sensitivity: "high" }));

  const scripts = names instanceof PDFDict ? nameTreeKeys(context, names.get(N.JavaScript)) : [];
  const autoRun = isJavaScriptAction(catalog.lookup(N.OpenAction)) || catalog.has(N.AA);
  if (scripts.length > 0 || autoRun) {
    push(entry("Hidden content", "JavaScript", scripts.length > 0 ? `${scripts.length} script${scripts.length === 1 ? "" : "s"}${autoRun ? ", runs on open" : ""}` : "Runs when the document opens", { label: "Document JavaScript", sensitivity: "medium" }));
  }

  // 6. Earlier revisions left behind by incremental saves
  const revisions = countRevisions(bytes);
  if (revisions > 1) {
    push(entry("Hidden content", "Revisions", `${revisions - 1} earlier version${revisions === 2 ? "" : "s"} saved inside the file — deleted or changed content may be recoverable`, { label: "Previous revisions", sensitivity: "high" }));
  }

  return { format: "pdf", entries, kept: [], location };
}

/** Delete every object that can no longer be reached from the trailer, so detached metadata isn't written back out. */
function collectGarbage(doc: PDFDocument) {
  const { context } = doc;
  const reachable = new Set<string>();
  const stack: PDFObject[] = [];
  if (context.trailerInfo.Root) stack.push(context.trailerInfo.Root);
  if (context.trailerInfo.Info) stack.push(context.trailerInfo.Info);
  if (context.trailerInfo.Encrypt) stack.push(context.trailerInfo.Encrypt);

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

export async function stripPdf(bytes: Uint8Array, options: StripOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const { context, catalog } = doc;

  // Document Info and file identifier
  context.trailerInfo.Info = undefined;
  context.trailerInfo.ID = undefined;

  // XMP packets, private application data, and camera metadata inside embedded photos
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
    if (!dict) continue;
    dict.delete(N.Metadata);
    dict.delete(N.PieceInfo);

    const jpeg = jpegImage(obj);
    if (jpeg && obj instanceof PDFRawStream) {
      try {
        const clean = await stripJpeg(jpeg, options);
        context.assign(ref, PDFRawStream.of(obj.dict, clean));
      } catch {
        // Leave an unparseable image untouched rather than corrupting the page.
      }
    }
  }

  // Comments
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(N.Annots);
    if (!(annots instanceof PDFArray)) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict)) continue;
      if (options.removeAttachments && annot.lookup(N.Subtype) === N.FileAttachment) {
        annots.remove(i);
        continue;
      }
      if (options.anonymizeAnnotations) {
        annot.delete(N.T);
        annot.delete(N.M);
        annot.delete(N.CreationDate);
        annot.delete(N.NM);
      }
    }
    if (options.removeJavaScript) page.node.delete(N.AA);
  }

  // Attachments and scripts
  const names = catalog.lookup(N.Names);
  if (options.removeAttachments) {
    if (names instanceof PDFDict) names.delete(N.EmbeddedFiles);
    catalog.delete(N.AF);
  }
  if (options.removeJavaScript) {
    if (names instanceof PDFDict) names.delete(N.JavaScript);
    if (isJavaScriptAction(catalog.lookup(N.OpenAction))) catalog.delete(N.OpenAction);
    catalog.delete(N.AA);
  }

  collectGarbage(doc);
  // rewrite: a full rewrite, never an incremental append (which would keep the original bytes
  // and every earlier revision). The other flags stop the library from adding anything.
  return doc.save({ rewrite: true, useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
}
