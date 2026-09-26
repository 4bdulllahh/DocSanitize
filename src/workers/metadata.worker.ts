/// <reference lib="webworker" />
import { auditMetadata, stripMetadata } from "@/lib/metadata";
import { exposeWorkerApi } from "@/lib/worker-rpc";

const api = { audit: auditMetadata, strip: stripMetadata };
export type MetadataWorkerApi = typeof api;

exposeWorkerApi(api);
