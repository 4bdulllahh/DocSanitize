import { concat, decodeOid, integer, integerBytes, oid as oidBytes, parseDer, seq, type Der } from "./der";

/* Object identifiers and WebCrypto glue for signing and checking signatures. */

export const OID = {
  // digests
  sha1: "1.3.14.3.2.26",
  sha256: "2.16.840.1.101.3.4.2.1",
  sha384: "2.16.840.1.101.3.4.2.2",
  sha512: "2.16.840.1.101.3.4.2.3",
  // keys and signature algorithms
  rsaEncryption: "1.2.840.113549.1.1.1",
  sha1WithRSA: "1.2.840.113549.1.1.5",
  sha256WithRSA: "1.2.840.113549.1.1.11",
  sha384WithRSA: "1.2.840.113549.1.1.12",
  sha512WithRSA: "1.2.840.113549.1.1.13",
  rsaPss: "1.2.840.113549.1.1.10",
  ecPublicKey: "1.2.840.10045.2.1",
  ecdsaSha1: "1.2.840.10045.4.1",
  ecdsaSha256: "1.2.840.10045.4.3.2",
  ecdsaSha384: "1.2.840.10045.4.3.3",
  ecdsaSha512: "1.2.840.10045.4.3.4",
  p256: "1.2.840.10045.3.1.7",
  p384: "1.3.132.0.34",
  p521: "1.3.132.0.35",
  ed25519: "1.3.101.112",
  // CMS
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingTime: "1.2.840.113549.1.9.5",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  signingCertificate: "1.2.840.113549.1.9.16.2.12",
  timeStampToken: "1.2.840.113549.1.9.16.2.14",
  tstInfo: "1.2.840.113549.1.9.16.1.4",
} as const;

export type Hash = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

const DIGESTS: Record<string, Hash> = {
  [OID.sha1]: "SHA-1",
  [OID.sha256]: "SHA-256",
  [OID.sha384]: "SHA-384",
  [OID.sha512]: "SHA-512",
};

export const hashOfOid = (oid: string): Hash | null => DIGESTS[oid] ?? null;

export async function digest(hash: Hash, ...parts: Uint8Array[]): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(hash, parts.length === 1 ? (parts[0] as BufferSource) : concat(parts)));
}

/** An AlgorithmIdentifier: SEQUENCE { oid, params }. */
export const algorithm = (oid: string, params?: Uint8Array) => seq(...[oidBytes(oid), ...(params ? [params] : [])]);

/** The algorithm OID and parameters of an AlgorithmIdentifier. */
export function readAlgorithm(node: Der): { oid: string; params: Der | null } {
  return { oid: decodeOid(node.children[0]), params: node.children[1] ?? null };
}

// ---------------------------------------------------------------- Public keys

export type KeyKind = { type: "rsa"; bits: number } | { type: "ec"; curve: "P-256" | "P-384" | "P-521" } | { type: "other"; oid: string };

const CURVES: Record<string, "P-256" | "P-384" | "P-521"> = { [OID.p256]: "P-256", [OID.p384]: "P-384", [OID.p521]: "P-521" };

/** What kind of key a SubjectPublicKeyInfo (or PKCS#8 PrivateKeyInfo) holds. */
export function keyKind(spki: Der): KeyKind {
  const alg = readAlgorithm(spki.children[0]);
  if (alg.oid === OID.rsaEncryption || alg.oid === OID.rsaPss) {
    try {
      const modulus = integerBytes(parseDer(spki.children[1].content.subarray(1)).children[0]);
      return { type: "rsa", bits: modulus.length * 8 };
    } catch {
      return { type: "rsa", bits: 0 };
    }
  }
  if (alg.oid === OID.ecPublicKey && alg.params) {
    const curve = CURVES[decodeOid(alg.params)];
    if (curve) return { type: "ec", curve };
  }
  return { type: "other", oid: alg.oid };
}

export function describeKey(kind: KeyKind): string {
  if (kind.type === "rsa") return kind.bits ? `RSA ${kind.bits}-bit` : "RSA";
  if (kind.type === "ec") return `ECDSA ${kind.curve}`;
  return kind.oid === OID.ed25519 ? "Ed25519" : "Unknown key type";
}

// ---------------------------------------------------------------- ECDSA signature formats

const CURVE_BYTES = { "P-256": 32, "P-384": 48, "P-521": 66 };

/** WebCrypto's r‖s → DER SEQUENCE { r, s }. */
export function ecdsaToDer(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  return seq(integer(raw.subarray(0, half)), integer(raw.subarray(half)));
}

/** DER SEQUENCE { r, s } → r‖s, each padded to the curve size. */
export function ecdsaFromDer(der: Uint8Array, curve: "P-256" | "P-384" | "P-521"): Uint8Array {
  const node = parseDer(der);
  const size = CURVE_BYTES[curve];
  const out = new Uint8Array(size * 2);
  node.children.slice(0, 2).forEach((part, i) => {
    const value = integerBytes(part);
    out.set(value.subarray(Math.max(0, value.length - size)), i * size + Math.max(0, size - value.length));
  });
  return out;
}

// ---------------------------------------------------------------- Checking signatures

export interface SignatureAlgorithm {
  oid: string;
  params: Der | null;
}

/** The hash a signature algorithm uses (for rsaEncryption and plain ecPublicKey, the CMS digest). */
function hashFor(alg: SignatureAlgorithm, fallback: Hash): Hash {
  switch (alg.oid) {
    case OID.sha1WithRSA:
    case OID.ecdsaSha1:
      return "SHA-1";
    case OID.sha256WithRSA:
    case OID.ecdsaSha256:
      return "SHA-256";
    case OID.sha384WithRSA:
    case OID.ecdsaSha384:
      return "SHA-384";
    case OID.sha512WithRSA:
    case OID.ecdsaSha512:
      return "SHA-512";
    default:
      return fallback;
  }
}

function pssParams(params: Der | null, fallback: Hash): { hash: Hash; saltLength: number } {
  let hash: Hash = "SHA-1";
  let saltLength = 20;
  for (const field of params?.children ?? []) {
    if (field.tag === 0xa0) hash = hashOfOid(readAlgorithm(field.children[0]).oid) ?? fallback;
    if (field.tag === 0xa2) saltLength = Number(field.children[0].content.reduce((n, b) => n * 256 + b, 0));
  }
  return { hash, saltLength };
}

/** Whether `signature` over `data` checks out with the public key in `spki`. Throws for algorithms we can't check. */
export async function verifySignature(spkiBytes: Uint8Array, alg: SignatureAlgorithm, data: Uint8Array, signature: Uint8Array, fallbackHash: Hash = "SHA-256"): Promise<boolean> {
  const spki = parseDer(spkiBytes);
  const kind = keyKind(spki);
  const source = spkiBytes as BufferSource;
  if (kind.type === "rsa") {
    if (alg.oid === OID.rsaPss) {
      const { hash, saltLength } = pssParams(alg.params, fallbackHash);
      // WebCrypto won't import a key whose SPKI says RSASSA-PSS; the key itself is the same.
      const key = await crypto.subtle.importKey("spki", rsaSpki(spki), { name: "RSA-PSS", hash }, false, ["verify"]);
      return crypto.subtle.verify({ name: "RSA-PSS", saltLength }, key, signature as BufferSource, data as BufferSource);
    }
    const key = await crypto.subtle.importKey("spki", rsaSpki(spki), { name: "RSASSA-PKCS1-v1_5", hash: hashFor(alg, fallbackHash) }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature as BufferSource, data as BufferSource);
  }
  if (kind.type === "ec") {
    const key = await crypto.subtle.importKey("spki", source, { name: "ECDSA", namedCurve: kind.curve }, false, ["verify"]);
    return crypto.subtle.verify({ name: "ECDSA", hash: hashFor(alg, fallbackHash) }, key, ecdsaFromDer(signature, kind.curve) as BufferSource, data as BufferSource);
  }
  throw new Error(`Signatures made with ${describeKey(kind)} keys can't be checked here.`);
}

/** The same RSA key with the plain rsaEncryption algorithm identifier. */
function rsaSpki(spki: Der): BufferSource {
  return seq(algorithm(OID.rsaEncryption, Uint8Array.of(0x05, 0)), spki.children[1].bytes) as BufferSource;
}

// ---------------------------------------------------------------- Signing

export interface SigningKey {
  key: CryptoKey;
  kind: KeyKind;
}

/** Import a PKCS#8 private key for signing with SHA-256. */
export async function importSigningKey(pkcs8: Uint8Array): Promise<SigningKey> {
  const info = parseDer(pkcs8);
  // PrivateKeyInfo: version, algorithm, key — keyKind reads the algorithm the same way.
  const alg = readAlgorithm(info.children[1]);
  let kind: KeyKind;
  if (alg.oid === OID.rsaEncryption) {
    const rsa = parseDer(info.children[2].content);
    kind = { type: "rsa", bits: integerBytes(rsa.children[1]).length * 8 };
    const key = await crypto.subtle.importKey("pkcs8", pkcs8 as BufferSource, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    return { key, kind };
  }
  if (alg.oid === OID.ecPublicKey && alg.params && CURVES[decodeOid(alg.params)]) {
    kind = { type: "ec", curve: CURVES[decodeOid(alg.params)] };
    const key = await crypto.subtle.importKey("pkcs8", pkcs8 as BufferSource, { name: "ECDSA", namedCurve: kind.curve }, false, ["sign"]);
    return { key, kind };
  }
  throw new Error("This certificate's key type isn't supported for signing (use an RSA or ECDSA P-256/P-384/P-521 key).");
}

/** The signature algorithm identifier this key signs with (SHA-256). */
export function signatureAlgorithmFor(kind: KeyKind): Uint8Array {
  return kind.type === "ec" ? algorithm(OID.ecdsaSha256) : algorithm(OID.sha256WithRSA, Uint8Array.of(0x05, 0));
}

/** Sign `data` with SHA-256; ECDSA signatures come back DER-encoded, as CMS and X.509 want them. */
export async function sign(signer: SigningKey, data: Uint8Array): Promise<Uint8Array> {
  if (signer.kind.type === "ec") {
    return ecdsaToDer(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer.key, data as BufferSource)));
  }
  return new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer.key, data as BufferSource));
}
