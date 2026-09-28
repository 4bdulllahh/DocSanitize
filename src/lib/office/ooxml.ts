import { zipSync } from "fflate";

/*
 * Helpers for writing Office Open XML packages (.docx / .xlsx). The packages are written by hand so
 * they contain exactly what we put in them: no docProps, so no author, company, app name or dates.
 */

// Characters XML 1.0 can't carry at all (C0 controls other than tab/newline/CR, lone surrogates, U+FFFE/F).
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function xmlText(value: string): string {
  return value.replace(INVALID_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function xmlAttr(value: string): string {
  return xmlText(value).replace(/"/g, "&quot;");
}

export const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Zip a package. XML parts are deflated; binary parts (pictures) are stored as they are. `[Content_Types].xml` goes first. */
export function zipPackage(parts: Record<string, string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const entries: Record<string, [Uint8Array, { level: 0 | 6; mtime: Date }]> = {};
  // A fixed timestamp: the archive shouldn't reveal when it was made.
  const mtime = new Date(1980, 0, 1);
  for (const [path, part] of Object.entries(parts)) entries[path] = typeof part === "string" ? [encoder.encode(part), { level: 6, mtime }] : [part, { level: 0, mtime }];
  return zipSync(entries);
}

export function contentTypes(defaults: Record<string, string>, overrides: Record<string, string>): string {
  return (
    XML_HEADER +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    Object.entries(defaults).map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`).join("") +
    Object.entries(overrides).map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join("") +
    "</Types>"
  );
}

export function relationships(rels: { id: string; type: string; target: string; external?: boolean }[]): string {
  return (
    XML_HEADER +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    rels
      .map(
        (r) =>
          `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${r.type}" Target="${xmlAttr(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`,
      )
      .join("") +
    "</Relationships>"
  );
}

export const OFFICE_DOCUMENT_REL = { id: "rId1", type: "officeDocument" };
