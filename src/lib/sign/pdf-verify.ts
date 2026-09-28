import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from "@cantoo/pdf-lib";
import { ProcessingError } from "../errors";
import { checkSigner, checkTimestamp, parseSignedData, type SignedData } from "./cms";
import { concat, equalBytes } from "./der";
import { digest } from "./crypto";
import { displayName, orderChain, summarizeCertificate as summarize, type CertificateSummary } from "./x509";
import { msg } from "@/i18n/msg";

/*
 * Checking the digital signatures in a PDF, entirely offline: that each one's bytes are intact,
 * that it was made with the key of the certificate it carries, what changed after it, and what
 * the certificate says. Whether a certificate authority vouches for the signer can't be known
 * offline; the report says who issued the certificate and gives its fingerprint instead.
 */

export type ChangesAfter = "none" | "covered" | "changed";

export interface SignatureReport {
  field: string;
  kind: "signature" | "certification" | "timestamp";
  /** DocMDP level for certifications: 1 no changes, 2 forms, 3 forms and comments. */
  certification: number | null;
  subFilter: string;
  signer: CertificateSummary | null;
  chain: CertificateSummary[];
  /** ISO time from the signature (the signer's clock, unless a timestamp says otherwise). */
  signedAt: string | null;
  timestamp: { time: string; authority: string | null; valid: boolean } | null;
  reason: string | null;
  location: string | null;
  contact: string | null;
  /** 1-based page of a visible signature, else null. */
  page: number | null;
  /** The signed bytes are unchanged and the signature is the certificate holder's. */
  intact: boolean;
  /** Why the signature isn't intact, or couldn't be checked. */
  problem: string | null;
  changesAfter: ChangesAfter;
  /** Bytes of the file this signature covers: the version that was signed is the file up to here. */
  signedLength: number;
  /** The certificate was valid (by its dates) when the document was signed. */
  certificateValidThen: boolean | null;
}

export interface VerifyReport {
  signatures: SignatureReport[];
  revisions: number;
}

const text = (value: unknown): string | null => (value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null);

function hexBytes(value: unknown): Uint8Array | null {
  if (value instanceof PDFHexString) return value.asBytes();
  if (value instanceof PDFString) return value.asBytes();
  return null;
}

/** Offsets just past each %%EOF: where each revision of the file ends. */
function revisionEnds(bytes: Uint8Array): number[] {
  const ends: number[] = [];
  const marker = [0x25, 0x25, 0x45, 0x4f, 0x46];
  for (let i = 0; i <= bytes.length - 5; i++) {
    if (marker.every((b, j) => bytes[i + j] === b)) {
      let end = i + 5;
      while (end < bytes.length && (bytes[end] === 0x0d || bytes[end] === 0x0a)) end++;
      ends.push(end);
    }
  }
  return ends;
}

interface Found {
  dict: PDFDict;
  ref: PDFRef;
  field: string;
  page: number | null;
}

function findSignatures(doc: PDFDocument): Found[] {
  const pages = doc.getPages();
  const pageOf = (widget: PDFRef): number | null => {
    const index = pages.findIndex((p) => p.node.Annots()?.asArray().some((a) => a instanceof PDFRef && a === widget));
    return index >= 0 ? index + 1 : null;
  };
  const byValue = new Map<PDFRef, { name: string; widget: PDFRef; rect: number[] }>();
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    const value = object.get(PDFName.of("V"));
    if (!(value instanceof PDFRef)) continue;
    const rect = object.lookupMaybe(PDFName.of("Rect"), PDFArray)?.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0)) ?? [];
    byValue.set(value, { name: text(object.lookup(PDFName.of("T"))) ?? "Signature", widget: ref, rect });
  }
  const found: Found[] = [];
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || !object.get(PDFName.of("ByteRange")) || !object.get(PDFName.of("Contents"))) continue;
    const field = byValue.get(ref);
    const visible = field && field.rect.length === 4 && Math.abs(field.rect[2] - field.rect[0]) > 1 && Math.abs(field.rect[3] - field.rect[1]) > 1;
    found.push({ dict: object, ref, field: field?.name ?? "Signature", page: field && visible ? pageOf(field.widget) : null });
  }
  return found;
}

function certificationLevel(dict: PDFDict): number | null {
  const refs = dict.lookupMaybe(PDFName.of("Reference"), PDFArray);
  for (const item of refs?.asArray() ?? []) {
    const ref = dict.context.lookup(item);
    if (!(ref instanceof PDFDict)) continue;
    if (ref.lookup(PDFName.of("TransformMethod")) !== PDFName.of("DocMDP")) continue;
    const p = ref.lookupMaybe(PDFName.of("TransformParams"), PDFDict)?.lookupMaybe(PDFName.of("P"), PDFNumber);
    return p?.asNumber() ?? 2;
  }
  return null;
}

type Checked = Omit<SignatureReport, "changesAfter" | "signedLength"> & { end: number };

/** The signing time in /M ("D:20260928201503+01'00'"), if readable. */
function signingTimeOf(dict: PDFDict): string | null {
  const m = dict.lookup(PDFName.of("M"));
  if (!(m instanceof PDFString || m instanceof PDFHexString)) return null;
  try {
    const date = PDFString.of(m.decodeText()).decodeDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

async function checkOne(bytes: Uint8Array, found: Found): Promise<Checked> {
  const { dict } = found;
  const subFilter = (dict.lookup(PDFName.of("SubFilter")) as PDFName | undefined)?.decodeText() ?? "";
  const certification = certificationLevel(dict);
  const isTimestamp = subFilter === "ETSI.RFC3161";
  const base: Checked = {
    field: found.field,
    kind: isTimestamp ? "timestamp" : certification ? "certification" : "signature",
    certification,
    subFilter,
    signer: null,
    chain: [],
    signedAt: signingTimeOf(dict),
    timestamp: null,
    reason: text(dict.lookup(PDFName.of("Reason"))),
    location: text(dict.lookup(PDFName.of("Location"))),
    contact: text(dict.lookup(PDFName.of("ContactInfo"))),
    page: found.page,
    intact: false,
    problem: null,
    certificateValidThen: null,
    end: 0,
  };

  const range = dict.lookupMaybe(PDFName.of("ByteRange"), PDFArray)?.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : -1)) ?? [];
  const contents = hexBytes(dict.lookup(PDFName.of("Contents")));
  if (range.length !== 4 || range.some((n) => n < 0) || !contents) return { ...base, problem: msg("The signature is incomplete.") };
  const [a, b, c, d] = range;
  base.end = c + d;
  // The gap must be exactly this signature's /Contents <…>, and the ranges must lie in the file.
  if (a !== 0 || b > c || c + d > bytes.length || bytes[b] !== 0x3c || bytes[c - 1] !== 0x3e) {
    return { ...base, problem: msg("The part of the file this signature covers doesn't match its own record, which is a sign of tampering.") };
  }
  const signed = concat([bytes.subarray(a, b), bytes.subarray(c, c + d)]);

  let cms: SignedData;
  try {
    cms = parseSignedData(contents);
  } catch {
    return { ...base, problem: subFilter === "adbe.x509.rsa_sha1" ? msg("This is an old kind of signature (adbe.x509.rsa_sha1) that can't be checked here.") : msg("The signature data couldn't be read.") };
  }
  const signer = cms.signers[0];
  if (!signer) return { ...base, problem: msg("The signature has no signer.") };
  const leaf = signer.certificate;
  if (leaf) {
    base.signer = await summarize(leaf);
    base.chain = await Promise.all(orderChain(leaf, cms.certificates).map(summarize));
  }

  if (isTimestamp) {
    // A document timestamp: the token stamps the signed bytes themselves.
    const stamp = await checkTimestamp(contents, signed);
    if (!stamp) return { ...base, problem: msg("The timestamp couldn't be read.") };
    base.timestamp = { time: stamp.time.toISOString(), authority: stamp.authority ? displayName(stamp.authority.subject) : null, valid: stamp.valid };
    base.signedAt = stamp.time.toISOString();
    return { ...base, intact: stamp.valid, problem: stamp.valid ? null : msg("The timestamp doesn't match the document.") };
  }

  let content: Uint8Array = signed;
  if (cms.content) {
    // adbe.pkcs7.sha1: the signed content is the SHA-1 of the ranges.
    if (!equalBytes(cms.content, await digest("SHA-1", signed))) return { ...base, problem: msg("The document was changed after it was signed.") };
    content = cms.content;
  }
  const check = await checkSigner(signer, content);
  if (signer.signingTime && !base.signedAt) base.signedAt = signer.signingTime.toISOString();
  if (signer.timestampToken) {
    const stamp = await checkTimestamp(signer.timestampToken, signer.signature);
    if (stamp) {
      base.timestamp = { time: stamp.time.toISOString(), authority: stamp.authority ? displayName(stamp.authority.subject) : null, valid: stamp.valid };
      if (stamp.valid) base.signedAt = stamp.time.toISOString();
    }
  }
  if (leaf && base.signedAt) {
    const at = new Date(base.signedAt);
    base.certificateValidThen = at >= leaf.notBefore && at <= leaf.notAfter;
  }
  if (!check.digestMatches) return { ...base, problem: msg("The document was changed after it was signed: its bytes don't match the signature.") };
  if (check.signatureValid === false) return { ...base, problem: msg("The signature doesn't match the certificate it carries.") };
  if (check.signatureValid === null) return { ...base, problem: check.problem ?? msg("The signature couldn't be checked.") };
  return { ...base, intact: true };
}

export async function verifyPdfSignatures(bytes: Uint8Array): Promise<VerifyReport> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  } catch {
    throw new ProcessingError("This file couldn't be read as a PDF.", "corrupt");
  }
  const found = findSignatures(doc);
  const checked = await Promise.all(found.map((f) => checkOne(bytes, f)));
  const lastEnd = Math.max(0, ...checked.map((c) => c.end));
  const signatures = checked
    .sort((x, y) => x.end - y.end)
    .map(({ end, ...report }): SignatureReport => ({
      ...report,
      signedLength: end,
      // Covered: later additions are themselves covered by a later signature over the whole file.
      changesAfter: end >= bytes.length ? "none" : lastEnd >= bytes.length ? "covered" : "changed",
    }));
  return { signatures, revisions: revisionEnds(bytes).length };
}

