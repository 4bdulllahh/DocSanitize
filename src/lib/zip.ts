import { zipSync } from "fflate";

/** Bundle files into a ZIP. PDFs and images are already compressed, so entries are stored as-is. */
export async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const { name, blob } of files) {
    let unique = name;
    for (let n = 2; unique in entries; n++) unique = name.replace(/(\.[^.]*)?$/, ` (${n})$1`);
    entries[unique] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  return new Blob([zipSync(entries) as BlobPart], { type: "application/zip" });
}

/** "report.pdf" + "part-1" -> "report-part-1.pdf" */
export function withSuffix(name: string, suffix: string, extension?: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = extension ?? (dot > 0 ? name.slice(dot) : "");
  return `${base}-${suffix}${ext}`;
}

/** "report.pdf" + ".docx" -> "report.docx" */
export function replaceExtension(name: string, extension: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}${extension}`;
}
