import { importSigningKey } from "./crypto";
import { writeCertificateFile } from "./pkcs12";
import { createSelfSignedCertificate, type NewCertificate } from "./x509";

/**
 * A new signing identity made on this device: an RSA key, a self-signed certificate for it, and
 * both locked in a .p12 with the given password. The key never leaves the returned file.
 */
export async function createCertificateFile(fields: NewCertificate & { password: string; bits?: 2048 | 3072 }): Promise<Uint8Array> {
  const name = fields.name.trim();
  if (!name) throw new Error("A certificate needs a name.");
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: fields.bits ?? 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const certificate = await createSelfSignedCertificate(
    { ...fields, name, email: fields.email?.trim() || undefined, organization: fields.organization?.trim() || undefined },
    await importSigningKey(pkcs8),
    spki,
  );
  return writeCertificateFile(pkcs8, certificate, fields.password, name);
}
