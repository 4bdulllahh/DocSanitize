/// <reference lib="webworker" />
import { extractPages, mergePdfs, rearrangePages } from "@/lib/pdf/assemble";
import { exposeWorkerApi } from "@/lib/worker-rpc";

const api = { merge: mergePdfs, extract: extractPages, rearrange: rearrangePages };
export type PdfWorkerApi = typeof api;

exposeWorkerApi(api);
