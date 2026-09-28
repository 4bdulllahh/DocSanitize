/// <reference lib="webworker" />
import { loadFonts } from "@/lib/office/fonts";
import { createCertificateFile } from "@/lib/sign/certificate";
import { describeCertificateFile } from "@/lib/sign/identity";
import { signPdf, type SignPdfOptions } from "@/lib/sign/pdf-sign";
import { verifyPdfSignatures } from "@/lib/sign/pdf-verify";
import { exposeWorkerApi } from "@/lib/worker-rpc";

const api = {
  describeCertificateFile,
  createCertificateFile,
  verifyPdfSignatures,
  async signPdf(bytes: Uint8Array, options: Omit<SignPdfOptions, "fonts" | "now">) {
    return signPdf(bytes, { ...options, fonts: options.appearance ? await loadFonts() : undefined });
  },
};
export type SignWorkerApi = typeof api;

exposeWorkerApi(api);
