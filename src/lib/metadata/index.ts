import { startsWith } from "./bytes";
import { auditJpeg, isJpeg, stripJpeg } from "./jpeg";
import { auditPdf, stripPdf } from "./pdf";
import { auditPng, isPng, stripPng } from "./png";
import { MetadataError, type MetadataReport, type StripOptions, type StripResult } from "./types";
import { auditWebp, isWebp, stripWebp } from "./webp";

export * from "./types";

type Format = MetadataReport["format"];

/** Identify the format from the file's bytes — never trust the extension. */
export function detectFormat(bytes: Uint8Array): Format {
  // %PDF may be preceded by junk; the spec allows it within the first 1 KB.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (head.includes("%PDF-")) return "pdf";
  if (isJpeg(bytes)) return "jpeg";
  if (isPng(bytes)) return "png";
  if (isWebp(bytes)) return "webp";
  if (startsWith(bytes, "RIFF")) throw new MetadataError("This RIFF file isn't a WebP image.", "unsupported");
  throw new MetadataError("Unsupported file format. Use a PDF, JPEG, PNG or WebP file.", "unsupported");
}

const ENGINES: Record<Format, {
  audit: (bytes: Uint8Array) => Promise<MetadataReport>;
  strip: (bytes: Uint8Array, options: StripOptions) => Promise<Uint8Array>;
}> = {
  pdf: { audit: auditPdf, strip: stripPdf },
  jpeg: { audit: auditJpeg, strip: stripJpeg },
  png: { audit: auditPng, strip: stripPng },
  webp: { audit: auditWebp, strip: stripWebp },
};

export function auditMetadata(bytes: Uint8Array): Promise<MetadataReport> {
  return ENGINES[detectFormat(bytes)].audit(bytes);
}

/** Strip metadata, then independently re-audit the output so the UI can prove it's clean. */
export async function stripMetadata(bytes: Uint8Array, options: StripOptions): Promise<StripResult> {
  const engine = ENGINES[detectFormat(bytes)];
  const clean = await engine.strip(bytes, options);
  const verification = await engine.audit(clean);
  return { bytes: clean, verification };
}
