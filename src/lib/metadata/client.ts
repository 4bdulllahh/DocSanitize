import { MetadataError, type MetadataReport, type StripOptions, type StripResult } from "./types";

export type MetadataRequest =
  | { id: number; op: "audit"; bytes: Uint8Array }
  | { id: number; op: "strip"; bytes: Uint8Array; options: StripOptions };

export type MetadataResponse =
  | { id: number; ok: true; result: MetadataReport | StripResult }
  | { id: number; ok: false; error: string; code?: MetadataError["code"] };

/** Omit that keeps each member of a union distinct. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type Pending = { resolve: (value: never) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../../workers/metadata.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<MetadataResponse>) => {
    const response = event.data;
    const task = pending.get(response.id);
    if (!task) return;
    pending.delete(response.id);
    if (response.ok) task.resolve(response.result as never);
    else task.reject(response.code ? new MetadataError(response.error, response.code) : new Error(response.error));
  };
  worker.onerror = (event) => {
    // A crashed worker fails everything in flight; the next call starts a fresh one.
    for (const task of pending.values()) task.reject(new Error(event.message || "The processing engine crashed."));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function run<T>(request: DistributiveOmit<MetadataRequest, "id">): Promise<T> {
  const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as Pending["resolve"], reject });
    // The bytes are a private copy (from File.arrayBuffer), so hand ownership to the worker.
    getWorker().postMessage({ ...request, id }, [request.bytes.buffer]);
  });
}

/** Read all metadata from a file, off the main thread. */
export async function auditFile(file: Blob): Promise<MetadataReport> {
  return run({ op: "audit", bytes: new Uint8Array(await file.arrayBuffer()) });
}

/** Strip metadata from a file and verify the output, off the main thread. */
export async function stripFile(file: Blob, options: StripOptions): Promise<StripResult> {
  return run({ op: "strip", bytes: new Uint8Array(await file.arrayBuffer()), options });
}
