import {
  concat,
  decodeOid,
  decodeTime,
  equalBytes,
  explicit,
  implicitConstructed,
  integer,
  integerBytes,
  octetString,
  oid,
  parseDer,
  seq,
  setOf,
  tlv,
  type Der,
} from "./der";
import { algorithm, digest, hashOfOid, OID, readAlgorithm, sign, signatureAlgorithmFor, verifySignature, type Hash, type SigningKey } from "./crypto";
import { parseCertificate, type Certificate } from "./x509";
import { msg } from "@/i18n/msg";

/*
 * CMS SignedData (RFC 5652), the "PKCS #7" inside a PDF signature. We write detached signatures
 * the way PAdES baseline asks: content type, message digest and the signing certificate's hash
 * as signed attributes, SHA-256 throughout; the signing time goes in the PDF's /M.
 */

const attribute = (type: string, value: Uint8Array) => seq(oid(type), setOf(value));

export interface SignInput {
  /** SHA-256 of the signed bytes. */
  contentDigest: Uint8Array;
  signer: SigningKey;
  certificate: Certificate;
  chain: Certificate[];
}

export async function buildSignedData({ contentDigest, signer, certificate, chain }: SignInput): Promise<Uint8Array> {
  const issuerSerial = seq(seq(tlv(0xa4, certificate.issuerDer)), integer(certificate.serial));
  const essCertIdV2 = seq(octetString(await digest("SHA-256", certificate.der)), issuerSerial);
  // Signed over as a SET, stored as [0] IMPLICIT.
  const signedAttrs = setOf(
    attribute(OID.contentType, oid(OID.data)),
    attribute(OID.messageDigest, octetString(contentDigest)),
    attribute(OID.signingCertificateV2, seq(seq(essCertIdV2))),
  );
  const signature = await sign(signer, signedAttrs);
  const signerInfo = seq(
    integer(1),
    seq(certificate.issuerDer, integer(certificate.serial)),
    algorithm(OID.sha256),
    implicitConstructed(0, parseDer(signedAttrs).content),
    signatureAlgorithmFor(signer.kind),
    octetString(signature),
  );
  const signedData = seq(
    integer(1),
    setOf(algorithm(OID.sha256)),
    seq(oid(OID.data)),
    implicitConstructed(0, concat([certificate.der, ...chain.map((c) => c.der)])),
    setOf(signerInfo),
  );
  return seq(oid(OID.signedData), explicit(0, signedData));
}

// ---------------------------------------------------------------- Reading

export interface CmsSigner {
  certificate: Certificate | null;
  digestOid: string;
  hash: Hash | null;
  /** The signed attributes as stored ([0] IMPLICIT), or null when the content itself is signed. */
  signedAttrs: Der | null;
  messageDigest: Uint8Array | null;
  signingTime: Date | null;
  hasSigningCertificate: boolean;
  signatureAlgorithm: { oid: string; params: Der | null };
  signature: Uint8Array;
  timestampToken: Uint8Array | null;
}

export interface SignedData {
  certificates: Certificate[];
  /** Encapsulated content (for timestamps and old adbe.pkcs7.sha1 signatures). */
  content: Uint8Array | null;
  contentType: string;
  signers: CmsSigner[];
}

export function parseSignedData(der: Uint8Array): SignedData {
  const info = parseDer(der);
  if (decodeOid(info.children[0]) !== OID.signedData) throw new Error("Not a CMS SignedData");
  const body = info.children[1].children[0].children;
  const encap = body[2];
  const contentType = decodeOid(encap.children[0]);
  const content = encap.children[1] ? encap.children[1].children[0].content : null;
  const certificates: Certificate[] = [];
  const certSet = body.find((n) => n.tag === 0xa0);
  for (const node of certSet?.children ?? []) {
    if (node.tag !== 0x30) continue; // other certificate formats
    try {
      certificates.push(parseCertificate(node.bytes));
    } catch {
      // unreadable certificate: skipped
    }
  }
  const signerInfos = body[body.length - 1].children;
  const signers = signerInfos.map((si): CmsSigner => {
    const [, sid, digestAlg, ...rest] = si.children;
    const signedAttrs = rest[0]?.tag === 0xa0 ? rest.shift()! : null;
    const [sigAlg, sigValue, unsigned] = rest;
    let certificate: Certificate | null = null;
    if (sid.tag === 0x30) {
      const serial = integerBytes(sid.children[1]);
      certificate = certificates.find((c) => equalBytes(c.issuerDer, sid.children[0].bytes) && equalBytes(c.serial, serial)) ?? null;
    } else if (sid.tag === 0x80) {
      certificate = certificates.find((c) => c.subjectKeyId && equalBytes(c.subjectKeyId, sid.content)) ?? null;
    }
    let messageDigest: Uint8Array | null = null;
    let signingTime: Date | null = null;
    let hasSigningCertificate = false;
    for (const attr of signedAttrs?.children ?? []) {
      const type = decodeOid(attr.children[0]);
      const value = attr.children[1].children[0];
      if (type === OID.messageDigest) messageDigest = value.content;
      if (type === OID.signingTime) signingTime = decodeTime(value);
      if (type === OID.signingCertificateV2 || type === OID.signingCertificate) hasSigningCertificate = true;
    }
    let timestampToken: Uint8Array | null = null;
    for (const attr of unsigned?.children ?? []) {
      if (decodeOid(attr.children[0]) === OID.timeStampToken) timestampToken = attr.children[1].children[0].bytes;
    }
    const digestOid = readAlgorithm(digestAlg).oid;
    return {
      certificate,
      digestOid,
      hash: hashOfOid(digestOid),
      signedAttrs,
      messageDigest,
      signingTime,
      hasSigningCertificate,
      signatureAlgorithm: readAlgorithm(sigAlg),
      signature: sigValue.content,
      timestampToken,
    };
  });
  return { certificates, content, contentType, signers };
}

export interface SignerCheck {
  /** The signed data's digest matches the bytes. */
  digestMatches: boolean;
  /** The signature was made by the certificate's key; null when it couldn't be checked. */
  signatureValid: boolean | null;
  problem?: string;
}

/** Check one signer against the signed bytes (for detached signatures) or the encapsulated content. */
export async function checkSigner(signer: CmsSigner, content: Uint8Array): Promise<SignerCheck> {
  if (!signer.hash) return { digestMatches: false, signatureValid: null, problem: msg("It uses a digest algorithm that can't be checked here.") };
  if (!signer.certificate) return { digestMatches: false, signatureValid: null, problem: msg("The signer's certificate isn't included in the signature.") };
  let signed: Uint8Array;
  let digestMatches: boolean;
  if (signer.signedAttrs) {
    digestMatches = !!signer.messageDigest && equalBytes(signer.messageDigest, await digest(signer.hash, content));
    // The signature covers the attributes encoded as a SET, not as the stored [0].
    signed = concat([Uint8Array.of(0x31), signer.signedAttrs.bytes.subarray(1)]);
  } else {
    digestMatches = true;
    signed = content;
  }
  try {
    const signatureValid = await verifySignature(signer.certificate.spki, signer.signatureAlgorithm, signed, signer.signature, signer.hash);
    return { digestMatches, signatureValid };
  } catch (error) {
    return { digestMatches, signatureValid: null, problem: error instanceof Error ? error.message : msg("The signature couldn't be checked.") };
  }
}

export interface Timestamp {
  time: Date;
  authority: Certificate | null;
  /** The token is intact and its imprint matches what it stamped. */
  valid: boolean;
}

/** Read and check an RFC 3161 timestamp token over `stamped` (a signature value, or a document's bytes). */
export async function checkTimestamp(token: Uint8Array, stamped: Uint8Array): Promise<Timestamp | null> {
  try {
    const cms = parseSignedData(token);
    if (cms.contentType !== OID.tstInfo || !cms.content) return null;
    const tst = parseDer(cms.content).children;
    const imprint = tst[2];
    const hash = hashOfOid(readAlgorithm(imprint.children[0]).oid);
    const time = decodeTime(tst.find((n) => n.tag === 0x18)!);
    const signer = cms.signers[0];
    const imprintOk = !!hash && equalBytes(imprint.children[1].content, await digest(hash, stamped));
    const check = signer ? await checkSigner(signer, cms.content) : null;
    return { time, authority: signer?.certificate ?? null, valid: imprintOk && !!check?.digestMatches && check.signatureValid === true };
  } catch {
    return null;
  }
}

