import { ProcessingError, type ProcessingErrorCode } from "../errors";

/**
 * How revealing a piece of metadata is.
 * - high: identifies a person, place or device (GPS, author, serial numbers, hidden history…)
 * - medium: fingerprints the file (software, dates, document IDs, titles…)
 * - low: technical detail (exposure, resolution, colour space…)
 */
export type Sensitivity = "high" | "medium" | "low";

export interface MetadataEntry {
  /** Section the entry belongs to, e.g. "Document Info", "GPS", "XMP". */
  group: string;
  /** Raw key as stored in the file, e.g. "GPSLatitude" or "dc:creator". */
  key: string;
  /** Human-readable name. */
  label: string;
  value: string;
  sensitivity: Sensitivity;
}

export interface MetadataReport {
  format: "pdf" | "jpeg" | "png" | "webp";
  entries: MetadataEntry[];
  /** Entries deliberately left in place (e.g. image orientation) with the reason. Not counted as leaks. */
  kept: { label: string; reason: string }[];
  /** Decimal GPS position if the file carries one. */
  location?: { latitude: number; longitude: number };
}

export interface StripOptions {
  /** Images: keep the ICC colour profile so colours render identically. */
  keepColorProfile: boolean;
  /** PDF: remove embedded file attachments. */
  removeAttachments: boolean;
  /** PDF: remove document JavaScript and auto-run actions. */
  removeJavaScript: boolean;
  /** PDF: remove author names and timestamps from comments/annotations. */
  anonymizeAnnotations: boolean;
}

export const DEFAULT_STRIP_OPTIONS: StripOptions = {
  keepColorProfile: false,
  removeAttachments: true,
  removeJavaScript: true,
  anonymizeAnnotations: true,
};

export interface StripResult {
  bytes: Uint8Array;
  /** Audit of the cleaned output, produced by re-reading it from scratch. */
  verification: MetadataReport;
}

/** Metadata-engine failures; `code` tells the UI how to explain them. */
export class MetadataError extends ProcessingError {
  constructor(message: string, code: ProcessingErrorCode) {
    super(message, code);
    this.name = "MetadataError";
  }
}
