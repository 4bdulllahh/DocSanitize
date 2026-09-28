/*
 * Marks English text written outside components (tool names, step names, errors and findings
 * produced by src/lib) so scripts/i18n-scan.mjs collects it for translation. It returns the text
 * unchanged: the interface translates it when showing it (t(text), or t.dynamic(text) for text
 * with values filled in).
 *
 *   msg("Merge PDF")                          → key "Merge PDF"
 *   msg`Page ${n} doesn't exist.`             → key "Page {0} doesn't exist."
 */
export function msg(text: string): string;
export function msg(strings: TemplateStringsArray, ...values: unknown[]): string;
export function msg(first: string | TemplateStringsArray, ...values: unknown[]): string {
  if (typeof first === "string") return first;
  return first.reduce((out, part, i) => out + String(values[i - 1]) + part);
}
