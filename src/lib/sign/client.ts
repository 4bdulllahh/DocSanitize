import type { SignWorkerApi } from "@/workers/sign.worker";
import { PDF_MIME } from "../pdf/client";
import { createWorkerClient } from "../worker-rpc";
import type { NewCertificate } from "./x509";
import type { SignPdfOptions } from "./pdf-sign";

const worker = createWorkerClient<SignWorkerApi>(() => new Worker(new URL("../../workers/sign.worker.ts", import.meta.url), { type: "module" }));

// A private copy each time: the bytes are transferred to the worker.
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

export const describeCertificate = (file: Uint8Array, password: string) => worker.describeCertificateFile(file.slice(), password);
export const createCertificate = (fields: NewCertificate & { password: string }) => worker.createCertificateFile(fields);
export const verifySignatures = async (file: Blob) => worker.verifyPdfSignatures(await bytesOf(file));

export async function signPdfFile(file: Blob, options: Omit<SignPdfOptions, "fonts" | "now">): Promise<Blob> {
  const signed = await worker.signPdf(await bytesOf(file), { ...options, certificate: options.certificate.slice() });
  return new Blob([signed as BlobPart], { type: PDF_MIME });
}
