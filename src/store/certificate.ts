import { create } from "zustand";
import type { Identity } from "@/lib/sign/identity";

/*
 * The certificate file opened in Digital Signature, so several documents can be signed in a row.
 * Memory only, like open files: it's gone when the tab closes, and never written anywhere.
 */

export interface LoadedCertificate {
  file: Uint8Array;
  fileName: string;
  password: string;
  identity: Identity;
  /** Created in this session, so the person still needs to download it. */
  madeHere: boolean;
}

interface CertificateState {
  current: LoadedCertificate | null;
  set: (certificate: LoadedCertificate) => void;
  forget: () => void;
}

export const useCertificateStore = create<CertificateState>()((set) => ({
  current: null,
  set: (certificate) => set({ current: certificate }),
  forget: () => set({ current: null }),
}));
