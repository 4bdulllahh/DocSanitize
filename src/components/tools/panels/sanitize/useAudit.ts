"use client";

import { useEffect, useState } from "react";
import { auditFile } from "@/lib/metadata/client";
import { MetadataError, type MetadataReport } from "@/lib/metadata/types";

export type AuditState =
  | { status: "loading" }
  | { status: "ready"; report: MetadataReport }
  | { status: "error"; message: string; code?: MetadataError["code"] };

/** Audit a blob in the metadata worker. Returns null when there is nothing to audit. */
export function useAudit(blob: Blob | undefined): AuditState | null {
  // The result is stored with the blob it belongs to, so a new blob reads as "loading"
  // without resetting state inside the effect.
  const [result, setResult] = useState<{ blob: Blob; state: AuditState } | null>(null);

  useEffect(() => {
    if (!blob) return;
    let cancelled = false;
    auditFile(blob)
      .then((report) => !cancelled && setResult({ blob, state: { status: "ready", report } }))
      .catch((error: unknown) => {
        if (cancelled) return;
        setResult({
          blob,
          state: {
            status: "error",
            message: error instanceof Error ? error.message : "This file couldn't be read.",
            code: error instanceof MetadataError ? error.code : undefined,
          },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [blob]);

  if (!blob) return null;
  return result?.blob === blob ? result.state : { status: "loading" };
}
