import {
  bitString,
  boolean,
  decodeOid,
  decodeString,
  decodeTime,
  equalBytes,
  explicit,
  ia5String,
  integer,
  integerBytes,
  octetString,
  oid,
  parseDer,
  printableString,
  seq,
  setOf,
  tlv,
  time,
  toHex,
  utf8String,
  TAG,
  type Der,
} from "./der";
import { describeKey, digest, keyKind, readAlgorithm, sign, signatureAlgorithmFor, verifySignature, type SigningKey } from "./crypto";

/* X.509 certificates: reading the parts people care about, and making a self-signed one. */

const NAME_FIELDS: Record<string, string> = {
  "2.5.4.3": "CN",
  "2.5.4.4": "SN",
  "2.5.4.42": "GN",
  "2.5.4.5": "serialNumber",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "ST",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "2.5.4.12": "title",
  "1.2.840.113549.1.9.1": "E",
};

export type DistinguishedName = Record<string, string>;

function readName(node: Der): DistinguishedName {
  const name: DistinguishedName = {};
  for (const rdn of node.children) {
    for (const pair of rdn.children) {
      const key = NAME_FIELDS[decodeOid(pair.children[0])] ?? decodeOid(pair.children[0]);
      const value = decodeString(pair.children[1]);
      name[key] = name[key] ? `${name[key]}, ${value}` : value;
    }
  }
  return name;
}

/** "Jane Doe", or the organisation, or the whole name. */
export function displayName(name: DistinguishedName): string {
  return name.CN || [name.GN, name.SN].filter(Boolean).join(" ") || name.O || name.E || Object.values(name).join(", ") || "Unnamed";
}

export interface Certificate {
  der: Uint8Array;
  subject: DistinguishedName;
  issuer: DistinguishedName;
  /** Raw DER of the issuer Name and the serial number (for CMS's IssuerAndSerialNumber). */
  issuerDer: Uint8Array;
  subjectDer: Uint8Array;
  serial: Uint8Array;
  serialHex: string;
  notBefore: Date;
  notAfter: Date;
  spki: Uint8Array;
  key: string;
  subjectKeyId: Uint8Array | null;
  isCa: boolean;
  keyUsage: string[];
  tbs: Uint8Array;
  signatureAlgorithm: { oid: string; params: Der | null };
  signature: Uint8Array;
}

const KEY_USAGE = ["digital signature", "non-repudiation", "key encipherment", "data encipherment", "key agreement", "certificate signing", "CRL signing", "encipher only", "decipher only"];

export function parseCertificate(der: Uint8Array): Certificate {
  const cert = parseDer(der);
  const [tbsNode, sigAlg, sigValue] = cert.children;
  const tbs = tbsNode.children;
  const offset = tbs[0].tag === 0xa0 ? 1 : 0;
  const [serialNode, , issuerNode, validity, subjectNode, spkiNode] = tbs.slice(offset);
  let subjectKeyId: Uint8Array | null = null;
  let isCa = false;
  let keyUsage: string[] = [];
  const extensions = tbs.find((n) => n.tag === 0xa3);
  for (const ext of extensions?.children[0]?.children ?? []) {
    const id = decodeOid(ext.children[0]);
    const value = parseDer(ext.children[ext.children.length - 1].content);
    if (id === "2.5.29.14") subjectKeyId = value.content;
    if (id === "2.5.29.19") isCa = value.children[0]?.tag === TAG.BOOLEAN && value.children[0].content[0] !== 0;
    if (id === "2.5.29.15") {
      const bits = value.content.subarray(1);
      keyUsage = KEY_USAGE.filter((_, i) => (bits[i >> 3] ?? 0) & (0x80 >> (i & 7)));
    }
  }
  const serial = integerBytes(serialNode);
  return {
    der: cert.bytes,
    subject: readName(subjectNode),
    issuer: readName(issuerNode),
    issuerDer: issuerNode.bytes,
    subjectDer: subjectNode.bytes,
    serial,
    serialHex: toHex(serial),
    notBefore: decodeTime(validity.children[0]),
    notAfter: decodeTime(validity.children[1]),
    spki: spkiNode.bytes,
    key: describeKey(keyKind(spkiNode)),
    subjectKeyId,
    isCa,
    keyUsage,
    tbs: tbsNode.bytes,
    signatureAlgorithm: readAlgorithm(sigAlg),
    signature: sigValue.content.subarray(1),
  };
}

/** Whether `cert` was signed by `issuer`'s key (false when the algorithm can't be checked). */
export async function issuedBy(cert: Certificate, issuer: Certificate): Promise<boolean> {
  if (!equalBytes(cert.issuerDer, issuer.subjectDer)) return false;
  try {
    return await verifySignature(issuer.spki, cert.signatureAlgorithm, cert.tbs, cert.signature);
  } catch {
    return false;
  }
}

/** The issuers of `leaf` among `certs`, nearest first (by name, as files seldom hold strangers). */
export function orderChain(leaf: Certificate, certs: Certificate[]): Certificate[] {
  const chain: Certificate[] = [];
  let current = leaf;
  for (;;) {
    if (equalBytes(current.issuerDer, current.subjectDer)) break;
    const next = certs.find((c) => c !== current && !chain.includes(c) && c !== leaf && equalBytes(c.subjectDer, current.issuerDer));
    if (!next) break;
    chain.push(next);
    current = next;
  }
  return chain;
}

/** Whether a certificate signed itself (its issuer is itself and its signature checks out). */
export async function isSelfSigned(cert: Certificate): Promise<boolean> {
  return equalBytes(cert.issuerDer, cert.subjectDer) && (await issuedBy(cert, cert));
}

export async function fingerprint(cert: Certificate): Promise<string> {
  const hash = await digest("SHA-256", cert.der);
  return toHex(hash).toUpperCase().match(/../g)!.join(":");
}

export interface CertificateSummary {
  name: string;
  email: string | null;
  organization: string | null;
  issuer: string;
  notBefore: string;
  notAfter: string;
  key: string;
  selfSigned: boolean;
  fingerprint: string;
}

export async function summarizeCertificate(cert: Certificate): Promise<CertificateSummary> {
  return {
    name: displayName(cert.subject),
    email: cert.subject.E ?? null,
    organization: cert.subject.O ?? null,
    issuer: displayName(cert.issuer),
    notBefore: cert.notBefore.toISOString(),
    notAfter: cert.notAfter.toISOString(),
    key: cert.key,
    selfSigned: await isSelfSigned(cert),
    fingerprint: await fingerprint(cert),
  };
}

// ---------------------------------------------------------------- Making one

export interface NewCertificate {
  name: string;
  email?: string;
  organization?: string;
  /** Two-letter country code. */
  country?: string;
  years: number;
}

function buildName(fields: NewCertificate): Uint8Array {
  const rdn = (id: string, value: Uint8Array) => setOf(seq(oid(id), value));
  const parts = [];
  if (fields.country) parts.push(rdn("2.5.4.6", printableString(fields.country.toUpperCase())));
  if (fields.organization) parts.push(rdn("2.5.4.10", utf8String(fields.organization)));
  parts.push(rdn("2.5.4.3", utf8String(fields.name)));
  if (fields.email) parts.push(rdn("1.2.840.113549.1.9.1", ia5String(fields.email)));
  return seq(...parts);
}

const extension = (id: string, critical: boolean, value: Uint8Array) => seq(oid(id), ...(critical ? [boolean(true)] : []), octetString(value));

/**
 * A self-signed certificate for signing documents: key usage digital signature + non-repudiation,
 * extended key usage for e-mail protection and document signing (Adobe and Microsoft).
 */
export async function createSelfSignedCertificate(fields: NewCertificate, signer: SigningKey, spki: Uint8Array, now = new Date()): Promise<Uint8Array> {
  const name = buildName(fields);
  const serial = crypto.getRandomValues(new Uint8Array(16));
  serial[0] &= 0x7f;
  const notBefore = new Date(now.getTime() - 60_000);
  const notAfter = new Date(now);
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + fields.years);
  const keyId = (await digest("SHA-1", parseDer(spki).children[1].content.subarray(1))).subarray(0, 20);
  const extensions = [
    extension("2.5.29.19", true, seq()),
    // digitalSignature (bit 0) + nonRepudiation (bit 1): 0b11000000, 6 unused bits.
    extension("2.5.29.15", true, tlv(TAG.BIT_STRING, Uint8Array.of(6, 0xc0))),
    extension("2.5.29.37", false, seq(oid("1.3.6.1.5.5.7.3.4"), oid("1.2.840.113583.1.1.5"), oid("1.3.6.1.4.1.311.10.3.12"))),
    extension("2.5.29.14", false, octetString(keyId)),
  ];
  if (fields.email) extensions.push(extension("2.5.29.17", false, seq(tlv(0x81, new TextEncoder().encode(fields.email)))));
  const algorithm = signatureAlgorithmFor(signer.kind);
  const tbs = seq(explicit(0, integer(2)), integer(serial), algorithm, name, seq(time(notBefore), time(notAfter)), name, spki, explicit(3, seq(...extensions)));
  return seq(tbs, algorithm, bitString(await sign(signer, tbs)));
}
