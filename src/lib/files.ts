import { msg } from "@/i18n/msg";

export type FileKind = "pdf" | "image" | "word" | "excel" | "powerpoint" | "text" | "video" | "audio" | "unknown";

const EXTENSIONS: Record<Exclude<FileKind, "unknown">, string[]> = {
  pdf: [".pdf"],
  image: [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif"],
  word: [".docx"],
  excel: [".xlsx", ".xls", ".ods", ".csv"],
  powerpoint: [".pptx"],
  text: [".txt", ".md", ".markdown", ".html", ".htm"],
  // Not .ts: that's usually TypeScript, not an MPEG transport stream.
  video: [".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".3gp", ".3g2", ".wmv", ".flv", ".mpg", ".mpeg", ".mts", ".m2ts", ".ogv"],
  audio: [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".flac", ".wma", ".aif", ".aiff", ".amr", ".weba"],
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
  powerpoint: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  text: ["text/plain", "text/markdown", "text/x-markdown", "text/html"],
  video: ["video/mp4", "video/x-m4v", "video/quicktime", "video/webm", "video/x-matroska", "video/x-msvideo", "video/avi", "video/3gpp", "video/3gpp2", "video/x-ms-wmv", "video/x-flv", "video/mpeg", "video/ogg"],
  audio: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/opus", "audio/flac", "audio/x-flac", "audio/x-ms-wma", "audio/aiff", "audio/x-aiff", "audio/amr", "audio/webm"],
};

export const KIND_LABELS: Record<FileKind, string> = {
  pdf: msg("PDF"),
  image: msg("Image"),
  word: msg("Word"),
  excel: msg("Excel"),
  powerpoint: msg("PowerPoint"),
  text: msg("Text"),
  video: msg("Video"),
  audio: msg("Audio"),
  unknown: msg("File"),
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

/** Build an `<input accept>` string for the given kinds ("" — anything — when "unknown" is one). */
export function acceptFor(kinds: readonly FileKind[]): string {
  if (kinds.includes("unknown")) return "";
  return kinds
    .flatMap((kind) => (kind === "unknown" ? [] : [...MIME_TYPES[kind], ...EXTENSIONS[kind]]))
    .join(",");
}

/**
 * What to show as the formats a tool takes: extensions, but one summary for the long video and
 * audio lists, and kinds instead of extensions for tools that take most kinds of file. A tool that
 * takes "unknown" files takes any file.
 */
export function extensionsFor(kinds: readonly FileKind[]): string[] {
  if (kinds.includes("unknown")) return [msg("Any file")];
  if (kinds.length > 4) return kinds.map((kind) => (kind === "image" ? msg("Images") : KIND_LABELS[kind]));
  return kinds.flatMap((kind) => {
    if (kind === "unknown") return [];
    if (kind === "video" || kind === "audio") return [kind === "video" ? msg`video (${EXTENSIONS.video.slice(0, 4).join(", ")}…)` : msg`audio (${EXTENSIONS.audio.slice(0, 4).join(", ")}…)`];
    return EXTENSIONS[kind];
  });
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
