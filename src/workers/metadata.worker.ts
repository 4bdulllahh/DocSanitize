/// <reference lib="webworker" />
import { auditMetadata, MetadataError, stripMetadata } from "@/lib/metadata";
import type { MetadataRequest, MetadataResponse } from "@/lib/metadata/client";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (event: MessageEvent<MetadataRequest>) => {
  const { id, op, bytes } = event.data;
  try {
    if (op === "audit") {
      const report = await auditMetadata(bytes);
      self.postMessage({ id, ok: true, result: report } satisfies MetadataResponse);
    } else {
      const result = await stripMetadata(bytes, event.data.options);
      self.postMessage({ id, ok: true, result } satisfies MetadataResponse, [result.bytes.buffer]);
    }
  } catch (error) {
    const response: MetadataResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : "Something went wrong while reading this file.",
      code: error instanceof MetadataError ? error.code : undefined,
    };
    self.postMessage(response);
  }
};
