import fontkit from "@cantoo/fontkit";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, type PDFFont } from "@cantoo/pdf-lib";
import { ProcessingError } from "../errors";
import type { FontFiles } from "../office/flow";
import { anchorBox, type Anchor } from "../pdf/anchor";
import { displaySize, drawableText, pageGeometry, toUserSpace } from "../pdf/stamp";
import { SIGNATURE_BOX as BOX, SIGNATURE_MARGIN } from "./layout";
import { buildSignedData } from "./cms";
import { concat, toHex } from "./der";
import { digest, importSigningKey } from "./crypto";
import { readCertificateFile } from "./pkcs12";
import { displayName } from "./x509";

/*
 * Signing a PDF with a certificate. The signature is added as an incremental update: the original
 * bytes stay exactly as they were (so earlier signatures stay valid), followed by the new objects.
 * The signature value covers every byte of the file except its own /Contents placeholder.
 */

/** DocMDP levels: 1 no changes, 2 form filling and signing, 3 also comments. */
export type Certification = 1 | 2 | 3;

export interface SignPdfOptions {
  certificate: Uint8Array;
  password: string;
  reason?: string;
  location?: string;
  contact?: string;
  /** Certify instead of approve: the document can only change as the level allows. */
  certify?: Certification | null;
  /** Show a signature box on this page (0-based) at this corner; omitted, the signature is invisible. */
  appearance?: { page: number; anchor: Anchor; labels?: BoxLabels } | null;
  fonts?: Pick<FontFiles, "regular" | "bold">;
  /** For tests. */
  now?: Date;
}

/** The words in the signature box, in the interface language when its font can draw it. */
export interface BoxLabels {
  signedBy: string;
  date: string;
  reason: string;
  location: string;
}

const ENGLISH_LABELS: BoxLabels = { signedBy: "Digitally signed by", date: "Date", reason: "Reason", location: "Location" };

const BYTE_RANGE_PLACEHOLDER = 9_999_999_999;

/** "2026.09.28 20:15:03 +01:00", in the signer's own time zone. */
export function signatureDate(date: Date): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const zone = `${offset >= 0 ? "+" : "-"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${zone}`;
}

/** Existing signature fields (by their dictionaries' /V), and whether one certifies the document. */
function existingSignatures(doc: PDFDocument): { count: number; certification: number | null } {
  let count = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict && object.get(PDFName.of("ByteRange")) && object.get(PDFName.of("Contents"))) count++;
  }
  const perms = doc.catalog.lookupMaybe(PDFName.of("Perms"), PDFDict);
  const mdp = perms?.lookupMaybe(PDFName.of("DocMDP"), PDFDict);
  const ref = mdp?.lookupMaybe(PDFName.of("Reference"), PDFArray)?.lookupMaybe(0, PDFDict);
  const level = ref?.lookupMaybe(PDFName.of("TransformParams"), PDFDict)?.lookupMaybe(PDFName.of("P"), PDFNumber)?.asNumber();
  return { count, certification: mdp ? (level ?? 2) : null };
}

function uniqueFieldName(doc: PDFDocument): string {
  const names = new Set<string>();
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    const t = object.lookup(PDFName.of("T"));
    if (t instanceof PDFString || t instanceof PDFHexString) names.add(t.decodeText());
  }
  let n = 1;
  while (names.has(`Signature${n}`)) n++;
  return `Signature${n}`;
}

interface AppearanceText {
  name: string;
  date: string;
  reason?: string;
  location?: string;
}

/** The signature box, drawn upright for the page's rotation; returns the widget's /Rect and appearance. */
function buildAppearance(doc: PDFDocument, pageIndex: number, anchor: Anchor, fonts: { regular: PDFFont; bold: PDFFont }, text: AppearanceText, labels: BoxLabels) {
  const page = doc.getPage(pageIndex);
  const geometry = pageGeometry(page);
  const shown = displaySize(geometry);
  const { u, v } = anchorBox(anchor, shown, BOX, SIGNATURE_MARGIN);
  const corners = [
    toUserSpace(geometry, u, v),
    toUserSpace(geometry, u + BOX.width, v),
    toUserSpace(geometry, u, v + BOX.height),
    toUserSpace(geometry, u + BOX.width, v + BOX.height),
  ];
  const rect = [Math.min(...corners.map((c) => c.x)), Math.min(...corners.map((c) => c.y)), Math.max(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.y))];

  const { width, height } = BOX;
  const lines: { font: PDFFont; size: number; text: string }[] = [{ font: fonts.regular, size: 7.5, text: drawableText(fonts.regular, labels.signedBy) }];
  const name = drawableText(fonts.bold, text.name);
  let nameSize = 13;
  while (nameSize > 7 && fonts.bold.widthOfTextAtSize(name, nameSize) > width - 16) nameSize -= 0.5;
  lines.push({ font: fonts.bold, size: nameSize, text: name });
  for (const [label, value] of [[labels.date, text.date], [labels.reason, text.reason], [labels.location, text.location]] as const) {
    if (!value) continue;
    let line = drawableText(fonts.regular, `${label}: ${value}`);
    while (line.length > 4 && fonts.regular.widthOfTextAtSize(line, 7.5) > width - 16) line = `${line.slice(0, -2)}…`;
    lines.push({ font: fonts.regular, size: 7.5, text: line });
  }
  const ops: string[] = ["q", "0.15 0.23 0.51 RG", "0.75 w", `0.5 0.5 ${width - 1} ${height - 1} re S`, "0.12 0.12 0.12 rg", "BT"];
  const fontNames = new Map<PDFFont, string>([
    [fonts.regular, "F1"],
    [fonts.bold, "F2"],
  ]);
  let y = height - 8;
  for (const line of lines) {
    y -= line.size + 2;
    ops.push(`/${fontNames.get(line.font)} ${line.size} Tf`, `1 0 0 1 8 ${y.toFixed(2)} Tm`, `${line.font.encodeText(line.text).toString()} Tj`);
  }
  ops.push("ET", "Q");

  const rotation = geometry.rotation;
  const matrix = { 0: [1, 0, 0, 1, 0, 0], 90: [0, 1, -1, 0, 0, 0], 180: [-1, 0, 0, -1, 0, 0], 270: [0, -1, 1, 0, 0, 0] }[rotation];
  const stream = doc.context.stream(ops.join("\n"), {
    Type: "XObject",
    Subtype: "Form",
    BBox: [0, 0, width, height],
    Matrix: matrix,
    Resources: { Font: { F1: fonts.regular.ref, F2: fonts.bold.ref } },
  });
  return { page, rect, appearance: doc.context.register(stream) };
}

function findBytes(haystack: Uint8Array, needle: string, from: number): number {
  const first = needle.charCodeAt(0);
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    if (haystack[i] !== first) continue;
    for (let j = 1; j < needle.length; j++) if (haystack[i + j] !== needle.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

export async function signPdf(bytes: Uint8Array, options: SignPdfOptions): Promise<Uint8Array> {
  const file = readCertificateFile(options.certificate, options.password);
  const signer = await importSigningKey(file.key);
  const now = options.now ?? new Date();
  const name = displayName(file.certificate.subject);

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, forIncrementalUpdate: true });
  } catch (error) {
    if (error instanceof Error && /encrypt|password/i.test(error.message)) throw new ProcessingError("This PDF is password-protected. Unlock it first.", "encrypted");
    throw new ProcessingError("This file couldn't be read as a PDF.", "corrupt");
  }
  if (doc.isEncrypted) throw new ProcessingError("This PDF is password-protected. Unlock it first.", "encrypted");
  const existing = existingSignatures(doc);
  if (existing.certification === 1) throw new ProcessingError("This PDF was certified with no changes allowed, so it can't be signed again without breaking that certification.", "invalid");
  if (options.certify && existing.count > 0) throw new ProcessingError("Only the first signature can certify a document, and this one is already signed. Sign it as an approval instead.", "invalid");
  if (doc.getPageCount() === 0) throw new ProcessingError("This PDF has no pages.", "invalid");

  // Room for the signature: the certificates plus a generous margin for the rest.
  const certBytes = [file.certificate, ...file.chain].reduce((n, c) => n + c.der.length, 0);
  const reserve = certBytes + 4096;

  const context = doc.context;
  const sigDict: Record<string, unknown> = {
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: "ETSI.CAdES.detached",
    ByteRange: [0, BYTE_RANGE_PLACEHOLDER, BYTE_RANGE_PLACEHOLDER, BYTE_RANGE_PLACEHOLDER],
    Contents: PDFHexString.of("0".repeat(reserve * 2)),
    M: PDFString.fromDate(now),
    Name: PDFHexString.fromText(name),
  };
  if (options.reason?.trim()) sigDict.Reason = PDFHexString.fromText(options.reason.trim());
  if (options.location?.trim()) sigDict.Location = PDFHexString.fromText(options.location.trim());
  if (options.contact?.trim()) sigDict.ContactInfo = PDFHexString.fromText(options.contact.trim());
  if (options.certify) {
    sigDict.Reference = [{ Type: "SigRef", TransformMethod: "DocMDP", TransformParams: { Type: "TransformParams", P: options.certify, V: "1.2" } }];
  }
  const sigRef = context.register(context.obj(sigDict as never));

  const widget: Record<string, unknown> = { Type: "Annot", Subtype: "Widget", FT: "Sig", T: PDFString.of(uniqueFieldName(doc)), V: sigRef, F: 132 };
  let pageIndex = 0;
  if (options.appearance) {
    pageIndex = Math.min(Math.max(0, options.appearance.page), doc.getPageCount() - 1);
    if (!options.fonts) throw new Error("Fonts are needed for a visible signature");
    doc.registerFontkit(fontkit);
    const [regular, bold] = await Promise.all([doc.embedFont(options.fonts.regular, { subset: true }), doc.embedFont(options.fonts.bold, { subset: true })]);
    const { rect, appearance } = buildAppearance(doc, pageIndex, options.appearance.anchor, { regular, bold }, {
      name,
      date: signatureDate(now),
      reason: options.reason?.trim(),
      location: options.location?.trim(),
    }, options.appearance.labels ?? ENGLISH_LABELS);
    widget.Rect = rect;
    widget.AP = { N: appearance };
  } else {
    widget.Rect = [0, 0, 0, 0];
  }
  const page = doc.getPage(pageIndex);
  widget.P = page.ref;
  const widgetRef = context.register(context.obj(widget as never));
  // Not page.node.addAnnot: that also rewraps the page's content streams, which a later
  // validator sees as the page itself changing after an earlier signature.
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (annots) annots.push(widgetRef);
  else page.node.set(PDFName.of("Annots"), context.obj([widgetRef]));

  const form = doc.catalog.getOrCreateAcroForm();
  form.dict.set(PDFName.of("SigFlags"), PDFNumber.of(3));
  form.addField(widgetRef);
  if (options.certify) doc.catalog.set(PDFName.of("Perms"), context.obj({ DocMDP: sigRef }));

  const increment = await doc.saveIncremental(context.snapshot!, { useObjectStreams: false });
  const output = concat([bytes, increment]);

  // Fill in the byte range, then the signature.
  const rangeText = `[ 0 ${BYTE_RANGE_PLACEHOLDER} ${BYTE_RANGE_PLACEHOLDER} ${BYTE_RANGE_PLACEHOLDER} ]`;
  const rangeAt = findBytes(output, rangeText, bytes.length);
  const contentsAt = findBytes(output, `<${"0".repeat(64)}`, bytes.length);
  if (rangeAt < 0 || contentsAt < 0) throw new Error("The signature placeholder wasn't found");
  const contentsEnd = contentsAt + reserve * 2 + 2;
  const range = [0, contentsAt, contentsEnd, output.length - contentsEnd];
  const filled = `[ ${range.join(" ")} ]`;
  output.set(new TextEncoder().encode(filled.padEnd(rangeText.length, " ")), rangeAt);

  const signedDigest = await digest("SHA-256", output.subarray(0, contentsAt), output.subarray(contentsEnd));
  const cms = await buildSignedData({ contentDigest: signedDigest, signer, certificate: file.certificate, chain: file.chain });
  if (cms.length > reserve) throw new Error("The signature is larger than the space reserved for it");
  output.set(new TextEncoder().encode(toHex(cms).toUpperCase()), contentsAt + 1);
  return output;
}

