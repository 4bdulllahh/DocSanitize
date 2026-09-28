import forge from "node-forge";
import { ProcessingError } from "../errors";
import { equalBytes, integerBytes, parseDer } from "./der";
import { OID, readAlgorithm } from "./crypto";
import { orderChain, parseCertificate, type Certificate } from "./x509";

/*
 * .p12 / .pfx files (PKCS #12): a private key and its certificate chain, locked with a password.
 * node-forge does the decryption, because many files still use 3DES and RC2, which WebCrypto
 * lacks. Keys and certificates come out as DER and are used with WebCrypto from there.
 */

export interface CertificateFile {
  /** PKCS #8 PrivateKeyInfo. */
  key: Uint8Array;
  certificate: Certificate;
  /** The issuers included in the file, nearest first. */
  chain: Certificate[];
}

const toBinary = (bytes: Uint8Array) => forge.util.binary.raw.encode(bytes);
const fromBinary = (text: string) => Uint8Array.from(forge.util.binary.raw.decode(text));
const derOf = (node: forge.asn1.Asn1) => fromBinary(forge.asn1.toDer(node).getBytes());

/** The public half of a PKCS #8 key, in the form a SubjectPublicKeyInfo carries it, for matching. */
function publicPart(pkcs8: Uint8Array): Uint8Array | null {
  const info = parseDer(pkcs8);
  const alg = readAlgorithm(info.children[1]).oid;
  const inner = parseDer(info.children[2].content);
  if (alg === OID.rsaEncryption) return integerBytes(inner.children[1]);
  // ECPrivateKey: version, privateKey, [0] params, [1] publicKey BIT STRING.
  const pub = inner.children.find((c) => c.tag === 0xa1);
  return pub ? pub.children[0].content.subarray(1) : null;
}

function certificatePublicPart(cert: Certificate): Uint8Array {
  const spki = parseDer(cert.spki);
  const key = spki.children[1].content.subarray(1);
  return readAlgorithm(spki.children[0]).oid === OID.rsaEncryption ? integerBytes(parseDer(key).children[0]) : key;
}

export function readCertificateFile(bytes: Uint8Array, password: string): CertificateFile {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(toBinary(bytes)), false, password);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/password|MAC|decrypt/i.test(message)) throw new ProcessingError("That password doesn't open this certificate file.", "encrypted");
    throw new ProcessingError("This isn't a certificate file DocSanitize can read (it should be a .p12 or .pfx with a private key).", "corrupt");
  }
  const keys: Uint8Array[] = [];
  const certs: Certificate[] = [];
  for (const safe of p12.safeContents) {
    for (const bag of safe.safeBags) {
      const raw = bag as forge.pkcs12.Bag & { asn1?: forge.asn1.Asn1 };
      if (bag.type === forge.pki.oids.pkcs8ShroudedKeyBag || bag.type === forge.pki.oids.keyBag) {
        if (bag.key) keys.push(derOf(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(bag.key))));
        else if (raw.asn1) keys.push(derOf(raw.asn1));
      } else if (bag.type === forge.pki.oids.certBag) {
        const der = bag.cert ? derOf(forge.pki.certificateToAsn1(bag.cert)) : raw.asn1 ? derOf(raw.asn1) : null;
        if (der) certs.push(parseCertificate(der));
      }
    }
  }
  if (!keys.length) throw new ProcessingError("This certificate file has no private key, so it can't sign. Export it again with the private key included.", "invalid");
  if (!certs.length) throw new ProcessingError("This file has a key but no certificate.", "invalid");

  // The certificate that goes with the key.
  let key = keys[0];
  let certificate = certs[0];
  found: for (const k of keys) {
    const pub = publicPart(k);
    for (const cert of certs) {
      if (pub && equalBytes(pub, certificatePublicPart(cert))) {
        key = k;
        certificate = cert;
        break found;
      }
    }
  }
  return { key, certificate, chain: orderChain(certificate, certs) };
}

/** Lock an RSA key and its certificate in a .p12 (AES-256, PBKDF2-SHA256). */
export function writeCertificateFile(pkcs8: Uint8Array, certificate: Uint8Array, password: string, friendlyName: string): Uint8Array {
  const key = forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(toBinary(pkcs8)));
  const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(toBinary(certificate)));
  // prfAlgorithm is passed on to the key encryption (not in the typings).
  const options = { algorithm: "aes256" as const, count: 10_000, friendlyName, generateLocalKeyId: true, prfAlgorithm: "sha256" };
  const asn1 = forge.pkcs12.toPkcs12Asn1(key, [cert], password, options);
  return derOf(asn1);
}
