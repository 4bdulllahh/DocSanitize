import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { ProcessingError } from "../errors";
import { plural, type Finding } from "./findings";
import { attr, elements, hasDescendant, parseXml, serializeXml, stripAttributes, textOf, transform, type XmlElement, type XmlNode } from "./xml-tree";

/*
 * What's hidden in a Word, Excel or PowerPoint file (Office Open XML: a ZIP of XML parts) and a
 * cleaner for it. Reads and edits the parts directly; nothing is converted, so the cleaned file
 * is the same document minus what was removed.
 */

export type OfficeKind = "word" | "excel" | "powerpoint";

type Package = Record<string, Uint8Array>;

const xmlOf = (pkg: Package, path: string): XmlNode[] | null => (pkg[path] ? parseXml(strFromU8(pkg[path])) : null);
const put = (pkg: Package, path: string, nodes: XmlNode[]) => (pkg[path] = strToU8(serializeXml(nodes)));
const partsIn = (pkg: Package, pattern: RegExp) => Object.keys(pkg).filter((p) => pattern.test(p));

function kindOf(pkg: Package): OfficeKind {
  if (pkg["word/document.xml"]) return "word";
  if (pkg["xl/workbook.xml"]) return "excel";
  if (pkg["ppt/presentation.xml"]) return "powerpoint";
  throw new ProcessingError("This isn't a Word, Excel or PowerPoint file DocSanitize can read. Only .docx, .xlsx and .pptx files (Office 2007 and later) can be inspected.", "unsupported");
}

function open(bytes: Uint8Array): Package {
  try {
    return unzipSync(bytes);
  } catch {
    throw new ProcessingError("This file isn't a .docx, .xlsx or .pptx document (it couldn't be opened as one). Older .doc, .xls and .ppt files, and OpenDocument files, aren't supported.", "unsupported");
  }
}

// ---------------------------------------------------------------------------- Relationships

/** "word/_rels/document.xml.rels" -> "word/document.xml"'s folder, "word/". */
const relsBase = (relsPath: string) => relsPath.replace(/_rels\/[^/]*\.rels$/, "");

/** Resolve a relationship target against the folder of its source part. */
export function resolveTarget(base: string, target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : base + target).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

interface Relationship {
  rels: string;
  id: string;
  type: string;
  target: string;
  external: boolean;
}

function relationships(pkg: Package): Relationship[] {
  const out: Relationship[] = [];
  for (const rels of partsIn(pkg, /\.rels$/)) {
    for (const el of elements(xmlOf(pkg, rels)!)) {
      if (el.name !== "Relationship") continue;
      const external = attr(el, "TargetMode") === "External";
      const target = attr(el, "Target") ?? "";
      out.push({ rels, id: attr(el, "Id") ?? "", type: (attr(el, "Type") ?? "").split("/").pop() ?? "", target: external ? target : resolveTarget(relsBase(rels), target), external });
    }
  }
  return out;
}

/** Delete parts, with their content-type overrides and every relationship pointing at them. */
function removeParts(pkg: Package, paths: string[]) {
  const gone = new Set(paths.filter((p) => pkg[p]));
  if (gone.size === 0) return;
  for (const path of gone) {
    delete pkg[path];
    const ownRels = path.replace(/([^/]+)$/, "_rels/$1.rels");
    delete pkg[ownRels];
  }
  const types = xmlOf(pkg, "[Content_Types].xml");
  if (types) put(pkg, "[Content_Types].xml", transform(types, (el) => (el.name === "Override" && gone.has((attr(el, "PartName") ?? "").replace(/^\//, "")) ? "drop" : "keep")));
  for (const rels of partsIn(pkg, /\.rels$/)) {
    const base = relsBase(rels);
    const nodes = xmlOf(pkg, rels)!;
    let changed = false;
    const kept = transform(nodes, (el) => {
      if (el.name !== "Relationship" || attr(el, "TargetMode") === "External") return "keep";
      if (!gone.has(resolveTarget(base, attr(el, "Target") ?? ""))) return "keep";
      changed = true;
      return "drop";
    });
    if (changed) put(pkg, rels, kept);
  }
}

/** Remove relationships (by source .rels and id), e.g. an external template reference. */
function removeRelationships(pkg: Package, drop: Relationship[]) {
  for (const rels of new Set(drop.map((r) => r.rels))) {
    const ids = new Set(drop.filter((r) => r.rels === rels).map((r) => r.id));
    put(pkg, rels, transform(xmlOf(pkg, rels)!, (el) => (el.name === "Relationship" && ids.has(attr(el, "Id") ?? "") ? "drop" : "keep")));
  }
}

// ---------------------------------------------------------------------------- Inspection

const CORE_LABELS: Record<string, string> = {
  "dc:creator": "Author",
  "cp:lastModifiedBy": "Last saved by",
  "dcterms:created": "Created",
  "dcterms:modified": "Modified",
  "cp:lastPrinted": "Last printed",
  "dc:title": "Title",
  "dc:subject": "Subject",
  "cp:keywords": "Keywords",
  "dc:description": "Comments",
  "cp:category": "Category",
  "cp:contentStatus": "Status",
  "cp:revision": "Revision number",
};
const APP_LABELS: Record<string, string> = { Company: "Company", Manager: "Manager", TotalTime: "Editing time (minutes)", Template: "Template", HyperlinkBase: "Hyperlink base" };

const MAX_ITEMS = 40;
const snippet = (text: string, max = 100) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
};

/** Parts holding a Word document's text: body, headers, footers, footnotes, endnotes. */
const wordStories = (pkg: Package) => partsIn(pkg, /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/);

export interface OfficeInspection {
  kind: OfficeKind;
  findings: Finding[];
  /** What the cleaner can remove. */
  removable: Record<keyof OfficeCleanOptions, boolean>;
}

export function inspectOffice(bytes: Uint8Array): OfficeInspection {
  const pkg = open(bytes);
  const kind = kindOf(pkg);
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);
  const people = new Set<string>();
  const rels = relationships(pkg);

  // Document properties.
  const properties: string[] = [];
  for (const el of elements(xmlOf(pkg, "docProps/core.xml") ?? [])) {
    const value = textOf(el).trim();
    if (CORE_LABELS[el.name] && value) {
      properties.push(`${CORE_LABELS[el.name]}: ${value}`);
      if (el.name === "dc:creator" || el.name === "cp:lastModifiedBy") people.add(value);
    }
  }
  for (const el of elements(xmlOf(pkg, "docProps/app.xml") ?? [])) {
    const value = textOf(el).trim();
    if (APP_LABELS[el.name] && value && !(el.name === "TotalTime" && value === "0")) properties.push(`${APP_LABELS[el.name]}: ${value}`);
  }
  const custom = [...elements(xmlOf(pkg, "docProps/custom.xml") ?? [])].filter((el) => el.name === "property").map((el) => `${attr(el, "name")}: ${textOf(el).trim()}`);
  if (properties.length || custom.length) {
    add({ id: "properties", severity: "medium", title: "Document properties", detail: custom.length ? `Including ${plural(custom.length, "custom property", "custom properties")}, which companies use for client names, case numbers and the like.` : "Shown in File > Info, and to anyone who checks the file's properties.", items: [...properties, ...custom] });
  }

  // Comments.
  const commentParts = partsIn(pkg, /^(word\/comments\.xml|xl\/comments\d*\.xml|xl\/threadedComments\/.*\.xml|ppt\/comments\/.*\.xml)$/);
  const comments: string[] = [];
  for (const part of commentParts) {
    for (const el of elements(xmlOf(pkg, part)!)) {
      // Excel's legacy comments list their authors separately.
      if (el.name === "author" && textOf(el).trim()) people.add(textOf(el).trim());
      if (!["w:comment", "comment", "threadedComment", "p:cm", "p188:cm"].includes(el.name)) continue;
      const author = attr(el, "w:author") ?? attr(el, "authorId");
      if (el.name === "w:comment" && author) people.add(author);
      const body = textOf(el);
      if (body.trim()) comments.push(`${el.name === "w:comment" && author ? `${author}: ` : ""}${snippet(body)}`);
    }
  }
  for (const el of elements([...(xmlOf(pkg, "ppt/commentAuthors.xml") ?? []), ...(xmlOf(pkg, "ppt/authors.xml") ?? []), ...(xmlOf(pkg, "xl/persons/person.xml") ?? [])])) {
    const name = attr(el, "name") ?? attr(el, "displayName");
    if (name && ["p:cmAuthor", "p188:author", "person"].includes(el.name)) people.add(name);
  }
  if (commentParts.length) add({ id: "comments", severity: "high", title: `${plural(comments.length || commentParts.length, "comment")}`, detail: "Review comments travel with the file even when they're hidden from view.", items: comments.slice(0, MAX_ITEMS) });

  // Word: tracked changes, hidden text, document variables, template path.
  if (kind === "word") {
    let inserted = 0;
    let deleted = 0;
    const deletedText: string[] = [];
    let hidden = 0;
    const hiddenText: string[] = [];
    for (const part of wordStories(pkg)) {
      for (const el of elements(xmlOf(pkg, part)!)) {
        if (el.name === "w:ins" || el.name === "w:moveTo") inserted++;
        if (el.name === "w:del" || el.name === "w:moveFrom") {
          deleted++;
          const t = [...elements(el.children)].filter((c) => c.name === "w:delText" || c.name === "w:t").map((c) => textOf(c)).join("");
          if (t.trim()) deletedText.push(`Deleted: “${snippet(t)}”`);
        }
        if (["w:ins", "w:del", "w:moveTo", "w:moveFrom", "w:rPrChange", "w:pPrChange"].includes(el.name)) {
          const author = attr(el, "w:author");
          if (author) people.add(author);
        }
        if (el.name === "w:r" && el.children.some((c) => c.type === "element" && c.name === "w:rPr" && hasDescendant(c, "w:vanish"))) {
          hidden++;
          const t = textOf(el);
          if (t.trim()) hiddenText.push(snippet(t));
        }
      }
    }
    if (inserted || deleted) add({ id: "tracked", severity: "high", title: `${plural(inserted + deleted, "tracked change")} not yet accepted`, detail: "Deleted text is still in the file and shows again with Track Changes on. Accepting the changes removes it.", items: deletedText.slice(0, MAX_ITEMS) });
    if (hidden) add({ id: "hidden-text", severity: "high", title: `${plural(hidden, "piece")} of hidden text`, detail: "Text formatted as hidden doesn't print or show, but it's in the file and appears with formatting marks on.", items: hiddenText.slice(0, MAX_ITEMS) });
    const settings = xmlOf(pkg, "word/settings.xml") ?? [];
    const vars = [...elements(settings)].filter((el) => el.name === "w:docVar").map((el) => `${attr(el, "w:name")}: ${snippet(attr(el, "w:val") ?? "")}`);
    if (vars.length) add({ id: "docvars", severity: "medium", title: `${plural(vars.length, "document variable")}`, detail: "Values stored by templates and add-ins, invisible in the document.", items: vars });
    if ([...elements(settings)].some((el) => el.name === "w:rsids")) add({ id: "rsids", severity: "info", title: "Editing-session IDs", detail: "Word tags each edit with a session number. They can show which documents were edited together, or on the same computer." });
  }

  // Excel: hidden sheets, rows and columns; pivot data; connections.
  if (kind === "excel") {
    const workbook = xmlOf(pkg, "xl/workbook.xml")!;
    const sheets = [...elements(workbook)].filter((el) => el.name === "sheet");
    const hiddenSheets = sheets.filter((s) => attr(s, "state") === "hidden" || attr(s, "state") === "veryHidden");
    if (hiddenSheets.length) {
      const very = hiddenSheets.some((s) => attr(s, "state") === "veryHidden");
      add({ id: "hidden-sheets", severity: "high", title: `${plural(hiddenSheets.length, "hidden sheet")}`, detail: very ? "Some are “very hidden”: they don't appear in Excel's Unhide list at all." : "Anyone can unhide them in Excel.", items: hiddenSheets.map((s) => `${attr(s, "name")}${attr(s, "state") === "veryHidden" ? " (very hidden)" : ""}`) });
    }
    let rows = 0;
    let columns = 0;
    for (const part of partsIn(pkg, /^xl\/worksheets\/sheet\d+\.xml$/)) {
      for (const el of elements(xmlOf(pkg, part)!)) {
        if (el.name === "row" && attr(el, "hidden") === "1") rows++;
        if (el.name === "col" && attr(el, "hidden") === "1") columns += Number(attr(el, "max") ?? 0) - Number(attr(el, "min") ?? 0) + 1;
      }
    }
    if (rows || columns) add({ id: "hidden-cells", severity: "high", title: `Hidden ${[rows && plural(rows, "row"), columns && plural(columns, "column")].filter(Boolean).join(" and ")}`, detail: "Their contents are in the file and anyone can unhide them." });
    const pivots = partsIn(pkg, /^xl\/pivotCache\/pivotCacheRecords\d*\.xml$/);
    if (pivots.length) add({ id: "pivot", severity: "medium", title: `${plural(pivots.length, "pivot table cache")}`, detail: "Pivot tables keep their own copy of the source data, which stays in the file even if the source sheet is deleted." });
    const connections = [...elements(xmlOf(pkg, "xl/connections.xml") ?? [])].filter((el) => el.name === "connection").map((el) => attr(el, "name") ?? "Connection");
    if (connections.length) add({ id: "connections", severity: "medium", title: `${plural(connections.length, "data connection")}`, detail: "Links to databases or other files; connection details can name servers and accounts.", items: connections });
  }

  // PowerPoint: speaker notes and hidden slides.
  if (kind === "powerpoint") {
    const notes = partsIn(pkg, /^ppt\/notesSlides\/notesSlide\d+\.xml$/)
      .map((part) => snippet([...elements(xmlOf(pkg, part)!)].filter((el) => el.name === "a:t").map(textOf).join(" ")))
      .filter((t) => t && !/^\d+$/.test(t));
    if (notes.length) add({ id: "notes", severity: "medium", title: `Speaker notes on ${plural(notes.length, "slide")}`, detail: "Notes are shared with the file even though they don't show during the presentation.", items: notes.slice(0, MAX_ITEMS) });
    const hiddenSlides = partsIn(pkg, /^ppt\/slides\/slide\d+\.xml$/).filter((part) => {
      const root = [...elements(xmlOf(pkg, part)!)].find((el) => el.name === "p:sld");
      return root && attr(root, "show") === "0";
    });
    if (hiddenSlides.length) add({ id: "hidden-slides", severity: "high", title: `${plural(hiddenSlides.length, "hidden slide")}`, detail: "Skipped in the slide show, but in the file for anyone to see.", items: hiddenSlides.map((p) => `Slide ${p.match(/(\d+)\.xml$/)?.[1]}`) });
  }

  // Everything: macros, embedded files, external links, thumbnails, printer settings.
  const macros = partsIn(pkg, /vbaProject\.bin$/);
  if (macros.length) add({ id: "macros", severity: "high", title: "Macros (VBA code)", detail: "Code that can run when the file is opened. Only enable macros from people you trust." });
  const embedded = partsIn(pkg, /\/embeddings\//);
  if (embedded.length) add({ id: "embedded", severity: "medium", title: `${plural(embedded.length, "embedded file")}`, detail: "Other documents or objects inside this one (e.g. a spreadsheet behind a chart). They keep their own contents and metadata.", items: embedded.map((p) => p.split("/").pop()!) });
  const external = rels.filter((r) => r.external && r.type !== "hyperlink");
  const localPath = (t: string) => /^(file:|[a-z]:\\|\\\\)/i.test(t) || /\\Users\\|\/Users\/|\/home\//i.test(t);
  if (external.length) {
    add({
      id: "external",
      severity: external.some((r) => localPath(r.target)) ? "high" : "medium",
      title: `${plural(external.length, "link")} to outside files`,
      detail: external.some((r) => localPath(r.target)) ? "Some are paths on a computer or network, which can reveal user names, folder names and servers." : "Templates, images or data the file loads from elsewhere.",
      items: external.map((r) => `${r.type}: ${r.target}`),
    });
  }
  const links = rels.filter((r) => r.external && r.type === "hyperlink");
  if (links.length) add({ id: "hyperlinks", severity: "info", title: `${plural(links.length, "hyperlink")}`, items: [...new Set(links.map((r) => r.target))].slice(0, MAX_ITEMS) });
  const thumbnails = partsIn(pkg, /^docProps\/thumbnail\./);
  if (thumbnails.length) add({ id: "thumbnail", severity: "medium", title: "A saved preview picture", detail: "A small image of the first page or sheet, saved when the file was. It can show content that has since changed." });
  const printers = partsIn(pkg, /\/printerSettings\//);
  if (printers.length) add({ id: "printer", severity: "info", title: "Printer settings", detail: "Settings for the printer last used, which can include its name." });
  const customXml = partsIn(pkg, /^customXml\/item\d+\.xml$/);
  if (customXml.length) add({ id: "custom-xml", severity: "info", title: `${plural(customXml.length, "custom data part")}`, detail: "Data stored by document management systems (such as SharePoint) or add-ins." });

  const app = [...elements(xmlOf(pkg, "docProps/app.xml") ?? [])].find((el) => el.name === "Application");
  if (app && textOf(app).trim()) add({ id: "app", severity: "info", title: `Made with ${textOf(app).trim()}` });

  if (people.size) findings.unshift({ id: "people", severity: "high", title: `Names of ${plural(people.size, "person", "people")} in the file`, detail: "Authors, editors and commenters, taken from the properties, comments and tracked changes.", items: [...people] });

  return {
    kind,
    findings,
    removable: {
      properties: properties.length > 0 || custom.length > 0,
      comments: commentParts.length > 0,
      trackedChanges: findings.some((f) => f.id === "tracked"),
      hiddenText: findings.some((f) => f.id === "hidden-text"),
      notes: findings.some((f) => f.id === "notes"),
      extras: thumbnails.length > 0 || printers.length > 0 || findings.some((f) => f.id === "rsids" || f.id === "docvars") || external.some((r) => r.type === "attachedTemplate"),
    },
  };
}

// ---------------------------------------------------------------------------- Cleaning

export interface OfficeCleanOptions {
  /** Author, company, dates, custom properties… */
  properties: boolean;
  comments: boolean;
  /** Word: accept every tracked change. */
  trackedChanges: boolean;
  /** Word: delete text formatted as hidden. */
  hiddenText: boolean;
  /** PowerPoint: delete speaker notes. */
  notes: boolean;
  /** Preview picture, printer settings, Word session ids, document variables and template path. */
  extras: boolean;
}

const EMPTY_CORE =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"></cp:coreProperties>';

/** Tracked-change markup: dropped (with what it holds) or unwrapped (keeping it) to accept every change. */
const REJECTED = new Set(["w:del", "w:moveFrom", "w:rPrChange", "w:pPrChange", "w:sectPrChange", "w:tblPrChange", "w:tblGridChange", "w:trPrChange", "w:tcPrChange", "w:numberingChange", "w:moveFromRangeStart", "w:moveFromRangeEnd", "w:moveToRangeStart", "w:moveToRangeEnd", "w:customXmlDelRangeStart", "w:customXmlDelRangeEnd", "w:customXmlInsRangeStart", "w:customXmlInsRangeEnd"]);
const ACCEPTED = new Set(["w:ins", "w:moveTo"]);

function editPart(pkg: Package, path: string, decide: (el: XmlElement) => "keep" | "drop" | "unwrap") {
  const nodes = xmlOf(pkg, path);
  if (nodes) put(pkg, path, transform(nodes, decide));
}

export function cleanOffice(bytes: Uint8Array, options: OfficeCleanOptions): Uint8Array {
  const pkg = open(bytes);
  const kind = kindOf(pkg);
  const order = Object.keys(pkg);

  if (options.properties) {
    if (pkg["docProps/core.xml"]) pkg["docProps/core.xml"] = strToU8(EMPTY_CORE);
    editPart(pkg, "docProps/app.xml", (el) => (["Company", "Manager", "TotalTime", "Template", "HyperlinkBase"].includes(el.name) ? "drop" : "keep"));
    removeParts(pkg, ["docProps/custom.xml"]);
  }

  if (options.comments) {
    removeParts(pkg, partsIn(pkg, /^(word\/(comments|commentsExtended|commentsIds|commentsExtensible|people)\.xml|xl\/comments\d*\.xml|xl\/threadedComments\/.*|xl\/persons\/.*|ppt\/comments\/.*|ppt\/commentAuthors\.xml|ppt\/authors\.xml)$/));
    if (kind === "word") {
      for (const part of wordStories(pkg)) {
        editPart(pkg, part, (el) =>
          el.name === "w:commentRangeStart" || el.name === "w:commentRangeEnd" || el.name === "w:commentReference" || (el.name === "w:r" && hasDescendant(el, "w:commentReference")) ? "drop" : "keep",
        );
      }
    }
    if (kind === "excel") {
      // A sheet's comments are drawn by a legacy VML drawing; without its comments part it goes too.
      for (const sheet of partsIn(pkg, /^xl\/worksheets\/sheet\d+\.xml$/)) {
        const relsPath = sheet.replace(/([^/]+)$/, "_rels/$1.rels");
        const sheetRels = relationships(pkg).filter((r) => r.rels === relsPath);
        const vml = sheetRels.filter((r) => r.type === "vmlDrawing");
        if (!vml.length) continue;
        const ids = new Set(vml.map((r) => r.id));
        editPart(pkg, sheet, (el) => (el.name === "legacyDrawing" && ids.has(attr(el, "r:id") ?? "") ? "drop" : "keep"));
        removeParts(pkg, vml.map((r) => r.target));
      }
    }
    if (kind === "powerpoint") {
      for (const slide of partsIn(pkg, /^ppt\/slides\/slide\d+\.xml$/)) editPart(pkg, slide, (el) => (el.name === "p188:commentRel" ? "drop" : "keep"));
    }
  }

  if (kind === "word" && (options.trackedChanges || options.hiddenText || options.extras)) {
    for (const part of wordStories(pkg)) {
      editPart(pkg, part, (el) => {
        if (options.trackedChanges && REJECTED.has(el.name)) return "drop";
        if (options.trackedChanges && ACCEPTED.has(el.name)) return "unwrap";
        if (options.hiddenText && el.name === "w:r" && el.children.some((c) => c.type === "element" && c.name === "w:rPr" && hasDescendant(c, "w:vanish"))) return "drop";
        return "keep";
      });
    }
  }

  if (options.notes && kind === "powerpoint") removeParts(pkg, partsIn(pkg, /^ppt\/notesSlides\/.*\.xml$/));

  if (options.extras) {
    removeParts(pkg, [...partsIn(pkg, /^docProps\/thumbnail\./), ...partsIn(pkg, /\/printerSettings\//)]);
    if (kind === "word") {
      const template = relationships(pkg).filter((r) => r.rels === "word/_rels/settings.xml.rels" && r.type === "attachedTemplate");
      removeRelationships(pkg, template);
      editPart(pkg, "word/settings.xml", (el) => (["w:rsids", "w:docVars", "w:attachedTemplate"].includes(el.name) ? "drop" : "keep"));
      for (const part of [...wordStories(pkg), "word/styles.xml", "word/numbering.xml", "word/settings.xml"]) {
        const nodes = xmlOf(pkg, part);
        if (nodes && stripAttributes(nodes, /^w:rsid/)) put(pkg, part, nodes);
      }
    }
  }

  // Same part order as the original, with a fixed timestamp (the archive shouldn't date the cleaning).
  const mtime = new Date(1980, 0, 1);
  const out: Zippable = {};
  for (const path of order) {
    if (!pkg[path]) continue;
    out[path] = [pkg[path], { level: /\.(xml|rels|vml)$/i.test(path) ? 6 : 0, mtime }];
  }
  return zipSync(out);
}
