import type { MetadataEntry, Sensitivity } from "./types";

// Matched case-insensitively against the entry key (and label) with non-letters removed.
const HIGH = [
  "gps", "latitude", "longitude", "altitude", "location", "city", "country", "state", "province",
  "sublocation", "address", "postal", "author", "artist", "creator", "byline", "owner", "copyright",
  "rights", "credit", "contact", "email", "phone", "person", "people", "lastmodifiedby", "company",
  "manager", "serial", "hostcomputer", "usercomment", "thumbnail", "attachment", "embeddedfile",
  "annotationauthor", "revision", "makernote", "cameraowner", "imageuniqueid",
];

const MEDIUM = [
  "make", "model", "lens", "software", "producer", "tool", "agent", "application", "date", "time",
  "created", "modified", "history", "documentid", "instanceid", "derivedfrom", "title", "subject",
  "description", "caption", "headline", "keywords", "comment", "rating", "javascript", "action",
  "uuid", "xmptk", "trapped",
];

// Checked first: keys that would otherwise hit a broader pattern above.
const EXACT: Record<string, Sensitivity> = {
  creatortool: "medium", // software name, not a person
  xmpcreatortool: "medium",
  exposuretime: "low",
  subsectime: "low",
  subsectimeoriginal: "low",
  subsectimedigitized: "low",
  offsettime: "medium",
  colorspace: "low",
  orientation: "low",
};

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

export function classify(key: string, label = key): Sensitivity {
  const k = normalize(key);
  const l = normalize(label);
  const local = normalize(key.slice(key.lastIndexOf(":") + 1));
  const exact = EXACT[k] ?? EXACT[local];
  if (exact) return exact;
  const has = (needle: string) => k.includes(needle) || l.includes(needle);
  if (HIGH.some(has)) return "high";
  if (MEDIUM.some(has)) return "medium";
  return "low";
}

/** "CreatorTool" -> "Creator Tool", "GPSLatitude" -> "GPS Latitude", "dc:creator" -> "Creator". */
export function humanize(key: string): string {
  const local = key.includes(":") ? key.slice(key.lastIndexOf(":") + 1) : key;
  const spaced = local
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const MAX_VALUE_LENGTH = 2000;

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return isNaN(value.getTime()) ? "" : value.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return `${value.byteLength.toLocaleString()} bytes of binary data`;
  }
  if (Array.isArray(value)) {
    // Long numeric arrays are binary blobs in disguise.
    if (value.length > 16 && value.every((v) => typeof v === "number")) return `${value.length} values`;
    return value.map(formatValue).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value).replace(/\u0000+$/g, "").trim();
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

export function entry(
  group: string,
  key: string,
  value: unknown,
  overrides: Partial<Pick<MetadataEntry, "label" | "sensitivity">> = {},
): MetadataEntry | null {
  const formatted = formatValue(value);
  if (formatted === "") return null;
  const label = overrides.label ?? humanize(key);
  return {
    group,
    key,
    label,
    value: formatted,
    sensitivity: overrides.sensitivity ?? classify(key, label),
  };
}

export function compact<T>(items: (T | null | undefined)[]): T[] {
  return items.filter((i): i is T => i !== null && i !== undefined);
}
