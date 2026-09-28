import exifr from "exifr";
import { auditMetadata, type MetadataEntry } from "../metadata";
import { plural, type Finding } from "./findings";

/*
 * Signs of how a photo was made and changed: editing apps, AI generators and Content Credentials
 * (C2PA) recorded in its metadata, an embedded thumbnail that no longer matches, dates that
 * disagree, and the JPEG's compression level. Error level analysis and the thumbnail comparison
 * need a canvas and run on the page (see `ela.ts`). None of this proves a photo is genuine or
 * fake; it shows what the file says about itself.
 */

const EDITORS = /photoshop|lightroom|gimp|affinity|pixelmator|snapseed|canva|picsart|facetune|luminar|capture one|darktable|paint\.net|photopea|fotor|vsco|meitu|remini|airbrush|photodirector|skylum|corel/i;
const AI_TOOLS = /midjourney|dall[·.\s-]?e|stable diffusion|firefly|imagen|bing image creator|novelai|leonardo|ideogram|flux|comfyui|automatic1111|invokeai|dreamstudio|craiyon|openai|gemini|grok/i;
const AI_SOURCE = /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|algorithmicMedia/;
/** PNG text keys image generators write their settings under. */
const AI_KEYS = new Set(["parameters", "prompt", "workflow", "invokeai_metadata", "sd-metadata", "dream", "negative_prompt", "comfyui"]);

const STD_LUMINANCE = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const STD_SUM = STD_LUMINANCE.reduce((a, b) => a + b, 0);

/** The JPEG quality setting (1–100, IJG scale) estimated from the luminance quantization table. */
export function jpegQuality(bytes: Uint8Array): number | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let i = 2; i + 4 < bytes.length; ) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xda) return null;
    if (marker === 0xdb) {
      for (let at = i + 4; at < i + 2 + length; ) {
        const precision = bytes[at] >> 4;
        const id = bytes[at] & 15;
        const size = precision ? 2 : 1;
        let sum = 0;
        for (let k = 0; k < 64; k++) sum += size === 2 ? (bytes[at + 1 + k * 2] << 8) | bytes[at + 2 + k * 2] : bytes[at + 1 + k];
        if (id === 0) {
          // All ones: nothing is quantized away.
          if (sum === 64) return 100;
          const scale = (sum / STD_SUM) * 100;
          const quality = scale <= 100 ? (200 - scale) / 2 : 5000 / scale;
          return Math.max(1, Math.min(100, Math.round(quality)));
        }
        at += 1 + 64 * size;
      }
    }
    i += 2 + length;
  }
  return null;
}

/** "YYYY:MM:DD HH:MM:SS" or ISO text -> Date. */
function parseDate(value: string): Date | null {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/.exec(value.trim());
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  return isNaN(date.getTime()) ? null : date;
}

function duration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return plural(hours, "hour");
  const days = Math.round(hours / 24);
  return days < 365 ? plural(days, "day") : plural(Math.round(days / 365), "year");
}

export interface ImageForensics {
  findings: Finding[];
  /** The EXIF thumbnail (a small JPEG), for comparing with the picture. */
  thumbnail: Uint8Array | null;
}

export async function inspectImage(bytes: Uint8Array): Promise<ImageForensics> {
  const report = await auditMetadata(bytes);
  const entries = report.entries;
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);
  const value = (...keys: string[]) => entries.find((e) => keys.some((k) => e.key.toLowerCase() === k.toLowerCase()))?.value ?? "";
  const matching = (test: (e: MetadataEntry) => boolean) => entries.filter(test);

  // Content Credentials: a signed manifest in a JUMBF box ("c2pa" label).
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 8 << 20)));
  const c2pa = /jumb[\s\S]{0,64}c2pa|c2pa\.(claim|signature|actions)/.test(head);

  // AI generators.
  const aiSigns: string[] = [];
  for (const e of entries) {
    if (AI_SOURCE.test(e.value)) aiSigns.push(`${e.label}: ${/composite/i.test(e.value) ? "partly made with AI" : "made with AI"}`);
    else if (AI_KEYS.has(e.key.toLowerCase())) aiSigns.push(`Generator settings (“${e.key}”): ${e.value.length > 140 ? `${e.value.slice(0, 140)}…` : e.value}`);
    else if (/software|creatortool|make|model|description|comment|artist/i.test(e.key) && AI_TOOLS.test(e.value)) aiSigns.push(`${e.label}: ${e.value}`);
  }
  if (c2pa && AI_SOURCE.test(head)) aiSigns.push("Content Credentials say it was made or changed with AI");
  if (aiSigns.length) add({ id: "ai", severity: "high", title: "Marked as made with AI", detail: "The file carries labels that AI image tools write. Without them, AI images are hard to tell apart; their absence proves nothing.", items: [...new Set(aiSigns)] });

  if (c2pa) add({ id: "c2pa", severity: "info", title: "Has Content Credentials (C2PA)", detail: "A signed record of how the picture was made and edited. You can read and verify it at contentcredentials.org/verify (that uploads the file, so only for files you're happy to share)." });

  // Editing software and history.
  const software = matching((e) => /^(software|creatortool|xmp:creatortool|processingsoftware|hostcomputer)$/i.test(e.key) || /softwareAgent/i.test(e.key)).map((e) => e.value);
  const editors = [...new Set(software.filter((s) => EDITORS.test(s)))];
  const history = matching((e) => /History/i.test(e.key)).map((e) => `${e.label}: ${e.value}`);
  if (editors.length || history.length) {
    add({ id: "edited", severity: "medium", title: editors.length ? `Edited with ${editors.join(", ")}` : "Has an editing history", detail: "Editing isn't suspicious in itself (phones and cameras adjust every photo), but it shows the file isn't straight from the camera.", items: history.slice(0, 30) });
  } else if (software.length) {
    add({ id: "software", severity: "info", title: `Saved by ${[...new Set(software)].join(", ")}` });
  }

  // Dates.
  const taken = parseDate(value("DateTimeOriginal", "CreateDate", "photoshop:DateCreated", "xmp:CreateDate"));
  const modified = parseDate(value("ModifyDate", "DateTime", "xmp:ModifyDate", "xmp:MetadataDate"));
  if (taken && modified && modified.getTime() - taken.getTime() > 60_000) {
    add({ id: "dates", severity: "medium", title: `Changed ${duration(modified.getTime() - taken.getTime())} after it was taken`, items: [`Taken: ${value("DateTimeOriginal", "CreateDate", "photoshop:DateCreated", "xmp:CreateDate")}`, `Last changed: ${value("ModifyDate", "DateTime", "xmp:ModifyDate", "xmp:MetadataDate")}`] });
  }

  // Camera, location, extras.
  const make = value("Make");
  const model = value("Model");
  if (make || model) add({ id: "camera", severity: "info", title: `Taken with ${model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`.trim()}` });
  else if (!aiSigns.length) add({ id: "no-camera", severity: "info", title: "No camera details", detail: "Screenshots, downloaded images and files that were cleaned or re-saved by some apps have none." });
  if (report.location) add({ id: "location", severity: "medium", title: "Records where it was taken", detail: `GPS position ${report.location.latitude.toFixed(5)}, ${report.location.longitude.toFixed(5)}. Sanitize Metadata removes it.` });
  const trailer = entries.find((e) => e.key === "Trailer" || e.key === "MPF");
  if (trailer) add({ id: "extra-images", severity: "medium", title: "Extra data stored with the picture", detail: trailer.value });

  const quality = jpegQuality(bytes);
  if (quality !== null) add({ id: "quality", severity: "info", title: `JPEG quality about ${quality}%`, detail: quality < 75 ? "Low quality: the picture has probably been compressed again, e.g. by a messaging app or social network, which also strips its details." : undefined });

  let thumbnail: Uint8Array | null = null;
  try {
    const thumb = await exifr.thumbnail(bytes);
    thumbnail = thumb ? new Uint8Array(thumb) : null;
  } catch {
    thumbnail = null;
  }
  return { findings, thumbnail };
}
