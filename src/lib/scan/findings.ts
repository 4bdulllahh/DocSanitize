/*
 * What the Inspect tools report. `high`: likely to expose something or be dangerous; `medium`:
 * worth knowing before sharing; `info`: neutral facts about the file.
 */

export type Severity = "high" | "medium" | "info";

export interface Finding {
  /** Stable id, e.g. "javascript", so the UI can attach actions. */
  id: string;
  severity: Severity;
  title: string;
  detail?: string;
  /** Specifics: names, values, pages. */
  items?: string[];
}

export const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString("en")} ${n === 1 ? word : many}`;
