import { readCertificateFile } from "./pkcs12";
import { summarizeCertificate, type CertificateSummary } from "./x509";

/** What the signing tool shows about an opened certificate file. */
export interface Identity extends CertificateSummary {
  /** Issuer names up the chain in the file. */
  chain: string[];
  expired: boolean;
  notYetValid: boolean;
  /** Its key usage allows signing (or doesn't say). */
  canSign: boolean;
}

export async function describeCertificateFile(bytes: Uint8Array, password: string, now = new Date()): Promise<Identity> {
  const file = readCertificateFile(bytes, password);
  const cert = file.certificate;
  return {
    ...(await summarizeCertificate(cert)),
    chain: (await Promise.all(file.chain.map(summarizeCertificate))).map((c) => c.name),
    expired: now > cert.notAfter,
    notYetValid: now < cert.notBefore,
    canSign: cert.keyUsage.length === 0 || cert.keyUsage.includes("digital signature") || cert.keyUsage.includes("non-repudiation"),
  };
}
