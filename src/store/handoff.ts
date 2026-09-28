import type { Box } from "@/lib/pdf/redact-search";

/*
 * Boxes another tool (Find Personal Data, Inspect PDF) asks Redact to mark, for one version of
 * one open file. Kept in memory only, and taken (cleared) by the Redact panel when it opens.
 */

export interface RedactHandoff {
  fileId: string;
  revision: number;
  /** Boxes per 0-based page index, as fractions of the displayed page. */
  boxes: Record<number, Box[]>;
  /** Shown in Redact, e.g. "12 items from Find Personal Data". */
  note: string;
}

let pending: RedactHandoff | null = null;

export function handOffToRedact(handoff: RedactHandoff) {
  pending = handoff;
}

/** The hand-off for this file version, if any (read in render; cleared by `clearRedactHandoff`). */
export function peekRedactHandoff(fileId: string, revision: number): RedactHandoff | null {
  return pending && pending.fileId === fileId && pending.revision === revision ? pending : null;
}

export function clearRedactHandoff(fileId: string) {
  if (pending?.fileId === fileId) pending = null;
}
