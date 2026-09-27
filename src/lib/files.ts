export type FileKind = "pdf" | "image" | "word" | "excel" | "unknown";

const EXTENSIONS: Record<Exclude<FileKind, "unknown">, string[]> = {
  pdf: [".pdf"],
  image: [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif"],
  word: [".docx"],
  excel: [".xlsx", ".xls", ".ods", ".csv"],
};

const MIME_TYPES: Record<Exclude<FileKind, "unknown">, string[]> = {
  pdf: ["application/pdf"],
  image: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"],
  word: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  excel: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/vnd.oasis.opendocument.spreadsheet",
    "text/csv",
  ],
};

export const KIND_LABELS: Record<FileKind, string> = {
  pdf: "PDF",
  image: "Image",
  word: "Word",
  excel: "Excel",
  unknown: "File",
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/** Classify a file by MIME type, falling back to its extension (browsers often report an empty type). */
export function detectFileKind(file: Pick<File, "name" | "type">): FileKind {
  const ext = extensionOf(file.name);
  for (const kind of Object.keys(EXTENSIONS) as Exclude<FileKind, "unknown">[]) {
    if (MIME_TYPES[kind].includes(file.type) || EXTENSIONS[kind].includes(ext)) {
      return kind;
    }
  }
  return "unknown";
}

/** Build an `<input accept>` string for the given kinds. */
export function acceptFor(kinds: readonly FileKind[]): string {
  return kinds
    .flatMap((kind) => (kind === "unknown" ? [] : [...MIME_TYPES[kind], ...EXTENSIONS[kind]]))
    .join(",");
}

export function extensionsFor(kinds: readonly FileKind[]): string[] {
  return kinds.flatMap((kind) => (kind === "unknown" ? [] : EXTENSIONS[kind]));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function createId(): string {
  // randomUUID is only exposed in secure contexts (https / localhost).
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
