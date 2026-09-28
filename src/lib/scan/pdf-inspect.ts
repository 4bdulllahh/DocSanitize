import { PDFArray, PDFDict, PDFName, PDFRef, PDFStream, PDFString, PDFHexString, type PDFDocument, type PDFObject } from "@cantoo/pdf-lib";
import { countRevisions, nameTreeKeys, stripPdfDocument, toValue } from "../metadata/pdf";
import { DEFAULT_STRIP_OPTIONS } from "../metadata/types";
import { collectGarbage, loadPdf, savePdf } from "../pdf/load";
import { plural, type Finding } from "./findings";
import { msg } from "@/i18n/msg";

/*
 * Structural checks for a PDF: what's inside the file besides what the pages show. Hidden and
 * covered text is found separately, by rendering (pdf-visibility.ts).
 */

const N = (name: string) => PDFName.of(name);
const EXECUTABLE = /\.(exe|scr|bat|cmd|com|js|jse|vbs|vbe|wsf|ps1|msi|jar|hta|lnk|dll|app|sh)$/i;

function text(obj: PDFObject | undefined): string {
  const value = toValue(obj);
  return value instanceof Date ? value.toISOString() : typeof value === "string" ? value : "";
}

/** Every action reachable from a dictionary's /A (with /Next chains) and /AA. */
function actionsOf(dict: PDFDict): PDFDict[] {
  const found: PDFDict[] = [];
  const visit = (obj: PDFObject | undefined, depth = 0) => {
    const action = obj instanceof PDFRef ? dict.context.lookup(obj) : obj;
    if (!(action instanceof PDFDict) || depth > 20) return;
    found.push(action);
    const next = action.lookup(N("Next"));
    if (next instanceof PDFArray) next.asArray().forEach((n) => visit(n, depth + 1));
    else visit(next, depth + 1);
  };
  visit(dict.get(N("A")));
  const aa = dict.lookup(N("AA"));
  if (aa instanceof PDFDict) for (const [, value] of aa.entries()) visit(value);
  return found;
}

const actionType = (action: PDFDict) => text(action.lookup(N("S")));

/** A file specification's name: a string, or a dictionary with /UF or /F. */
function fileName(spec: PDFObject | undefined): string {
  if (spec instanceof PDFDict) return text(spec.lookup(N("UF"))) || text(spec.lookup(N("F")));
  return text(spec);
}

function annotationsOf(doc: PDFDocument): { page: number; annot: PDFDict }[] {
  const out: { page: number; annot: PDFDict }[] = [];
  doc.getPages().forEach((page, i) => {
    const annots = page.node.lookup(N("Annots"));
    if (!(annots instanceof PDFArray)) return;
    for (let k = 0; k < annots.size(); k++) {
      const annot = annots.lookup(k);
      if (annot instanceof PDFDict) out.push({ page: i, annot });
    }
  });
  return out;
}

/** Objects in the file that nothing points to any more: content that was deleted but not removed. */
function leftoverObjects(doc: PDFDocument): { count: number; images: number } {
  const { context } = doc;
  const reachable = new Set<string>();
  const stack: PDFObject[] = [];
  for (const start of [context.trailerInfo.Root, context.trailerInfo.Info, context.trailerInfo.Encrypt]) if (start) stack.push(start);
  while (stack.length) {
    const obj = stack.pop();
    if (obj instanceof PDFRef) {
      if (reachable.has(obj.toString())) continue;
      reachable.add(obj.toString());
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
  let count = 0;
  let images = 0;
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (reachable.has(ref.toString())) continue;
    // Cross-reference and object streams are part of the file's structure.
    const dict = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    const type = dict ? text(dict.lookup(N("Type"))) : "";
    if (type === "XRef" || type === "ObjStm") continue;
    count++;
    if (dict && text(dict.lookup(N("Subtype"))) === "Image") images++;
  }
  return { count, images };
}

export interface PdfInspection {
  findings: Finding[];
  /** What the cleaner can remove, for its checkboxes. */
  removable: { javascript: boolean; attachments: boolean; comments: boolean; metadata: boolean; thumbnails: boolean };
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  const doc = await loadPdf(bytes);
  const { context, catalog } = doc;
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);
  const pages = doc.getPageCount();
  const annotations = annotationsOf(doc);

  // Earlier versions kept by incremental saves.
  const revisions = countRevisions(bytes);
  if (revisions > 1) {
    add({ id: "revisions", severity: "high", title: msg`${plural(revisions - 1, "earlier version")} saved inside the file`, detail: msg("Each save appended changes instead of rewriting the file, so text or pages that were changed or deleted can be recovered from it.") });
  }
  const leftovers = leftoverObjects(doc);
  if (leftovers.count > 0) {
    add({
      id: "leftovers",
      severity: leftovers.images > 0 ? "high" : "medium",
      title: msg`${plural(leftovers.count, "leftover object")} nothing uses any more`,
      detail: leftovers.images
        ? msg`Content that was deleted from the document but is still stored in the file, including ${plural(leftovers.images, "image")}.`
        : msg("Content that was deleted from the document but is still stored in the file."),
    });
  }

  // Scripts and actions.
  const names = catalog.lookup(N("Names"));
  const scripts = names instanceof PDFDict ? nameTreeKeys(context, names.get(N("JavaScript"))) : [];
  const actions: { type: string; where: string; detail?: string }[] = [];
  const collect = (dict: PDFDict, where: string) => {
    for (const action of actionsOf(dict)) {
      const type = actionType(action);
      const target = text(action.lookup(N("URI"))) || fileName(action.lookup(N("F")));
      actions.push({ type, where, detail: target || undefined });
    }
  };
  const open = catalog.get(N("OpenAction"));
  if (open) {
    const action = open instanceof PDFRef ? context.lookup(open) : open;
    if (action instanceof PDFDict && action.has(N("S"))) actions.push({ type: actionType(action), where: msg("when the document opens") });
  }
  collect(catalog, msg("document events"));
  doc.getPages().forEach((page, i) => collect(page.node, msg`page ${i + 1}`));
  for (const { page, annot } of annotations) collect(annot, msg`page ${page + 1}`);

  const js = actions.filter((a) => a.type === "JavaScript");
  if (scripts.length || js.length) {
    const openJs = js.some((a) => a.where === msg("when the document opens") || a.where === msg("document events"));
    add({
      id: "javascript",
      severity: openJs ? "high" : "medium",
      title: msg`JavaScript: ${plural(scripts.length + js.length, "script")}`,
      detail: openJs
        ? msg("Runs automatically when the file is opened. Scripts can change what the document shows, check form input or contact websites. Forms sometimes use them for calculations.")
        : msg("Scripts can change what the document shows, check form input or contact websites. Forms sometimes use them for calculations."),
      items: [...scripts.map((s) => msg`Document script “${s}”`), ...js.map((a) => msg`Script on ${a.where}`)].slice(0, 50),
    });
  }
  const launch = actions.filter((a) => a.type === "Launch");
  if (launch.length) add({ id: "launch", severity: "high", title: launch.length === 1 ? msg("1 action that opens a program or file") : msg`${launch.length} actions that open a program or file`, detail: msg("A “Launch” action asks the reader to open another file or run a program. Legitimate documents almost never need this."), items: launch.map((a) => `${a.detail ?? msg("Unnamed target")} (${a.where})`) });
  const submit = actions.filter((a) => a.type === "SubmitForm");
  if (submit.length) add({ id: "submit", severity: "medium", title: msg("Form data can be sent to a website"), detail: msg("A button submits what's typed into the form to an address on the internet."), items: [...new Set(submit.map((a) => a.detail ?? msg("Unknown address")))] });
  const remote = actions.filter((a) => a.type === "GoToR" || a.type === "GoToE" || a.type === "ImportData");
  if (remote.length) add({ id: "remote", severity: "medium", title: msg`${plural(remote.length, "link")} to other files`, items: remote.map((a) => `${a.detail ?? msg("Another file")} (${a.where})`) });
  const links = actions.filter((a) => a.type === "URI");
  if (links.length) {
    const hosts = [...new Set(links.map((l) => { try { return new URL(l.detail ?? "").host || l.detail!; } catch { return l.detail ?? "?"; } }))];
    add({ id: "links", severity: "info", title: msg`${plural(links.length, "web link")} to ${plural(hosts.length, "site")}`, detail: msg("Check Links & QR Codes looks at each one for warning signs."), items: hosts });
  }

  // Attachments.
  const files = names instanceof PDFDict ? nameTreeKeys(context, names.get(N("EmbeddedFiles"))) : [];
  const attached = annotations.filter(({ annot }) => annot.lookup(N("Subtype")) === N("FileAttachment"));
  const attachmentNames = [...files, ...attached.map(({ page, annot }) => msg`${fileName(annot.lookup(N("FS"))) || msg("Attachment")} (on page ${page + 1})`)];
  if (attachmentNames.length) {
    const risky = attachmentNames.some((n) => EXECUTABLE.test(n.replace(/ \(on page \d+\)$/, "")));
    add({ id: "attachments", severity: "high", title: plural(attachmentNames.length, "attached file"), detail: risky ? msg("At least one is a program or script: don't open it unless you trust the sender.") : msg("Files carried inside the PDF, which readers show in their attachments panel."), items: attachmentNames });
  }

  // Comments and forms.
  const comments = annotations.filter(({ annot }) => !["Link", "Widget", "Popup"].includes(text(annot.lookup(N("Subtype")))));
  if (comments.length) {
    const authors = [...new Set(comments.map(({ annot }) => text(annot.lookup(N("T"))).trim()).filter(Boolean))];
    const notes = comments
      .map(({ page, annot }) => ({ page, contents: text(annot.lookup(N("Contents"))).trim().replace(/\s+/g, " ") }))
      .filter((c) => c.contents)
      .map((c) => msg`Page ${c.page + 1}: “${c.contents.length > 120 ? `${c.contents.slice(0, 120)}…` : c.contents}”`);
    add({
      id: "comments",
      severity: authors.length || notes.length ? "high" : "medium",
      title: msg`${plural(comments.length, "comment")} and markup`,
      detail: authors.length ? msg`Written by ${authors.join(", ")}. Review notes can reveal more than the document itself.` : msg("Notes, highlights and drawings added on top of the pages."),
      items: notes.slice(0, 50),
    });
  }
  const widgets = annotations.filter(({ annot }) => annot.lookup(N("Subtype")) === N("Widget"));
  if (widgets.length) {
    let filled = 0;
    let signatures = 0;
    try {
      for (const field of doc.getForm().getFields()) {
        const value = field.acroField.dict.lookup(N("V"));
        if (text(field.acroField.dict.lookup(N("FT"))) === "Sig") {
          if (value) signatures++;
          continue;
        }
        if (value instanceof PDFString || value instanceof PDFHexString ? value.decodeText().trim() : value instanceof PDFName ? value.decodeText() !== "Off" : value instanceof PDFArray) filled++;
      }
    } catch {
      // An unusual form structure: just report the fields.
    }
    add({ id: "form", severity: filled ? "medium" : "info", title: msg`A form with ${plural(widgets.length, "field")}`, detail: filled ? (filled === 1 ? msg("1 field is filled in. Flatten PDF makes the answers part of the page.") : msg`${filled} fields are filled in. Flatten PDF makes the answers part of the page.`) : msg("No field is filled in.") });
    if (signatures) add({ id: "signatures", severity: "info", title: msg`Digitally signed (${plural(signatures, "signature")})`, detail: msg("Any change to the file, including cleaning it, will break the signature.") });
  }

  // Hidden layers.
  const oc = catalog.lookup(N("OCProperties"));
  if (oc instanceof PDFDict) {
    const all = oc.lookup(N("OCGs"));
    const config = oc.lookup(N("D"));
    const off = config instanceof PDFDict ? config.lookup(N("OFF")) : undefined;
    const hidden =
      off instanceof PDFArray
        ? off.asArray().map((ref) => {
            const layer = context.lookup(ref);
            return (layer instanceof PDFDict && text(layer.lookup(N("Name")))) || msg("Unnamed layer");
          })
        : [];
    if (hidden.length) add({ id: "layers", severity: "high", title: plural(hidden.length, "hidden layer"), detail: msg("Content on these layers isn't shown, but anyone can switch them on in a PDF reader, and it can be copied."), items: hidden });
    else if (all instanceof PDFArray && all.size()) add({ id: "layers-info", severity: "info", title: msg`${plural(all.size(), "layer")}, all visible` });
  }

  // Metadata, private data and thumbnails.
  const info = context.lookup(context.trailerInfo.Info);
  const infoKeys = info instanceof PDFDict ? info.entries().filter(([, v]) => text(v).trim()).map(([k, v]) => `${k.decodeText()}: ${text(v)}`) : [];
  const xmp = catalog.has(N("Metadata"));
  let pieceInfo = 0;
  for (const [, obj] of context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
    if (dict?.has(N("PieceInfo"))) pieceInfo++;
  }
  if (infoKeys.length || xmp || pieceInfo) {
    add({ id: "metadata", severity: "medium", title: msg("Document properties and metadata"), detail: [xmp && msg("An XMP metadata packet (it can hold editing history)."), pieceInfo && msg("Private data from the app that made it, which can include the original editable file."), msg("Sanitize Metadata shows every entry.")].filter(Boolean).join(" "), items: infoKeys });
  }
  const thumbnails = doc.getPages().filter((p) => p.node.has(N("Thumb"))).length;
  if (thumbnails) add({ id: "thumbnails", severity: "medium", title: plural(thumbnails, "stored page thumbnail"), detail: msg("Small pictures of the pages saved in the file. They can still show content that was later changed or removed.") });

  const version = /%PDF-(\d\.\d)/.exec(new TextDecoder("latin1").decode(bytes.subarray(0, 1024)))?.[1];
  const producer = info instanceof PDFDict ? text(info.lookup(N("Producer"))) : "";
  add({ id: "summary", severity: "info", title: version ? msg`${plural(pages, "page")}, PDF ${version}` : plural(pages, "page"), detail: producer ? msg`Made with ${producer}.` : undefined });

  return {
    findings,
    removable: {
      javascript: scripts.length > 0 || js.length > 0 || launch.length > 0 || submit.length > 0 || remote.length > 0,
      attachments: attachmentNames.length > 0,
      comments: comments.length > 0,
      metadata: infoKeys.length > 0 || xmp || pieceInfo > 0,
      thumbnails: thumbnails > 0,
    },
  };
}

export interface CleanOptions {
  javascript: boolean;
  attachments: boolean;
  comments: boolean;
  metadata: boolean;
  thumbnails: boolean;
}

const RISKY_ACTIONS = new Set(["JavaScript", "Launch", "SubmitForm", "ImportData", "GoToR", "GoToE", "ResetForm"]);

/**
 * Remove what's chosen, then rewrite the file from scratch, which also drops earlier versions and
 * leftover objects. Links and form fields stay.
 */
export async function cleanPdf(bytes: Uint8Array, options: CleanOptions): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const { catalog } = doc;
  if (options.metadata) {
    await stripPdfDocument(doc, { ...DEFAULT_STRIP_OPTIONS, removeAttachments: options.attachments, removeJavaScript: options.javascript });
  }
  const names = catalog.lookup(N("Names"));
  if (options.javascript) {
    if (names instanceof PDFDict) names.delete(N("JavaScript"));
    const open = catalog.lookup(N("OpenAction"));
    if (open instanceof PDFDict && RISKY_ACTIONS.has(actionType(open))) catalog.delete(N("OpenAction"));
    catalog.delete(N("AA"));
    for (const page of doc.getPages()) page.node.delete(N("AA"));
    for (const { annot } of annotationsOf(doc)) {
      annot.delete(N("AA"));
      const action = annot.lookup(N("A"));
      if (action instanceof PDFDict && RISKY_ACTIONS.has(actionType(action))) annot.delete(N("A"));
    }
    // Form-level scripts (calculation order) and XFA scripts.
    const acro = catalog.lookup(N("AcroForm"));
    if (acro instanceof PDFDict) acro.delete(N("CO"));
  }
  if (options.attachments) {
    if (names instanceof PDFDict) names.delete(N("EmbeddedFiles"));
    catalog.delete(N("AF"));
  }
  for (const page of doc.getPages()) {
    if (options.thumbnails) page.node.delete(N("Thumb"));
    const annots = page.node.lookup(N("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let k = annots.size() - 1; k >= 0; k--) {
      const annot = annots.lookup(k);
      if (!(annot instanceof PDFDict)) continue;
      const subtype = text(annot.lookup(N("Subtype")));
      const comment = !["Link", "Widget"].includes(subtype);
      if ((options.comments && comment) || (options.attachments && subtype === "FileAttachment")) annots.remove(k);
    }
  }
  collectGarbage(doc);
  return savePdf(doc);
}
