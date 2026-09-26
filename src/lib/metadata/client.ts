import type { MetadataWorkerApi } from "@/workers/metadata.worker";
import { createWorkerClient } from "../worker-rpc";
import type { MetadataReport, StripOptions, StripResult } from "./types";

const worker = createWorkerClient<MetadataWorkerApi>(
  () => new Worker(new URL("../../workers/metadata.worker.ts", import.meta.url), { type: "module" }),
);

/** Read all metadata from a file, off the main thread. */
export async function auditFile(file: Blob): Promise<MetadataReport> {
  return worker.audit(new Uint8Array(await file.arrayBuffer()));
}

/** Strip metadata from a file and verify the output, off the main thread. */
export async function stripFile(file: Blob, options: StripOptions): Promise<StripResult> {
  return worker.strip(new Uint8Array(await file.arrayBuffer()), options);
}
